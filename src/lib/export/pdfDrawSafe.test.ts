/**
 * Unit tests for PDF draw-safe helpers (WinAnsi sanitize + normalized index mapping).
 * Run via: npx tsx src/lib/export/pdfDrawSafe.test.ts
 */
import { normalizeForMatch } from '../pdf/textUtils';
import {
  buildNormalizedOriginMap,
  findNormalizedIndex,
  findNormalizedRange,
  sanitizeWinAnsi,
} from './pdfDrawSafe';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(sanitizeWinAnsi('Hello—world…') === 'Hello-world...', 'emdash/ellipsis');
assert(sanitizeWinAnsi('‘smart’ “quotes”') === "'smart' \"quotes\"", 'smart quotes');
assert(!sanitizeWinAnsi('café — ok').includes('—'), 'no remaining emdash');

{
  const hay = 'Alpha beta gamma';
  const { normalized, origins } = buildNormalizedOriginMap(hay);
  assert(normalized === normalizeForMatch(hay), 'origin map must match normalizeForMatch');
  const idx = findNormalizedIndex(hay, 'beta');
  assert(idx === 6, `expected beta raw offset 6, got ${idx}`);
  assert(origins[normalized.indexOf('beta')] === 6, 'origin for beta');
}

assert(findNormalizedIndex('abc', 'zzz') === -1, 'missing needle must be -1');
assert(findNormalizedIndex('abc', '!!!') === -1, 'punct-only needle must be -1');

{
  const hay = 'Results—show improvement';
  const idx = findNormalizedIndex(hay, 'show');
  assert(idx === hay.indexOf('show'), `show offset, got ${idx}`);
}

{
  // Raw span must cover full visual text, not just normalized char count
  const hay = 'Hello, world!!! Next';
  const range = findNormalizedRange(hay, 'Hello, world');
  assert(range.start === 0, `start 0, got ${range.start}`);
  assert(range.end >= 'Hello, world'.length, `end covers raw world, got ${range.end}`);
  assert(hay.slice(range.start, range.end).startsWith('Hello'), 'slice starts with Hello');
  // End should reach past trailing bangs that normalize away
  assert(range.end > hay.indexOf('world') + 5, 'end includes trailing punct');
}

console.log('pdfDrawSafe.test.ts: ok');
