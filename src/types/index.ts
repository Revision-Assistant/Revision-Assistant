/** Core domain types for the Research Paper Revision Assistant */

export type CitationStyle = 'IEEE' | 'Vancouver' | 'APA' | 'Harvard' | 'unknown';

export type SectionName =
  | 'Abstract'
  | 'Introduction'
  | 'Methods'
  | 'Results'
  | 'Discussion'
  | 'Conclusion'
  | 'References'
  | 'Other';

export type FindingKind =
  | 'similarity'
  | 'ai'
  | 'grammar'
  | 'orphan_ref'
  | 'broken_citation'
  | 'citation_need';

export type FindingCategory =
  | 'reference_entry'
  | 'properly_quoted'
  | 'already_cited'
  | 'common_phrase'
  | 'methods_boilerplate'
  | 'missing_in_text_citation'
  | 'needs_new_citation'
  | 'needs_restatement'
  | 'source_unidentifiable'
  | 'ai_flagged'
  | 'orphan_reference'
  | 'broken_citation'
  | 'review_manually'
  | 'grammar_error'
  | 'trivial_match'
  | 'needs_citation_claim';

export type FindingStatus = 'open' | 'accepted' | 'dismissed' | 'edited';

export type TurnitinSourceType = 'internet' | 'publication' | 'student_paper' | 'unknown';

export interface TextSpan {
  text: string;
  startOffset: number;
  endOffset: number;
  page: number;
}

export interface PaperSentence extends TextSpan {
  sentenceIndex: number;
  section: SectionName;
}

export interface PaperSection {
  name: SectionName;
  startOffset: number;
  endOffset: number;
  pageStart: number;
}

export interface ReferenceEntry {
  index: number;
  raw: string;
  authors: string[];
  year: string | null;
  title: string | null;
  venue: string | null;
  startOffset: number;
  endOffset: number;
}

export interface InTextCitation {
  marker: string;
  style: CitationStyle;
  startOffset: number;
  endOffset: number;
  /** Parsed keys e.g. numbers for IEEE or author-year */
  keys: string[];
}

export interface ParsedPaper {
  fullText: string;
  pages: { pageNumber: number; text: string; startOffset: number; endOffset: number }[];
  sentences: PaperSentence[];
  sections: PaperSection[];
  references: ReferenceEntry[];
  citations: InTextCitation[];
  detectedCitationStyle: CitationStyle;
  pageCount: number;
}

export interface MatchSource {
  title: string;
  url: string | null;
  percentage: number;
  sourceType: TurnitinSourceType;
}

export interface SimilarityFlag extends TextSpan {
  matchPct: number | null;
  sources: MatchSource[];
  colorIndex?: number;
  /** Offsets already point at the paper (badge-position mapping) — skip fuzzy alignment */
  preAligned?: boolean;
}

export interface SimilarityReport {
  overallPct: number | null;
  flags: SimilarityFlag[];
  sources: MatchSource[];
  formatVersion: string;
  rawText: string;
}

export interface AIFlag extends TextSpan {
  confidence?: number;
}

export interface AIReport {
  overallPct: number | null;
  flags: AIFlag[];
  formatVersion: string;
  rawText: string;
}

export interface AlignedSpan {
  reportText: string;
  paperStart: number;
  paperEnd: number;
  paperPage: number;
  paperText: string;
  score: number;
  sources: MatchSource[];
  matchPct: number | null;
  kind: FindingKind;
  /**
   * Located from a match badge's position rather than matched excerpt text, so the span is
   * the sentence *around* the match — the exact matched fragment is unknown.
   */
  positionOnly?: boolean;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  category: FindingCategory;
  startOffset: number;
  endOffset: number;
  page: number;
  text: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  matchPct: number | null;
  sourceType: TurnitinSourceType | null;
  explanation: string | null;
  suggestion: string | null;
  status: FindingStatus;
  /** False-positive style categories shown greyed */
  isInformational: boolean;
  confidence: number;
  /** Local AI diagnostics when kind === 'ai' */
  aiFeatures?: AIFeatures;
  userNote?: string;
  editedText?: string;
  /** True when editedText drops a citation marker present in the original span (see lib/citation/guard.ts) */
  citationWarning?: boolean;
  /** Exact one-click replacement text for kind === 'grammar' findings (see lib/grammar/languageTool.ts) */
  replacementText?: string | null;
  /** Signals behind a citation_need finding; doubles as the training feature vector */
  citationNeedFeatures?: CitationNeedFeatures;
}

export interface CitationNeedFeatures {
  hasAttributionCue: boolean;
  hasClaimCue: boolean;
  hasNearbyCitation: boolean;
  isOwnWork: boolean;
  wordCount: number;
  numericCount: number;
  section: SectionName;
  score: number;
}

export interface AIFeatures {
  sentenceLengthVariance: number;
  hedgingDensity: number;
  concreteEntityCount: number;
  citationCount: number;
  avgSentenceLength: number;
}

export interface ProjectMeta {
  id?: string;
  title: string;
  similarityPct: number | null;
  aiPct: number | null;
  reportFormatVersion: string | null;
  citationStyle: CitationStyle;
}

export interface AnalysisResult {
  paper: ParsedPaper;
  similarity: SimilarityReport | null;
  ai: AIReport | null;
  findings: Finding[];
  meta: ProjectMeta;
}

export interface ChangeLogEntry {
  findingId: string;
  kind: FindingKind;
  category: FindingCategory;
  originalText: string;
  action: FindingStatus;
  suggestion: string | null;
  userNote: string | null;
  editedText: string | null;
  page: number;
  citationWarning: boolean;
}

export type PipelineStage =
  | 'idle'
  | 'parsing_paper'
  | 'parsing_reports'
  | 'aligning'
  | 'categorizing'
  | 'citation_need'
  | 'grammar_check'
  | 'explaining'
  | 'done'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  message: string;
  percent: number;
}
