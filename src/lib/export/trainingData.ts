/**
 * Training-label export (plan.md §9 item 1).
 *
 * `findings.status` is the asset: every accept/dismiss is a human judgement on whether a
 * flag was real. plan.md calls this "the moat — nobody else has your label set", and says
 * to log it from day one even though the classifier is months away.
 *
 * This emits one JSONL row per decided finding with its engineered features, ready to load
 * straight into pandas. No paper text leaves the browser beyond the flagged span itself,
 * which the author already sees.
 */

import type { Finding, ParsedPaper, ProjectMeta } from '../../types';
import { downloadText } from './changeLog';

export interface TrainingRow {
  /** Label: 1 = author agreed the flag was real, 0 = author dismissed it */
  label: number;
  kind: string;
  category: string;
  /** Engineered features — keep names stable; the notebook reads them positionally by key */
  f_word_count: number;
  f_char_count: number;
  f_match_pct: number | null;
  f_source_type: string | null;
  f_section: string | null;
  f_page: number;
  f_confidence: number;
  f_is_informational: number;
  f_has_citation_marker: number;
  f_in_quotes: number;
  f_has_numbers: number;
  f_attribution_cue: number | null;
  f_claim_cue: number | null;
  f_nearby_citation: number | null;
  f_own_work: number | null;
  f_ai_sentence_variance: number | null;
  f_ai_hedging: number | null;
  f_ai_entities: number | null;
  /** Kept for error analysis; drop before training if you want a text-free dataset */
  text: string;
  was_edited: number;
}

function sectionAtOffset(paper: ParsedPaper, offset: number): string | null {
  for (const s of paper.sections) {
    if (offset >= s.startOffset && offset < s.endOffset) return s.name;
  }
  return null;
}

export function buildTrainingRows(
  paper: ParsedPaper,
  findings: Finding[]
): TrainingRow[] {
  return findings
    // Only decided findings carry signal; "open" means the author never judged it
    .filter((f) => f.status === 'accepted' || f.status === 'dismissed' || f.status === 'edited')
    .map((f) => {
      const words = f.text.trim().split(/\s+/).filter(Boolean).length;
      const cn = f.citationNeedFeatures;
      const ai = f.aiFeatures;

      return {
        label: f.status === 'dismissed' ? 0 : 1,
        kind: f.kind,
        category: f.category,
        f_word_count: words,
        f_char_count: f.text.length,
        f_match_pct: f.matchPct,
        f_source_type: f.sourceType,
        f_section: sectionAtOffset(paper, f.startOffset),
        f_page: f.page,
        f_confidence: f.confidence,
        f_is_informational: f.isInformational ? 1 : 0,
        f_has_citation_marker: /\[\d+\]|\([A-Z][a-z]+[^)]*\d{4}\)/.test(f.text) ? 1 : 0,
        f_in_quotes: /["“”]/.test(f.text) ? 1 : 0,
        f_has_numbers: /\d/.test(f.text) ? 1 : 0,
        f_attribution_cue: cn ? (cn.hasAttributionCue ? 1 : 0) : null,
        f_claim_cue: cn ? (cn.hasClaimCue ? 1 : 0) : null,
        f_nearby_citation: cn ? (cn.hasNearbyCitation ? 1 : 0) : null,
        f_own_work: cn ? (cn.isOwnWork ? 1 : 0) : null,
        f_ai_sentence_variance: ai?.sentenceLengthVariance ?? null,
        f_ai_hedging: ai?.hedgingDensity ?? null,
        f_ai_entities: ai?.concreteEntityCount ?? null,
        text: f.text.slice(0, 600),
        was_edited: f.status === 'edited' ? 1 : 0,
      };
    });
}

export function toJsonl(rows: TrainingRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

export function exportTrainingData(
  meta: ProjectMeta,
  paper: ParsedPaper,
  findings: Finding[]
): number {
  const rows = buildTrainingRows(paper, findings);
  if (rows.length === 0) return 0;

  const safe = meta.title.replace(/[^\w-]+/g, '_').slice(0, 40) || 'paper';
  downloadText(`${safe}_labels.jsonl`, toJsonl(rows), 'application/x-ndjson');
  return rows.length;
}
