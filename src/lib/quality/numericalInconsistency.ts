/**
 * Numerical inconsistency detection — same quantity reported with different
 * values in different parts of the manuscript (high-precision heuristics).
 *
 * Prefers few false positives: requires matching metric keywords + same unit
 * family, and skips clear conditionals (train vs test, baseline vs proposed).
 */

import type { Finding, ParsedPaper, SectionName } from '../../types';
import { offsetToPage } from '../pdf/textUtils';

export type UnitFamily =
  | 'percent'
  | 'count'
  | 'temperature'
  | 'voltage'
  | 'current'
  | 'ratio'
  | 'time'
  | 'length'
  | 'mass'
  | 'frequency'
  | 'generic';

export interface NumericClaim {
  value: number;
  rawValue: string;
  unitFamily: UnitFamily;
  unitRaw: string;
  metricKey: string;
  metricTokens: string[];
  qualifiers: string[];
  sentenceText: string;
  startOffset: number;
  endOffset: number;
  claimStart: number;
  claimEnd: number;
  page: number;
  section: SectionName;
}

const SKIP_SECTIONS: SectionName[] = ['References'];

const METRIC_ALIASES: Record<string, string> = {
  accuracy: 'accuracy',
  acc: 'accuracy',
  precision: 'precision',
  recall: 'recall',
  sensitivity: 'sensitivity',
  specificity: 'specificity',
  f1: 'f1',
  'f1-score': 'f1',
  'f1 score': 'f1',
  'f-measure': 'f1',
  auc: 'auc',
  'auroc': 'auc',
  map: 'map',
  'mAP': 'map',
  iou: 'iou',
  'mean iou': 'iou',
  miou: 'iou',
  bleu: 'bleu',
  rouge: 'rouge',
  psnr: 'psnr',
  ssim: 'ssim',
  'sample size': 'sample_size',
  samples: 'sample_size',
  subjects: 'sample_size',
  participants: 'sample_size',
  patients: 'sample_size',
  cases: 'sample_size',
  cohort: 'sample_size',
  temperature: 'temperature',
  temp: 'temperature',
  voltage: 'voltage',
  current: 'current',
  'learning rate': 'learning_rate',
  lr: 'learning_rate',
  epoch: 'epochs',
  epochs: 'epochs',
  batch: 'batch_size',
  'batch size': 'batch_size',
  throughput: 'throughput',
  latency: 'latency',
  'error rate': 'error_rate',
  'error': 'error_rate',
  mse: 'mse',
  rmse: 'rmse',
  mae: 'mae',
};

const QUALIFIER_RE =
  /\b(train(?:ing)?|test(?:ing)?|val(?:idation)?|dev(?:elopment)?|baseline|proposed|ours?|their|control|treatment|before|after|pre[- ]?|post[- ]?|male|female|young|old|indoor|outdoor|low[- ]?power|high[- ]?power)\b/gi;

const CONDITIONAL_SPLIT_RE =
  /\b(?:respectively|whereas|while|compared\s+to|versus|vs\.?|when\s+using|for\s+the\s+\w+\s+set)\b/i;

function uid(): string {
  return crypto.randomUUID();
}

function normalizeMetricToken(raw: string): string | null {
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (METRIC_ALIASES[key]) return METRIC_ALIASES[key];
  // bare "n" / "N" → sample size
  if (key === 'n') return 'sample_size';
  return null;
}

function extractQualifiers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(QUALIFIER_RE)) {
    const q = m[1].toLowerCase().replace(/^pre[- ]?/, 'pre').replace(/^post[- ]?/, 'post');
    if (/^train/.test(q)) out.add('train');
    else if (/^test/.test(q)) out.add('test');
    else if (/^val|^dev/.test(q)) out.add('val');
    else if (/^baseline/.test(q)) out.add('baseline');
    else if (/^propos|^our/.test(q)) out.add('proposed');
    else if (/^their|^control/.test(q)) out.add('control');
    else if (/^treatment/.test(q)) out.add('treatment');
    else out.add(q);
  }
  return [...out].sort();
}

function qualifiersConflict(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  // Distinct roles (train vs test, baseline vs proposed) → not a manuscript inconsistency
  const roles = [
    ['train', 'test'],
    ['train', 'val'],
    ['test', 'val'],
    ['baseline', 'proposed'],
    ['control', 'treatment'],
    ['before', 'after'],
    ['pre', 'post'],
  ];
  for (const [x, y] of roles) {
    if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) return true;
  }
  const setB = new Set(b);
  // Compatible if any overlap on non-role tags
  if (a.some((x) => setB.has(x))) return false;
  // Any remaining disjoint non-empty qualifier sets → treat as different conditions
  return true;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isYearLike(n: number, unitFamily: UnitFamily): boolean {
  return unitFamily === 'generic' && n >= 1900 && n <= 2100 && Number.isInteger(n);
}

function valuesDiffer(a: number, b: number, family: UnitFamily): boolean {
  const diff = Math.abs(a - b);
  switch (family) {
    case 'percent':
      return diff >= 1.0;
    case 'count':
      return diff >= 1;
    case 'ratio':
      return diff >= 0.015;
    case 'temperature':
      return diff >= 0.5;
    case 'voltage':
    case 'current':
      return diff >= Math.max(0.05, 0.01 * Math.max(Math.abs(a), Math.abs(b), 1));
    case 'time':
    case 'length':
    case 'mass':
    case 'frequency':
      return diff >= Math.max(0.01, 0.02 * Math.max(Math.abs(a), Math.abs(b), 1));
    default:
      return diff >= Math.max(1, 0.05 * Math.max(Math.abs(a), Math.abs(b), 1));
  }
}

type PatternHit = {
  rawValue: string;
  value: number;
  unitFamily: UnitFamily;
  unitRaw: string;
  metricKey: string;
  metricTokens: string[];
  index: number;
  length: number;
};

function collectPatternHits(text: string): PatternHit[] {
  const hits: PatternHit[] = [];

  const push = (
    rawValue: string,
    unitFamily: UnitFamily,
    unitRaw: string,
    metricRaw: string,
    index: number,
    length: number
  ) => {
    const value = parseNumber(rawValue);
    if (value == null) return;
    const metricKey = normalizeMetricToken(metricRaw) || metricRaw.toLowerCase().replace(/\s+/g, '_');
    if (isYearLike(value, unitFamily)) return;
    // Skip figure/table indices: "Figure 3" already excluded by patterns; guard tiny generic ints
    if (unitFamily === 'generic' && Number.isInteger(value) && value <= 20) return;
    hits.push({
      rawValue,
      value,
      unitFamily,
      unitRaw,
      metricKey,
      metricTokens: [metricKey],
      index,
      length,
    });
  };

  // n = 50 / N = 45 / sample size of 120
  for (const m of text.matchAll(
    /\b(?:(?:sample\s+size|cohort\s+size|number\s+of\s+(?:samples?|subjects?|participants?|patients?|cases?))\s*(?:of|=|:)?\s*|([nN])\s*=\s*)(\d{1,7}(?:\.\d+)?)\b/g
  )) {
    const raw = m[2];
    const metric = m[1] ? 'n' : 'sample size';
    push(raw, 'count', 'n', metric, m.index ?? 0, m[0].length);
  }

  // accuracy of 92% / F1 = 0.91 / precision was 88%
  for (const m of text.matchAll(
    /\b(accuracy|precision|recall|sensitivity|specificity|F1(?:-?\s*score)?|AUC|AUROC|mAP|IoU|mIoU|BLEU|ROUGE|PSNR|SSIM|error\s+rate|MSE|RMSE|MAE)\s*(?:score\s*)?(?:of|was|were|=|:)?\s*(\d{1,3}(?:\.\d+)?)\s*(%|％)?\b/gi
  )) {
    const hasPct = Boolean(m[3]);
    const value = parseNumber(m[2]);
    if (value == null) continue;
    const family: UnitFamily = hasPct ? 'percent' : value <= 1.5 ? 'ratio' : 'percent';
    push(m[2], family, hasPct ? '%' : '', m[1], m.index ?? 0, m[0].length);
  }

  // 92% accuracy / 90% precision
  for (const m of text.matchAll(
    /\b(\d{1,3}(?:\.\d+)?)\s*(%|％)\s*(accuracy|precision|recall|sensitivity|specificity|F1(?:-?\s*score)?|AUC|mAP|IoU|error(?:\s+rate)?)\b/gi
  )) {
    push(m[1], 'percent', '%', m[3], m.index ?? 0, m[0].length);
  }

  // temperature 25 °C / heated to 37C / at 300 K
  for (const m of text.matchAll(
    /\b(?:(?:temperature|temp(?:erature)?)\s*(?:of|=|:)?\s*|at\s+|heated\s+to\s+|cooled\s+to\s+)(-?\d{1,4}(?:\.\d+)?)\s*°?\s*([CFK])\b/gi
  )) {
    push(m[1], 'temperature', m[2].toUpperCase(), 'temperature', m.index ?? 0, m[0].length);
  }

  // voltage / current
  for (const m of text.matchAll(
    /\b(?:(voltage|current)\s*(?:of|=|:)?\s*|at\s+)(-?\d{1,4}(?:\.\d+)?)\s*(m?V|kV|m?A|µA|uA)\b/gi
  )) {
    const metric = (m[1] || (/[vV]/.test(m[3]) ? 'voltage' : 'current')).toLowerCase();
    const family: UnitFamily = /[vV]/.test(m[3]) ? 'voltage' : 'current';
    push(m[2], family, m[3], metric, m.index ?? 0, m[0].length);
  }

  // learning rate = 0.001 / batch size of 32 / 100 epochs
  for (const m of text.matchAll(
    /\b(learning\s+rate|lr|batch\s+size|epochs?)\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?(?:e[-+]?\d+)?)\b/gi
  )) {
    push(m[2], 'generic', '', m[1], m.index ?? 0, m[0].length);
  }

  // Deduplicate overlapping hits (keep longer / more specific)
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  const filtered: PatternHit[] = [];
  for (const h of hits) {
    const overlaps = filtered.some(
      (p) => !(h.index + h.length <= p.index || p.index + p.length <= h.index)
    );
    if (!overlaps) filtered.push(h);
  }
  return filtered;
}

/**
 * Extract numeric claims with metric context from the manuscript.
 */
export function extractNumericClaims(paper: ParsedPaper): NumericClaim[] {
  const claims: NumericClaim[] = [];

  for (const s of paper.sentences) {
    if (SKIP_SECTIONS.includes(s.section)) continue;
    if (s.text.trim().length < 12) continue;
    const hits = collectPatternHits(s.text);
    for (const h of hits) {
      const windowStart = Math.max(0, h.index - 40);
      const windowEnd = Math.min(s.text.length, h.index + h.length + 40);
      const window = s.text.slice(windowStart, windowEnd);
      claims.push({
        value: h.value,
        rawValue: h.rawValue,
        unitFamily: h.unitFamily,
        unitRaw: h.unitRaw,
        metricKey: h.metricKey,
        metricTokens: h.metricTokens,
        qualifiers: extractQualifiers(window),
        sentenceText: s.text,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        claimStart: s.startOffset + h.index,
        claimEnd: s.startOffset + h.index + h.length,
        page: s.page || offsetToPage(paper.pages, s.startOffset),
        section: s.section,
      });
    }
  }

  // Fallback: scan full text windows when sentence segmentation is sparse
  if (claims.length === 0 && paper.fullText.length > 80) {
    const text = paper.fullText;
    for (const h of collectPatternHits(text)) {
      const absStart = h.index;
      const absEnd = h.index + h.length;
      const sentStart = Math.max(0, text.lastIndexOf('.', absStart - 1) + 1);
      let sentEnd = text.indexOf('.', absEnd);
      if (sentEnd < 0) sentEnd = Math.min(text.length, absEnd + 160);
      else sentEnd += 1;
      const sentenceText = text.slice(sentStart, sentEnd).trim();
      const window = text.slice(Math.max(0, absStart - 40), Math.min(text.length, absEnd + 40));
      claims.push({
        value: h.value,
        rawValue: h.rawValue,
        unitFamily: h.unitFamily,
        unitRaw: h.unitRaw,
        metricKey: h.metricKey,
        metricTokens: h.metricTokens,
        qualifiers: extractQualifiers(window),
        sentenceText,
        startOffset: sentStart,
        endOffset: sentEnd,
        claimStart: absStart,
        claimEnd: absEnd,
        page: offsetToPage(paper.pages, absStart),
        section: 'Other',
      });
    }
  }

  return claims;
}

function formatValue(c: NumericClaim): string {
  const unit =
    c.unitFamily === 'percent'
      ? '%'
      : c.unitRaw
        ? ` ${c.unitRaw}`
        : c.unitFamily === 'count'
          ? ''
          : '';
  return `${c.rawValue}${unit}`.trim();
}

function metricLabel(key: string): string {
  if (key === 'sample_size') return 'sample size (n)';
  if (key === 'f1') return 'F1';
  if (key === 'learning_rate') return 'learning rate';
  if (key === 'batch_size') return 'batch size';
  if (key === 'error_rate') return 'error rate';
  return key.replace(/_/g, ' ');
}

export interface NumericalInconsistencyOptions {
  maxFindings?: number;
}

/**
 * Detect conflicting numeric claims for the same metric/unit family.
 */
export function detectNumericalInconsistencies(
  paper: ParsedPaper,
  options: NumericalInconsistencyOptions = {}
): Finding[] {
  const maxFindings = options.maxFindings ?? 12;
  const claims = extractNumericClaims(paper);
  if (claims.length < 2) return [];

  // Group by metricKey + unitFamily
  const groups = new Map<string, NumericClaim[]>();
  for (const c of claims) {
    const key = `${c.metricKey}::${c.unitFamily}`;
    const list = groups.get(key) || [];
    list.push(c);
    groups.set(key, list);
  }

  const out: Finding[] = [];
  const seenPairs = new Set<string>();

  for (const [, group] of groups) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!valuesDiffer(a.value, b.value, a.unitFamily)) continue;
        if (qualifiersConflict(a.qualifiers, b.qualifiers)) continue;
        // Skip if either sentence explicitly contrasts multiple values
        if (CONDITIONAL_SPLIT_RE.test(a.sentenceText) || CONDITIONAL_SPLIT_RE.test(b.sentenceText)) {
          continue;
        }
        // Prefer cross-sentence; skip near-duplicates of same span
        if (a.claimStart === b.claimStart) continue;
        if (Math.abs(a.startOffset - b.startOffset) < 8) continue;

        const pairKey = [a.claimStart, b.claimStart].sort((x, y) => x - y).join(':');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const label = metricLabel(a.metricKey);
        const va = formatValue(a);
        const vb = formatValue(b);
        const sectionHint =
          a.section !== b.section
            ? ` (${a.section} vs ${b.section})`
            : a.page !== b.page
              ? ` (pages ${a.page} vs ${b.page})`
              : '';

        out.push({
          id: uid(),
          kind: 'manuscript_quality',
          category: 'numerical_inconsistency',
          startOffset: a.startOffset,
          endOffset: a.endOffset,
          page: a.page,
          text: a.sentenceText,
          sourceUrl: null,
          sourceTitle: null,
          matchPct: null,
          sourceType: null,
          explanation:
            `The manuscript reports ${label} as ${va} in one place and ${vb} elsewhere${sectionHint}. ` +
            `Same metric and unit family, without an obvious train/test or baseline/proposed qualifier separating them. ` +
            `This is a heuristic consistency check — not a full statistical audit; confirm whether the values refer to different conditions.`,
          suggestion:
            `Align the ${label} figures (${va} vs ${vb}), or add an explicit condition (e.g. train vs test, baseline vs proposed) so readers know they are not the same claim.`,
          status: 'open',
          isInformational: false,
          confidence: 0.88,
          relatedSpan: {
            text: b.sentenceText,
            startOffset: b.startOffset,
            endOffset: b.endOffset,
            page: b.page,
          },
          numericalConflict: {
            metricLabel: label,
            valueA: va,
            valueB: vb,
            unitFamily: a.unitFamily,
          },
        });

        if (out.length >= maxFindings) return out;
      }
    }
  }

  // Prefer cross-section conflicts first
  out.sort((x, y) => {
    const xCross = x.relatedSpan && x.page !== x.relatedSpan.page ? 0 : 1;
    const yCross = y.relatedSpan && y.page !== y.relatedSpan.page ? 0 : 1;
    if (xCross !== yCross) return xCross - yCross;
    return x.startOffset - y.startOffset;
  });

  return out.slice(0, maxFindings);
}
