/**
 * Crossref metadata lookup for "needs new citation" findings (plan.md Stage 4:
 * "Publication source → Match against reference list, Crossref lookup").
 *
 * Never fabricates: only upgrades a suggestion when the top Crossref hit's title is a
 * confident match for what Turnitin actually reported. On any doubt, leaves the existing
 * bare title/URL suggestion alone rather than asserting possibly-wrong metadata.
 */

import type { CitationStyle, Finding } from '../../types';
import { similarity as textSim } from '../alignment/fuzzyMatch';
import { formatCitation } from './format';

const CROSSREF_URL = 'https://api.crossref.org/works';
const MATCH_THRESHOLD = 0.6;

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefItem {
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
}

export async function lookupCrossref(title: string): Promise<{
  title: string;
  author: string[];
  issued: string | null;
  containerTitle: string | null;
} | null> {
  if (!title || title.trim().length < 8) return null;

  const url = `${CROSSREF_URL}?query.bibliographic=${encodeURIComponent(title)}&rows=1`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as { message?: { items?: CrossrefItem[] } };
  const item = data.message?.items?.[0];
  const hitTitle = item?.title?.[0];
  if (!item || !hitTitle) return null;

  // Conservative gate: reject anything that isn't clearly the same paper Turnitin reported.
  if (textSim(title, hitTitle) < MATCH_THRESHOLD) return null;

  const year = item.issued?.['date-parts']?.[0]?.[0];
  return {
    title: hitTitle,
    author: (item.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean),
    issued: year ? String(year) : null,
    containerTitle: item['container-title']?.[0] || null,
  };
}

/**
 * Upgrade needs_new_citation suggestions with real formatted citations where a confident
 * Crossref match exists. Runs sequentially with a small cap so one missing paper doesn't
 * stall analysis; failures fall back silently to the existing bare title/URL suggestion.
 */
export async function enrichCitationSuggestions(
  findings: Finding[],
  citationStyle: CitationStyle,
  maxLookups = 12
): Promise<Finding[]> {
  const targets = findings.filter((f) => f.category === 'needs_new_citation' && f.sourceTitle);
  if (targets.length === 0) return findings;

  const enriched = new Map<string, string>();
  for (const f of targets.slice(0, maxLookups)) {
    try {
      const hit = await lookupCrossref(f.sourceTitle!);
      if (!hit) continue;
      const formatted = formatCitation(
        { title: hit.title, author: hit.author, issued: hit.issued, containerTitle: hit.containerTitle, URL: f.sourceUrl },
        citationStyle
      );
      enriched.set(f.id, `Consider citing: ${formatted}`);
    } catch (err) {
      console.warn('Crossref lookup failed', err);
    }
  }

  if (enriched.size === 0) return findings;
  return findings.map((f) => (enriched.has(f.id) ? { ...f, suggestion: enriched.get(f.id)! } : f));
}
