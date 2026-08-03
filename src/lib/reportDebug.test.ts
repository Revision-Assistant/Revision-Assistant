/**
 * Lightweight assertions via `npm run test:unit`
 */
import { nextStepForFinding, originLabel, reportEvidenceRows, reportDebugForExplain } from './reportDebug';
import type { Finding } from '../types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const base: Finding = {
  id: '1',
  kind: 'similarity',
  category: 'needs_restatement',
  startOffset: 0,
  endOffset: 40,
  page: 2,
  text: 'Long overlapping passage about diagnostic imaging results under limited labels.',
  sourceUrl: 'https://example.com/paper',
  sourceTitle: 'Deep learning for medical imaging',
  matchPct: 4,
  sourceType: 'publication',
  explanation: 'Long span with substantial overlap.',
  suggestion: 'Rewrite from memory.',
  status: 'open',
  isInformational: false,
  confidence: 0.8,
  reportText: 'diagnostic imaging results under limited labels',
  sources: [
    {
      title: 'Deep learning for medical imaging',
      url: 'https://example.com/paper',
      percentage: 4,
      sourceType: 'publication',
    },
  ],
  positionOnly: true,
  reportOrigin: 'similarity_report',
};

assert(originLabel('similarity_report').includes('Similarity'), 'origin label');
assert(nextStepForFinding(base).toLowerCase().includes('restate'), 'next step restatement');

const rows = reportEvidenceRows(base);
assert(rows.some((r) => r.label === 'Match weight' && r.value.includes('4%')), 'match weight row');
assert(rows.some((r) => r.label === 'Report source'), 'source row');
assert(rows.some((r) => r.label === 'Extent'), 'positionOnly extent');
assert(rows.some((r) => r.label === 'Report excerpt'), 'report excerpt when different');

const payload = reportDebugForExplain(base);
assert(payload.reportOrigin === 'similarity_report', 'explain payload origin');
assert(Array.isArray(payload.sources) && (payload.sources as unknown[]).length === 1, 'explain sources');

const localAi: Finding = {
  ...base,
  kind: 'ai',
  category: 'ai_flagged',
  matchPct: null,
  sourceTitle: null,
  sourceUrl: null,
  sourceType: null,
  sources: [],
  reportOrigin: 'local_heuristic',
  reportText: base.text,
  positionOnly: true,
};
assert(originLabel(localAi.reportOrigin).includes('Local'), 'local origin');
assert(nextStepForFinding(localAi).toLowerCase().includes('ownership'), 'ai next step');

console.log('reportDebug.test.ts: ok');
