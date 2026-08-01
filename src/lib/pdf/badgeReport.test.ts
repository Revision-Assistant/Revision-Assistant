/**
 * Lightweight node-free assertions run via `npm run test:unit`
 *
 * Fixtures mirror the real geometry measured from Turnitin exports: the entry number's
 * baseline sits ~6pt BELOW its first title line, its percentage ~3pt below the number, and
 * the page header also places a bare number at the far left.
 */
import {
  findOriginalityStart,
  isBadgeStyleReport,
  extractBadges,
  parseSourceList,
  badgesToFlags,
} from './badgeReport';
import type { PositionedPage } from './extractText';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const item = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 5 });

const pages: PositionedPage[] = [
  // p1: cover sheet
  { pageNumber: 1, height: 792, items: [item('paper.docx', 257, 617), item('by Someone', 247, 598)] },
  // p2 & p3: rasterized body — only match badges are real text
  { pageNumber: 2, height: 792, items: [item('1', 176, 596), item('2', 300, 200)] },
  { pageNumber: 3, height: 792, items: [item('1', 461, 671)] },
  // p4: originality report
  {
    pageNumber: 4,
    height: 792,
    items: [
      item('ORIGINALITY REPORT', 32, 728),
      // header: bare number at far left, percent sign adjacent (NOT far right)
      item('8', 32, 688),
      item('%', 52, 688),
      item('SIMILARITY INDEX', 32, 675),
      item('PRIMARY SOURCES', 32, 651),
      // entry 1
      item('1', 37, 620),
      item('1', 564, 617),
      item('%', 578, 617),
      item('www.example.com', 62, 626),
      item('Internet Source', 62, 616),
      // entry 2
      item('2', 37, 580),
      item('<', 552, 576),
      item('1', 564, 576),
      item('%', 578, 576),
      item('"Handbook of Things", Wiley, 2019', 62, 586),
      item('Publication', 62, 575),
    ],
  },
];

const originalityStart = findOriginalityStart(pages);
assert(originalityStart === 4, `originality should start on p4, got ${originalityStart}`);
assert(isBadgeStyleReport(pages, originalityStart), 'rasterized body pages should be detected as badge-style');

const badges = extractBadges(pages, originalityStart);
assert(badges.length === 3, `expected 3 badges from body pages only, got ${badges.length}`);
assert(
  badges.every((b) => b.reportPage >= 2 && b.reportPage < originalityStart),
  'badges must come only from body pages, never the cover or originality pages'
);
const topBadge = badges.find((b) => b.reportPage === 3)!;
assert(topBadge.yFraction < 0.2, `y=671 near page top should map to a small fraction, got ${topBadge.yFraction}`);

const sources = parseSourceList(pages, originalityStart);
assert(sources.size === 2, `expected 2 sources, got ${sources.size}`);

// The header's "8% SIMILARITY INDEX" must not be mistaken for entry #8
assert(!sources.has(8), 'page header must not be parsed as a source entry');

const s1 = sources.get(1)!;
assert(s1.title === 'www.example.com', `entry 1 title wrong: ${s1.title}`);
assert(s1.sourceType === 'internet', `entry 1 type wrong: ${s1.sourceType}`);
assert(s1.url === 'https://www.example.com', `entry 1 url wrong: ${s1.url}`);
assert(s1.percentage === 1, `entry 1 pct wrong: ${s1.percentage}`);

const s2 = sources.get(2)!;
assert(s2.title.startsWith('"Handbook of Things"'), `entry 2 title wrong: ${s2.title}`);
assert(s2.sourceType === 'publication', `entry 2 type wrong: ${s2.sourceType}`);
assert(s2.percentage === 0.5, `"<1%" should record as 0.5, got ${s2.percentage}`);

// Badge -> paper offset mapping
const fullText = 'First sentence here. Second sentence here. Third sentence here. Fourth one here.';
const sentences = [
  { text: 'First sentence here.', startOffset: 0, endOffset: 20, page: 1, sentenceIndex: 0, section: 'Other' as const },
  { text: 'Second sentence here.', startOffset: 21, endOffset: 42, page: 1, sentenceIndex: 1, section: 'Other' as const },
  { text: 'Third sentence here.', startOffset: 43, endOffset: 63, page: 2, sentenceIndex: 2, section: 'Other' as const },
  { text: 'Fourth one here.', startOffset: 64, endOffset: 80, page: 2, sentenceIndex: 3, section: 'Other' as const },
];
const paper: ParsedPaper = {
  fullText,
  pages: [
    { pageNumber: 1, text: fullText.slice(0, 42), startOffset: 0, endOffset: 42 },
    { pageNumber: 2, text: fullText.slice(43), startOffset: 43, endOffset: 80 },
  ],
  sentences,
  sections: [{ name: 'Other', startOffset: 0, endOffset: fullText.length, pageStart: 1 }],
  references: [],
  citations: [],
  detectedCitationStyle: 'IEEE',
  pageCount: 2,
};

const flags = badgesToFlags(badges, sources, paper, 2);
assert(flags.length > 0, 'badges should produce flags');
assert(
  flags.every((f) => f.preAligned === true),
  'badge-derived flags must be marked preAligned so fuzzy alignment is skipped'
);
assert(
  flags.every((f) => f.startOffset >= 0 && f.endOffset <= fullText.length && f.endOffset > f.startOffset),
  'flag offsets must be real spans inside the paper'
);
assert(
  flags.every((f) => fullText.slice(f.startOffset, f.endOffset) === f.text),
  'flag text must match the paper slice at its offsets'
);
// Report page 3 -> paper page 2; y near the top of the page -> that page's first sentence
const p3flag = flags.find((f) => f.text === 'Third sentence here.');
assert(p3flag, 'a badge at the top of report p3 should land on paper page 2');

// Sources carry through so downstream rules can cross-check the reference list
assert(
  flags.every((f) => f.sources.length === 1),
  'each flag should carry its resolved source'
);

console.log('badgeReport.test.ts: all passed');
