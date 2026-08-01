/**
 * Stage 1 — Parse the paper:
 * sections (IMRaD), sentences, reference list, in-text citations, citation style.
 */

import type {
  CitationStyle,
  InTextCitation,
  PaperSection,
  PaperSentence,
  ParsedPaper,
  ReferenceEntry,
  SectionName,
} from '../../types';
import type { PageText } from './extractText';
import { offsetToPage } from './textUtils';
import { sectionAt } from './sections';

export { sectionAt } from './sections';

const SECTION_PATTERNS: { name: SectionName; re: RegExp }[] = [
  { name: 'Abstract', re: /^\s*(abstract|summary)\s*$/i },
  { name: 'Introduction', re: /^\s*(1\.?\s*)?(introduction|background)\s*$/i },
  { name: 'Methods', re: /^\s*(\d+\.?\s*)?(materials?\s+and\s+methods|methods?|methodology|experimental\s+procedure)\s*$/i },
  { name: 'Results', re: /^\s*(\d+\.?\s*)?(results?|findings)\s*$/i },
  { name: 'Discussion', re: /^\s*(\d+\.?\s*)?(discussion|results?\s+and\s+discussion)\s*$/i },
  { name: 'Conclusion', re: /^\s*(\d+\.?\s*)?(conclusions?|concluding\s+remarks)\s*$/i },
  { name: 'References', re: /^\s*(references|bibliography|works\s+cited|literature\s+cited)\s*$/i },
];

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z\[(\"'])|(?<=[.!?]")\s+/;

export function segmentSections(fullText: string, pages: PageText[]): PaperSection[] {
  // Scan for section headers as short lines / capitalized phrases near start of paragraphs
  const candidates: { name: SectionName; index: number }[] = [];

  // Look at windows of text that look like headings (short, often all-caps or Title Case after newline-ish gaps)
  // Since we collapsed newlines, search for known section keywords as whole-word phrases with context.
  const headingRe =
    /(?:^|\s)((?:\d{1,2}\.?\s*)?(?:Abstract|Summary|Introduction|Background|Materials?\s+and\s+Methods|Methods?|Methodology|Experimental\s+Procedure|Results?|Findings|Discussion|Results?\s+and\s+Discussion|Conclusions?|Concluding\s+Remarks|References|Bibliography|Works\s+Cited|Literature\s+Cited))(?=\s|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(fullText)) !== null) {
    const label = m[1].trim();
    for (const { name, re } of SECTION_PATTERNS) {
      if (re.test(label)) {
        // Avoid matching "methods" inside body text: heading should be relatively isolated
        // Require short label and that next chars aren't mid-sentence lower-case continuation of a long phrase
        candidates.push({ name, index: m.index + (m[0].startsWith(' ') ? 1 : 0) });
        break;
      }
    }
  }

  // Deduplicate: keep first occurrence of each section name in order
  const seen = new Set<SectionName>();
  const ordered: { name: SectionName; index: number }[] = [];
  for (const c of candidates.sort((a, b) => a.index - b.index)) {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      ordered.push(c);
    }
  }

  if (ordered.length === 0) {
    return [
      {
        name: 'Other',
        startOffset: 0,
        endOffset: fullText.length,
        pageStart: 1,
      },
    ];
  }

  const sections: PaperSection[] = [];
  // Preamble before first section
  if (ordered[0].index > 0) {
    sections.push({
      name: 'Other',
      startOffset: 0,
      endOffset: ordered[0].index,
      pageStart: 1,
    });
  }

  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i].index;
    const end = i + 1 < ordered.length ? ordered[i + 1].index : fullText.length;
    sections.push({
      name: ordered[i].name,
      startOffset: start,
      endOffset: end,
      pageStart: offsetToPage(pages, start),
    });
  }

  return sections;
}

export function segmentSentences(
  fullText: string,
  pages: PageText[],
  sections: PaperSection[]
): PaperSentence[] {
  const sentences: PaperSentence[] = [];
  // Split while tracking offsets
  let cursor = 0;
  const parts = fullText.split(SENTENCE_SPLIT);
  // Reconstruct offsets carefully
  let searchFrom = 0;
  let idx = 0;
  for (const part of parts) {
    if (!part.trim()) {
      searchFrom += part.length;
      continue;
    }
    const pos = fullText.indexOf(part, searchFrom);
    if (pos === -1) continue;
    const start = pos;
    const end = pos + part.length;
    sentences.push({
      text: part.trim(),
      startOffset: start,
      endOffset: end,
      page: offsetToPage(pages, start),
      sentenceIndex: idx++,
      section: sectionAt(sections, start),
    });
    searchFrom = end;
    cursor = end;
  }
  void cursor;
  return sentences;
}

/** Detect citation style from in-text markers and reference formatting */
export function detectCitationStyle(fullText: string, referencesRaw: string): CitationStyle {
  const ieee = (fullText.match(/\[\d{1,3}\]/g) || []).length;
  const vancouver = (fullText.match(/(?<=\w)\d{1,2}(?=\s|,|\.)/g) || []).length; // weak
  const apa = (fullText.match(/\([A-Z][a-zA-Z-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?\)/g) || []).length;
  const harvard = (fullText.match(/[A-Z][a-zA-Z-]+\s+\(\d{4}\)/g) || []).length;

  // Reference list cues
  const numberedRefs = (referencesRaw.match(/^\s*\[\d+\]|\n\s*\[\d+\]|\n\s*\d+\.\s+[A-Z]/gm) || []).length;

  const scores: { style: CitationStyle; score: number }[] = [
    { style: 'IEEE', score: ieee * 2 + (numberedRefs > 3 ? 5 : 0) },
    { style: 'APA', score: apa * 3 },
    { style: 'Harvard', score: harvard * 2 },
    { style: 'Vancouver', score: numberedRefs > 3 && ieee < 3 ? numberedRefs : vancouver * 0.5 },
  ];

  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score < 2) return 'unknown';
  return scores[0].style;
}

export function extractInTextCitations(
  fullText: string,
  style: CitationStyle
): InTextCitation[] {
  const citations: InTextCitation[] = [];

  const push = (marker: string, start: number, end: number, keys: string[], s: CitationStyle) => {
    citations.push({ marker, style: s, startOffset: start, endOffset: end, keys });
  };

  // Always scan multiple patterns; prefer detected style but capture all
  const bracketRe = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(fullText)) !== null) {
    const keys = m[1].split(/[,–-]/).map((k) => k.trim()).filter(Boolean);
    push(m[0], m.index, m.index + m[0].length, keys, 'IEEE');
  }

  const apaRe = /\(([A-Z][a-zA-Z'-]+(?:\s+et\s+al\.)?(?:\s*&\s*[A-Z][a-zA-Z'-]+)?,?\s*\d{4}[a-z]?(?:\s*;\s*[A-Z][a-zA-Z'-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?)*)\)/g;
  while ((m = apaRe.exec(fullText)) !== null) {
    const keys = m[1].split(';').map((k) => k.trim());
    push(m[0], m.index, m.index + m[0].length, keys, style === 'Harvard' ? 'Harvard' : 'APA');
  }

  return citations.sort((a, b) => a.startOffset - b.startOffset);
}

interface RefMarker {
  num: number;
  idx: number;
}

function findMarkers(body: string, re: RegExp): RefMarker[] {
  const out: RefMarker[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(body)) !== null) {
    out.push({ num: parseInt(m[1], 10), idx: m.index });
  }
  return out;
}

/** Reject marker sets that don't look like a real numbered sequence (page numbers, decimals, etc). */
function isPlausibleSequence(markers: RefMarker[]): boolean {
  if (markers.length < 2) return false;
  let increasing = 0;
  for (let i = 1; i < markers.length; i++) {
    if (markers[i].num > markers[i - 1].num) increasing++;
  }
  return increasing / (markers.length - 1) >= 0.85 && markers[0].num <= 3;
}

export function parseReferenceList(
  fullText: string,
  sections: PaperSection[]
): ReferenceEntry[] {
  const refSection = sections.find((s) => s.name === 'References');
  if (!refSection) return [];

  const block = fullText.slice(refSection.startOffset, refSection.endOffset);
  // Drop the heading itself
  const body = block.replace(/^\s*(references|bibliography|works\s+cited|literature\s+cited)\s*/i, '');
  const bodyStart = refSection.startOffset + (block.length - body.length);

  // Split entries: numbered "[9] " / "9. " markers, or fall back to loose sentence splits.
  // NOTE: fullText has already had all line breaks collapsed to spaces (normalizePdfText),
  // so markers must be detected directly in the flowing text — they cannot be anchored to
  // start-of-line. Scoped to the References block, "[N]"/"N." occurrences are reliably
  // entry boundaries rather than in-text citations, but we still gate on a plausible
  // monotonic sequence to avoid false splits on decimals, page numbers, or figure refs.
  const entryChunks: { raw: string; localStart: number; num: number | null }[] = [];

  const bracketMarkers = findMarkers(body, /\[(\d{1,3})\]\s+(?=[A-Z"“])/g);
  const dotMarkers = findMarkers(body, /(?:^|\s)(\d{1,3})\.\s+(?=[A-Z"“])/g);
  const markers = isPlausibleSequence(bracketMarkers)
    ? bracketMarkers
    : isPlausibleSequence(dotMarkers)
      ? dotMarkers
      : [];

  if (markers.length >= 2) {
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].idx;
      const end = i + 1 < markers.length ? markers[i + 1].idx : body.length;
      const raw = body.slice(start, end).trim();
      if (raw.length > 10) entryChunks.push({ raw, localStart: start, num: markers[i].num });
    }
  } else {
    // Fallback: unnumbered lists (APA/Harvard) — split on sentence-ish boundaries
    const loose = body.split(/(?<=\.)\s+(?=[A-Z\[])/);
    let pos = 0;
    for (const chunk of loose) {
      const p = body.indexOf(chunk, pos);
      if (chunk.trim().length > 20) {
        entryChunks.push({ raw: chunk.trim(), localStart: p >= 0 ? p : pos, num: null });
      }
      pos = (p >= 0 ? p : pos) + chunk.length;
    }
  }

  return entryChunks.map((c, i) => {
    const parsed = parseSingleReference(c.raw);
    return {
      index: c.num ?? i + 1,
      raw: c.raw,
      authors: parsed.authors,
      year: parsed.year,
      title: parsed.title,
      venue: parsed.venue,
      startOffset: bodyStart + c.localStart,
      endOffset: bodyStart + c.localStart + c.raw.length,
    };
  });
}

function parseSingleReference(raw: string): {
  authors: string[];
  year: string | null;
  title: string | null;
  venue: string | null;
} {
  const yearMatch = raw.match(/\b(19|20)\d{2}[a-z]?\b/);
  const year = yearMatch ? yearMatch[0] : null;

  // Authors: text before year or first period block
  let authors: string[] = [];
  const authorChunk = year
    ? raw.slice(0, raw.indexOf(year)).replace(/^\[\d+\]\s*|\d+\.\s*/, '')
    : raw.slice(0, 80);
  const authorParts = authorChunk
    .split(/,|and|&|;/)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && a.length < 60 && /[A-Za-z]/.test(a));
  authors = authorParts.slice(0, 6);

  // Title: often in quotes or after year
  let title: string | null = null;
  const quoted = raw.match(/[""](.+?)[""]/) || raw.match(/"(.+?)"/);
  if (quoted) {
    title = quoted[1];
  } else if (year) {
    // Strip the punctuation that trails a year — including the closing paren of styles
    // that bracket it, e.g. "Regan B, O'Kennedy R (2018) Point-of-Care Compatibility…"
    const afterYear = raw.slice(raw.indexOf(year) + year.length).replace(/^[\s.,:;)\]}]+/, '');
    const titlePart = afterYear.split(/[.?]/)[0];
    if (titlePart && titlePart.length > 8) title = titlePart.trim();
  }

  // Venue: journal-ish after title
  let venue: string | null = null;
  if (title) {
    const afterTitle = raw.slice(raw.indexOf(title) + title.length);
    const venueMatch = afterTitle.match(/([A-Z][A-Za-z\s&:]+?)(?:,|\s+\d{4}|\s+vol)/);
    if (venueMatch) venue = venueMatch[1].trim();
  }

  return { authors, year, title, venue };
}

/** Shared by both PDF and DOCX entry points once raw text + page breakdown are extracted. */
export function buildParsedPaper(fullText: string, pages: PageText[], pageCount: number): ParsedPaper {
  const sections = segmentSections(fullText, pages);
  const sentences = segmentSentences(fullText, pages, sections);
  const references = parseReferenceList(fullText, sections);
  const refSection = sections.find((s) => s.name === 'References');
  const refRaw = refSection
    ? fullText.slice(refSection.startOffset, refSection.endOffset)
    : '';
  const detectedCitationStyle = detectCitationStyle(fullText, refRaw);
  const citations = extractInTextCitations(fullText, detectedCitationStyle);

  return {
    fullText,
    pages,
    sentences,
    sections,
    references,
    citations,
    detectedCitationStyle,
    pageCount,
  };
}

export async function parsePaper(data: ArrayBuffer): Promise<ParsedPaper> {
  // Dynamic import: extractText.ts pulls in the pdf.js worker via a Vite-only `?url`
  // import, which would break loading this module's pure functions under plain Node
  // (unit tests). Only the browser entry point (parsePaper) needs it at runtime.
  const { extractTextFromPdf } = await import('./extractText');
  const { fullText, pages, pageCount } = await extractTextFromPdf(data);
  return buildParsedPaper(fullText, pages, pageCount);
}

/**
 * DOCX has no fixed pagination (page breaks are a rendering-time concept, not stored
 * data), so the whole document is treated as a single "page" — findings still get exact
 * character offsets, they just won't have a meaningful page number to show.
 */
export async function parsePaperFromDocx(data: ArrayBuffer): Promise<ParsedPaper> {
  const { extractTextFromDocx } = await import('../docx/extractDocx');
  const { fullText, pages, pageCount } = await extractTextFromDocx(data);
  return buildParsedPaper(fullText, pages, pageCount);
}
