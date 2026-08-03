/**
 * Lightweight entity / citation preservation for humanize drafts (browser).
 */

import { extractMarkers } from '../citation/guard';

const ENTITY_RES: RegExp[] = [
  /[αβγδεζηθικλμνξπρστυφχψωΑ-Ω]/g,
  /\b(?:AlGaN|GaN|SiO2|MoS2|HEMT|MOSFET|TCAD|DNA|RNA|PBS|EDTA)\b/gi,
  /\b[A-Z]{2,}[A-Za-z0-9/-]*\d[A-Za-z0-9/-]*\b/g,
  /\b[A-Z][A-Z0-9]{1,7}\b/g,
  /(?:^|[^A-Za-z])((?:\d+\.\d+|\d+)(?:\s*[×xX]\s*10\s*[−\-]?\s*\d+|\s*[eE][+\-]?\d+|%)?)/g,
  /\[\d+(?:\s*[,–\-]\s*\d+)*\]/g,
];

export function extractProtectedTokens(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const re of ENTITY_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const tok = (m[1] || m[0]).trim();
      if (!tok || seen.has(tok)) continue;
      seen.add(tok);
      found.push(tok);
    }
  }
  for (const c of extractMarkers(text)) {
    if (!seen.has(c.marker)) {
      seen.add(c.marker);
      found.push(c.marker);
    }
  }
  return found;
}

/** Append any missing protected tokens so drafts don't silently drop citations/entities. */
export function restoreMissingEntities(source: string, draft: string): string {
  const missing = extractProtectedTokens(source).filter((t) => !draft.includes(t));
  if (missing.length === 0) return draft.trim();
  return `${draft.trim()} (${missing.join(', ')})`;
}
