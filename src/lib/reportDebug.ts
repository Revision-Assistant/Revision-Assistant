/**
 * Report-grounded debug helpers for findings.
 * Surfaces why a span was flagged and what to do next — from report fields + category rules.
 */

import type { Finding, FindingCategory, MatchSource, ReportOrigin } from '../types';

const NEXT_STEPS: Partial<Record<FindingCategory, string>> = {
  needs_restatement:
    'Restate the idea from memory without looking at the source wording. Keep technical terms and every citation marker; change structure and phrasing.',
  needs_new_citation:
    'If you used this source, add a bibliography entry and an in-text citation. If you did not, restate until the close overlap is gone.',
  missing_in_text_citation:
    'Add the matching in-text citation marker near this claim — the source is already in your reference list.',
  needs_citation_claim:
    'Add a citation for the prior-work claim, or soften the claim if it is common knowledge you are not attributing.',
  source_unidentifiable:
    'Do not invent a citation. Restate in your own words if the overlap is not coincidence; disclose recycled coursework if relevant.',
  ai_flagged:
    'Revise for ownership: concrete numbers, named entities, your citations, and varied sentence rhythm. Do not chase a detector score.',
  review_manually:
    'Open the original report PDF next to this highlight and decide whether the overlap or AI cue still applies after alignment.',
  already_cited:
    'Confirm the nearby citation covers this claim. If wording is still too close, lightly restate while keeping the marker.',
  trivial_match:
    'Glance for distinctive phrasing; most sub-1% matches are shared terminology you can dismiss.',
  properly_quoted: 'No rewrite needed if the quote is accurate and cited.',
  reference_entry: 'No action — bibliography matches are expected.',
  methods_boilerplate: 'Usually leave as-is unless your institution requires restatement.',
  common_phrase: 'Usually dismiss after a quick check that it is not a distinctive borrowed phrase.',
  orphan_reference: 'Cite it in the body where used, or remove it from the reference list.',
  broken_citation: 'Fix the marker number or add the missing bibliography entry.',
  grammar_error: 'Apply the suggested fix or dismiss if intentional.',
  numerical_ambiguity:
    'Add the unit, sample size (n), comparison baseline, uncertainty (CI / ±), or exact value.',
  numerical_inconsistency:
    'Reconcile the two reported values for the same quantity, or state distinct conditions (train vs test, baseline vs proposed).',
  publication_issue:
    'Replace boilerplate with concrete steps or report the actual quantitative result in the sentence.',
  novelty_issue:
    'Scope the novelty claim, name a comparison baseline, or drop “novel/first” if it cannot be substantiated.',
};

export function originLabel(origin: ReportOrigin | null | undefined): string {
  switch (origin) {
    case 'similarity_report':
      return 'Similarity / originality report';
    case 'ai_report':
      return 'AI writing report';
    case 'local_heuristic':
      return 'Local voice heuristic (no AI-report span aligned)';
    default:
      return 'Analysis rules';
  }
}

export function nextStepForFinding(f: Finding): string {
  if (f.suggestion?.trim() && (f.category === 'needs_new_citation' || f.category === 'missing_in_text_citation')) {
    return f.suggestion.trim();
  }
  return NEXT_STEPS[f.category] || 'Review the highlight and decide whether a revision is needed.';
}

export function formatSourceLine(s: MatchSource): string {
  const pct = s.percentage != null ? `${s.percentage}%` : '?%';
  const type = s.sourceType && s.sourceType !== 'unknown' ? ` · ${s.sourceType.replace('_', ' ')}` : '';
  const url = s.url ? ` — ${s.url}` : '';
  return `${pct} · ${s.title || 'Untitled source'}${type}${url}`;
}

/** Structured evidence rows for the finding detail panel */
export function reportEvidenceRows(f: Finding): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  if (f.reportOrigin) {
    rows.push({ label: 'Signal source', value: originLabel(f.reportOrigin) });
  }

  if (f.kind === 'similarity' || f.matchPct != null) {
    if (f.matchPct != null) {
      rows.push({
        label: 'Match weight',
        value: f.matchPct < 1 ? `<1% of document (trivial fragment)` : `~${f.matchPct}% attributed to this source`,
      });
    }
  }

  if (f.page > 0) {
    rows.push({ label: 'Manuscript page', value: String(f.page) });
  }

  if (f.numericalConflict) {
    rows.push({
      label: 'Conflicting values',
      value: `${f.numericalConflict.metricLabel}: ${f.numericalConflict.valueA} vs ${f.numericalConflict.valueB}`,
    });
  }

  if (f.relatedSpan) {
    rows.push({
      label: `Other mention (p.${f.relatedSpan.page})`,
      value: f.relatedSpan.text.trim().slice(0, 400),
    });
  }

  const sources = f.sources?.length
    ? f.sources
    : f.sourceTitle
      ? [
          {
            title: f.sourceTitle,
            url: f.sourceUrl,
            percentage: f.matchPct ?? 0,
            sourceType: f.sourceType || ('unknown' as const),
          },
        ]
      : [];

  if (sources.length > 0) {
    rows.push({
      label: sources.length === 1 ? 'Report source' : 'Report sources',
      value: sources.map(formatSourceLine).join('\n'),
    });
  }

  if (f.positionOnly) {
    rows.push({
      label: 'Extent',
      value:
        'Report marks where the match/AI cue sits, not how much of the sentence overlaps — only part of the highlight may apply.',
    });
  }

  if (
    f.reportText &&
    f.reportText.trim() &&
    f.reportText.trim() !== f.text.trim() &&
    f.reportOrigin !== 'local_heuristic'
  ) {
    rows.push({
      label: 'Report excerpt',
      value: f.reportText.trim().slice(0, 500),
    });
  }

  rows.push({ label: 'Category rule', value: f.category.replace(/_/g, ' ') });

  return rows;
}

/** Compact payload for LLM explain — keep under char budgets at the call site */
export function reportDebugForExplain(f: Finding): Record<string, unknown> {
  return {
    reportOrigin: f.reportOrigin ?? null,
    reportText: f.reportText ? f.reportText.slice(0, 400) : null,
    positionOnly: !!f.positionOnly,
    sources: (f.sources || [])
      .slice(0, 5)
      .map((s) => ({
        title: s.title?.slice(0, 160),
        url: s.url,
        percentage: s.percentage,
        sourceType: s.sourceType,
      })),
    matchPct: f.matchPct,
    page: f.page,
    nextStepHint: nextStepForFinding(f).slice(0, 280),
  };
}
