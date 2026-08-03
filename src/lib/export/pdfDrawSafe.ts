/**
 * Pure helpers for PDF overlay / StandardFonts drawing (no pdf.js).
 */

import { normalizeForMatch } from '../pdf/textUtils';

/**
 * pdf-lib StandardFonts are WinAnsi-only. Em-dashes, curly quotes, ellipses, etc.
 * throw at drawText/widthOfTextAtSize — sanitize every user/LLM string before drawing.
 */
export function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

/**
 * Expand one raw character the same way normalizeForMatch does for a full string
 * (lowercase, ligatures, punct→space) — without trim/collapse (handled by the walker).
 */
function expandRawChar(ch: string): string {
  return ch
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d']/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/[^a-z0-9\s']/g, ' ');
}

/**
 * Build normalizeForMatch(haystack) while recording the raw index that produced
 * each normalized character. Single-char normalizeForMatch().trim() drops spaces
 * and must not be used for this mapping.
 */
export function buildNormalizedOriginMap(haystack: string): {
  normalized: string;
  origins: number[];
} {
  const origins: number[] = [];
  let normalized = '';
  let pendingSpace = false;
  let started = false;

  for (let ri = 0; ri < haystack.length; ri++) {
    const piece = expandRawChar(haystack[ri]);
    for (const pc of piece) {
      if (/\s/.test(pc)) {
        if (started) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        normalized += ' ';
        origins.push(ri);
        pendingSpace = false;
      }
      normalized += pc;
      origins.push(ri);
      started = true;
    }
  }

  return { normalized, origins };
}

/** Map a normalized match onto the raw haystack. Returns -1 / -1 on failure. */
export function findNormalizedRange(
  haystack: string,
  needle: string
): { start: number; end: number } {
  const n = normalizeForMatch(needle);
  if (!n) return { start: -1, end: -1 };

  const { normalized, origins } = buildNormalizedOriginMap(haystack);
  if (normalized !== normalizeForMatch(haystack)) {
    const h = normalizeForMatch(haystack);
    const i = h.indexOf(n);
    return i < 0 ? { start: -1, end: -1 } : { start: i, end: i + n.length };
  }

  const i = normalized.indexOf(n);
  if (i < 0 || i >= origins.length) return { start: -1, end: -1 };

  const start = origins[i];
  const lastNorm = i + n.length - 1;
  let end = (lastNorm < origins.length ? origins[lastNorm] : origins[origins.length - 1]) + 1;

  // Cover punctuation glyphs that normalize away immediately after the last matched char
  // so whiteout rectangles erase the full visual span (e.g. trailing commas/periods).
  while (end < haystack.length) {
    const ch = haystack[end];
    if (/[a-zA-Z0-9\s]/.test(ch)) break;
    const piece = expandRawChar(ch);
    // Stop if this raw glyph contributes real alphanumeric content (ligatures, etc.)
    if (/[a-z0-9]/i.test(piece)) break;
    end += 1;
  }

  return { start, end: Math.max(start + 1, end) };
}

/** Map a normalized match index back onto the raw haystack. Returns -1 on failure. */
export function findNormalizedIndex(haystack: string, needle: string): number {
  return findNormalizedRange(haystack, needle).start;
}
