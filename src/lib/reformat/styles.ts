/**
 * Top ~30 citation styles for the Resubmission Reformatter.
 * Bundled citation-js templates: apa, vancouver, harvard1.
 * Additional styles map to the closest bundled template with an honest note.
 * CSL styles are CC BY-SA 3.0 (Citation Style Language project).
 */

export type CitationForm = 'numeric' | 'author-date' | 'note';

export interface ReformatStyle {
  id: string;
  label: string;
  /** citation-js / citeproc template name */
  template: string;
  citationForm: CitationForm;
  /** When true, UI should say footnote styles are out of MVP scope */
  unsupported?: boolean;
  /** Honest mapping note when we approximate with a bundled template */
  note?: string;
}

export const REFORMAT_STYLES: ReformatStyle[] = [
  { id: 'apa', label: 'APA 7th', template: 'apa', citationForm: 'author-date' },
  { id: 'harvard1', label: 'Harvard', template: 'harvard1', citationForm: 'author-date' },
  { id: 'vancouver', label: 'Vancouver', template: 'vancouver', citationForm: 'numeric' },
  {
    id: 'ieee',
    label: 'IEEE',
    template: 'vancouver',
    citationForm: 'numeric',
    note: 'Closest bundled numbered style (Vancouver). Verify brackets and italics against IEEE author guidelines.',
  },
  {
    id: 'nature',
    label: 'Nature',
    template: 'vancouver',
    citationForm: 'numeric',
    note: 'Numbered bibliography via Vancouver template — check Nature’s superscript markers separately.',
  },
  {
    id: 'science',
    label: 'Science (AAAS)',
    template: 'apa',
    citationForm: 'author-date',
    note: 'Author–date approximation; verify Science’s endnote conventions on the journal site.',
  },
  {
    id: 'ama',
    label: 'AMA / JAMA',
    template: 'vancouver',
    citationForm: 'numeric',
    note: 'Numbered medical style via Vancouver template.',
  },
  {
    id: 'nlm',
    label: 'NLM / PubMed',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'acs',
    label: 'ACS',
    template: 'apa',
    citationForm: 'author-date',
    note: 'Author–date ACS approximation via APA template.',
  },
  {
    id: 'chicago-author-date',
    label: 'Chicago (author–date)',
    template: 'apa',
    citationForm: 'author-date',
    note: 'Closest bundled author–date style.',
  },
  {
    id: 'chicago-notes',
    label: 'Chicago (notes)',
    template: 'apa',
    citationForm: 'note',
    unsupported: true,
    note: 'Footnote / endnote styles are out of scope for this MVP.',
  },
  {
    id: 'mla',
    label: 'MLA 9th',
    template: 'apa',
    citationForm: 'author-date',
    note: 'Author–date approximation; MLA works-cited differs — verify manually.',
  },
  {
    id: 'elsevier-harvard',
    label: 'Elsevier (Harvard)',
    template: 'harvard1',
    citationForm: 'author-date',
  },
  {
    id: 'elsevier-vancouver',
    label: 'Elsevier (numbered)',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'elsevier-apa',
    label: 'Elsevier (APA)',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'springer-basic',
    label: 'Springer (basic author–date)',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'springer-vancouver',
    label: 'Springer (numbered)',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'mdpi',
    label: 'MDPI',
    template: 'apa',
    citationForm: 'author-date',
    note: 'Many MDPI journals use ACS/APA-like author–date; confirm on the journal page.',
  },
  {
    id: 'acm',
    label: 'ACM',
    template: 'apa',
    citationForm: 'author-date',
    note: 'ACM numeric vs author–year varies by venue — verify.',
  },
  {
    id: 'rsc',
    label: 'Royal Society of Chemistry',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'iop',
    label: 'IOP',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'aip',
    label: 'AIP',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'aps',
    label: 'APS (Physical Review)',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'oxford-harvard',
    label: 'Oxford (Harvard)',
    template: 'harvard1',
    citationForm: 'author-date',
  },
  {
    id: 'taylor-francis-apa',
    label: 'Taylor & Francis (APA)',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'taylor-francis-chicago',
    label: 'Taylor & Francis (Chicago AD)',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'sage-harvard',
    label: 'SAGE (Harvard)',
    template: 'harvard1',
    citationForm: 'author-date',
  },
  {
    id: 'wiley-apa',
    label: 'Wiley (APA)',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'frontiers',
    label: 'Frontiers',
    template: 'apa',
    citationForm: 'author-date',
  },
  {
    id: 'plos',
    label: 'PLOS',
    template: 'vancouver',
    citationForm: 'numeric',
  },
  {
    id: 'bmc',
    label: 'BMC / SpringerOpen',
    template: 'vancouver',
    citationForm: 'numeric',
  },
];

export function getStyle(id: string): ReformatStyle {
  return REFORMAT_STYLES.find((s) => s.id === id) ?? REFORMAT_STYLES[0];
}
