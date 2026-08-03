import { useMemo, useRef, useState } from 'react';
import type { ParsedPaper } from '../types';
import {
  assertUploadFile,
  FileTooLargeError,
  UnsupportedPaperFormatError,
} from '../lib/files/limits';
import { parsePaper, parsePaperFromDocx } from '../lib/pdf/paperParser';
import { parseReferencesToCsl, type ParsedCslRef } from '../lib/reformat/parseToCsl';
import { enrichViaCrossref } from '../lib/reformat/crossrefEnrich';
import { renderBibliography, type RenderedRef } from '../lib/reformat/renderBibliography';
import { REFORMAT_STYLES, getStyle } from '../lib/reformat/styles';
import {
  searchVenueRequirements,
  type VenueRequirements,
} from '../lib/reformat/venueRequirements';
import { buildRequirementsDelta, type RequirementsDelta } from '../lib/reformat/requirementsDelta';
import { buildReformatPackage, downloadTextFile } from '../lib/reformat/exportPackage';

interface Props {
  onActivity?: () => void;
  onSensitiveChange?: (hasData: boolean) => void;
}

const STATUS_MARK: Record<string, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  cant_check: '?',
};

export function ReformatWorkbench({ onActivity, onSensitiveChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paper, setPaper] = useState<ParsedPaper | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [venueQuery, setVenueQuery] = useState('');
  const [selectedVenue, setSelectedVenue] = useState<VenueRequirements | null>(null);
  const [styleId, setStyleId] = useState('apa');

  const [entries, setEntries] = useState<ParsedCslRef[]>([]);
  const [crossrefOn, setCrossrefOn] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  const venueHits = useMemo(() => searchVenueRequirements(venueQuery, 8), [venueQuery]);

  const rendered: RenderedRef[] = useMemo(() => {
    if (entries.length === 0) return [];
    return renderBibliography(entries, styleId);
  }, [entries, styleId]);

  const delta: RequirementsDelta | null = useMemo(() => {
    if (!paper || !selectedVenue) return null;
    return buildRequirementsDelta(paper, selectedVenue, title);
  }, [paper, selectedVenue, title]);

  const styleMeta = getStyle(styleId);

  const stats = useMemo(() => {
    const high = entries.filter((e) => e.confidence === 'high').length;
    const mid = entries.filter((e) => e.confidence === 'medium').length;
    const low = entries.filter((e) => e.confidence === 'low').length;
    return { high, mid, low, total: entries.length };
  }, [entries]);

  const pickVenue = (v: VenueRequirements) => {
    setSelectedVenue(v);
    setStyleId(v.styleId);
    setVenueQuery(v.label);
    onActivity?.();
  };

  const loadFile = async (file: File) => {
    setBusy(true);
    setError(null);
    onActivity?.();
    try {
      assertUploadFile(file, 'paper');
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith('.docx')
        ? await parsePaperFromDocx(buf)
        : await parsePaper(buf);
      setPaper(parsed);
      setTitle(file.name.replace(/\.(pdf|docx)$/i, ''));
      const csl = parseReferencesToCsl(parsed.references);
      setEntries(csl);
      onSensitiveChange?.(true);
      if (csl.length === 0) {
        setError(
          'No reference list was detected. Check that the manuscript has a References / Bibliography section the parser can read.'
        );
      }
      // Soft default: leave venue picker empty so the author chooses the next journal.
    } catch (e) {
      if (e instanceof FileTooLargeError || e instanceof UnsupportedPaperFormatError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setPaper(null);
      setEntries([]);
    } finally {
      setBusy(false);
    }
  };

  const runEnrich = async () => {
    if (entries.length === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setEnrichBusy(true);
    setEnrichProgress({ done: 0, total: entries.length });
    onActivity?.();
    try {
      const next = await enrichViaCrossref(entries, {
        signal: ac.signal,
        onProgress: setEnrichProgress,
      });
      setEntries(next);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setEnrichBusy(false);
      setEnrichProgress(null);
    }
  };

  const applyEdit = (index: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.index === index
          ? {
              ...e,
              csl: { ...e.csl, title: editText.trim() || e.csl.title },
              confidence: 'medium' as const,
              source: 'edited' as const,
              note: 'Edited locally by you.',
            }
          : e
      )
    );
    setEditIndex(null);
    setEditText('');
    onActivity?.();
  };

  const doExport = () => {
    if (rendered.length === 0) return;
    const md = buildReformatPackage({
      title,
      styleId,
      rendered,
      delta,
    });
    const safe = (title || 'manuscript').replace(/[^\w\-]+/g, '_').slice(0, 60);
    downloadTextFile(`${safe}_reformat_package.md`, md);
    onActivity?.();
  };

  const reset = () => {
    abortRef.current?.abort();
    setPaper(null);
    setEntries([]);
    setTitle('');
    setError(null);
    setSelectedVenue(null);
    setVenueQuery('');
    setCrossrefOn(false);
    onSensitiveChange?.(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="reformat-workbench">
      {!paper && (
        <section className="reformat-drop">
          <p className="reformat-kicker">Resubmission reformatter</p>
          <h2>Reformatting for a resubmission?</h2>
          <p className="lede">
            Upload the manuscript — it stays in your browser. We restyle the bibliography and
            build a requirements checklist. Layout-preserving PDF rewrite is not included.
          </p>
          <label className="reformat-file-btn">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
            />
            {busy ? 'Parsing…' : 'Upload PDF or DOCX'}
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="muted reformat-stat">
            Researchers report a median 14 hours formatting per manuscript (PLOS ONE 2019).
            References are usually the worst chunk.
          </p>
        </section>
      )}

      {paper && (
        <>
          <div className="reformat-toolbar">
            <div className="reformat-toolbar-main">
              <p className="reformat-kicker">Reformat</p>
              <h2>{title || 'Manuscript'}</h2>
              <p className="muted">
                {stats.total} references · {stats.high} high confidence · {stats.mid} medium ·{' '}
                {stats.low} need review
                {paper.detectedCitationStyle !== 'unknown'
                  ? ` · detected ${paper.detectedCitationStyle}`
                  : ''}
              </p>
            </div>
            <div className="reformat-toolbar-actions">
              <label className="style-select">
                Style
                <select
                  value={styleId}
                  onChange={(e) => {
                    setStyleId(e.target.value);
                    onActivity?.();
                  }}
                >
                  {REFORMAT_STYLES.filter((s) => !s.unsupported).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="primary" disabled={rendered.length === 0} onClick={doExport}>
                Export package
              </button>
              <button type="button" className="ghost" onClick={reset}>
                Start over
              </button>
            </div>
          </div>

          {styleMeta.note && <p className="reformat-style-note muted">{styleMeta.note}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="reformat-target">
            <label>
              Target venue
              <input
                type="search"
                placeholder="Search curated venues (e.g. IEEE Access, PLOS ONE)…"
                value={venueQuery}
                onChange={(e) => setVenueQuery(e.target.value)}
              />
            </label>
            {venueHits.length > 0 && (
              <ul className="reformat-venue-hits">
                {venueHits.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => pickVenue(v)}>
                      <strong>{v.label}</strong>
                      <span>
                        {getStyle(v.styleId).label} · verified {v.lastVerified}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedVenue && (
              <p className="muted reformat-venue-picked">
                Target: <strong>{selectedVenue.label}</strong> — style preselected to{' '}
                {getStyle(selectedVenue.styleId).label}.{' '}
                {selectedVenue.notes || ''} Always verify on the journal site (last verified:{' '}
                {selectedVenue.lastVerified}).
              </p>
            )}
          </div>

          <div className="reformat-crossref">
            <label className="reformat-toggle">
              <input
                type="checkbox"
                checked={crossrefOn}
                onChange={(e) => setCrossrefOn(e.target.checked)}
              />
              <span>
                Look up references on Crossref (sends only the reference text, never your
                manuscript). Improves accuracy for entries without DOIs.
              </span>
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!crossrefOn || enrichBusy || entries.length === 0}
              onClick={() => void runEnrich()}
            >
              {enrichBusy
                ? `Enriching… ${enrichProgress ? `${enrichProgress.done}/${enrichProgress.total}` : ''}`
                : 'Enrich via Crossref'}
            </button>
            {enrichBusy && (
              <button
                type="button"
                className="linkish"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </button>
            )}
          </div>

          <div className="reformat-split">
            <section className="reformat-refs" aria-label="Restyled references">
              <header>
                <h3>References ({rendered.length})</h3>
                <p className="muted">
                  Old vs new · edit titles if needed · unresolvable entries are kept
                </p>
              </header>
              <ul className="reformat-ref-list">
                {rendered.map((r) => (
                  <li key={r.index} className={`conf-${r.confidence}`}>
                    <div className="reformat-ref-head">
                      <span className="reformat-ref-num">[{r.index}]</span>
                      <span className={`reformat-badge conf-${r.confidence}`}>
                        {r.confidence}
                        {r.source === 'crossref' ? ' · Crossref' : r.source === 'edited' ? ' · edited' : ''}
                      </span>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => {
                          setEditIndex(r.index);
                          setEditText(String(r.csl.title || ''));
                        }}
                      >
                        Edit title
                      </button>
                    </div>
                    <p className="reformat-old">
                      <span className="lbl">Old</span> {r.raw.slice(0, 220)}
                      {r.raw.length > 220 ? '…' : ''}
                    </p>
                    <p className="reformat-new">
                      <span className="lbl">New</span> {r.rendered}
                    </p>
                    {r.note && <p className="muted reformat-ref-note">{r.note}</p>}
                    {editIndex === r.index && (
                      <div className="reformat-edit-row">
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          aria-label="Edit reference title"
                        />
                        <button type="button" className="secondary" onClick={() => applyEdit(r.index)}>
                          Save
                        </button>
                        <button type="button" className="ghost" onClick={() => setEditIndex(null)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <aside className="reformat-delta" aria-label="Requirements delta">
              <header>
                <h3>Requirements delta</h3>
                {delta ? (
                  <p className="muted">{delta.disclaimer}</p>
                ) : (
                  <p className="muted">Pick a target venue to see the curated checklist.</p>
                )}
              </header>
              {delta && (
                <>
                  <p className="reformat-delta-summary">
                    {delta.passCount} pass · {delta.warnCount} warn · {delta.failCount} fail ·{' '}
                    {delta.cantCheckCount} can&apos;t check
                  </p>
                  <ul className="reformat-delta-list">
                    {delta.items.map((it) => (
                      <li key={it.id} className={`st-${it.status}`}>
                        <span className="mark" aria-hidden>
                          {STATUS_MARK[it.status] || '?'}
                        </span>
                        <div>
                          <strong>{it.label}</strong>
                          <p>{it.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="reformat-phase2-note">
                <h4>In-text changes</h4>
                <p className="muted">
                  Preview of marker rewrites (e.g. [3], [7] → author–date) ships in Phase 2.
                  Export includes bibliography + checklist + restyle notes only.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
