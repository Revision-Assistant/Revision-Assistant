import { fingerprintReport } from './fingerprint';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sim = `
Turnitin Similarity Report
Similarity Index: 18%
Match Overview
12% https://www.example.com/article Some Journal Article Title Here
8% Submitted to University of Somewhere
Internet Sources
`;

const fp = fingerprintReport(sim, 'similarity');
assert(fp.ok, 'similarity report should pass fingerprint');
assert(fp.reportKind === 'similarity', 'kind similarity');

const ai = `
Turnitin AI Writing Detection
42% of the submission is likely AI generated
Qualifying text is highlighted below.
`;
const fpAi = fingerprintReport(ai, 'ai');
assert(fpAi.ok, 'ai report should pass fingerprint');

const paper = `
Abstract
This paper presents a novel method for clustering.
Introduction
We contribute three things.
`;
const bad = fingerprintReport(paper, 'similarity');
assert(!bad.ok, 'plain paper must fail fingerprint loudly');

// Real badge-style export: cover + sparse numbers early, originality index late
const badgeCover = 'paper.docx by Author\nSubmission date: 22-Jul-2026\nSubmission ID: 3001761778\n';
const badgeNums = Array.from({ length: 400 }, (_, i) => String((i % 70) + 1)).join(' ');
const badgeTail =
  '19 % SIMILARITY INDEX 12 % INTERNET SOURCES\nORIGINALITY REPORT\nPRIMARY SOURCES\n1 1 % ouci.dntb.gov.ua Internet Source\n';
const badgeReport = fingerprintReport(badgeCover + badgeNums + badgeTail, 'similarity');
assert(badgeReport.ok, `badge-style Turnitin export should pass: ${badgeReport.errors.join('; ')}`);

console.log('fingerprint.test.ts: all passed');
