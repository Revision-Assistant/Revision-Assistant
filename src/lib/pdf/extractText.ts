/**
 * Browser PDF text extraction via pdf.js.
 * Returns full document text with page and character offsets.
 */

import { normalizePdfText } from './textUtils';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfjsModule> | null = null;
let workerReady: Promise<void> | null = null;
let pdfjsRef: PdfjsModule | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsRef) return pdfjsRef;
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Node lacks DOMMatrix required by the modern build; legacy works in tsx/scripts.
      if (typeof window === 'undefined') {
        return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;
      }
      return import('pdfjs-dist');
    })();
  }
  pdfjsRef = await pdfjsPromise;
  return pdfjsRef;
}

/** Vite browser build vs Node/tsx eval harness — both need a workerSrc. */
async function ensurePdfWorker(): Promise<PdfjsModule> {
  const pdfjs = await loadPdfjs();
  if (pdfjs.GlobalWorkerOptions.workerSrc) return pdfjs;
  if (!workerReady) {
    workerReady = (async () => {
      if (typeof window === 'undefined') {
        const { createRequire } = await import('node:module');
        const { pathToFileURL } = await import('node:url');
        const require = createRequire(import.meta.url);
        let workerPath: string;
        try {
          workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
        } catch {
          workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
        }
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      } else {
        const mod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
      }
    })();
  }
  await workerReady;
  return pdfjs;
}

export interface PageText {
  pageNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface ExtractedPdf {
  fullText: string;
  pages: PageText[];
  pageCount: number;
}

/** A single positioned text run, in PDF user space (origin bottom-left). */
export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface PositionedPage {
  pageNumber: number;
  /** MediaBox height, needed to convert y into a top-down fraction */
  height: number;
  items: PositionedItem[];
}

export { normalizePdfText, normalizeForMatch, offsetToPage } from './textUtils';

/**
 * Extract text runs with their coordinates.
 *
 * Needed for Turnitin similarity reports, which rasterize the submitted document and
 * overlay only small numeric match badges as real text — so the badge *position* is the
 * only machine-readable signal of where a match occurred. See badgeReport.ts.
 */
export async function extractPositionedPages(data: ArrayBuffer): Promise<PositionedPage[]> {
  const pdfjs = await ensurePdfWorker();
  const doc = await pdfjs.getDocument({ data: toPrivateBytes(data) }).promise;
  const pages: PositionedPage[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: PositionedItem[] = [];

    for (const raw of content.items as {
      str: string;
      transform: number[];
      width: number;
    }[]) {
      if (!raw.str || !raw.str.trim()) continue;
      items.push({
        str: raw.str,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width || 0,
      });
    }

    pages.push({ pageNumber: i, height: viewport.height, items });
  }

  return pages;
}

/**
 * pdf.js transfers the backing buffer to its worker, which detaches it and makes the
 * ArrayBuffer unusable for any later parse. Callers legitimately parse the same file twice
 * (text pass + positioned pass), so always hand pdf.js a private copy.
 */
function toPrivateBytes(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data.slice(0));
}

export async function extractTextFromPdf(data: ArrayBuffer): Promise<ExtractedPdf> {
  const pdfjs = await ensurePdfWorker();
  const doc = await pdfjs.getDocument({ data: toPrivateBytes(data) }).promise;
  const pages: PageText[] = [];
  let fullText = '';
  let offset = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as {
      str: string;
      transform: number[];
      width: number;
      hasEOL?: boolean;
    }[];
    let pageRaw = '';
    let lastY: number | null = null;
    let lastXEnd = 0;

    for (const item of items) {
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageRaw += '\n';
        lastXEnd = 0;
      } else if (lastY !== null && x - lastXEnd > 2) {
        pageRaw += ' ';
      }

      pageRaw += item.str;
      lastY = y;
      lastXEnd = x + (item.width || 0);
      if (item.hasEOL) {
        pageRaw += '\n';
        lastXEnd = 0;
      }
    }

    const text = normalizePdfText(pageRaw);
    const sep = fullText.length > 0 ? ' ' : '';
    if (sep) {
      fullText += sep;
      offset += sep.length;
    }
    const adjustedStart = offset;
    fullText += text;
    offset += text.length;
    pages.push({
      pageNumber: i,
      text,
      startOffset: adjustedStart,
      endOffset: offset,
    });
  }

  return { fullText, pages, pageCount: doc.numPages };
}
