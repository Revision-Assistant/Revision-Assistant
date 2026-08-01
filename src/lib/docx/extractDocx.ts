/**
 * Browser DOCX text extraction via mammoth (pure client-side, no upload).
 * Matches the { fullText, pages, pageCount } shape extractText.ts produces for PDFs so
 * paperParser.ts's downstream logic (sections, sentences, citations) is format-agnostic.
 */

import mammoth from 'mammoth';
import { normalizePdfText } from '../pdf/textUtils';
import type { PageText } from '../pdf/extractText';

export interface ExtractedDocx {
  fullText: string;
  pages: PageText[];
  pageCount: number;
}

export async function extractTextFromDocx(data: ArrayBuffer): Promise<ExtractedDocx> {
  // mammoth's Node build wants `{ buffer }`; browsers use `{ arrayBuffer }`.
  let result: { value: string };
  if (typeof window === 'undefined' && typeof Buffer !== 'undefined') {
    result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  } else {
    result = await mammoth.extractRawText({ arrayBuffer: data });
  }
  const text = normalizePdfText(result.value);

  // No real pagination available for docx — treat the whole document as one page.
  const page: PageText = { pageNumber: 1, text, startOffset: 0, endOffset: text.length };

  return { fullText: text, pages: [page], pageCount: 1 };
}
