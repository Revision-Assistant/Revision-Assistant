/**
 * Requirements delta checklist — compare ParsedPaper stats against curated venue requirements.
 */

import type { ParsedPaper } from '../../types';
import {
  analyzeCallouts,
  buildSubmissionChecklist,
  extractKeywords,
  type CheckStatus,
  type VenueStyleId,
} from '../submission/checklist';
import { checkStatements } from '../submission/statements';
import type { VenueRequirements } from './venueRequirements';
import { getStyle } from './styles';

export interface DeltaItem {
  id: string;
  label: string;
  status: CheckStatus | 'cant_check';
  detail: string;
}

export interface RequirementsDelta {
  venueLabel: string;
  styleId: string;
  styleLabel: string;
  lastVerified: string;
  disclaimer: string;
  items: DeltaItem[];
  passCount: number;
  warnCount: number;
  failCount: number;
  cantCheckCount: number;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function abstractText(paper: ParsedPaper): string | null {
  const abs = paper.sections.find((s) => s.name === 'Abstract');
  if (!abs) return null;
  return paper.fullText.slice(abs.startOffset, abs.endOffset);
}

function hasHighlights(fullText: string): boolean {
  return /(?:^|\n)\s*highlights?\s*[:\n]/i.test(fullText.slice(0, 8000));
}

function structuredAbstractHint(abs: string): boolean {
  return /\b(background|objective|methods?|results?|conclusions?)\s*:/i.test(abs);
}

export function buildRequirementsDelta(
  paper: ParsedPaper,
  req: VenueRequirements,
  title = ''
): RequirementsDelta {
  const items: DeltaItem[] = [];
  const style = getStyle(req.styleId);
  const archetype: VenueStyleId = req.archetype ?? 'generic';

  // Reuse archetype checklist, then add venue-specific deltas
  const base = buildSubmissionChecklist(paper, archetype, title);
  for (const it of base.items) {
    items.push({
      id: `base-${it.id}`,
      label: it.label,
      status: it.status,
      detail: it.detail,
    });
  }

  const abs = abstractText(paper);
  if (req.abstractMaxWords != null || req.abstractMinWords != null) {
    if (!abs) {
      items.push({
        id: 'abs-limit',
        label: 'Abstract within venue word limit',
        status: 'fail',
        detail: 'No Abstract section detected.',
      });
    } else {
      const w = wordCount(abs);
      const min = req.abstractMinWords ?? 0;
      const max = req.abstractMaxWords ?? 9999;
      const ok = w >= min && w <= max;
      items.push({
        id: 'abs-limit',
        label: `Abstract ≤ ${max} words${min ? ` (≥ ${min})` : ''}`,
        status: ok ? 'pass' : 'fail',
        detail: ok
          ? `Abstract ≈ ${w} words (target ${min || 0}–${max}).`
          : `Abstract ≈ ${w} words; curated target is ${min || 0}–${max}. Verify on the journal site.`,
      });
    }
  }

  if (req.abstractStructured) {
    if (!abs) {
      items.push({
        id: 'abs-struct',
        label: 'Structured abstract headings',
        status: 'fail',
        detail: 'No abstract to check for structured headings.',
      });
    } else {
      const ok = structuredAbstractHint(abs);
      items.push({
        id: 'abs-struct',
        label: 'Structured abstract headings',
        status: ok ? 'pass' : 'warn',
        detail: ok
          ? 'Abstract appears to use structured headings (Background/Methods/Results….).'
          : 'This venue pattern often wants a structured abstract — headings were not clearly detected.',
      });
    }
  }

  if (req.keywordMin != null || req.keywordMax != null) {
    const kws = extractKeywords(paper.fullText);
    const min = req.keywordMin ?? 0;
    const max = req.keywordMax ?? 20;
    const heading = req.keywordHeading || 'Keywords';
    if (kws.length === 0) {
      items.push({
        id: 'kw',
        label: `${heading} present`,
        status: 'warn',
        detail: `No keywords line detected. Curated range: ${min}–${max}.`,
      });
    } else {
      const ok = kws.length >= min && kws.length <= max;
      items.push({
        id: 'kw',
        label: `${heading} count (${min}–${max})`,
        status: ok ? 'pass' : 'warn',
        detail: `${kws.length} keyword(s) detected.`,
      });
    }
  }

  if (req.expectsNumericCitations) {
    const ok = paper.detectedCitationStyle === 'IEEE' || paper.detectedCitationStyle === 'Vancouver';
    items.push({
      id: 'cite-num',
      label: 'Numeric in-text citations',
      status: ok ? 'pass' : 'warn',
      detail: ok
        ? `Detected ${paper.detectedCitationStyle} — matches numeric venues.`
        : `Detected ${paper.detectedCitationStyle}; this venue pattern expects numeric citations. Restyle bibliography and update in-text markers (in-text rewrite preview is Phase 2).`,
    });
  }

  if (req.expectsHighlights) {
    items.push({
      id: 'highlights',
      label: 'Research highlights (3–5 bullets)',
      status: hasHighlights(paper.fullText) ? 'pass' : 'fail',
      detail: hasHighlights(paper.fullText)
        ? 'A Highlights section/heading was detected near the front matter.'
        : 'Highlights not found — many Elsevier-style venues want 3–5 bullet research highlights.',
    });
  }

  const statements = checkStatements(paper);
  if (req.expectsConflictStatement) {
    const conflict = statements.items.find((s) => /conflict|interest/i.test(s.label));
    items.push({
      id: 'coi',
      label: 'Conflict of interest / competing interests statement',
      status: conflict?.status === 'ok' ? 'pass' : 'warn',
      detail:
        conflict?.why ||
        'Could not confirm a conflict-of-interest statement — add one if the journal requires it.',
    });
  }
  if (req.expectsDataAvailability) {
    const data = statements.items.find((s) => /data/i.test(s.label));
    items.push({
      id: 'data',
      label: 'Data availability statement',
      status: data?.status === 'ok' ? 'pass' : 'warn',
      detail:
        data?.why ||
        'Data-availability wording not clearly detected — required by many OA venues.',
    });
  }

  if (req.wordLimit != null) {
    const bodyWords = wordCount(paper.fullText);
    items.push({
      id: 'wordcap',
      label: `Manuscript length vs ~${req.wordLimit} word guidance`,
      status: bodyWords <= req.wordLimit * 1.15 ? 'pass' : 'warn',
      detail: `Full extracted text ≈ ${bodyWords} words (includes refs). Soft check only — journal limits often exclude references.`,
    });
  }

  const figs = analyzeCallouts(paper, 'figure');
  items.push({
    id: 'fig-res',
    label: 'Figure resolution / file format',
    status: 'cant_check',
    detail:
      figs.count > 0
        ? `${figs.count} figure callout(s) found — resolution/DPI cannot be checked from extracted text.`
        : 'No figure callouts detected; figure file specs cannot be checked here.',
  });

  items.push({
    id: 'style-target',
    label: `Target reference style: ${style.label}`,
    status: style.unsupported ? 'fail' : 'pass',
    detail: style.unsupported
      ? style.note || 'This citation form is not supported in the MVP.'
      : `Bibliography will be rendered with the ${style.label} template${style.note ? ` (${style.note})` : ''}.`,
  });

  const passCount = items.filter((i) => i.status === 'pass').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const failCount = items.filter((i) => i.status === 'fail').length;
  const cantCheckCount = items.filter((i) => i.status === 'cant_check').length;

  return {
    venueLabel: req.label,
    styleId: req.styleId,
    styleLabel: style.label,
    lastVerified: req.lastVerified,
    disclaimer: `Curated from public author-guideline patterns (last verified: ${req.lastVerified}). Journals change requirements — always verify on the journal site. Not affiliated with the publisher.`,
    items,
    passCount,
    warnCount,
    failCount,
    cantCheckCount,
  };
}

export function formatDeltaMarkdown(delta: RequirementsDelta): string {
  const lines = [
    `# Requirements delta — ${delta.venueLabel}`,
    '',
    delta.disclaimer,
    '',
    `Style target: ${delta.styleLabel}`,
    `Summary: ${delta.passCount} pass · ${delta.warnCount} warn · ${delta.failCount} fail · ${delta.cantCheckCount} can't check`,
    '',
  ];
  for (const it of delta.items) {
    const mark =
      it.status === 'pass' ? '✓' : it.status === 'fail' ? '✗' : it.status === 'warn' ? '!' : '?';
    lines.push(`- [${mark}] **${it.label}** — ${it.detail}`);
  }
  lines.push('');
  return lines.join('\n');
}
