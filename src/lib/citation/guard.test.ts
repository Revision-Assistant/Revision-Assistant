/**
 * Lightweight node-free assertions run via `npm run test:unit`
 */
import { extractMarkers, checkCitationIntegrity } from './guard';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// IEEE bracket extraction
const ieee = extractMarkers('Deep nets improved accuracy [3, 4] on this benchmark.');
assert(ieee.length === 1 && ieee[0].keys.join(',') === '3,4', 'should extract IEEE bracket keys');

// APA extraction
const apa = extractMarkers('This was previously shown (Smith, 2020; Lee et al., 2019).');
assert(apa.length === 1 && apa[0].keys.length === 2, 'should extract multiple APA keys');

// Harvard extraction
const harvard = extractMarkers('Smith (2020) demonstrated this effect.');
assert(harvard.length === 1, 'should extract Harvard-style marker');

// No citation in original -> always ok
assert(
  checkCitationIntegrity('A plain sentence with no citation.', 'A rewritten sentence.').ok,
  'no citation in original should always pass'
);

// Citation dropped entirely -> flagged
const dropped = checkCitationIntegrity(
  'Convolutional architectures improved sensitivity [12].',
  'Convolutional architectures improved sensitivity through better feature extraction.'
);
assert(!dropped.ok, 'dropping the only citation should fail integrity check');
assert(dropped.lost.length === 1 && dropped.lost[0].marker === '[12]', 'should report the exact lost marker');

// Citation reformatted but keys survive -> not flagged
const reformatted = checkCitationIntegrity(
  'This was shown by prior work [3, 4].',
  'This was shown by prior work, as reported in [3] and later confirmed in [4].'
);
assert(reformatted.ok, 'splitting a combined marker into two separate ones should not count as lost');

// Partial loss: one of two distinct citations dropped -> flagged
const partial = checkCitationIntegrity(
  'Two independent studies confirm this [5] (Lee, 2019).',
  'Two independent studies confirm this [5].'
);
assert(!partial.ok && partial.lost.length === 1, 'dropping one of two citations should flag only the missing one');

console.log('guard.test.ts: all passed');
