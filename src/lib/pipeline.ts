/**
 * End-to-end client-side processing pipeline (Stages 1–4, local Stage 5 fallback).
 * Groq explanations are optional via Netlify function.
 */

import type {
  AnalysisResult,
  Finding,
  PipelineProgress,
  ProjectMeta,
} from '../types';
import { parsePaper, parsePaperFromDocx } from './pdf/paperParser';
import { parseSimilarityReport, parseAIReport } from './pdf/reportParser';
import { alignSimilarityFlags, alignAIFlags } from './alignment/fuzzyMatch';
import { categorizeAll, needsLlmExplanation } from './categorize/rules';
import { computeAIFeatures, localAIExplanation } from './ai/features';
import { UnsupportedReportFormatError } from './pdf/fingerprint';
import { checkGrammar } from './grammar/languageTool';
import { filterGrammarFindingsWithLlm } from './grammar/grammarFilterClient';
import { enrichCitationSuggestions } from './citation/crossref';
import { detectCitationNeed } from './citation/citationNeed';
import { detectCitationNeedSmart } from './citation/citationNeedModel';
import { detectManuscriptQuality } from './quality/manuscriptQuality';
import { detectManuscriptQualitySmart } from './quality/manuscriptQualityModel';
import { detectNumericalInconsistencies } from './quality/numericalInconsistency';
import { scanAiSpansSmart } from './ai/aiDetectModel';
import {
  EXPLAIN_MAX_CONTEXT_CHARS,
  EXPLAIN_MAX_PAYLOAD_CHARS,
  EXPLAIN_MAX_SPANS,
  EXPLAIN_MAX_TEXT_CHARS,
  truncateForExplain,
} from './files/limits';
import { reportDebugForExplain } from './reportDebug';

export type ProgressCb = (p: PipelineProgress) => void;

export interface PipelineInputs {
  paperFile: ArrayBuffer;
  /** true when paperFile is a .docx buffer rather than PDF */
  paperIsDocx?: boolean;
  similarityPdf?: ArrayBuffer | null;
  aiPdf?: ArrayBuffer | null;
  title?: string;
  /** If true, call Netlify function for escalated spans */
  requestLlm?: boolean;
  /** If true (default), run LanguageTool grammar/style checking */
  requestGrammar?: boolean;
  /**
   * If true, run the in-browser SciBERT citation-need model (~110 MB quantized ONNX).
   * Falls back to the regex rules silently when the model isn't available.
   * Off by default so first-paint analysis stays light.
   */
  requestCitationModel?: boolean;
  /**
   * If true (default), run the in-browser manuscript-quality model
   * (numerical / publication / novelty-claim flags). Falls back to rules.
   */
  requestQualityModel?: boolean;
  /** Supabase access token for authenticated rate-limited calls */
  accessToken?: string | null;
}

async function explainViaApi(
  findings: Finding[],
  paperContext: { citationStyle: string; surrounding: Record<string, string> },
  accessToken?: string | null
): Promise<Finding[]> {
  const escalated = findings.filter(needsLlmExplanation).slice(0, EXPLAIN_MAX_SPANS);
  if (escalated.length === 0) return findings;

  const buildSpans = (list: typeof escalated) =>
    list.map((f) => ({
      id: f.id,
      kind: f.kind,
      category: f.category,
      text: truncateForExplain(f.text, EXPLAIN_MAX_TEXT_CHARS),
      sourceTitle: f.sourceTitle
        ? truncateForExplain(f.sourceTitle, 200)
        : f.sourceTitle,
      sourceUrl: f.sourceUrl,
      sourceType: f.sourceType,
      matchPct: f.matchPct,
      aiFeatures: f.aiFeatures,
      reportDebug: reportDebugForExplain(f),
      context: truncateForExplain(
        paperContext.surrounding[f.id] || '',
        EXPLAIN_MAX_CONTEXT_CHARS
      ),
    }));

  let spans = buildSpans(escalated);
  let payload = { spans, citationStyle: paperContext.citationStyle };
  let body = JSON.stringify(payload);
  // Stay under Netlify function body limits on the free public MVP.
  while (body.length > EXPLAIN_MAX_PAYLOAD_CHARS && spans.length > 4) {
    spans = spans.slice(0, Math.ceil(spans.length * 0.7));
    payload = { spans, citationStyle: paperContext.citationStyle };
    body = JSON.stringify(payload);
  }

  try {
    const res = await fetch('/.netlify/functions/explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body,
    });

    if (!res.ok) {
      console.warn('LLM explain failed', res.status, await res.text());
      return findings;
    }

    const data = (await res.json()) as {
      explanations?: { id: string; explanation: string; suggestion?: string }[];
    };

    const map = new Map((data.explanations || []).map((e) => [e.id, e]));
    return findings.map((f) => {
      const e = map.get(f.id);
      if (!e) return f;
      return {
        ...f,
        explanation: e.explanation || f.explanation,
        suggestion: e.suggestion ?? f.suggestion,
      };
    });
  } catch (err) {
    console.warn('LLM explain error', err);
    return findings;
  }
}

function surroundingContext(
  fullText: string,
  start: number,
  end: number,
  sentences = 2
): string {
  // Approximate: take ~200 chars before/after
  const before = fullText.slice(Math.max(0, start - 250), start);
  const after = fullText.slice(end, Math.min(fullText.length, end + 250));
  void sentences;
  return `…${before}【${fullText.slice(start, end)}】${after}…`;
}

export async function runPipeline(
  inputs: PipelineInputs,
  onProgress?: ProgressCb
): Promise<AnalysisResult> {
  const report = (stage: PipelineProgress['stage'], message: string, percent: number) => {
    onProgress?.({ stage, message, percent });
  };

  // Keep a private copy before parsers (pdf.js / mammoth) touch the buffer — needed for
  // layout-preserving PDF export and safe even when extractors already clone internally.
  const sourceBytes = inputs.paperFile.slice(0);

  report(
    'parsing_paper',
    inputs.paperIsDocx
      ? 'Extracting text from Word (.docx)…'
      : 'Extracting text from PDF pages…',
    5
  );
  const paper = inputs.paperIsDocx
    ? await parsePaperFromDocx(inputs.paperFile)
    : await parsePaper(inputs.paperFile);

  if (!paper.fullText.trim()) {
    throw new Error(
      'No extractable text found in the manuscript. If this is a scanned PDF, use a text-based export or DOCX.'
    );
  }

  report(
    'parsing_paper',
    `Manuscript ready · ${paper.pageCount} page${paper.pageCount === 1 ? '' : 's'} · ${paper.fullText.length.toLocaleString()} characters`,
    18
  );

  let similarity = null;
  let ai = null;

  report('parsing_reports', 'Reading optional similarity / AI report PDFs…', 25);
  try {
    if (inputs.similarityPdf) {
      // Paper is passed so badge positions can be mapped onto real offsets
      similarity = await parseSimilarityReport(inputs.similarityPdf, paper);
    }
  } catch (e) {
    if (e instanceof UnsupportedReportFormatError) throw e;
    throw e;
  }

  try {
    if (inputs.aiPdf) {
      ai = await parseAIReport(inputs.aiPdf);
    }
  } catch (e) {
    if (e instanceof UnsupportedReportFormatError) throw e;
    throw e;
  }

  if (!similarity && !ai) {
    // Still useful: citation integrity only
    report('categorizing', 'No similarity reports — checking citation integrity…', 70);
  }

  report('aligning', 'Aligning flagged spans to your paper…', 45);
  const simAligned = similarity
    ? alignSimilarityFlags(similarity.flags, paper)
    : { aligned: [], matchRate: 1 };
  let aiAligned = ai ? alignAIFlags(ai.flags, paper) : [];
  // Force AI-path support even without a Turnitin AI PDF: trained detector when
  // VITE_AI_MODEL_ID is set, heuristic voice scan otherwise (handled inside).
  if (aiAligned.length === 0) {
    report('aligning', 'Scanning for machine-like prose (local AI assist)…', 50);
    aiAligned = await scanAiSpansSmart(paper);
  }

  if (similarity && simAligned.matchRate < 0.5 && similarity.flags.length > 0) {
    console.warn(
      `Low alignment rate: ${(simAligned.matchRate * 100).toFixed(0)}%. PDF reflow may be severe.`
    );
  }

  report('categorizing', 'Categorizing findings with rules…', 65);
  let findings = categorizeAll(
    simAligned.aligned,
    aiAligned,
    paper,
    computeAIFeatures
  );

  // Local explanations for AI + actionable items
  findings = findings.map((f) => {
    if (f.kind === 'ai' && f.aiFeatures && !f.explanation) {
      const origin =
        f.reportOrigin === 'ai_report' || f.reportOrigin === 'local_heuristic'
          ? f.reportOrigin
          : null;
      return { ...f, explanation: localAIExplanation(f.aiFeatures, f.text, origin) };
    }
    return f;
  });

  // Deep citation-need model is opt-in (≈110 MB ONNX); App enables it explicitly.
  const wantCitationModel = inputs.requestCitationModel === true;
  if (wantCitationModel) {
    report('citation_need', 'Running deep citation-need check (local model)…', 68);
    const citationFindings = await detectCitationNeedSmart(paper, {
      onProgress: (done, total) => {
        report(
          'citation_need',
          `Deep citation-need check… ${done}/${total}`,
          68 + Math.round((done / Math.max(total, 1)) * 3)
        );
      },
    });
    findings = findings.concat(citationFindings);
  } else {
    findings = findings.concat(detectCitationNeed(paper));
  }

  // Manuscript quality — numerical ambiguity, publication craft, novelty-claim phrasing
  const wantQualityModel = inputs.requestQualityModel !== false;
  if (wantQualityModel) {
    report('manuscript_quality', 'Running manuscript-quality check (local model)…', 71);
    const qualityFindings = await detectManuscriptQualitySmart(paper, {
      onProgress: (done, total) => {
        report(
          'manuscript_quality',
          `Manuscript-quality check… ${done}/${total}`,
          71 + Math.round((done / Math.max(total, 1)) * 2)
        );
      },
    });
    findings = findings.concat(qualityFindings);
  } else {
    findings = findings.concat(detectManuscriptQuality(paper));
  }

  // Numerical inconsistency — same metric/unit with conflicting values (rules, high precision)
  report('manuscript_quality', 'Checking numerical consistency…', 73);
  findings = findings.concat(detectNumericalInconsistencies(paper));

  // Grammar is always on (LanguageTool → local STEM/name filters → optional LLM keep/drop)
  report('grammar_check', 'Checking grammar and style (LanguageTool)…', 74);
  try {
    let grammarFindings = await checkGrammar(paper, {
      onProgress: (done, total) => {
        report(
          'grammar_check',
          `Checking grammar and style (LanguageTool)… ${done}/${total}`,
          74 + Math.round((done / Math.max(total, 1)) * 4)
        );
      },
    });
    report('grammar_check', 'Reviewing grammar with AI…', 79);
    grammarFindings = await filterGrammarFindingsWithLlm(grammarFindings, {
      accessToken: inputs.accessToken,
      onProgress: (message) => report('grammar_check', message, 79),
    });
    findings = findings.concat(grammarFindings);
  } catch (err) {
    console.warn('Grammar check failed', err);
  }

  // Real citation metadata for sources not in the reference list (Crossref lookup —
  // never fabricates fields, only upgrades a bare title/URL suggestion when a confident match exists)
  try {
    findings = await enrichCitationSuggestions(findings, paper.detectedCitationStyle);
  } catch (err) {
    console.warn('Crossref enrichment failed', err);
  }

  // LLM explain always attempted (Vite dev plugin or Netlify function)
  report('explaining', 'Requesting revision guidance for escalated spans…', 80);
  const surrounding: Record<string, string> = {};
  for (const f of findings) {
    if (needsLlmExplanation(f) && f.startOffset >= 0) {
      surrounding[f.id] = surroundingContext(
        paper.fullText,
        f.startOffset,
        f.endOffset
      );
    }
  }
  findings = await explainViaApi(
    findings,
    { citationStyle: paper.detectedCitationStyle, surrounding },
    inputs.accessToken
  );

  const meta: ProjectMeta = {
    title: inputs.title || 'Untitled paper',
    similarityPct: similarity?.overallPct ?? null,
    aiPct: ai?.overallPct ?? null,
    reportFormatVersion:
      [similarity?.formatVersion, ai?.formatVersion].filter(Boolean).join('+') ||
      null,
    citationStyle: paper.detectedCitationStyle,
  };

  report('done', 'Analysis complete', 100);
  return {
    paper,
    similarity,
    ai,
    findings,
    meta,
    sourceBytes,
    sourceKind: inputs.paperIsDocx ? 'docx' : 'pdf',
  };
}

export { UnsupportedReportFormatError };
