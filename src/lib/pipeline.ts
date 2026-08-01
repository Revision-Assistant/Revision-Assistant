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
import { enrichCitationSuggestions } from './citation/crossref';
import { detectCitationNeed } from './citation/citationNeed';
import { detectCitationNeedSmart } from './citation/citationNeedModel';
import { scanLocalAiSpans } from './ai/localScan';

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
  /** Supabase access token for authenticated rate-limited calls */
  accessToken?: string | null;
}

async function explainViaApi(
  findings: Finding[],
  paperContext: { citationStyle: string; surrounding: Record<string, string> },
  accessToken?: string | null
): Promise<Finding[]> {
  const escalated = findings.filter(needsLlmExplanation);
  if (escalated.length === 0) return findings;

  const payload = {
    spans: escalated.map((f) => ({
      id: f.id,
      kind: f.kind,
      category: f.category,
      text: f.text,
      sourceTitle: f.sourceTitle,
      sourceUrl: f.sourceUrl,
      sourceType: f.sourceType,
      matchPct: f.matchPct,
      aiFeatures: f.aiFeatures,
      context: paperContext.surrounding[f.id] || '',
    })),
    citationStyle: paperContext.citationStyle,
  };

  try {
    const res = await fetch('/.netlify/functions/explain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
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

  report('parsing_paper', inputs.paperIsDocx ? 'Parsing paper DOCX…' : 'Parsing paper PDF…', 5);
  const paper = inputs.paperIsDocx
    ? await parsePaperFromDocx(inputs.paperFile)
    : await parsePaper(inputs.paperFile);

  let similarity = null;
  let ai = null;

  report('parsing_reports', 'Parsing Turnitin reports…', 25);
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
    report('categorizing', 'No Turnitin reports — checking citation integrity…', 70);
  }

  report('aligning', 'Aligning flagged spans to your paper…', 45);
  const simAligned = similarity
    ? alignSimilarityFlags(similarity.flags, paper)
    : { aligned: [], matchRate: 1 };
  let aiAligned = ai ? alignAIFlags(ai.flags, paper) : [];
  // Force AI-path support even without a Turnitin AI PDF: local voice heuristics.
  if (aiAligned.length === 0) {
    report('aligning', 'Scanning for machine-like prose (local AI assist)…', 50);
    aiAligned = scanLocalAiSpans(paper);
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
      return { ...f, explanation: localAIExplanation(f.aiFeatures, f.text) };
    }
    return f;
  });

  // Claims needing attribution — always run deep model when available (forced support).
  const wantCitationModel = inputs.requestCitationModel !== false;
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

  // Grammar is always on
  report('grammar_check', 'Checking grammar and style (LanguageTool)…', 72);
  try {
    const grammarFindings = await checkGrammar(paper, {
      onProgress: (done, total) => {
        report(
          'grammar_check',
          `Checking grammar and style (LanguageTool)… ${done}/${total}`,
          72 + Math.round((done / Math.max(total, 1)) * 6)
        );
      },
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
  return { paper, similarity, ai, findings, meta };
}

export { UnsupportedReportFormatError };
