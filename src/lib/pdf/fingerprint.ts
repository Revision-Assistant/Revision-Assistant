/**
 * Turnitin report format fingerprinting.
 * Fail loudly on unsupported templates rather than silently mis-parsing.
 */

export interface FingerprintResult {
  ok: boolean;
  formatVersion: string;
  reportKind: 'similarity' | 'ai' | 'unknown';
  errors: string[];
  warnings: string[];
}

/** Known header / section cues for Turnitin similarity reports */
const SIMILARITY_MARKERS = {
  headers: [
    /turnitin/i,
    /similarity\s*(report|index|check)?/i,
    /originality\s*report/i,
  ],
  sections: [
    /match\s*overview/i,
    /internet\s*sources?/i,
    /publications?/i,
    /student\s*papers?/i,
    /sources?\s*overview/i,
    /similarity\s*index/i,
  ],
  overall: [
    /similarity\s*index\s*[:\s]*\d{1,3}\s*%/i,
    /\d{1,3}\s*%\s*overall\s*similarity/i,
    /overall\s*similarity[:\s]*\d{1,3}\s*%/i,
  ],
};

const AI_MARKERS = {
  headers: [
    /turnitin/i,
    /ai\s*(writing\s*)?(detection|report|indicator)/i,
    /detected\s*as\s*ai/i,
  ],
  sections: [
    /ai\s*writing/i,
    /%?\s*of\s*(the\s*)?(submission|text|document)\s*(is\s*)?(likely\s*)?(AI|generated)/i,
    /qualifying\s*text/i,
  ],
  overall: [
    /\d{1,3}\s*%\s*(of\s*)?(the\s*)?(text|submission|document)?\s*(detected|likely)?\s*(as\s*)?AI/i,
    /AI\s*(writing\s*)?(detection|score|percentage)\s*[:\s]*\d{1,3}\s*%/i,
  ],
};

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((re) => re.test(text)).length;
}

/**
 * Verify the PDF text looks like a supported Turnitin report.
 * Returns formatVersion string for storage (e.g. "similarity-v1", "ai-v1").
 */
export function fingerprintReport(
  fullText: string,
  expected: 'similarity' | 'ai' | 'auto' = 'auto'
): FingerprintResult {
  // Badge-style Turnitin exports put cover + numeric match badges first; the originality
  // index / source list often starts dozens of pages later. Scan the whole text (and a
  // head sample) so those reports are not rejected as "unsupported".
  const sample = fullText.slice(0, 8000);
  const body = fullText.length > 8000 ? fullText : sample;
  const errors: string[] = [];
  const warnings: string[] = [];

  const badgeExport =
    /submission\s*(date|id)/i.test(sample) &&
    /originality\s*report/i.test(body) &&
    /similarity\s*index/i.test(body);

  const simScore =
    countMatches(body, SIMILARITY_MARKERS.headers) * 2 +
    countMatches(body, SIMILARITY_MARKERS.sections) +
    countMatches(body, SIMILARITY_MARKERS.overall) * 3 +
    (badgeExport ? 4 : 0);

  const aiScore =
    countMatches(body, AI_MARKERS.headers) * 2 +
    countMatches(body, AI_MARKERS.sections) +
    countMatches(body, AI_MARKERS.overall) * 3;

  let reportKind: 'similarity' | 'ai' | 'unknown' = 'unknown';
  if (expected === 'similarity') reportKind = 'similarity';
  else if (expected === 'ai') reportKind = 'ai';
  else if (simScore >= aiScore && simScore >= 2) reportKind = 'similarity';
  else if (aiScore > simScore && aiScore >= 2) reportKind = 'ai';

  if (reportKind === 'unknown') {
    errors.push(
      'Could not recognize this file as a Turnitin similarity or AI report. ' +
        'Expected page-1 headers / section labels were not found.'
    );
    return {
      ok: false,
      formatVersion: 'unknown',
      reportKind,
      errors,
      warnings,
    };
  }

  if (reportKind === 'similarity') {
    if (countMatches(body, SIMILARITY_MARKERS.headers) < 1 && !badgeExport) {
      errors.push('Missing Turnitin / Similarity header on early pages.');
    }
    if (
      countMatches(body, SIMILARITY_MARKERS.sections) < 1 &&
      countMatches(body, SIMILARITY_MARKERS.overall) < 1 &&
      !badgeExport
    ) {
      errors.push(
        'Missing expected sections (Match Overview / Similarity Index). Unsupported report format.'
      );
    }
  }

  if (reportKind === 'ai') {
    if (countMatches(body, AI_MARKERS.headers) < 1 && countMatches(body, AI_MARKERS.overall) < 1) {
      errors.push('Missing AI writing detection markers. Unsupported report format.');
    }
  }

  // Generic PDF that is just the paper re-uploaded
  if (/^\s*(abstract|introduction)\b/i.test(sample) && simScore < 2 && aiScore < 2 && !badgeExport) {
    errors.push(
      'This looks like a research paper, not a Turnitin report. Upload the Similarity / AI report PDF from Turnitin.'
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      formatVersion: `${reportKind}-unsupported`,
      reportKind,
      errors,
      warnings,
    };
  }

  if (fullText.length < 80) {
    warnings.push('Report text is very short; extraction may be incomplete.');
  }

  return {
    ok: true,
    formatVersion: `${reportKind}-v1`,
    reportKind,
    errors,
    warnings,
  };
}

export class UnsupportedReportFormatError extends Error {
  public readonly details: FingerprintResult;

  constructor(result: FingerprintResult) {
    super(
      result.errors.join(' ') ||
        'Unsupported Turnitin report format. Parsing aborted to avoid incorrect advice.'
    );
    this.name = 'UnsupportedReportFormatError';
    this.details = result;
  }
}
