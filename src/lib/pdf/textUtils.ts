/** Pure text helpers — no pdf.js dependency (safe for unit tests). */

/** Normalize PDF text: fix hyphenation at line breaks, collapse whitespace carefully */
export function normalizePdfText(raw: string): string {
  let t = raw.replace(/(\w)-\n(\w)/g, '$1$2');
  t = t.replace(/\n+/g, ' ');
  t = t.replace(/[ \t\u00a0]+/g, ' ');
  return t.trim();
}

/** Soft normalize for matching (lowercase, strip punctuation variants) */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d']/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function offsetToPage(
  pages: { pageNumber: number; startOffset: number; endOffset: number }[],
  offset: number
): number {
  for (const p of pages) {
    if (offset >= p.startOffset && offset < p.endOffset) return p.pageNumber;
  }
  return pages.length ? pages[pages.length - 1].pageNumber : 1;
}
