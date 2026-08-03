/**
 * Curated venue requirements for the Resubmission Reformatter delta checklist.
 * Written in our own words from public author-guideline patterns — not scraped pages.
 * Always show lastVerified + "verify on the journal site" in the UI.
 */

import type { VenueStyleId } from '../submission/checklist';

export interface VenueRequirements {
  /** Match key — usually curated venue name or short alias */
  id: string;
  label: string;
  /** Preferred CSL style id from styles.ts */
  styleId: string;
  abstractMinWords?: number;
  abstractMaxWords?: number;
  abstractStructured?: boolean;
  keywordMin?: number;
  keywordMax?: number;
  keywordHeading?: string;
  wordLimit?: number;
  expectsNumericCitations?: boolean;
  expectsHighlights?: boolean;
  expectsConflictStatement?: boolean;
  expectsDataAvailability?: boolean;
  titleMaxWords?: number;
  /** Checklist archetype for shared submission checks */
  archetype?: VenueStyleId;
  lastVerified: string;
  notes?: string;
}

/** Top curated profiles (~25). Remaining venues fall back to archetype generics. */
export const VENUE_REQUIREMENTS: VenueRequirements[] = [
  {
    id: 'ieee-access',
    label: 'IEEE Access',
    styleId: 'ieee',
    abstractMinWords: 150,
    abstractMaxWords: 250,
    keywordMin: 3,
    keywordMax: 10,
    keywordHeading: 'Index Terms',
    expectsNumericCitations: true,
    expectsConflictStatement: true,
    titleMaxWords: 20,
    archetype: 'ieee',
    lastVerified: '2026-06',
    notes: 'Open-access APCs apply; topical fit ≠ acceptance.',
  },
  {
    id: 'ieee-sensors',
    label: 'IEEE Sensors Journal',
    styleId: 'ieee',
    abstractMaxWords: 200,
    keywordHeading: 'Index Terms',
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'ieee-tnnls',
    label: 'IEEE Transactions on Neural Networks and Learning Systems',
    styleId: 'ieee',
    abstractMaxWords: 200,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'ieee-tpami',
    label: 'IEEE Transactions on Pattern Analysis and Machine Intelligence',
    styleId: 'ieee',
    abstractMaxWords: 200,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'ieee-iot',
    label: 'IEEE Internet of Things Journal',
    styleId: 'ieee',
    abstractMaxWords: 200,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'ieee-tbme',
    label: 'IEEE Transactions on Biomedical Engineering',
    styleId: 'ieee',
    abstractMaxWords: 200,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'mdpi-sensors',
    label: 'MDPI Sensors',
    styleId: 'mdpi',
    abstractMaxWords: 200,
    keywordMin: 3,
    keywordMax: 10,
    expectsDataAvailability: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'mdpi-electronics',
    label: 'MDPI Electronics',
    styleId: 'mdpi',
    abstractMaxWords: 200,
    expectsDataAvailability: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'nature-comms',
    label: 'Nature Communications (pattern)',
    styleId: 'nature',
    abstractMaxWords: 150,
    expectsDataAvailability: true,
    expectsConflictStatement: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
    notes: 'Nature portfolio journals vary — verify the specific title’s checklist.',
  },
  {
    id: 'scientific-reports',
    label: 'Scientific Reports (pattern)',
    styleId: 'nature',
    abstractMaxWords: 200,
    expectsDataAvailability: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'plos-one',
    label: 'PLOS ONE',
    styleId: 'plos',
    abstractMaxWords: 300,
    expectsDataAvailability: true,
    expectsConflictStatement: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'bmc-bioinformatics',
    label: 'BMC Bioinformatics (pattern)',
    styleId: 'bmc',
    abstractMaxWords: 350,
    abstractStructured: true,
    expectsDataAvailability: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'frontiers-ai',
    label: 'Frontiers in Artificial Intelligence (pattern)',
    styleId: 'frontiers',
    abstractMaxWords: 280,
    expectsConflictStatement: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'applied-energy',
    label: 'Applied Energy (Elsevier pattern)',
    styleId: 'elsevier-harvard',
    abstractMaxWords: 250,
    expectsHighlights: true,
    expectsConflictStatement: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
    notes: 'Many Elsevier energy titles want 3–5 research highlights.',
  },
  {
    id: 'sensors-actuators-b',
    label: 'Sensors and Actuators B (Elsevier pattern)',
    styleId: 'elsevier-harvard',
    abstractMaxWords: 250,
    expectsHighlights: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'neurocomputing',
    label: 'Neurocomputing (Elsevier pattern)',
    styleId: 'elsevier-harvard',
    abstractMaxWords: 200,
    expectsHighlights: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'expert-systems',
    label: 'Expert Systems with Applications (pattern)',
    styleId: 'elsevier-harvard',
    abstractMaxWords: 250,
    expectsHighlights: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'acs-ami',
    label: 'ACS Applied Materials & Interfaces',
    styleId: 'acs',
    abstractMaxWords: 200,
    expectsConflictStatement: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'rsc-nanoscale',
    label: 'Nanoscale (RSC pattern)',
    styleId: 'rsc',
    abstractMaxWords: 250,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'aip-apl',
    label: 'Applied Physics Letters',
    styleId: 'aip',
    abstractMaxWords: 100,
    wordLimit: 3500,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
    notes: 'Letters are short — check current word/figure caps on the AIP site.',
  },
  {
    id: 'iop-nanotechnology',
    label: 'Nanotechnology (IOP pattern)',
    styleId: 'iop',
    abstractMaxWords: 200,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'acm-tist',
    label: 'ACM TIST (pattern)',
    styleId: 'acm',
    abstractMaxWords: 200,
    archetype: 'generic',
    lastVerified: '2026-06',
  },
  {
    id: 'springer-nca',
    label: 'Neural Computing and Applications (Springer pattern)',
    styleId: 'springer-basic',
    abstractMaxWords: 250,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'wiley-ijn',
    label: 'International Journal of Numerical Methods (Wiley pattern)',
    styleId: 'wiley-apa',
    abstractMaxWords: 250,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
  {
    id: 'generic-ieee',
    label: 'Generic IEEE-style venue',
    styleId: 'ieee',
    abstractMinWords: 100,
    abstractMaxWords: 250,
    expectsNumericCitations: true,
    archetype: 'ieee',
    lastVerified: '2026-06',
  },
  {
    id: 'generic-elsevier',
    label: 'Generic Elsevier-style venue',
    styleId: 'elsevier-harvard',
    abstractMinWords: 100,
    abstractMaxWords: 300,
    expectsHighlights: true,
    archetype: 'elsevier',
    lastVerified: '2026-06',
  },
];

export function findVenueRequirements(query: string): VenueRequirements | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = VENUE_REQUIREMENTS.find(
    (v) => v.label.toLowerCase() === q || v.id === q
  );
  if (exact) return exact;
  return (
    VENUE_REQUIREMENTS.find(
      (v) =>
        v.label.toLowerCase().includes(q) ||
        q.includes(v.label.toLowerCase().slice(0, 18)) ||
        v.id.includes(q.replace(/\s+/g, '-'))
    ) ?? null
  );
}

export function searchVenueRequirements(query: string, limit = 12): VenueRequirements[] {
  const q = query.trim().toLowerCase();
  if (!q) return VENUE_REQUIREMENTS.slice(0, limit);
  return VENUE_REQUIREMENTS.filter(
    (v) => v.label.toLowerCase().includes(q) || v.id.includes(q.replace(/\s+/g, '-'))
  ).slice(0, limit);
}
