/**
 * Stage 2 — Parse Turnitin similarity and AI reports (deterministic extraction).
 * Format is assumed consistent across sample reports; fingerprint guard runs first.
 */

import type {
  AIFlag,
  AIReport,
  MatchSource,
  ParsedPaper,
  SimilarityFlag,
  SimilarityReport,
  TurnitinSourceType,
} from '../../types';
import { extractPdfBundle, extractTextFromPdf } from './extractText';
import { normalizeForMatch } from './textUtils';
import {
  badgesToFlags,
  extractBadges,
  findOriginalityStart,
  isBadgeStyleReport,
  parseSourceList,
} from './badgeReport';
import {
  fingerprintReport,
  UnsupportedReportFormatError,
} from './fingerprint';

function classifySourceType(title: string, url: string | null): TurnitinSourceType {
  const t = `${title} ${url || ''}`.toLowerCase();
  if (
    /submitted to|student paper|university|college|repository of|coursework/.test(t)
  ) {
    return 'student_paper';
  }
  if (url && /^https?:\/\//i.test(url)) return 'internet';
  if (
    /journal|doi\.org|pubmed|ieee|springer|elsevier|wiley|acm|proceedings|conference/.test(t)
  ) {
    return 'publication';
  }
  if (url) return 'internet';
  return 'unknown';
}

function extractOverallSimilarity(text: string): number | null {
  const patterns = [
    /similarity\s*index\s*[:\s]*(\d{1,3})\s*%/i,
    /overall\s*similarity[:\s]*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*overall\s*similarity/i,
    /similarity\s*[:\s]*(\d{1,3})\s*%/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function extractOverallAI(text: string): number | null {
  const patterns = [
    /(\d{1,3})\s*%\s*(?:of\s+)?(?:the\s+)?(?:text|submission|document|qualifying)?\s*(?:is\s+)?(?:likely\s+)?(?:AI|generated)/i,
    /AI\s*(?:writing\s*)?(?:detection|score|percentage|indicator)\s*[:\s]*(\d{1,3})\s*%/i,
    /detected\s+as\s+AI[:\s]*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*AI/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

/** Parse Match Overview table rows: "12% https://... Title" or "8% Submitted to X University" */
export function parseMatchOverview(text: string): MatchSource[] {
  const sources: MatchSource[] = [];
  const seen = new Set<string>();

  // Pattern: percentage then URL or title
  const rowRe =
    /(\d{1,3})\s*%\s*((?:https?:\/\/\S+)|(?:www\.\S+))?[\s]*([^\n%]{8,200}?)(?=\s+\d{1,3}\s*%|$)/gi;

  let m: RegExpExecArray | null;
  const chunk = extractMatchOverviewSection(text);

  while ((m = rowRe.exec(chunk)) !== null) {
    const percentage = parseInt(m[1], 10);
    let url = m[2] ? m[2].replace(/[.,;)]+$/, '') : null;
    if (url && url.startsWith('www.')) url = 'https://' + url;
    let title = (m[3] || '').trim();
    // Clean trailing junk
    title = title.replace(/\s+\d{1,3}\s*%.*$/, '').trim();
    if (!title && url) title = url;
    if (percentage > 100 || percentage < 0) continue;
    if (!title || title.length < 3) continue;

    const key = `${percentage}|${title.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title,
      url,
      percentage,
      sourceType: classifySourceType(title, url),
    });
  }

  // Fallback looser pattern for "Submitted to …" lines
  if (sources.length === 0) {
    const loose =
      /(\d{1,3})\s*%\s+(Submitted to [^\n]+|[A-Z][^\n]{10,120})/g;
    while ((m = loose.exec(text)) !== null) {
      const percentage = parseInt(m[1], 10);
      const title = m[2].trim();
      sources.push({
        title,
        url: null,
        percentage,
        sourceType: classifySourceType(title, null),
      });
    }
  }

  return sources.sort((a, b) => b.percentage - a.percentage);
}

function extractMatchOverviewSection(text: string): string {
  const start = text.search(/match\s*overview|sources?\s*overview|internet\s*sources/i);
  if (start === -1) return text.slice(0, 12000);
  return text.slice(start, start + 15000);
}

/**
 * Extract highlighted / flagged passage text from similarity reports.
 * Turnitin exports often interleave source labels with matched excerpts.
 */
export function extractSimilarityFlags(
  text: string,
  sources: MatchSource[]
): SimilarityFlag[] {
  const flags: SimilarityFlag[] = [];

  // Strategy A: numbered match blocks "1. matched text here …"
  const blockRe =
    /(?:^|\n)\s*(\d{1,3})\s*[.)]\s+([A-Z“"a-z][^]{20,800}?)(?=(?:\n\s*\d{1,3}\s*[.)]\s+[A-Z])|$)/g;
  let m: RegExpExecArray | null;
  const used = new Set<string>();

  while ((m = blockRe.exec(text)) !== null) {
    const colorIndex = parseInt(m[1], 10);
    let excerpt = m[2].trim();
    // Drop if it looks like a source line only
    if (/^\d{1,3}\s*%/.test(excerpt)) continue;
    if (/^https?:\/\//i.test(excerpt)) continue;
    if (excerpt.length < 25) continue;
    // Trim source attribution tails
    excerpt = excerpt.replace(/\s*\d{1,3}\s*%\s*(Submitted to|https?:).*$/i, '').trim();
    const key = normalizeForMatch(excerpt).slice(0, 80);
    if (used.has(key)) continue;
    used.add(key);

    const assigned = sources[Math.min(colorIndex - 1, sources.length - 1)] || sources[0];
    flags.push({
      text: excerpt,
      startOffset: m.index,
      endOffset: m.index + m[0].length,
      page: 1,
      matchPct: assigned?.percentage ?? null,
      sources: assigned ? [assigned] : [],
      colorIndex,
    });
  }

  // Strategy B: quoted / italic-like long runs after percentage markers
  if (flags.length < 3) {
    const pctBlocks =
      /(\d{1,3})\s*%\s*(?:match(?:ed)?)?[:\s]+["“]?(.{30,500}?)["”]?(?=\s+\d{1,3}\s*%|\n\n|$)/gi;
    while ((m = pctBlocks.exec(text)) !== null) {
      const pct = parseInt(m[1], 10);
      const excerpt = m[2].trim();
      if (excerpt.length < 30) continue;
      if (/https?:\/\//i.test(excerpt) && excerpt.split(' ').length < 8) continue;
      const key = normalizeForMatch(excerpt).slice(0, 80);
      if (used.has(key)) continue;
      used.add(key);
      const matchedSource =
        sources.find((s) => s.percentage === pct) ||
        sources.find((s) => Math.abs(s.percentage - pct) <= 1) ||
        null;
      flags.push({
        text: excerpt,
        startOffset: m.index,
        endOffset: m.index + m[0].length,
        page: 1,
        matchPct: pct,
        sources: matchedSource ? [matchedSource] : [],
      });
    }
  }

  // Strategy C: if still sparse, use longer unique n-grams from source titles context
  // Leave empty — alignment stage will still work with whatever we have.

  return flags;
}

export function extractAIFlags(text: string): AIFlag[] {
  const flags: AIFlag[] = [];
  const used = new Set<string>();

  // Highlighted AI sentences often appear as continuous paragraphs after the score
  // Capture sentence-like runs of 40+ chars that aren't headers
  const bodyStart = Math.max(
    0,
    text.search(/qualifying text|ai writing|detected as ai|highlighted/i)
  );
  const body = text.slice(bodyStart);

  const sentenceRe = /([A-Z][^.!?\n]{40,600}[.!?])/g;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(body)) !== null) {
    const s = m[1].trim();
    if (/turnitin|similarity|page \d|submission|qualifying/i.test(s)) continue;
    const key = normalizeForMatch(s).slice(0, 60);
    if (used.has(key)) continue;
    used.add(key);
    flags.push({
      text: s,
      startOffset: bodyStart + m.index,
      endOffset: bodyStart + m.index + m[0].length,
      page: 1,
    });
  }

  return flags;
}

export async function parseSimilarityReport(
  data: ArrayBuffer,
  paper?: ParsedPaper | null
): Promise<SimilarityReport> {
  // One open for text + positions — large Turnitin PDFs used to OOM from a double parse.
  const { fullText, positioned, truncated } = await extractPdfBundle(data, {
    needPositioned: true,
  });
  const fp = fingerprintReport(fullText, 'similarity');
  if (!fp.ok) throw new UnsupportedReportFormatError(fp);

  const overallPct = extractOverallSimilarity(fullText);

  // Preferred path: Turnitin's standard export rasterizes the document body and leaves
  // only numeric match badges as text, so positions — not scraped prose — carry the
  // signal. Requires the author's paper to map badges onto real offsets.
  const originalityStart = findOriginalityStart(positioned);

  if (paper && isBadgeStyleReport(positioned, originalityStart)) {
    const sourceMap = parseSourceList(positioned, originalityStart);
    const badges = extractBadges(positioned, originalityStart);
    const lastPosPage = positioned.reduce((m, p) => Math.max(m, p.pageNumber), 0);
    const bodyPageCount =
      (originalityStart > 0 ? originalityStart - 1 : lastPosPage) - 1;
    const flags = badgesToFlags(badges, sourceMap, paper, bodyPageCount);

    if (flags.length > 0) {
      return {
        overallPct,
        flags,
        sources: [...sourceMap.values()].sort((a, b) => b.percentage - a.percentage),
        formatVersion: `${fp.formatVersion}-badge${truncated ? '-truncated' : ''}`,
        rawText: fullText,
      };
    }
  }

  // Fallback: text-based exports (copy/paste, HTML print) that do contain excerpt prose
  const sources = parseMatchOverview(fullText);
  const flags = extractSimilarityFlags(fullText, sources);

  return {
    overallPct,
    flags,
    sources,
    formatVersion: `${fp.formatVersion}${truncated ? '-truncated' : ''}`,
    rawText: fullText,
  };
}

export async function parseAIReport(data: ArrayBuffer): Promise<AIReport> {
  const { fullText } = await extractTextFromPdf(data);
  const fp = fingerprintReport(fullText, 'ai');
  if (!fp.ok) throw new UnsupportedReportFormatError(fp);

  const overallPct = extractOverallAI(fullText);
  const flags = extractAIFlags(fullText);

  return {
    overallPct,
    flags,
    formatVersion: fp.formatVersion,
    rawText: fullText,
  };
}
