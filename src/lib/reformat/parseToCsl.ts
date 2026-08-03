/**
 * Convert parsed ReferenceEntry rows into CSL-JSON with confidence scores.
 * Never drops an entry — unresolvable fields stay null and confidence drops.
 */

import type { ReferenceEntry } from '../../types';
import { extractDoi } from '../submission/referenceHygiene';

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CslJson {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  issued?: { 'date-parts': number[][] };
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  publisher?: string;
  [key: string]: unknown;
}

export interface ParsedCslRef {
  index: number;
  raw: string;
  csl: CslJson;
  confidence: ParseConfidence;
  source: 'local' | 'crossref' | 'edited';
  /** Human-readable reason when confidence is not high */
  note?: string;
}

const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;)\]]+/i;
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)[a-z]?\b/;
const VOL_RE = /\b(?:vol\.?|volume)\s*(\d+)\b/i;
const ISSUE_RE = /\b(?:no\.?|issue|iss\.?)\s*(\d+)\b/i;
const PAGES_RE = /\bpp?\.\s*([\d]+[\u2013\-][\d]+|\d+)\b/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;

function splitAuthorNames(authors: string[]): CslName[] {
  return authors
    .map((a) => a.replace(/^\[\d+\]\s*|\d+\.\s*/, '').trim())
    .filter((a) => a.length > 1)
    .slice(0, 12)
    .map((name) => {
      // "Smith J." or "Smith, J." or "J. Smith"
      const comma = name.match(/^([^,]+),\s*(.+)$/);
      if (comma) {
        return { family: comma[1].trim(), given: comma[2].trim() };
      }
      const initialsLast = name.match(/^((?:[A-Z]\.?\s*)+)\s+([A-Z][a-zA-Z'\-]+)$/);
      if (initialsLast) {
        return { family: initialsLast[2], given: initialsLast[1].replace(/\s+/g, ' ').trim() };
      }
      const lastInitials = name.match(/^([A-Z][a-zA-Z'\-]+)\s+((?:[A-Z]\.?\s*)+)$/);
      if (lastInitials) {
        return { family: lastInitials[1], given: lastInitials[2].replace(/\s+/g, ' ').trim() };
      }
      return { literal: name };
    });
}

function scoreConfidence(opts: {
  title: string | null;
  authors: CslName[];
  year: number | null;
  doi: string | null;
  venue: string | null;
}): { confidence: ParseConfidence; note?: string } {
  const hasTitle = Boolean(opts.title && opts.title.length > 8);
  const hasAuthors = opts.authors.length > 0;
  const hasYear = opts.year != null;
  const hasDoi = Boolean(opts.doi);
  const hasVenue = Boolean(opts.venue && opts.venue.length > 2);

  if (hasDoi && hasTitle && (hasAuthors || hasYear)) {
    return { confidence: 'high' };
  }
  if (hasTitle && hasAuthors && hasYear) {
    return {
      confidence: hasVenue || hasDoi ? 'high' : 'medium',
      note: hasVenue || hasDoi ? undefined : 'Parsed locally — check venue and page numbers yourself.',
    };
  }
  if (hasTitle && (hasAuthors || hasYear)) {
    return {
      confidence: 'medium',
      note: 'Parsed locally — check author names and page numbers yourself.',
    };
  }
  return {
    confidence: 'low',
    note: 'Weak local parse — verify manually; entry was kept so nothing is dropped.',
  };
}

/** Build CSL-JSON from an already-segmented ReferenceEntry (local heuristics only). */
export function referenceToCsl(ref: ReferenceEntry): ParsedCslRef {
  const raw = ref.raw.replace(/^\[\d+\]\s*|\d+\.\s*/, '').trim();
  const doi = extractDoi(ref.raw) || (raw.match(DOI_RE)?.[0]?.replace(/[.,;]+$/, '') ?? null);
  const yearStr = ref.year || raw.match(YEAR_RE)?.[0] || null;
  const year = yearStr ? parseInt(yearStr.replace(/[a-z]/i, ''), 10) : null;
  const title = ref.title?.trim() || null;
  const venue = ref.venue?.trim() || null;
  const authorSource =
    Array.isArray(ref.authors) && ref.authors.length > 0 ? ref.authors : [];
  const authors = splitAuthorNames(authorSource);
  const volume = raw.match(VOL_RE)?.[1];
  const issue = raw.match(ISSUE_RE)?.[1];
  const page = raw.match(PAGES_RE)?.[1]?.replace(/\u2013/g, '-');
  const url = raw.match(URL_RE)?.[0]?.replace(/[.,;)]+$/, '');

  const csl: CslJson = {
    id: `ref-${ref.index}`,
    type: 'article-journal',
  };
  if (title) csl.title = title;
  else csl.title = raw.slice(0, 160);
  if (authors.length) csl.author = authors;
  if (year && year >= 1900 && year <= 2100) csl.issued = { 'date-parts': [[year]] };
  if (venue) csl['container-title'] = venue;
  if (volume) csl.volume = volume;
  if (issue) csl.issue = issue;
  if (page) csl.page = page;
  if (doi) csl.DOI = doi;
  if (url) csl.URL = url;

  const { confidence, note } = scoreConfidence({
    title,
    authors,
    year,
    doi,
    venue,
  });

  return {
    index: ref.index,
    raw: ref.raw,
    csl,
    confidence,
    source: 'local',
    note,
  };
}

export function parseReferencesToCsl(references: ReferenceEntry[]): ParsedCslRef[] {
  return references.map(referenceToCsl);
}

/** Apply a Crossref message object onto a ParsedCslRef (raises confidence when fields improve). */
export function mergeCrossrefMessage(
  entry: ParsedCslRef,
  message: Record<string, unknown>
): ParsedCslRef {
  const next: CslJson = { ...entry.csl };
  const title = Array.isArray(message.title) ? String(message.title[0] || '') : '';
  if (title) next.title = title;

  if (Array.isArray(message.author)) {
    next.author = (message.author as { family?: string; given?: string; name?: string }[])
      .filter(Boolean)
      .slice(0, 20)
      .map((a) => {
        if (a.family || a.given) return { family: a.family, given: a.given };
        return { literal: a.name || 'Unknown' };
      });
  }

  const parts = (message.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts'];
  if (parts?.[0]?.[0]) next.issued = { 'date-parts': [[parts[0][0]]] };

  const container = Array.isArray(message['container-title'])
    ? String(message['container-title'][0] || '')
    : '';
  if (container) next['container-title'] = container;

  if (message.volume) next.volume = String(message.volume);
  if (message.issue) next.issue = String(message.issue);
  if (message.page) next.page = String(message.page);
  if (typeof message.DOI === 'string') next.DOI = message.DOI;
  if (typeof message.URL === 'string') next.URL = message.URL;
  if (typeof message.type === 'string' && message.type) {
    // Map a few Crossref types to CSL
    const t = message.type;
    if (t.includes('book')) next.type = 'book';
    else if (t.includes('proceedings')) next.type = 'paper-conference';
    else next.type = 'article-journal';
  }

  return {
    ...entry,
    csl: next,
    confidence: 'high',
    source: 'crossref',
    note: undefined,
  };
}
