/**
 * Export revised text + change log for supervisor review.
 */

import type { ChangeLogEntry, Finding, ParsedPaper } from '../../types';
import { checkCitationIntegrity } from '../citation/guard';

export function buildChangeLog(findings: Finding[]): ChangeLogEntry[] {
  return findings
    .filter((f) => f.status !== 'open')
    .map((f) => ({
      findingId: f.id,
      kind: f.kind,
      category: f.category,
      originalText: f.text,
      action: f.status,
      suggestion: f.suggestion,
      userNote: f.userNote ?? null,
      editedText: f.editedText ?? null,
      page: f.page,
      citationWarning:
        f.citationWarning ?? (f.editedText != null && !checkCitationIntegrity(f.text, f.editedText).ok),
    }));
}

/** Apply accepted edits into paper text (simple offset-based, descending) */
export function applyAcceptedEdits(paper: ParsedPaper, findings: Finding[]): string {
  return applyAcceptedEditsDetailed(paper, findings).text;
}

export interface AppliedEditSpan {
  findingId: string;
  start: number;
  end: number;
  page: number;
}

/** Revised text plus mapped spans for each applied edit (for clickable revised view). */
export function applyAcceptedEditsDetailed(
  paper: ParsedPaper,
  findings: Finding[]
): { text: string; applied: AppliedEditSpan[] } {
  const edits = findings
    .filter(
      (f) =>
        (f.status === 'accepted' || f.status === 'edited') &&
        f.editedText != null &&
        f.startOffset >= 0 &&
        f.endOffset > f.startOffset &&
        f.endOffset <= paper.fullText.length
    )
    .sort((a, b) => a.startOffset - b.startOffset);

  // Apply ascending with a running delta so each recorded span is exact in the
  // final string even when earlier replacements change the text length.
  const parts: string[] = [];
  const applied: AppliedEditSpan[] = [];
  let cursor = 0;
  let delta = 0;
  for (const e of edits) {
    if (e.startOffset < cursor) continue; // skip overlapping edits
    const replacement = e.editedText!;
    parts.push(paper.fullText.slice(cursor, e.startOffset));
    parts.push(replacement);
    const start = e.startOffset + delta;
    applied.push({
      findingId: e.id,
      start,
      end: start + replacement.length,
      page: e.page,
    });
    delta += replacement.length - (e.endOffset - e.startOffset);
    cursor = e.endOffset;
  }
  parts.push(paper.fullText.slice(cursor));
  return { text: parts.join(''), applied };
}

/** Safe bulk-apply: every open finding with replacementText that keeps citations. */
export function applyAllSafeReplacements(findings: Finding[]): {
  next: Finding[];
  applied: number;
  skipped: number;
} {
  let applied = 0;
  let skipped = 0;
  const next = findings.map((f) => {
    if (f.status !== 'open' || !f.replacementText) return f;
    const integrity = checkCitationIntegrity(f.text, f.replacementText);
    if (!integrity.ok) {
      skipped += 1;
      return f;
    }
    applied += 1;
    return {
      ...f,
      status: 'accepted' as const,
      editedText: f.replacementText,
      citationWarning: false,
    };
  });
  return { next, applied, skipped };
}

export function formatChangeLogMarkdown(
  title: string,
  findings: Finding[],
  meta: { similarityPct: number | null; aiPct: number | null }
): string {
  const log = buildChangeLog(findings);
  const citationIssues = log.filter((e) => e.citationWarning);
  const lines: string[] = [
    `# Revision change log: ${title}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Similarity index: ${meta.similarityPct ?? 'n/a'}%`,
    `AI writing index: ${meta.aiPct ?? 'n/a'}%`,
    '',
    `## Summary`,
    '',
    `| Status | Count |`,
    `|--------|------:|`,
    `| Accepted | ${findings.filter((f) => f.status === 'accepted').length} |`,
    `| Edited | ${findings.filter((f) => f.status === 'edited').length} |`,
    `| Dismissed | ${findings.filter((f) => f.status === 'dismissed').length} |`,
    `| Still open | ${findings.filter((f) => f.status === 'open').length} |`,
    '',
  ];

  if (citationIssues.length > 0) {
    lines.push(
      `## ⚠ Citation check — ${citationIssues.length} rewrite${citationIssues.length > 1 ? 's' : ''} may have dropped a citation`,
      '',
      'These edits removed a citation marker that was present in the original flagged passage. Review before submitting:',
      ''
    );
    citationIssues.forEach((e) => {
      lines.push(`- **${e.category}** (p.${e.page}): "${e.originalText.slice(0, 120)}${e.originalText.length > 120 ? '…' : ''}"`);
    });
    lines.push('');
  }

  lines.push(`## Decisions`, '');

  if (log.length === 0) {
    lines.push('_No accept/dismiss/edit actions recorded yet._');
  } else {
    log.forEach((e, i) => {
      lines.push(`### ${i + 1}. [${e.action}] ${e.category} (p.${e.page})`);
      lines.push('');
      lines.push(`**Original:** ${e.originalText.slice(0, 400)}${e.originalText.length > 400 ? '…' : ''}`);
      lines.push('');
      if (e.editedText) {
        lines.push(`**Revised:** ${e.editedText}`);
        lines.push('');
      }
      if (e.citationWarning) {
        lines.push('**⚠ Citation check:** this revision appears to drop a citation marker present in the original — verify before submitting.');
        lines.push('');
      }
      if (e.suggestion) {
        lines.push(`**Guidance:** ${e.suggestion}`);
        lines.push('');
      }
      if (e.userNote) {
        lines.push(`**Author note:** ${e.userNote}`);
        lines.push('');
      }
    });
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_This log was produced by a revision assistant. It does not guarantee a particular similarity score. All wording decisions remain the author\'s responsibility._'
  );

  return lines.join('\n');
}

export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on a delay — revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportRevisionPackage(
  title: string,
  paper: ParsedPaper,
  findings: Finding[],
  meta: { similarityPct: number | null; aiPct: number | null }
) {
  const revised = applyAcceptedEdits(paper, findings);
  const log = formatChangeLogMarkdown(title, findings, meta);
  const safe = title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'paper';
  downloadText(`${safe}_revised.txt`, revised);
  // Browsers often block a second synchronous download in the same tick.
  window.setTimeout(() => {
    downloadText(`${safe}_changelog.md`, log, 'text/markdown');
  }, 350);
}
