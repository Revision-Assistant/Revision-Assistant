/**
 * Export package for Resubmission Reformatter: bibliography + change notes + checklist.
 * Layout-preserving PDF rewrite is intentionally NOT included.
 */

import type { RequirementsDelta } from './requirementsDelta';
import { formatDeltaMarkdown } from './requirementsDelta';
import type { RenderedRef } from './renderBibliography';
import { formatBibliographyText } from './renderBibliography';
import { getStyle } from './styles';

export interface ReformatExportInput {
  title: string;
  styleId: string;
  rendered: RenderedRef[];
  delta: RequirementsDelta | null;
  /** Optional short notes from the author */
  authorNotes?: string;
}

function changeNotesMarkdown(rendered: RenderedRef[], styleId: string): string {
  const style = getStyle(styleId);
  const lines = [
    `# Citation restyle notes — ${style.label}`,
    '',
    'This package restyles the **bibliography** only.',
    'In-text citation rewriting with a live change map is planned for a later release.',
    'Do **not** expect a layout-preserving PDF rewrite from this tool.',
    '',
    '| # | Confidence | Source | Old (excerpt) | New (excerpt) |',
    '|---|------------|--------|---------------|---------------|',
  ];
  for (const r of rendered) {
    const oldEx = r.raw.replace(/\|/g, '\\|').slice(0, 80).replace(/\s+/g, ' ');
    const newEx = r.rendered.replace(/\|/g, '\\|').slice(0, 80).replace(/\s+/g, ' ');
    lines.push(`| ${r.index} | ${r.confidence} | ${r.source} | ${oldEx} | ${newEx} |`);
  }
  lines.push('');
  const low = rendered.filter((r) => r.confidence === 'low').length;
  if (low > 0) {
    lines.push(
      `**${low} entr${low === 1 ? 'y needs' : 'ies need'} manual review** (low confidence). Nothing was dropped.`
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function buildReformatPackage(input: ReformatExportInput): string {
  const parts: string[] = [
    `# Resubmission reformatter package`,
    '',
    `Manuscript: ${input.title || '(untitled)'}`,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '---',
    '',
    formatBibliographyText(input.rendered, input.styleId),
    '---',
    '',
    changeNotesMarkdown(input.rendered, input.styleId),
  ];

  if (input.delta) {
    parts.push('---', '', formatDeltaMarkdown(input.delta));
  }

  if (input.authorNotes?.trim()) {
    parts.push('---', '', '# Author notes', '', input.authorNotes.trim(), '');
  }

  parts.push(
    '---',
    '',
    '_Revision Assistant — privacy-first; manuscript stayed in your browser. Crossref was used only if you opted in (reference strings only)._'
  );

  return parts.join('\n');
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
