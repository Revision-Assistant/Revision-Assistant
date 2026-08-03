/**
 * Watermarked PDF for heuristic journal-readiness assessment.
 * Always includes a “not a guarantee” disclaimer banner.
 */

import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { sanitizeWinAnsi } from '../export/pdfDrawSafe';
import type { ReadinessResult } from './scoreReadiness';

const WATERMARK = 'Revision Assistant - heuristic journal readiness (not peer review)';

export interface ExportReadinessPdfOptions {
  title: string;
  readiness: ReadinessResult;
}

export async function exportJournalReadinessPdf(opts: ExportReadinessPdfOptions): Promise<string> {
  const { title, readiness } = opts;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const bodySize = 10;
  const lineHeight = 14;

  type Line = { text: string; size: number; bold?: boolean; color?: ReturnType<typeof rgb> };
  const lines: Line[] = [];
  const push = (text: string, size = bodySize, bold = false, color?: ReturnType<typeof rgb>) => {
    lines.push({ text, size, bold, color });
  };
  const blank = () => lines.push({ text: '', size: bodySize });

  const date = new Date().toISOString().slice(0, 10);
  push('Journal readiness assessment (heuristic)', 16, true);
  push(title.slice(0, 200) || 'Untitled manuscript', 12, true);
  push(`Generated ${date} · Revision Assistant`, 9, false, rgb(0.35, 0.4, 0.37));
  blank();

  push('IMPORTANT DISCLAIMER', 11, true, rgb(0.55, 0.2, 0.12));
  for (const w of wrap(
    'These scores are heuristic estimates from manuscript signals (structure, quality, ' +
      'grammar, citation, and AI/similarity findings). They are NOT peer review, NOT affiliated ' +
      'with IEEE, Elsevier, Clarivate, Scimago, or any publisher ranking body, and do NOT guarantee ' +
      'acceptance, indexing, or quartile placement. Venue suggestions are topical examples only.',
    font,
    9,
    maxWidth
  )) {
    push(w, 9, false, rgb(0.45, 0.22, 0.15));
  }
  blank();

  push('Readiness scores (0-100)', 12, true);
  push(`Q1-like bar (internal checklist): ${readiness.q1LikeScore}`, 11, true);
  push(`Q2-like bar (internal checklist): ${readiness.q2LikeScore}`, 11, true);
  push(`IEEE-oriented craft score: ${readiness.ieeeScore}`, 11, true);
  push(`Inferred fields: ${readiness.fieldGuess.join(', ') || 'general'}`, 9);
  blank();
  for (const w of wrap(readiness.summary, font, bodySize, maxWidth)) push(w);
  blank();
  for (const w of wrap(readiness.mappingNote, font, 8, maxWidth)) {
    push(w, 8, false, rgb(0.35, 0.4, 0.37));
  }
  blank();

  if (readiness.scoreBreakdown?.length) {
    push('Score breakdown (what raised / lowered the bars)', 12, true);
    push(
      'Approximate checklist points before clamping. Heuristic only — not acceptance odds.',
      8,
      false,
      rgb(0.35, 0.4, 0.37)
    );
    for (const b of readiness.scoreBreakdown) {
      const sign = b.effect === 'raised' ? '+' : '-';
      push(
        `${sign} ${b.label}  [Q1 ${fmtPdfDelta(b.q1Delta)}, Q2 ${fmtPdfDelta(b.q2Delta)}, IEEE ${fmtPdfDelta(b.ieeeDelta)}]`,
        9,
        false,
        b.effect === 'raised' ? rgb(0.12, 0.4, 0.28) : rgb(0.5, 0.25, 0.12)
      );
    }
    blank();
  }

  push('Checklist', 12, true);
  for (const c of readiness.checklist) {
    const mark = c.passed ? '[PASS]' : '[GAP]';
    push(`${mark} ${c.label}`, 10, true, c.passed ? rgb(0.12, 0.4, 0.28) : rgb(0.5, 0.25, 0.12));
    for (const w of wrap(c.note, font, 9, maxWidth)) push(w, 9, false, rgb(0.3, 0.35, 0.32));
  }
  blank();

  push('What to correct (priority gaps)', 12, true);
  if (readiness.gaps.length === 0) {
    push('No priority gaps from current open findings / structure heuristics.', 10);
  } else {
    readiness.gaps.forEach((g, i) => {
      push(`${i + 1}. [${g.severity.toUpperCase()}] ${g.title}`, 10, true);
      for (const w of wrap(g.detail, font, 9, maxWidth)) push(w, 9);
      blank();
    });
  }

  push('Suggested venues (heuristic topical fit)', 12, true);
  push(
    'These are curated examples / open venues matched by keywords. Confidence is low or medium only. None "will accept" the paper.',
    8,
    false,
    rgb(0.35, 0.4, 0.37)
  );
  blank();
  for (const j of readiness.journalSuggestions) {
    push(`${j.name} (${j.confidence} confidence)`, 10, true);
    push(j.publisherHint, 8, false, rgb(0.35, 0.4, 0.37));
    for (const w of wrap(j.reason, font, 9, maxWidth)) push(w, 9);
    if (j.caution) {
      for (const w of wrap(`Caution: ${j.caution}`, font, 8, maxWidth)) {
        push(w, 8, false, rgb(0.5, 0.35, 0.1));
      }
    }
    blank();
  }

  push('Not a guarantee banner', 11, true, rgb(0.55, 0.2, 0.12));
  for (const w of wrap(
    'Do not treat this PDF as evidence of Q1/Q2 readiness for hiring, funding, or submission decisions. ' +
      'Verify each venue\'s aims & scope, APCs, and your institution\'s guidance yourself.',
    font,
    9,
    maxWidth
  )) {
    push(w, 9, false, rgb(0.45, 0.22, 0.15));
  }

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  stamp(page, font);

  for (const line of lines) {
    const needed = line.size >= 14 ? lineHeight + 4 : lineHeight;
    if (y < margin + needed) {
      page = doc.addPage([pageWidth, pageHeight]);
      stamp(page, font);
      y = pageHeight - margin;
    }
    if (line.text) {
      page.drawText(sanitizeWinAnsi(line.text), {
        x: margin,
        y,
        size: line.size,
        font: line.bold ? fontBold : font,
        color: line.color ?? rgb(0.08, 0.1, 0.09),
        maxWidth,
      });
      y -= line.size >= 14 ? lineHeight + 4 : lineHeight;
    } else {
      y -= lineHeight * 0.55;
    }
  }

  const bytes = await doc.save();
  const slug = title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'paper';
  const fileName = `${slug}_journal_readiness.pdf`;
  downloadPdfBytes(bytes, fileName);
  return fileName;
}

function stamp(page: PDFPage, font: PDFFont) {
  const { width, height } = page.getSize();
  page.drawText(sanitizeWinAnsi(WATERMARK), {
    x: width * 0.18,
    y: height * 0.42,
    size: 14,
    font,
    color: rgb(0.75, 0.8, 0.77),
    rotate: degrees(32),
    opacity: 0.35,
  });
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fmtPdfDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  if (r < 0) return `${r}`;
  return '0';
}
