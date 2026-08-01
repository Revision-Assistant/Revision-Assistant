/**
 * Lightweight node-free assertions run via `npm run test:unit`
 */
import { matchSourceToReferences, categorizeSimilaritySpan } from './rules';
import type { AlignedSpan, ParsedPaper, ReferenceEntry } from '../../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const refs: ReferenceEntry[] = [
  {
    index: 1,
    raw: 'Smith J. Deep learning for medical imaging. Nature Medicine. 2020.',
    authors: ['Smith J'],
    year: '2020',
    title: 'Deep learning for medical imaging',
    venue: 'Nature Medicine',
    startOffset: 1000,
    endOffset: 1100,
  },
];

const paper = {
  fullText:
    'Introduction We study CNNs. Convolutional architectures improved diagnostic sensitivity on chest radiographs under limited labeled data. Methods We used Python. References Smith J. Deep learning for medical imaging. Nature Medicine. 2020.',
  pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: 500 }],
  sentences: [],
  sections: [
    { name: 'Introduction' as const, startOffset: 0, endOffset: 140, pageStart: 1 },
    { name: 'Methods' as const, startOffset: 140, endOffset: 170, pageStart: 1 },
    { name: 'References' as const, startOffset: 170, endOffset: 500, pageStart: 1 },
  ],
  references: refs,
  citations: [],
  detectedCitationStyle: 'APA' as const,
  pageCount: 1,
} satisfies ParsedPaper;

// Reference match
const hit = matchSourceToReferences('Deep learning for medical imaging Nature', refs);
assert(hit && hit.index === 1, 'should match reference by title');

const miss = matchSourceToReferences('Completely unrelated student thesis about frogs', refs);
assert(miss === null, 'should not match unrelated title');

// Categorize missing citation
const span: AlignedSpan = {
  reportText:
    'Convolutional architectures improved diagnostic sensitivity on chest radiographs under limited labeled data.',
  paperStart: 28,
  paperEnd: 135,
  paperPage: 1,
  paperText:
    'Convolutional architectures improved diagnostic sensitivity on chest radiographs under limited labeled data.',
  score: 0.95,
  sources: [
    {
      title: 'Deep learning for medical imaging',
      url: 'https://example.com',
      percentage: 5,
      sourceType: 'publication',
    },
  ],
  matchPct: 5,
  kind: 'similarity',
};

const finding = categorizeSimilaritySpan(span, paper);
assert(
  finding.category === 'missing_in_text_citation',
  `expected missing_in_text_citation, got ${finding.category}`
);

// Student paper never proposes citation path as needs_new_citation
const student: AlignedSpan = {
  ...span,
  sources: [
    {
      title: 'Submitted to University of Example',
      url: null,
      percentage: 3,
      sourceType: 'student_paper',
    },
  ],
};
const sf = categorizeSimilaritySpan(student, paper);
assert(sf.category === 'source_unidentifiable', 'student paper → unidentifiable');
assert(!sf.suggestion?.toLowerCase().includes('cite'), 'no citation proposal for student paper');

// Reference section informational
const refSpan: AlignedSpan = {
  reportText: 'Smith J. Deep learning',
  paperStart: 180,
  paperEnd: 220,
  paperPage: 1,
  paperText: 'Smith J. Deep learning for medical imaging.',
  score: 1,
  sources: [],
  matchPct: 2,
  kind: 'similarity',
};
const rf = categorizeSimilaritySpan(refSpan, paper);
assert(rf.category === 'reference_entry', 'refs section → reference_entry');
assert(rf.isInformational, 'reference_entry is informational');

// Sub-1% sources are fragments, not passages — informational, not "needs a citation"
const trivial: AlignedSpan = {
  ...span,
  sources: [
    {
      title: 'Some unrelated conference paper about other things',
      url: 'https://example.org/other',
      percentage: 0.5,
      sourceType: 'publication',
    },
  ],
  matchPct: 0.5,
  positionOnly: true,
};
const tf = categorizeSimilaritySpan(trivial, paper);
assert(tf.category === 'trivial_match', `expected trivial_match, got ${tf.category}`);
assert(tf.isInformational, 'trivial_match should be informational, not actionable');
assert(
  /not its extent|only part of it/i.test(tf.explanation || ''),
  'position-only findings must disclose that the matched extent is unknown'
);

// A source that IS in the reference list still outranks the trivial gate
const trivialButCited: AlignedSpan = {
  ...span,
  sources: [
    {
      title: 'Deep learning for medical imaging',
      url: null,
      percentage: 0.5,
      sourceType: 'publication',
    },
  ],
  matchPct: 0.5,
};
const tbc = categorizeSimilaritySpan(trivialButCited, paper);
assert(
  tbc.category === 'missing_in_text_citation',
  `reference-list match should outrank the trivial gate, got ${tbc.category}`
);

console.log('rules.test.ts: all passed');
