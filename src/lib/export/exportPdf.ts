/**
 * Watermarked PDF export that preserves the uploaded manuscript layout.
 *
 * PDF uploads: clone original pages (fonts, figures, geometry intact), apply
 * author-approved edit overlays only when location confidence is high, then
 * stamp watermark. Always also download a separate revision-instructions PDF.
 * DOCX uploads: fall back to a reflowed text PDF (Word layout cannot be cloned
 * as PDF) plus the same revision-instructions companion.
 */

import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont } from 'pdf-lib';
import type { Finding, ParsedPaper } from '../../types';
import { applyAcceptedEdits } from './changeLog';
import {
  extractPdfBundle,
  type PositionedItem,
  type PositionedPage,
} from '../pdf/extractText';
import { normalizeForMatch } from '../pdf/textUtils';
import { findNormalizedRange, sanitizeWinAnsi } from './pdfDrawSafe';

export { findNormalizedIndex, findNormalizedRange, sanitizeWinAnsi } from './pdfDrawSafe';

const WATERMARK = 'Revised with Revision Assistant - author-approved edits';

/** Minimum normalized needle length for a high-confidence in-layout overlay. */
const HIGH_CONFIDENCE_MIN_CHARS = 24;
/** Prefix length used only when the full needle fails; still must be substantial. */
const SUBSTANTIAL_PREFIX_CHARS = 48;

export type PaperSourceKind = 'pdf' | 'docx';

export interface ExportPdfOptions {
  title: string;
  paper: ParsedPaper;
  findings: Finding[];
  /** Original uploaded bytes — required for layout-preserving PDF export */
  sourceBytes?: ArrayBuffer | null;
  sourceKind?: PaperSourceKind | null;
}

export interface EditOverlayStatus {
  findingId: string;
  page: number;
  category: string;
  originalText: string;
  replacementText: string;
  /** Whether the edit was drawn onto the cloned manuscript pages */
  appliedInLayout: boolean;
  reason?: string;
}

export interface ExportPdfResult {
  mode: 'original-layout' | 'reflowed-text';
  editOverlays: number;
  editMisses: number;
  edits: EditOverlayStatus[];
  manuscriptFileName: string;
  instructionsFileName: string;
  /** Ready-to-show status line for the UI */
  message: string;
}

export async function exportWatermarkedPdf(opts: ExportPdfOptions): Promise<ExportPdfResult> {
  const { title, paper, findings, sourceBytes, sourceKind } = opts;

  if (sourceKind === 'pdf' && sourceBytes && sourceBytes.byteLength > 0) {
    return exportFromOriginalPdf(title, paper, findings, sourceBytes);
  }

  return exportReflowedWithInstructions(title, paper, findings, sourceKind ?? null);
}

function editableFindings(findings: Finding[]): Finding[] {
  return findings.filter(
    (f) =>
      (f.status === 'accepted' || f.status === 'edited') &&
      f.editedText != null &&
      f.text.trim().length > 0
  );
}

function safeTitleSlug(title: string): string {
  return title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'paper';
}

export function formatExportMessage(result: Omit<ExportPdfResult, 'message'>): string {
  const { mode, editOverlays: n, editMisses: m, instructionsFileName } = result;
  const instr = `\`${instructionsFileName}\``;

  if (mode === 'reflowed-text') {
    const editNote =
      n + m > 0
        ? ` Revision wording is listed in ${instr} (not applied to an original PDF layout).`
        : '';
    return (
      `PDF exported as reflowed text (DOCX source — original Word layout cannot be cloned).` +
      ` Upload a PDF manuscript to keep original page formatting.` +
      editNote
    );
  }

  if (n === 0 && m > 0) {
    return (
      `Could not modify the PDF text layer in-place. Your original layout PDF is watermarked only; ` +
      `follow ${instr} to apply wording changes (page, original quote, replacement).`
    );
  }

  if (n > 0 && m > 0) {
    return (
      `Kept your original PDF layout. Applied ${n} edit${n === 1 ? '' : 's'} on-page. ` +
      `${m} edit${m === 1 ? '' : 's'} could not be modified in-layout — see ${instr} and/or the change log.`
    );
  }

  if (n > 0 && m === 0) {
    return (
      `Kept your original PDF layout. Applied ${n} edit${n === 1 ? '' : 's'} on-page. ` +
      `Details also in ${instr}.`
    );
  }

  return `Kept your original PDF layout (watermarked). No accepted wording edits to apply. Companion: ${instr}.`;
}

async function exportFromOriginalPdf(
  title: string,
  _paper: ParsedPaper,
  findings: Finding[],
  sourceBytes: ArrayBuffer
): Promise<ExportPdfResult> {
  // Fresh copy — pdf.js may detach buffers
  const bytesForPdfjs = sourceBytes.slice(0);
  const bytesForLib = sourceBytes.slice(0);

  const bundle = await extractPdfBundle(bytesForPdfjs, { needPositioned: true });
  const srcDoc = await PDFDocument.load(bytesForLib, { ignoreEncryption: true });
  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const pages = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
  for (const p of pages) outDoc.addPage(p);

  const edits = editableFindings(findings);
  const statuses: EditOverlayStatus[] = [];

  for (const edit of edits) {
    const pageNum = Math.max(1, edit.page || 1);
    const located = locateEditOnPages(bundle.positioned, edit.text, pageNum);

    if (!located) {
      statuses.push({
        findingId: edit.id,
        page: pageNum,
        category: edit.category,
        originalText: edit.text,
        replacementText: edit.editedText!,
        appliedInLayout: false,
        reason:
          "can't modify this passage in the PDF layout (text span not located with high confidence)",
      });
      continue;
    }

    const pdfPage = outDoc.getPage(located.pageNumber - 1);
    if (!pdfPage) {
      statuses.push({
        findingId: edit.id,
        page: pageNum,
        category: edit.category,
        originalText: edit.text,
        replacementText: edit.editedText!,
        appliedInLayout: false,
        reason: "can't modify this passage in the PDF layout (page missing)",
      });
      continue;
    }

    const { boxes } = located;
    const fontSize = Math.max(7, Math.min(14, boxes[0].fontSize || 10));
    const first = boxes[0];
    const maxW = Math.max(
      first.width,
      boxes.reduce((a, b) => a + b.width, 0) * 0.85
    );
    const lines = wrapToWidth(
      sanitizeWinAnsi(edit.editedText!),
      font,
      fontSize,
      Math.max(80, maxW)
    );
    const drawnLines = lines.slice(0, 8);
    const lineStep = fontSize * 1.15;
    const textBlockHeight = Math.max(
      boxes.reduce((h, b) => Math.max(h, b.height), 0),
      drawnLines.length * lineStep
    );
    const textBlockWidth = Math.max(
      maxW,
      120,
      ...drawnLines.map((line) => font.widthOfTextAtSize(line, fontSize))
    );

    // Erase original glyph boxes…
    for (const box of boxes) {
      pdfPage.drawRectangle({
        x: box.x - 1,
        y: box.y - 2,
        width: box.width + 2,
        height: box.height + 3,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }
    // …and the full multi-line replacement footprint so longer rewrites don't sit on unerased text.
    pdfPage.drawRectangle({
      x: first.x - 1,
      y: first.y - (drawnLines.length - 1) * lineStep - 2,
      width: textBlockWidth + 2,
      height: textBlockHeight + 4,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });

    let y = first.y;
    for (const line of drawnLines) {
      pdfPage.drawText(line, {
        x: first.x,
        y,
        size: fontSize,
        font,
        color: rgb(0.05, 0.12, 0.08),
        maxWidth: Math.max(maxW, 120),
      });
      y -= lineStep;
    }

    statuses.push({
      findingId: edit.id,
      page: located.pageNumber,
      category: edit.category,
      originalText: edit.text,
      replacementText: edit.editedText!,
      appliedInLayout: true,
      reason:
        located.pageNumber !== pageNum
          ? `applied on adjacent page ${located.pageNumber} (report listed p.${pageNum})`
          : undefined,
    });
  }

  for (let i = 0; i < outDoc.getPageCount(); i++) {
    stampWatermark(outDoc.getPage(i), font);
  }

  const slug = safeTitleSlug(title);
  const manuscriptFileName = `${slug}_revised_original_layout.pdf`;
  const instructionsFileName = `${slug}_revision_instructions.pdf`;

  const out = await outDoc.save();
  downloadPdfBytes(out, manuscriptFileName);
  await delay(350);
  await exportRevisionInstructionsPdf(title, statuses, instructionsFileName, {
    mode: 'original-layout',
  });

  const editOverlays = statuses.filter((s) => s.appliedInLayout).length;
  const editMisses = statuses.filter((s) => !s.appliedInLayout).length;
  const base = {
    mode: 'original-layout' as const,
    editOverlays,
    editMisses,
    edits: statuses,
    manuscriptFileName,
    instructionsFileName,
  };
  return { ...base, message: formatExportMessage(base) };
}

async function exportReflowedWithInstructions(
  title: string,
  paper: ParsedPaper,
  findings: Finding[],
  sourceKind: PaperSourceKind | null
): Promise<ExportPdfResult> {
  const edits = editableFindings(findings);
  const statuses: EditOverlayStatus[] = edits.map((edit) => ({
    findingId: edit.id,
    page: Math.max(1, edit.page || 1),
    category: edit.category,
    originalText: edit.text,
    replacementText: edit.editedText!,
    appliedInLayout: false,
    reason:
      sourceKind === 'docx'
        ? 'DOCX source — cannot preserve Word layout as PDF; wording not applied in-layout'
        : 'no original PDF bytes — reflowed export only',
  }));

  const slug = safeTitleSlug(title);
  const manuscriptFileName = `${slug}_revised_reflowed.pdf`;
  const instructionsFileName = `${slug}_revision_instructions.pdf`;

  await exportReflowedTextPdf(title, paper, findings, manuscriptFileName);
  await delay(350);
  await exportRevisionInstructionsPdf(title, statuses, instructionsFileName, {
    mode: 'reflowed-text',
  });

  const base = {
    mode: 'reflowed-text' as const,
    editOverlays: 0,
    editMisses: statuses.length,
    edits: statuses,
    manuscriptFileName,
    instructionsFileName,
  };
  return { ...base, message: formatExportMessage(base) };
}

interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface LocatedEdit {
  pageNumber: number;
  boxes: TextBox[];
  confidence: 'high';
}

/** Prefer reported page, then ±1; only return high-confidence matches. */
function locateEditOnPages(
  positioned: PositionedPage[],
  rawNeedle: string,
  preferredPage: number
): LocatedEdit | null {
  const order = [preferredPage, preferredPage - 1, preferredPage + 1].filter(
    (p, i, arr) => p >= 1 && arr.indexOf(p) === i
  );

  for (const pageNum of order) {
    const posPage = positioned.find((p) => p.pageNumber === pageNum);
    if (!posPage) continue;
    const boxes = locateTextBoxesHighConfidence(posPage, rawNeedle);
    if (boxes.length) {
      return { pageNumber: pageNum, boxes, confidence: 'high' };
    }
  }
  return null;
}

/**
 * Locate glyph boxes only when the match is high-confidence:
 * full normalized needle, or a substantial prefix (≥48 chars / full short needles).
 */
function locateTextBoxesHighConfidence(page: PositionedPage, rawNeedle: string): TextBox[] {
  const needle = normalizeForMatch(rawNeedle).replace(/\s+/g, ' ').trim();
  if (needle.length < 3) return [];

  const built = buildHaystack(page.items);
  if (!built.hay.length) return [];

  // 1) Full needle
  let range = findNormalizedRange(built.hay, needle);
  if (range.start >= 0) {
    return boxesFromRange(page.items, built.map, range.start, range.end);
  }

  // 2) Substantial prefixes (honesty: skip tiny fragments)
  const prefixes = uniquePrefixes(needle);
  for (const prefix of prefixes) {
    if (!isHighConfidenceNeedle(prefix, needle)) continue;
    range = findNormalizedRange(built.hay, prefix);
    if (range.start >= 0) {
      return boxesFromRange(page.items, built.map, range.start, range.end);
    }
  }

  // 3) Slightly longer window from start of needle when hyphenation leftovers remain
  if (needle.length > SUBSTANTIAL_PREFIX_CHARS) {
    const mid = needle.slice(0, Math.min(needle.length, SUBSTANTIAL_PREFIX_CHARS + 24));
    if (isHighConfidenceNeedle(mid, needle)) {
      range = findNormalizedRange(built.hay, mid);
      if (range.start >= 0) {
        return boxesFromRange(page.items, built.map, range.start, range.end);
      }
    }
  }

  return [];
}

function uniquePrefixes(needle: string): string[] {
  const lens = [
    needle.length,
    Math.min(needle.length, 80),
    Math.min(needle.length, SUBSTANTIAL_PREFIX_CHARS),
    Math.min(needle.length, 40),
  ];
  const out: string[] = [];
  for (const len of lens) {
    if (len < HIGH_CONFIDENCE_MIN_CHARS && len < needle.length) continue;
    const p = needle.slice(0, len).trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

function isHighConfidenceNeedle(candidate: string, fullNeedle: string): boolean {
  if (candidate.length < 3) return false;
  // Short findings: only full (or nearly full) match counts
  if (fullNeedle.length <= SUBSTANTIAL_PREFIX_CHARS) {
    return candidate.length >= Math.min(fullNeedle.length, HIGH_CONFIDENCE_MIN_CHARS) ||
      candidate.length === fullNeedle.length;
  }
  return candidate.length >= SUBSTANTIAL_PREFIX_CHARS;
}

function buildHaystack(items: PositionedItem[]): { hay: string; map: number[] } {
  let hay = '';
  const map: number[] = [];
  let lastY: number | null = null;
  let lastXEnd = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (lastY !== null && Math.abs(it.y - lastY) > 2) {
      hay += ' ';
      map.push(-1);
      lastXEnd = 0;
    } else if (lastY !== null && it.x - lastXEnd > 2) {
      hay += ' ';
      map.push(-1);
    }
    for (let c = 0; c < it.str.length; c++) {
      hay += it.str[c];
      map.push(i);
    }
    lastY = it.y;
    lastXEnd = it.x + (it.width || 0);
  }
  return { hay, map };
}

function boxesFromRange(
  items: PositionedItem[],
  map: number[],
  start: number,
  end: number
): TextBox[] {
  const used = new Set<number>();
  for (let i = start; i < end && i < map.length; i++) {
    const ii = map[i];
    if (ii >= 0) used.add(ii);
  }
  const boxes: TextBox[] = [];
  for (const ii of [...used].sort((a, b) => a - b)) {
    const it = items[ii];
    const fontSize = estimateFontSize(it);
    boxes.push({
      x: it.x,
      y: it.y,
      width: Math.max(it.width, it.str.length * fontSize * 0.45),
      height: fontSize * 1.15,
      fontSize,
    });
  }
  return boxes;
}

function estimateFontSize(it: PositionedItem): number {
  if (it.str.length > 0 && it.width > 0) {
    return Math.min(18, Math.max(7, it.width / (it.str.length * 0.5)));
  }
  return 10;
}

function stampWatermark(page: PDFPage, font: PDFFont) {
  const { width, height } = page.getSize();
  page.drawText(WATERMARK, {
    x: width * 0.12,
    y: height * 0.45,
    size: Math.min(14, width * 0.022),
    font,
    color: rgb(0.72, 0.76, 0.74),
    rotate: degrees(32),
    opacity: 0.32,
  });
  page.drawText(WATERMARK, {
    x: 36,
    y: 22,
    size: 7,
    font,
    color: rgb(0.45, 0.5, 0.47),
  });
}

async function exportRevisionInstructionsPdf(
  title: string,
  edits: EditOverlayStatus[],
  fileName: string,
  meta: { mode: 'original-layout' | 'reflowed-text' }
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const bodySize = 10;
  const lineHeight = 13;

  const applied = edits.filter((e) => e.appliedInLayout).length;
  const missed = edits.filter((e) => !e.appliedInLayout).length;
  const date = new Date().toISOString().slice(0, 10);

  const lines: { text: string; size: number; bold?: boolean; color?: ReturnType<typeof rgb> }[] = [];
  lines.push({ text: 'Revision instructions', size: 16, bold: true });
  lines.push({ text: '', size: bodySize });
  lines.push({ text: title.slice(0, 200) || 'Manuscript', size: 12, bold: true });
  lines.push({ text: `Generated: ${date}`, size: 9 });
  lines.push({ text: WATERMARK, size: 8, color: rgb(0.4, 0.45, 0.42) });
  lines.push({ text: '', size: bodySize });

  if (meta.mode === 'original-layout') {
    lines.push({
      text:
        'Companion to your original-layout PDF. Edits marked Applied in layout = YES were overlaid on the cloned manuscript. ' +
        'Edits marked NO could not be modified reliably in the PDF text layer — apply those manually in Word/LaTeX using the quotes below.',
      size: 9,
    });
  } else {
    lines.push({
      text:
        'Source was DOCX (or PDF bytes were unavailable). The companion manuscript PDF is reflowed text only. ' +
        'Use this list to apply wording changes in your original Word/LaTeX file, or re-upload a PDF manuscript for layout-preserving export.',
      size: 9,
    });
  }
  lines.push({ text: '', size: bodySize });
  lines.push({
    text: `Summary: ${edits.length} accepted/edited passage(s) · ${applied} applied in-layout · ${missed} need manual apply`,
    size: 10,
    bold: true,
  });
  lines.push({ text: '', size: bodySize });

  if (edits.length === 0) {
    lines.push({ text: 'No accepted or edited findings with replacement text.', size: bodySize });
  } else {
    edits.forEach((e, i) => {
      const status = e.appliedInLayout ? 'YES' : 'NO';
      lines.push({
        text: `${i + 1}. Page ${e.page} · ${e.category} · Applied in layout: ${status}`,
        size: 11,
        bold: true,
        color: e.appliedInLayout ? rgb(0.1, 0.35, 0.2) : rgb(0.55, 0.2, 0.1),
      });
      if (e.reason) {
        lines.push({ text: `Note: ${e.reason}`, size: 8, color: rgb(0.35, 0.35, 0.35) });
      }
      lines.push({ text: 'Original:', size: 9, bold: true });
      for (const w of wrapToWidth(clip(e.originalText, 900), font, bodySize, maxWidth)) {
        lines.push({ text: w, size: bodySize });
      }
      lines.push({ text: 'Replacement:', size: 9, bold: true });
      for (const w of wrapToWidth(clip(e.replacementText, 900), font, bodySize, maxWidth)) {
        lines.push({ text: w, size: bodySize });
      }
      lines.push({ text: '', size: bodySize });
      lines.push({
        text: '— — — — — — — — — — — — — — — — — — — —',
        size: 8,
        color: rgb(0.7, 0.7, 0.7),
      });
      lines.push({ text: '', size: bodySize });
    });
  }

  lines.push({
    text:
      'This file does not change your manuscript by itself. It lists author-approved wording so you (or a supervisor) can apply remaining edits where the PDF text layer could not be updated safely.',
    size: 8,
    color: rgb(0.35, 0.38, 0.36),
  });

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const line of lines) {
    const needed = line.size === 16 ? lineHeight + 6 : lineHeight;
    if (y < margin + needed) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    if (line.text) {
      // wrap long instruction paragraphs that were stored as single lines
      const wrapped =
        line.text.length > 100 && !line.bold
          ? wrapToWidth(line.text, font, line.size, maxWidth)
          : [line.text];
      for (const w of wrapped) {
        if (y < margin + lineHeight) {
          page = doc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(sanitizeWinAnsi(w), {
          x: margin,
          y,
          size: line.size,
          font: line.bold ? fontBold : font,
          color: line.color ?? rgb(0.08, 0.1, 0.09),
          maxWidth,
        });
        y -= line.size >= 14 ? lineHeight + 4 : lineHeight;
      }
    } else {
      y -= lineHeight * 0.6;
    }
  }

  const bytes = await doc.save();
  downloadPdfBytes(bytes, fileName);
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

async function exportReflowedTextPdf(
  title: string,
  paper: ParsedPaper,
  findings: Finding[],
  fileName: string
): Promise<void> {
  const revised = applyAcceptedEdits(paper, findings);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  const bodySize = 11;
  const lineHeight = 15;
  const titleSize = 14;

  const paragraphs = revised.split(/\n+/).filter((p) => p.trim().length > 0);
  const lines: { text: string; size: number; bold?: boolean }[] = [];
  lines.push({ text: title.slice(0, 180) || 'Revised manuscript', size: titleSize, bold: true });
  lines.push({ text: '', size: bodySize });
  lines.push({
    text: `Exported ${new Date().toISOString().slice(0, 10)} · ${WATERMARK}`,
    size: 9,
  });
  lines.push({
    text: 'Note: source was DOCX — layout is reflowed. Upload a PDF manuscript to keep original formatting.',
    size: 9,
  });
  lines.push({
    text: 'See the companion *_revision_instructions.pdf for each accepted edit (page, original, replacement).',
    size: 9,
  });
  lines.push({ text: '', size: bodySize });

  for (const para of paragraphs.length ? paragraphs : [revised || '(empty)']) {
    const wrapped = wrapToWidth(para.replace(/\s+/g, ' ').trim(), font, bodySize, maxWidth);
    for (const w of wrapped) lines.push({ text: w, size: bodySize });
    lines.push({ text: '', size: bodySize });
  }

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  stampWatermark(page, font);

  for (const line of lines) {
    if (y < margin + lineHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      stampWatermark(page, font);
      y = pageHeight - margin;
    }
    if (line.text) {
      page.drawText(sanitizeWinAnsi(line.text), {
        x: margin,
        y,
        size: line.size,
        font: line.bold ? fontBold : font,
        color: rgb(0.08, 0.1, 0.09),
        maxWidth,
      });
    }
    y -= line.size === titleSize ? lineHeight + 4 : lineHeight;
  }

  const bytes = await doc.save();
  downloadPdfBytes(bytes, fileName);
}

function wrapToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string[] {
  const safe = sanitizeWinAnsi(text);
  const words = safe.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function downloadPdfBytes(bytes: Uint8Array, fileName: string) {
  // Copy the view — bytes.buffer may be a larger SharedArrayBuffer-backed allocation
  // from pdf-lib, and passing .buffer alone can corrupt or pad the download.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoke on a delay — revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
