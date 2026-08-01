/**
 * Format a suggested citation via citation-js when metadata exists.
 * Never fabricates fields — only formats what was provided (plan.md decision #4:
 * "use citation-js, don't hand-roll it").
 */

import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';
import type { CitationStyle } from '../../types';

export interface CiteInput {
  title?: string | null;
  URL?: string | null;
  author?: string[];
  /** Publication year as a string, e.g. "2020" */
  issued?: string | null;
  containerTitle?: string | null;
}

/**
 * citation-js's bundled CSL styles are apa, vancouver, harvard1 — there is no bundled
 * IEEE template. Vancouver is the closest available numbered style, so IEEE/unknown map
 * to it rather than pulling in a remote CSL file at runtime.
 */
const TEMPLATE_BY_STYLE: Record<CitationStyle, string> = {
  APA: 'apa',
  Harvard: 'harvard1',
  Vancouver: 'vancouver',
  IEEE: 'vancouver',
  unknown: 'apa',
};

/** Best-effort plain-text citation via citation-js; falls back to title + URL on any failure. */
export function formatCitation(input: CiteInput, style: CitationStyle = 'APA'): string {
  const title = input.title?.trim() || 'Untitled source';
  const fallback = `${title}${input.URL ? ` ${input.URL}` : ''}`;

  const year = input.issued && /^\d{4}$/.test(input.issued) ? parseInt(input.issued, 10) : null;

  const csl: Record<string, unknown> = {
    id: 'suggested',
    type: 'article-journal',
    title,
  };
  if (input.author?.length) {
    csl.author = input.author.map((name) => ({ literal: name }));
  }
  if (year) {
    csl.issued = { 'date-parts': [[year]] };
  }
  if (input.containerTitle) {
    csl['container-title'] = input.containerTitle;
  }
  if (input.URL) {
    csl.URL = input.URL;
  }

  try {
    const cite = new Cite(csl);
    const template = TEMPLATE_BY_STYLE[style] || 'apa';
    const out = cite
      .format('bibliography', { format: 'text', template, lang: 'en-US' })
      .trim();
    return out || fallback;
  } catch (err) {
    console.warn('citation-js formatting failed, using fallback', err);
    return fallback;
  }
}
