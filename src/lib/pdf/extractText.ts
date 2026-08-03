/**
 * Browser PDF text extraction via pdf.js.
 * Returns full document text with page and character offsets.
 *
 * Large Turnitin exports are memory-heavy (raster pages). We open each PDF once,
 * release page resources as we go, and optionally cap page count for the free MVP.
 */

import { normalizePdfText } from './textUtils';
import { PDF_MAX_PAGES } from '../files/limits';

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
  /** True when PDF_MAX_PAGES truncated the parse */
  truncated?: boolean;
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

export interface ExtractedPdfBundle extends ExtractedPdf {
  positioned: PositionedPage[];
}

export { normalizePdfText, normalizeForMatch, offsetToPage } from './textUtils';

/**
 * pdf.js may transfer the backing buffer to its worker (detaching it). Callers that
 * parse the same file twice must copy — prefer extractPdfBundle for one open.
 */
function toPrivateBytes(data: ArrayBuffer): Uint8Array {
  return new Uint8Array(data.slice(0));
}

type TextContentItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
};

function pageTextFromItems(items: TextContentItem[]): string {
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

  return normalizePdfText(pageRaw);
}

function positionedFromItems(
  items: TextContentItem[],
  pageNumber: number,
  height: number
): PositionedPage {
  const out: PositionedItem[] = [];
  for (const raw of items) {
    if (!raw.str || !raw.str.trim()) continue;
    out.push({
      str: raw.str,
      x: raw.transform[4],
      y: raw.transform[5],
      width: raw.width || 0,
    });
  }
  return { pageNumber, height, items: out };
}

/**
 * When a PDF exceeds maxPages, keep the head (paper body / early text) and the
 * tail (Turnitin originality / source list usually sits at the end).
 */
function pageIndices(totalPages: number, maxPages: number): { indices: number[]; truncated: boolean } {
  if (totalPages <= maxPages) {
    return {
      indices: Array.from({ length: totalPages }, (_, i) => i + 1),
      truncated: false,
    };
  }
  const tail = Math.min(48, Math.floor(maxPages / 3));
  const head = maxPages - tail;
  const indices: number[] = [];
  for (let i = 1; i <= head; i++) indices.push(i);
  const tailStart = totalPages - tail + 1;
  for (let i = Math.max(head + 1, tailStart); i <= totalPages; i++) indices.push(i);
  return { indices, truncated: true };
}

/**
 * Single-open extract of plain text + positioned runs.
 * Used by similarity reports so we do not double memory on large Turnitin PDFs.
 */
export async function extractPdfBundle(
  data: ArrayBuffer,
  opts?: { maxPages?: number; needPositioned?: boolean }
): Promise<ExtractedPdfBundle> {
  const needPositioned = opts?.needPositioned !== false;
  const pdfjs = await ensurePdfWorker();
  const doc = await pdfjs.getDocument({
    data: toPrivateBytes(data),
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;

  const totalPages = doc.numPages;
  const maxOpt = opts?.maxPages ?? PDF_MAX_PAGES;
  const { indices, truncated } = pageIndices(totalPages, maxOpt);

  const pages: PageText[] = [];
  const positioned: PositionedPage[] = [];
  let fullText = '';
  let offset = 0;

  try {
    for (const i of indices) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const items = content.items as TextContentItem[];
        const text = pageTextFromItems(items);
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

        if (needPositioned) {
          const viewport = page.getViewport({ scale: 1 });
          positioned.push(positionedFromItems(items, i, viewport.height));
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await doc.destroy();
  }

  return {
    fullText,
    pages,
    pageCount: totalPages,
    truncated,
    positioned,
  };
}

/**
 * Extract text runs with their coordinates.
 *
 * Needed for Turnitin similarity reports, which rasterize the submitted document and
 * overlay only small numeric match badges as real text — so the badge *position* is the
 * only machine-readable signal of where a match occurred. See badgeReport.ts.
 */
export async function extractPositionedPages(data: ArrayBuffer): Promise<PositionedPage[]> {
  const bundle = await extractPdfBundle(data, { needPositioned: true });
  return bundle.positioned;
}

export async function extractTextFromPdf(data: ArrayBuffer): Promise<ExtractedPdf> {
  const bundle = await extractPdfBundle(data, { needPositioned: false });
  return {
    fullText: bundle.fullText,
    pages: bundle.pages,
    pageCount: bundle.pageCount,
    truncated: bundle.truncated,
  };
}
