/**
 * Unit tests for the ethics / declaration statement checker.
 * Run: npx tsx src/lib/submission/statements.test.ts
 */
import { checkStatements } from './statements';
import type { ParsedPaper } from '../../types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function paperWith(fullText: string, methodsText?: string): ParsedPaper {
  const text = methodsText ? `${fullText}\nMethods\n${methodsText}` : fullText;
  const mStart = methodsText ? text.indexOf('Methods') : -1;
  return {
    fullText: text,
    pages: [{ pageNumber: 1, text: '', startOffset: 0, endOffset: text.length }],
    sentences: [],
    sections: methodsText
      ? [{ name: 'Methods', startOffset: mStart, endOffset: text.length, pageStart: 1 }]
      : [],
    references: [],
    citations: [],
    detectedCitationStyle: 'IEEE',
    pageCount: 1,
  };
}

// Human-subject study with no statements → ethics + consent + COI missing
const humanNoStatements = checkStatements(
  paperWith(
    'We study user behavior.',
    'We recruited 40 participants who completed a questionnaire and interviews.'
  )
);
const byId = (id: string) => humanNoStatements.items.find((i) => i.id === id);
assert(byId('ethics')?.status === 'missing', 'human study without ethics statement → missing');
assert(byId('ethics')?.template?.includes('[INSTITUTION]'), 'ethics template has placeholders');
assert(byId('consent')?.status === 'missing', 'human study without consent → missing');
assert(byId('conflict')?.status === 'missing', 'no COI disclosure → missing');
assert(humanNoStatements.missingCount >= 3, `expected ≥3 missing, got ${humanNoStatements.missingCount}`);

// Same study with statements present → ok
const humanWithStatements = checkStatements(
  paperWith(
    'We study user behavior. This study was approved by the University institutional review board (IRB no. 42). ' +
      'Written informed consent was obtained from all participants. ' +
      'The authors declare no conflicts of interest. ' +
      'This work was supported by Grant No. 123. ' +
      'Data availability: the data are available at https://osf.io/xyz.',
    'We recruited 40 participants who completed a questionnaire.'
  )
);
for (const id of ['ethics', 'consent', 'conflict', 'funding', 'data']) {
  const item = humanWithStatements.items.find((i) => i.id === id);
  assert(item?.status === 'ok', `${id} should be ok when statement present, got ${item?.status}`);
}
assert(humanWithStatements.missingCount === 0, 'nothing missing when all statements present');

// Animal study → animal ethics template
const animal = checkStatements(
  paperWith('We test a drug.', 'Experiments used 24 mice in vivo under standard housing.')
);
const animalEthics = animal.items.find((i) => i.id === 'ethics');
assert(animalEthics?.status === 'missing', 'animal study without ethics → missing');
assert(/animal/i.test(animalEthics?.template || ''), 'animal template should mention animals');

// Pure simulation paper → ethics not needed, no consent row
const sim = checkStatements(
  paperWith('We simulate a channel model.', 'We run Monte Carlo simulations of the estimator.')
);
assert(sim.items.find((i) => i.id === 'ethics')?.status === 'not_needed', 'simulation → ethics not needed');
assert(!sim.items.some((i) => i.id === 'consent'), 'no human signals → no consent row');

// Dataset paper without availability statement → missing
const dataPaper = checkStatements(
  paperWith('We release a benchmark dataset of 10k samples collected from sensors.', 'We collected data using sensors.')
);
assert(
  dataPaper.items.find((i) => i.id === 'data')?.status === 'missing',
  'dataset paper without availability statement → missing'
);

console.log('statements.test.ts: all passed');
