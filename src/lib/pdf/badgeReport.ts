/**
 * Badge-style Turnitin similarity reports.
 *
 * Turnitin's PDF export rasterizes the submitted document: on the body pages the prose is
 * an image, and the ONLY extractable text is the small numeric match badges overlaid on
 * it. There is no flagged excerpt text in the file to scrape — the earlier text-scraping
 * approach was silently matching the originality-report header instead, which is why
 * nearly every span degraded to "review manually".
 *
 * What *is* recoverable, and is enough:
 *   - the numbered source list (title, type, percentage) on the originality pages
 *   - each badge's number + page + (x, y), i.e. which source matched and roughly where
 *
 * Since the author uploads their paper separately, a badge at a known position maps back
 * onto their real text, giving exact offsets — arguably better than Turnitin's own
 * truncated excerpts.
 */

import type { MatchSource, ParsedPaper, SimilarityFlag, TurnitinSourceType } from '../../types';
import type { PositionedPage } from './extractText';

/** x-position bands observed across Turnitin exports (US Letter, 612pt wide). */
const SOURCE_NUM_MAX_X = 55;
const SOURCE_TEXT_MIN_X = 56;
const PERCENT_MIN_X = 540;

const BADGE_RE = /^\d{1,3}$/;

export interface Badge {
  sourceNumber: number;
  /** 1-based page index within the report */
  reportPage: number;
  x: number;
  y: number;
  /** 0 = top of page, 1 = bottom */
  yFraction: number;
}

export function findOriginalityStart(pages: PositionedPage[]): number {
  for (const p of pages) {
    const joined = p.items.map((i) => i.str).join(' ');
    if (/ORIGINALITY\s*REPORT/i.test(joined)) return p.pageNumber;
  }
  return -1;
}

/**
 * A body page in a rasterized report contains only badges: a handful of short numeric
 * runs and nothing else. If pages carry real prose, this isn't a badge-style report and
 * the caller should use the text-scraping path instead.
 */
export function isBadgeStyleReport(pages: PositionedPage[], originalityStart: number): boolean {
  const lastPage = pages.reduce((m, p) => Math.max(m, p.pageNumber), 0);
  const lastBody = originalityStart > 0 ? originalityStart - 1 : lastPage;
  const bodyPages = pages.filter((p) => p.pageNumber >= 2 && p.pageNumber <= lastBody);
  if (bodyPages.length === 0) return false;

  let numericOnly = 0;
  let considered = 0;
  for (const p of bodyPages) {
    if (p.items.length === 0) continue; // blank page — no evidence either way
    considered++;
    if (p.items.every((i) => BADGE_RE.test(i.str.trim()))) numericOnly++;
  }

  if (considered === 0) return false;
  return numericOnly / considered >= 0.8;
}

export function extractBadges(pages: PositionedPage[], originalityStart: number): Badge[] {
  const lastPage = pages.reduce((m, p) => Math.max(m, p.pageNumber), 0);
  const lastBody = originalityStart > 0 ? originalityStart - 1 : lastPage;
  const badges: Badge[] = [];

  for (const p of pages) {
    if (p.pageNumber < 2 || p.pageNumber > lastBody) continue; // skip cover + originality pages
    for (const item of p.items) {
      const t = item.str.trim();
      if (!BADGE_RE.test(t)) continue;
      const n = parseInt(t, 10);
      if (n < 1 || n > 200) continue;
      badges.push({
        sourceNumber: n,
        reportPage: p.pageNumber,
        x: item.x,
        y: item.y,
        yFraction: p.height > 0 ? Math.min(1, Math.max(0, (p.height - item.y) / p.height)) : 0,
      });
    }
  }

  return badges;
}

function classifySourceType(typeLabel: string, title: string): TurnitinSourceType {
  const label = typeLabel.toLowerCase();
  if (label.includes('student')) return 'student_paper';
  if (label.includes('internet')) return 'internet';
  if (label.includes('publication')) return 'publication';

  // The type line falls on the next page for entries that straddle a page break, so infer
  // from the title's own shape instead.
  if (/submitted to/i.test(title)) return 'student_paper';
  if (/^(https?:\/\/|www\.)/i.test(title) || /^[\w-]+(\.[\w-]+)+$/.test(title.trim())) {
    return 'internet';
  }
  // Author-list + quoted-title + venue is the house style for publications here
  if (/["“].+["”]/.test(title) && /\b(19|20)\d{2}\b/.test(title)) return 'publication';
  if (/\b(journal|proceedings|conference|wiley|springer|elsevier|ieee|acm|press|review)\b/i.test(title)) {
    return 'publication';
  }
  return 'unknown';
}

/**
 * Parse the numbered source list from the originality pages.
 *
 * Layout quirks that matter (measured from real exports):
 *  - the entry number's baseline sits ~6pt BELOW its first title line, not level with it
 *  - its percentage sits ~3pt below the number, at the far right
 *  - the page header ("8% SIMILARITY INDEX") also puts a bare number at the far left, so
 *    entries are only accepted when a far-right percentage accompanies them
 */
export function parseSourceList(
  pages: PositionedPage[],
  originalityStart: number
): Map<number, MatchSource> {
  const sources = new Map<number, MatchSource>();
  if (originalityStart < 1) return sources;

  const ROW_TOLERANCE = 10;
  const DESC_ABOVE = 12;

  // Flatten the originality section into one ordered stream, so entries whose title wraps
  // across a page break are still read as a single record.
  interface StreamRow {
    page: number;
    y: number;
    text: string;
  }
  const stream: StreamRow[] = [];
  const entries: { num: number; page: number; y: number; pct: number | null }[] = [];

  for (const p of pages) {
    if (p.pageNumber < originalityStart) continue;

    for (const item of p.items) {
      if (item.x > SOURCE_NUM_MAX_X) continue;
      const t = item.str.trim();
      if (!BADGE_RE.test(t)) continue;
      const num = parseInt(t, 10);
      if (!num) continue;

      const pctItems = p.items
        .filter((i) => i.x >= PERCENT_MIN_X && Math.abs(i.y - item.y) <= ROW_TOLERANCE)
        .sort((a, b) => a.x - b.x);
      const pctText = pctItems.map((i) => i.str.trim()).join('');

      // Some Turnitin exports omit the far-right % column in the text layer (titles still
      // extract). Keep those entries so badges can resolve to a named source.
      const hasPct = pctText.includes('%');
      const m = pctText.match(/(\d{1,3})\s*%/);
      entries.push({
        num,
        page: p.pageNumber,
        y: item.y,
        pct: !hasPct ? null : pctText.includes('<') ? 0.5 : m ? parseInt(m[1], 10) : null,
      });
    }

    // Group description items into text rows
    const rows = new Map<number, typeof p.items>();
    for (const item of p.items) {
      if (item.x < SOURCE_TEXT_MIN_X || item.x >= PERCENT_MIN_X) continue;
      if (!item.str.trim()) continue;
      const key = Math.round(item.y);
      let bucket: typeof p.items | undefined;
      for (const [k, v] of rows) {
        if (Math.abs(k - key) <= 3) {
          bucket = v;
          break;
        }
      }
      if (bucket) bucket.push(item);
      else rows.set(key, [item]);
    }

    for (const [y, items] of rows) {
      const text = items
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join('')
        .trim();
      if (text) stream.push({ page: p.pageNumber, y, text });
    }
  }

  if (entries.length === 0) return sources;

  // Reading order: earlier page first, then top-down (PDF y decreases downward)
  const readingOrder = (a: { page: number; y: number }, b: { page: number; y: number }) =>
    a.page !== b.page ? a.page - b.page : b.y - a.y;

  entries.sort(readingOrder);
  stream.sort(readingOrder);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const next = entries[i + 1];

    const lines = stream
      .filter((row) => {
        // Starts just above this entry's number…
        const afterStart =
          row.page > entry.page || (row.page === entry.page && row.y <= entry.y + DESC_ABOVE);
        if (!afterStart) return false;
        // …and stops just above the next one
        if (!next) return true;
        return row.page < next.page || (row.page === next.page && row.y > next.y + DESC_ABOVE);
      })
      .map((row) => row.text);

    if (lines.length === 0) continue;

    // Last line is the source-type label; the rest form the title/venue
    const typeLabel = lines[lines.length - 1];
    const isTypeLine = /^(internet source|publication|student paper)$/i.test(typeLabel.trim());
    const titleLines = isTypeLine ? lines.slice(0, -1) : lines;
    const title = titleLines.join(' ').replace(/\s+/g, ' ').trim() || typeLabel;

    if (!title) continue;
    if (
      /^(primary sources|similarity index|internet sources|publications|student papers|originality report)$/i.test(
        title
      )
    ) {
      continue;
    }

    const sourceType = classifySourceType(isTypeLine ? typeLabel : '', title);
    const url = /^(https?:\/\/|www\.)/i.test(title)
      ? title.startsWith('www.')
        ? `https://${title}`
        : title
      : sourceType === 'internet' && /^[\w.-]+\.[a-z]{2,}$/i.test(title)
        ? `https://${title}`
        : null;

    if (!sources.has(entry.num)) {
      sources.set(entry.num, {
        title,
        url,
        percentage: entry.pct ?? 0,
        sourceType,
      });
    }
  }

  return sources;
}

/**
 * Convert badge positions into paper offsets.
 *
 * Body page B of the report corresponds to page B-1 of the paper (page 1 is the cover
 * sheet). When the paper has no usable pagination — e.g. DOCX, which has no fixed pages —
 * the badge is placed by its fractional position through the whole document instead.
 * Offsets are snapped to sentence boundaries so findings land on real prose.
 */
export function badgesToFlags(
  badges: Badge[],
  sources: Map<number, MatchSource>,
  paper: ParsedPaper,
  bodyPageCount: number
): SimilarityFlag[] {
  if (badges.length === 0) return [];

  const usePaperPages = paper.pages.length >= bodyPageCount && bodyPageCount > 0;
  const flags: SimilarityFlag[] = [];

  for (const badge of badges) {
    const bodyIndex = badge.reportPage - 2; // 0-based index into the paper's pages
    if (bodyIndex < 0) continue;

    let approxOffset: number;
    if (usePaperPages && bodyIndex < paper.pages.length) {
      const page = paper.pages[bodyIndex];
      approxOffset = page.startOffset + badge.yFraction * (page.endOffset - page.startOffset);
    } else {
      const docFraction = (bodyIndex + badge.yFraction) / Math.max(bodyPageCount, 1);
      approxOffset = docFraction * paper.fullText.length;
    }

    const sentence = nearestSentence(paper, approxOffset);
    if (!sentence) continue;

    const source = sources.get(badge.sourceNumber);
    flags.push({
      text: sentence.text,
      startOffset: sentence.startOffset,
      endOffset: sentence.endOffset,
      page: sentence.page,
      matchPct: source?.percentage ?? null,
      sources: source ? [source] : [],
      colorIndex: badge.sourceNumber,
      preAligned: true,
    });
  }

  return dedupeByOffset(flags);
}

function nearestSentence(paper: ParsedPaper, offset: number) {
  if (paper.sentences.length === 0) return null;
  let best = paper.sentences[0];
  let bestDist = Infinity;
  for (const s of paper.sentences) {
    if (offset >= s.startOffset && offset < s.endOffset) return s;
    const dist = offset < s.startOffset ? s.startOffset - offset : offset - s.endOffset;
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/** Several badges can land on the same sentence; keep the highest-percentage one. */
function dedupeByOffset(flags: SimilarityFlag[]): SimilarityFlag[] {
  const byOffset = new Map<number, SimilarityFlag>();
  for (const f of flags) {
    const existing = byOffset.get(f.startOffset);
    if (!existing || (f.matchPct ?? 0) > (existing.matchPct ?? 0)) {
      byOffset.set(f.startOffset, f);
    }
  }
  return [...byOffset.values()].sort((a, b) => a.startOffset - b.startOffset);
}
