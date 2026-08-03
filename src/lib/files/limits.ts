/**
 * Client-side file size / format guards for the public free MVP.
 * Papers and reports never leave the browser for analyze — limits exist to
 * prevent tab crashes (pdf.js + large Turnitin rasters), not Netlify upload caps.
 */

export const MB = 1024 * 1024;

/** Manuscript PDF / DOCX hard cap */
export const PAPER_MAX_BYTES = 25 * MB;
/** Turnitin similarity / AI report PDFs (image-heavy) */
export const REPORT_MAX_BYTES = 45 * MB;

export const PAPER_WARN_BYTES = 12 * MB;
export const REPORT_WARN_BYTES = 22 * MB;

/** Soft page ceiling — very long PDFs are truncated with a note in progress/errors */
export const PDF_MAX_PAGES = 160;

export type UploadKind = 'paper' | 'similarity' | 'ai';

export class FileTooLargeError extends Error {
  readonly kind: UploadKind;
  readonly sizeBytes: number;
  readonly maxBytes: number;

  constructor(kind: UploadKind, sizeBytes: number, maxBytes: number) {
    super(
      `${kindLabel(kind)} is ${formatBytes(sizeBytes)} (limit ${formatBytes(maxBytes)}). ` +
        `Compress the PDF, export fewer pages, or save the Word file as a smaller .docx without embedded media.`
    );
    this.name = 'FileTooLargeError';
    this.kind = kind;
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

export class UnsupportedPaperFormatError extends Error {
  constructor(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.doc') && !lower.endsWith('.docx')) {
      super(
        'Old .doc Word files are not supported. Open the file in Word or Google Docs and Save As / Download as .docx, then upload again.'
      );
    } else {
      super('Paper must be a .pdf or .docx file.');
    }
    this.name = 'UnsupportedPaperFormatError';
  }
}

function kindLabel(kind: UploadKind): string {
  if (kind === 'paper') return 'Your paper';
  if (kind === 'similarity') return 'Similarity report';
  return 'AI report';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

export function maxBytesFor(kind: UploadKind): number {
  return kind === 'paper' ? PAPER_MAX_BYTES : REPORT_MAX_BYTES;
}

export function warnBytesFor(kind: UploadKind): number {
  return kind === 'paper' ? PAPER_WARN_BYTES : REPORT_WARN_BYTES;
}

/** Throws FileTooLargeError / UnsupportedPaperFormatError when invalid. */
export function assertUploadFile(file: File, kind: UploadKind): void {
  const name = file.name.toLowerCase();
  if (kind === 'paper') {
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      throw new UnsupportedPaperFormatError(file.name);
    }
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
      throw new UnsupportedPaperFormatError(file.name);
    }
  } else if (!name.endsWith('.pdf')) {
    throw new Error(`${kindLabel(kind)} must be a PDF.`);
  }

  const max = maxBytesFor(kind);
  if (file.size > max) {
    throw new FileTooLargeError(kind, file.size, max);
  }
}

export function sizeWarning(file: File, kind: UploadKind): string | null {
  const warn = warnBytesFor(kind);
  if (file.size <= warn) return null;
  return (
    `${formatBytes(file.size)} — large files can be slow or run out of memory in the browser. ` +
    `If analysis fails, compress the PDF or remove embedded images.`
  );
}

/** Cap JSON bodies sent to Netlify explain (~6 MB function limit; stay well under). */
export const EXPLAIN_MAX_SPANS = 24;
export const EXPLAIN_MAX_TEXT_CHARS = 900;
export const EXPLAIN_MAX_CONTEXT_CHARS = 500;
export const EXPLAIN_MAX_PAYLOAD_CHARS = 450_000;

export function truncateForExplain(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
