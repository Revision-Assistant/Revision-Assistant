/**
 * Citation-integrity guard.
 *
 * The rest of this app is built around guided restatement, not silent rewrites — see
 * plan.md §1 scope boundaries. That principle has a sharp edge: an author (or the LLM
 * guidance text) restating a plagiarism-flagged passage can accidentally drop the very
 * citation marker that made the passage legitimate in the first place. This module never
 * rewrites anything itself; it only detects when that has happened so the UI can surface
 * a warning before the author moves on.
 */

const BRACKET_RE = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;
const APA_RE =
  /\(([A-Z][a-zA-Z'-]+(?:\s+et\s+al\.)?(?:\s*&\s*[A-Z][a-zA-Z'-]+)?,?\s*\d{4}[a-z]?(?:\s*;\s*[A-Z][a-zA-Z'-]+(?:\s+et\s+al\.)?,?\s*\d{4}[a-z]?)*)\)/g;
const HARVARD_RE = /\b[A-Z][a-zA-Z-]+\s+\(\d{4}[a-z]?\)/g;

export interface CitationMarker {
  /** The exact marker text as it appears, e.g. "[3, 4]" or "(Smith, 2020)" */
  marker: string;
  /** Normalized keys inside it, e.g. ["3", "4"] or ["Smith, 2020"] */
  keys: string[];
}

/** Extract citation-like markers from a plain text snippet — no full-paper context needed. */
export function extractMarkers(text: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  const seen = new Set<string>();

  const add = (marker: string, keys: string[]) => {
    const norm = marker.trim();
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    markers.push({ marker: norm, keys: keys.map((k) => k.trim()).filter(Boolean) });
  };

  let m: RegExpExecArray | null;
  const bracket = new RegExp(BRACKET_RE.source, 'g');
  while ((m = bracket.exec(text)) !== null) {
    add(m[0], m[1].split(/[,–-]/));
  }

  const apa = new RegExp(APA_RE.source, 'g');
  while ((m = apa.exec(text)) !== null) {
    add(m[0], m[1].split(';'));
  }

  const harvard = new RegExp(HARVARD_RE.source, 'g');
  while ((m = harvard.exec(text)) !== null) {
    add(m[0], [m[0]]);
  }

  return markers;
}

export interface CitationIntegrityResult {
  ok: boolean;
  /** Markers present in the original that have no surviving key anywhere in the rewrite */
  lost: CitationMarker[];
}

/**
 * Compare citation markers in an original flagged span against a proposed rewrite.
 * Conservative by design: a marker only counts as "lost" if NONE of its keys survive —
 * reformatting (e.g. "[3, 4]" -> "[3] ... [4]") or reordering never trips a false alarm,
 * only an outright removal does.
 */
export function checkCitationIntegrity(
  originalText: string,
  rewrittenText: string
): CitationIntegrityResult {
  const before = extractMarkers(originalText);
  if (before.length === 0) return { ok: true, lost: [] };

  const afterKeys = new Set(
    extractMarkers(rewrittenText).flatMap((m) => m.keys.map((k) => k.toLowerCase()))
  );

  const lost = before.filter((m) => !m.keys.some((k) => afterKeys.has(k.toLowerCase())));
  return { ok: lost.length === 0, lost };
}

export function formatLostCitationsWarning(lost: CitationMarker[]): string {
  const list = lost.map((m) => m.marker).join(', ');
  return `This rewrite drops citation marker${lost.length > 1 ? 's' : ''} ${list} that were present in the original passage. If the claim they support is still here, add the citation back — don't let restatement silently remove sourcing.`;
}
