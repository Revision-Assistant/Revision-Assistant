/**
 * Unit tests for Resubmission Reformatter pure logic.
 */
import assert from 'node:assert/strict';
import type { ParsedPaper, ReferenceEntry } from '../../types';
import { parseReferencesToCsl, referenceToCsl } from './parseToCsl';
import { renderBibliography, formatBibliographyText } from './renderBibliography';
import { buildRequirementsDelta, formatDeltaMarkdown } from './requirementsDelta';
import { VENUE_REQUIREMENTS, findVenueRequirements } from './venueRequirements';
import { buildReformatPackage } from './exportPackage';
import { REFORMAT_STYLES, getStyle } from './styles';

function ref(partial: Partial<ReferenceEntry> & { index: number; raw: string }): ReferenceEntry {
  return {
    authors: [],
    year: null,
    title: null,
    venue: null,
    startOffset: 0,
    endOffset: partial.raw.length,
    ...partial,
  };
}

// --- parse ---
const ieeeRef = ref({
  index: 1,
  raw: '[1] J. Smith and A. Lee, "Deep learning for sensors," IEEE Sensors J., vol. 20, no. 3, pp. 100–110, 2020, doi: 10.1109/JSEN.2020.1234567.',
  authors: ['J. Smith', 'A. Lee'],
  year: '2020',
  title: 'Deep learning for sensors',
  venue: 'IEEE Sensors J.',
});

const parsed = referenceToCsl(ieeeRef);
assert.equal(parsed.csl.DOI, '10.1109/JSEN.2020.1234567');
assert.ok(parsed.csl.title?.includes('Deep learning'));
assert.equal(parsed.confidence, 'high');
assert.equal(parsed.source, 'local');

const weakRef = ref({
  index: 2,
  raw: '[2] See website for details about the protocol used in 2019.',
});
const weak = referenceToCsl(weakRef);
assert.equal(weak.confidence, 'low');
assert.ok(weak.csl.title); // never empty — entry kept

const list = parseReferencesToCsl([ieeeRef, weakRef]);
assert.equal(list.length, 2);

// --- styles catalog ---
assert.ok(REFORMAT_STYLES.length >= 25);
assert.equal(getStyle('ieee').citationForm, 'numeric');
assert.equal(getStyle('chicago-notes').unsupported, true);

// --- render ---
const rendered = renderBibliography(list, 'apa');
assert.equal(rendered.length, 2);
assert.ok(rendered[0].rendered.length > 10);
const bibText = formatBibliographyText(rendered, 'apa');
assert.match(bibText, /Restyled bibliography/);
assert.match(bibText, /\[1\]/);

// --- venue requirements ---
assert.ok(VENUE_REQUIREMENTS.length >= 20);
const access = findVenueRequirements('IEEE Access');
assert.ok(access);
assert.equal(access!.styleId, 'ieee');

// --- delta checklist ---
const paper: ParsedPaper = {
  fullText:
    'Abstract This paper studies sensors with enough words to pass a soft length check for testing purposes only and more filler text here. Index Terms—sensors, learning. Introduction Methods Results Discussion Conclusion References [1] J. Smith, "Deep learning for sensors," IEEE Sensors J., 2020. Highlights: better accuracy.',
  pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: 200 }],
  sentences: [],
  sections: [
    { name: 'Abstract', startOffset: 0, endOffset: 120, pageStart: 1 },
    { name: 'Introduction', startOffset: 120, endOffset: 140, pageStart: 1 },
    { name: 'Methods', startOffset: 140, endOffset: 150, pageStart: 1 },
    { name: 'Results', startOffset: 150, endOffset: 160, pageStart: 1 },
    { name: 'Discussion', startOffset: 160, endOffset: 170, pageStart: 1 },
    { name: 'Conclusion', startOffset: 170, endOffset: 180, pageStart: 1 },
    { name: 'References', startOffset: 180, endOffset: 260, pageStart: 1 },
  ],
  references: [ieeeRef],
  citations: [],
  detectedCitationStyle: 'IEEE',
  pageCount: 1,
};

const delta = buildRequirementsDelta(paper, access!, 'Deep learning for sensors');
assert.ok(delta.items.length > 3);
assert.match(delta.disclaimer, /verify on the journal site/i);
assert.match(formatDeltaMarkdown(delta), /Requirements delta/);

const pkg = buildReformatPackage({
  title: 'Deep learning for sensors',
  styleId: 'apa',
  rendered,
  delta,
});
assert.match(pkg, /Resubmission reformatter package/);
assert.match(pkg, /Citation restyle notes/);

console.log('reformat tests: ok');
