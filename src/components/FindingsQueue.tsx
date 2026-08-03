import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Finding, FindingCategory, FindingKind, FindingStatus, ParsedPaper } from '../types';
import { checkCitationIntegrity, formatLostCitationsWarning } from '../lib/citation/guard';
import { requestHumanizeDrafts } from '../lib/rewrite/humanizeClient';
import { nextStepForFinding, reportEvidenceRows } from '../lib/reportDebug';
import { JournalReadiness } from './JournalReadiness';
import { SubmissionToolkit } from './SubmissionToolkit';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Finding>) => void;
  similarityPct: number | null;
  aiPct: number | null;
  citationStyle?: string;
  accessToken?: string | null;
  onHumanizeMessage?: (msg: string) => void;
  /** Required for Journal readiness tab */
  paper?: ParsedPaper | null;
  paperTitle?: string;
}

/** Plain-language card titles — a first-time user should know what to do from the title alone. */
export const LABELS: Record<FindingCategory, string> = {
  reference_entry: 'Reference list entry',
  properly_quoted: 'Properly quoted',
  already_cited: 'Already cited nearby',
  common_phrase: 'Common phrase',
  methods_boilerplate: 'Methods boilerplate',
  missing_in_text_citation: 'Add the in-text citation marker',
  needs_new_citation: 'Add a citation for this source',
  needs_restatement: 'Rewrite in your own words',
  source_unidentifiable: 'Overlap with an unknown source',
  ai_flagged: 'Reads as AI-written',
  orphan_reference: 'Reference never cited in text',
  broken_citation: 'Broken citation marker',
  review_manually: 'Needs your judgement',
  grammar_error: 'Grammar & style',
  trivial_match: 'Trivial match (under 1%)',
  needs_citation_claim: 'Claim may need a citation',
  numerical_ambiguity: 'Unclear number or statistic',
  numerical_inconsistency: 'Conflicting numbers in the paper',
  publication_issue: 'Vague or weak statement',
  novelty_issue: 'Novelty claim needs substance',
};

type Severity = 'high' | 'medium' | 'low' | 'info';

/** Triage order: citation/similarity problems first, quality/AI second, grammar polish last. */
const SEVERITY: Record<FindingCategory, Severity> = {
  needs_restatement: 'high',
  needs_new_citation: 'high',
  missing_in_text_citation: 'high',
  broken_citation: 'high',
  source_unidentifiable: 'high',
  needs_citation_claim: 'medium',
  ai_flagged: 'medium',
  novelty_issue: 'medium',
  publication_issue: 'medium',
  numerical_ambiguity: 'medium',
  numerical_inconsistency: 'high',
  orphan_reference: 'medium',
  review_manually: 'medium',
  grammar_error: 'low',
  trivial_match: 'info',
  reference_entry: 'info',
  properly_quoted: 'info',
  already_cited: 'info',
  common_phrase: 'info',
  methods_boilerplate: 'info',
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

const SEVERITY_META: Record<Severity, { label: string; cls: string }> = {
  high: { label: 'Fix first', cls: 'sev-chip-high' },
  medium: { label: 'Review', cls: 'sev-chip-medium' },
  low: { label: 'Polish', cls: 'sev-chip-low' },
  info: { label: 'FYI', cls: 'sev-chip-info' },
};

type KindFilter = 'all' | 'citation' | 'similarity' | 'ai' | 'quality' | 'grammar';

const KIND_GROUPS: Record<Exclude<KindFilter, 'all'>, FindingKind[]> = {
  similarity: ['similarity'],
  citation: ['citation_need', 'orphan_ref', 'broken_citation'],
  ai: ['ai'],
  grammar: ['grammar'],
  quality: ['manuscript_quality'],
};

const FILTER_LABELS: Record<Exclude<KindFilter, 'all'>, string> = {
  citation: 'Citations',
  similarity: 'Similarity',
  ai: 'AI',
  quality: 'Quality',
  grammar: 'Grammar',
};

const FILTER_TITLES: Record<Exclude<KindFilter, 'all'>, string> = {
  citation: 'Missing, broken, or never-used citations',
  similarity: 'Passages matched by your similarity report',
  ai: 'Passages that read as AI-written',
  quality: 'Ambiguous numbers, conflicting quantities, vague statements, novelty claims',
  grammar: 'Grammar and style suggestions',
};

const groupForKind = (kind: FindingKind): Exclude<KindFilter, 'all'> => {
  for (const [key, kinds] of Object.entries(KIND_GROUPS) as [Exclude<KindFilter, 'all'>, FindingKind[]][]) {
    if (kinds.includes(kind)) return key;
  }
  return 'grammar';
};

type PanelMode = 'findings' | 'journal' | 'toolkit';

export function FindingsQueue({
  findings,
  selectedId,
  onSelect,
  onUpdate,
  similarityPct,
  aiPct,
  citationStyle,
  accessToken,
  onHumanizeMessage,
  paper = null,
  paperTitle = '',
}: Props) {
  const [panelMode, setPanelMode] = useState<PanelMode>('findings');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [showInformational, setShowInformational] = useState(false);
  const [query, setQuery] = useState('');
  const [whyOpen, setWhyOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [humanizeBusy, setHumanizeBusy] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const humanizeRunRef = useRef(0);

  // Leaving a finding while the rewrite box is open must not leave stale editText
  // bound to a different selection (false citation-integrity warnings).
  useEffect(() => {
    setEditId((prev) => {
      if (prev != null && prev !== selectedId) {
        setEditText('');
        return null;
      }
      return prev;
    });
    setWhyOpen(false);
  }, [selectedId]);

  const counts = useMemo(() => {
    const actionable = findings.filter((f) => !f.isInformational);
    const info = findings.filter((f) => f.isInformational).length;
    const open = actionable.filter((f) => f.status === 'open').length;
    const reviewed = actionable.filter((f) => f.status !== 'open').length;
    const openByKind = (k: Exclude<KindFilter, 'all'>) =>
      actionable.filter((f) => KIND_GROUPS[k].includes(f.kind) && f.status === 'open').length;
    return {
      total: actionable.length,
      info,
      open,
      reviewed,
      similarity: openByKind('similarity'),
      citation: openByKind('citation'),
      ai: openByKind('ai'),
      grammar: openByKind('grammar'),
      quality: openByKind('quality'),
    };
  }, [findings]);

  // Grammar is presented as one batch card in the Everything view so 60+ small
  // suggestions don't drown the handful of findings that actually need thought.
  const grammarBatched = kindFilter === 'all' && !query;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = findings.filter((f) => {
      if (!showInformational && f.isInformational) return false;
      if (!showResolved && f.status !== 'open') return false;
      if (kindFilter !== 'all' && !KIND_GROUPS[kindFilter].includes(f.kind)) return false;
      if (grammarBatched && f.kind === 'grammar' && f.status === 'open' && f.id !== selectedId) {
        return false;
      }
      if (q && !f.text.toLowerCase().includes(q) && !(LABELS[f.category] || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const sev = SEVERITY_RANK[SEVERITY[a.category] || 'medium'] - SEVERITY_RANK[SEVERITY[b.category] || 'medium'];
      if (sev !== 0) return sev;
      if (a.page !== b.page) return a.page - b.page;
      return a.startOffset - b.startOffset;
    });
  }, [findings, kindFilter, showResolved, showInformational, query, grammarBatched, selectedId]);

  const selected = findings.find((f) => f.id === selectedId) || null;

  // Clicking a highlight in the manuscript must always reveal its card, even if the
  // current filter would hide it.
  useEffect(() => {
    if (!selected) return;
    if (selected.isInformational && !showInformational) setShowInformational(true);
    if (selected.status !== 'open' && !showResolved) setShowResolved(true);
    const group = groupForKind(selected.kind);
    if (kindFilter !== 'all' && !KIND_GROUPS[kindFilter].includes(selected.kind)) {
      setKindFilter(group);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to selection only
  }, [selectedId]);

  const selectedEvidence = useMemo(
    () => (selected ? reportEvidenceRows(selected) : []),
    [selected]
  );
  const selectedNextStep = useMemo(
    () => (selected ? nextStepForFinding(selected) : ''),
    [selected]
  );
  const visibleIds = useMemo(() => visible.map((f) => f.id), [visible]);
  const selectedIndex = selectedId ? visibleIds.indexOf(selectedId) : -1;

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-finding-id="${selectedId}"]`);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [selectedId]);

  const setStatus = (id: string, status: FindingStatus, extra?: Partial<Finding>) => {
    onUpdate(id, { status, ...extra });
  };

  const goRelative = (delta: number) => {
    if (visibleIds.length === 0) return;
    const base = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : 0;
    const next = Math.max(0, Math.min(visibleIds.length - 1, base + delta));
    onSelect(visibleIds[next]);
  };

  /** Resolve and immediately move to the next open card — the core triage gesture. */
  const resolveAndAdvance = (id: string, status: FindingStatus, extra?: Partial<Finding>) => {
    const idx = visibleIds.indexOf(id);
    setStatus(id, status, extra);
    const nextId = visibleIds.find((vid, i) => i > idx && vid !== id);
    onSelect(nextId ?? null);
  };

  const onListKeyDown = (e: ReactKeyboardEvent) => {
    // Don't steal keys from inputs rendered inside the list area
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      goRelative(1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      goRelative(-1);
    } else if (e.key === 'Home' && visibleIds.length > 0) {
      e.preventDefault();
      onSelect(visibleIds[0]);
    } else if (e.key === 'End' && visibleIds.length > 0) {
      e.preventDefault();
      onSelect(visibleIds[visibleIds.length - 1]);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  };

  const editIntegrity = useMemo(
    () => (selected ? checkCitationIntegrity(selected.text, editText) : { ok: true, lost: [] }),
    [selected, editText]
  );

  const applyFix = (f: Finding, advance = false) => {
    if (!f.replacementText) return;
    const integrity = checkCitationIntegrity(f.text, f.replacementText);
    if (integrity.ok) {
      if (advance) {
        resolveAndAdvance(f.id, 'accepted', { editedText: f.replacementText, citationWarning: false });
      } else {
        setStatus(f.id, 'accepted', { editedText: f.replacementText, citationWarning: false });
      }
    } else {
      onSelect(f.id);
      setEditId(f.id);
      setEditText(f.replacementText);
    }
  };

  const openGrammar = useMemo(
    () => findings.filter((f) => f.kind === 'grammar' && f.status === 'open' && !f.isInformational),
    [findings]
  );
  const safeGrammarFixes = useMemo(
    () =>
      openGrammar.filter(
        (f) => f.replacementText && checkCitationIntegrity(f.text, f.replacementText).ok
      ).length,
    [openGrammar]
  );

  const fixAllGrammar = () => {
    for (const f of openGrammar) {
      if (!f.replacementText) continue;
      if (checkCitationIntegrity(f.text, f.replacementText).ok) {
        setStatus(f.id, 'accepted', { editedText: f.replacementText, citationWarning: false });
      }
    }
  };

  const canHumanize = (f: Finding) =>
    f.status === 'open' &&
    !f.isInformational &&
    (f.kind === 'ai' || f.category === 'needs_restatement' || f.category === 'ai_flagged');

  const humanizeTargets = useMemo(() => findings.filter(canHumanize), [findings]);

  const runHumanize = async (only?: Finding) => {
    const runId = ++humanizeRunRef.current;
    setHumanizeBusy(true);
    try {
      const list = only ? [only] : humanizeTargets;
      const drafts = await requestHumanizeDrafts(list, {
        accessToken,
        citationStyle,
      });
      if (humanizeRunRef.current !== runId) return;
      if (drafts.length === 0) {
        onHumanizeMessage?.(
          'No drafts returned. Check LLM keys on Netlify, or try again.'
        );
        return;
      }
      if (only && drafts[0]) {
        setEditId(only.id);
        setEditText(drafts[0].draft);
        onHumanizeMessage?.('Draft ready — review in Edit text, then Save edit.');
      } else {
        const map = new Map(drafts.map((d) => [d.id, d.draft]));
        setPendingDrafts(map);
        onHumanizeMessage?.(
          `${drafts.length} draft${drafts.length === 1 ? '' : 's'} ready. Review with Accept drafts or open each finding.`
        );
      }
    } catch (e) {
      if (humanizeRunRef.current !== runId) return;
      onHumanizeMessage?.(e instanceof Error ? e.message : String(e));
    } finally {
      if (humanizeRunRef.current === runId) setHumanizeBusy(false);
    }
  };

  const acceptPendingDrafts = () => {
    let n = 0;
    for (const [id, draft] of pendingDrafts) {
      const f = findings.find((x) => x.id === id);
      if (!f) continue;
      const integrity = checkCitationIntegrity(f.text, draft);
      onUpdate(id, {
        status: 'edited',
        editedText: draft,
        citationWarning: !integrity.ok,
      });
      n += 1;
    }
    setPendingDrafts(new Map());
    onHumanizeMessage?.(
      n > 0
        ? `Accepted ${n} draft${n === 1 ? '' : 's'} into the manuscript. Switch to Revised view if needed.`
        : 'No drafts to accept.'
    );
  };

  const showJournal = panelMode === 'journal' && paper != null;
  const showToolkit = panelMode === 'toolkit' && paper != null;
  const progressPct = counts.total > 0 ? Math.round((counts.reviewed / counts.total) * 100) : 0;

  const filterChips = (
    Object.keys(FILTER_LABELS) as Exclude<KindFilter, 'all'>[]
  ).filter((k) => counts[k] > 0 || kindFilter === k);

  const renderExpanded = (f: Finding) => (
    <div className="card-detail" onClick={(e) => e.stopPropagation()}>
      {f.citationWarning && editId !== f.id && (
        <p className="citation-alert">
          Your saved rewrite may have dropped a citation that was in the original passage.
          Re-open Edit text to review.
        </p>
      )}

      {selectedNextStep && (
        <div className="card-guidance">
          <h4>What to do</h4>
          <p className="pre">{selectedNextStep}</p>
        </div>
      )}
      {f.suggestion && f.suggestion.trim() !== selectedNextStep.trim() && (
        <div className="card-guidance">
          <h4>Suggested wording</h4>
          <p className="pre">{f.suggestion}</p>
        </div>
      )}
      {f.confidence < 0.6 && (
        <p className="low-conf">Low confidence — prefer your own judgement over this guidance.</p>
      )}

      <div className="detail-actions">
        {f.replacementText && f.status === 'open' ? (
          <button
            type="button"
            className="primary"
            title={`Replace with: "${f.replacementText}"`}
            onClick={() => applyFix(f, true)}
          >
            Fix &amp; next
          </button>
        ) : canHumanize(f) ? (
          <button
            type="button"
            className="primary"
            disabled={humanizeBusy}
            onClick={() => void runHumanize(f)}
          >
            {humanizeBusy ? 'Drafting…' : 'Draft rewrite'}
          </button>
        ) : f.status === 'open' ? (
          <button
            type="button"
            className="primary"
            onClick={() => resolveAndAdvance(f.id, 'accepted')}
          >
            Mark reviewed &amp; next
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => setStatus(f.id, 'open')}>
            Reopen
          </button>
        )}
        {pendingDrafts.has(f.id) && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              const draft = pendingDrafts.get(f.id)!;
              setEditId(f.id);
              setEditText(draft);
            }}
          >
            Open draft
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setEditId(f.id);
            setEditText(pendingDrafts.get(f.id) || f.editedText || f.text);
          }}
        >
          Edit text
        </button>
        {f.suggestion &&
          (f.category === 'needs_new_citation' || f.category === 'missing_in_text_citation') && (
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(f.suggestion || '');
              }}
            >
              Copy citation
            </button>
          )}
        {f.status === 'open' && (
          <button
            type="button"
            className="ghost"
            onClick={() => resolveAndAdvance(f.id, 'dismissed')}
          >
            Dismiss
          </button>
        )}
      </div>

      {editId === f.id && (
        <div className="edit-box">
          <label htmlFor="edit-area">Your rewrite (tracked in the change log)</label>
          <textarea
            id="edit-area"
            rows={5}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
          />
          {!editIntegrity.ok && (
            <p className="citation-alert">{formatLostCitationsWarning(editIntegrity.lost)}</p>
          )}
          <div className="detail-actions">
            <button
              type="button"
              className="primary"
              disabled={!editIntegrity.ok}
              onClick={() => {
                setStatus(f.id, 'edited', { editedText: editText, citationWarning: false });
                setEditId(null);
              }}
            >
              Save edit
            </button>
            {!editIntegrity.ok && (
              <button
                type="button"
                className="ghost danger"
                onClick={() => {
                  setStatus(f.id, 'edited', { editedText: editText, citationWarning: true });
                  setEditId(null);
                }}
              >
                Save anyway (citation removed)
              </button>
            )}
            <button type="button" className="ghost" onClick={() => setEditId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(f.explanation || selectedEvidence.length > 0 || f.aiFeatures) && (
        <div className="why-flagged">
          <button
            type="button"
            className="why-toggle"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((v) => !v)}
          >
            <span className={`caret ${whyOpen ? '' : 'closed'}`}>▾</span> Why was this flagged?
          </button>
          {whyOpen && (
            <div className="why-body">
              {f.explanation && <p className="pre">{f.explanation}</p>}
              {selectedEvidence.length > 0 && (
                <dl className="evidence-list">
                  {selectedEvidence.map((row) => (
                    <div key={row.label} className="evidence-row">
                      <dt>{row.label}</dt>
                      <dd className="pre">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {f.aiFeatures && (
                <ul className="feat-list">
                  <li>Sentence length variance: {f.aiFeatures.sentenceLengthVariance}</li>
                  <li>Hedging density: {f.aiFeatures.hedgingDensity}</li>
                  <li>Concrete entities/numbers: {f.aiFeatures.concreteEntityCount}</li>
                  <li>Nearby citations: {f.aiFeatures.citationCount}</li>
                  <li>Avg sentence length: {f.aiFeatures.avgSentenceLength}</li>
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <label className="note-label" htmlFor={`note-${f.id}`}>
        Author note (optional)
      </label>
      <input
        id={`note-${f.id}`}
        type="text"
        value={f.userNote || ''}
        placeholder="e.g. Will rephrase after lab meeting"
        onChange={(e) => onUpdate(f.id, { userNote: e.target.value })}
      />
    </div>
  );

  return (
    <div className={`findings-queue${showJournal || showToolkit ? ' journal-mode' : ''}`}>
      <div className="queue-chrome">
        <div
          className="filters panel-mode-tabs"
          role="tablist"
          aria-label="Findings, journal readiness, or submission toolkit"
        >
          <button
            type="button"
            role="tab"
            className={panelMode === 'findings' ? 'chip active' : 'chip'}
            aria-selected={panelMode === 'findings'}
            onClick={() => setPanelMode('findings')}
          >
            Findings
          </button>
          <button
            type="button"
            role="tab"
            className={panelMode === 'journal' ? 'chip active' : 'chip'}
            aria-selected={panelMode === 'journal'}
            disabled={!paper}
            title={paper ? 'Heuristic Q1/Q2-like readiness' : 'Run analysis first'}
            onClick={() => setPanelMode('journal')}
          >
            Journal readiness
          </button>
          <button
            type="button"
            role="tab"
            className={panelMode === 'toolkit' ? 'chip active' : 'chip'}
            aria-selected={panelMode === 'toolkit'}
            disabled={!paper}
            title={
              paper
                ? 'Pre-submission checklist, reference hygiene, statements, cover letter'
                : 'Run analysis first'
            }
            onClick={() => setPanelMode('toolkit')}
          >
            Submission toolkit
          </button>
          <span className="queue-status-meta">
            {similarityPct != null ? <>Similarity {similarityPct}% · </> : null}
            {aiPct != null ? <>AI {aiPct}%</> : similarityPct == null ? 'No report scores' : null}
          </span>
        </div>

        {panelMode === 'findings' && (
          <div className="triage-bar">
            <div className="triage-progress">
              <span className="triage-progress-label">
                {counts.reviewed === counts.total && counts.total > 0 ? (
                  <strong>All {counts.total} findings reviewed</strong>
                ) : (
                  <>
                    <strong>{counts.reviewed}</strong> of <strong>{counts.total}</strong> reviewed
                  </>
                )}
              </span>
              <div
                className="triage-track"
                role="progressbar"
                aria-valuenow={counts.reviewed}
                aria-valuemin={0}
                aria-valuemax={counts.total}
              >
                <div style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <div className="triage-nav">
              <button
                type="button"
                className="ghost compact"
                disabled={visibleIds.length === 0 || selectedIndex <= 0}
                onClick={() => goRelative(-1)}
                title="Previous finding"
              >
                ← Prev
              </button>
              <button
                type="button"
                className="primary compact triage-next"
                disabled={visibleIds.length === 0}
                onClick={() => goRelative(1)}
              >
                {selectedIndex < 0 ? 'Start review' : 'Next →'}
              </button>
            </div>
          </div>
        )}

        {panelMode === 'findings' && (
          <div className="filters" role="group" aria-label="Filter by finding type">
            <button
              type="button"
              className={kindFilter === 'all' ? 'chip active' : 'chip'}
              aria-pressed={kindFilter === 'all'}
              onClick={() => setKindFilter('all')}
            >
              Everything
            </button>
            {filterChips.map((k) => (
              <button
                key={k}
                type="button"
                className={kindFilter === k ? 'chip active' : 'chip'}
                aria-pressed={kindFilter === k}
                title={FILTER_TITLES[k]}
                onClick={() => setKindFilter(k)}
              >
                {FILTER_LABELS[k]}
                {counts[k] > 0 ? <span className="chip-count">{counts[k]}</span> : null}
              </button>
            ))}
          </div>
        )}

        {panelMode === 'findings' && (
          <div className="queue-tools">
            <input
              type="search"
              className="queue-search"
              value={query}
              placeholder="Search findings…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="toggle" title="Include findings you already fixed, edited, or dismissed">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show reviewed
            </label>
            {counts.info > 0 && (
              <label
                className="toggle"
                title="Include FYI-only rows (quoted text, reference entries, common phrases) that need no action"
              >
                <input
                  type="checkbox"
                  checked={showInformational}
                  onChange={(e) => setShowInformational(e.target.checked)}
                />
                Show informational
              </label>
            )}
          </div>
        )}
        {panelMode === 'findings' && (humanizeTargets.length > 0 || pendingDrafts.size > 0) && (
          <div className="humanize-bar">
            <button
              type="button"
              className="ghost compact"
              disabled={humanizeBusy || humanizeTargets.length === 0}
              title="Asks the writing assistant for a reworded draft of every open AI-flagged passage. Nothing changes until you review and accept each draft."
              onClick={() => void runHumanize()}
            >
              {humanizeBusy ? 'Drafting…' : `Draft all AI flags (${humanizeTargets.length})`}
            </button>
            {pendingDrafts.size > 0 && (
              <button type="button" className="primary compact" onClick={acceptPendingDrafts}>
                Accept {pendingDrafts.size} drafts
              </button>
            )}
          </div>
        )}
      </div>

      {showToolkit && paper ? (
        <div className="queue-body journal-body">
          <SubmissionToolkit
            paper={paper}
            title={paperTitle || 'Untitled manuscript'}
            accessToken={accessToken}
          />
        </div>
      ) : showJournal && paper ? (
        <div className="queue-body journal-body">
          <JournalReadiness
            paper={paper}
            findings={findings}
            title={paperTitle || 'Untitled manuscript'}
            similarityPct={similarityPct}
            aiPct={aiPct}
            accessToken={accessToken}
            onSelectFinding={(id) => {
              setPanelMode('findings');
              onSelect(id);
            }}
          />
        </div>
      ) : (
        <div className="queue-body">
          <div
            className="finding-list"
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-label="Findings — use arrow keys to move between findings"
            aria-activedescendant={selectedId ? `finding-${selectedId}` : undefined}
            onKeyDown={onListKeyDown}
          >
            <ul className="triage-items">
              {visible.map((f) => {
                const sev = SEVERITY[f.category] || 'medium';
                const meta = SEVERITY_META[sev];
                const isSelected = selectedId === f.id;
                return (
                  <li
                    key={f.id}
                    id={`finding-${f.id}`}
                    data-finding-id={f.id}
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      'finding-card',
                      f.isInformational ? 'informational' : '',
                      isSelected ? 'selected expanded' : '',
                      f.status,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelect(isSelected ? null : f.id)}
                  >
                    <div className="finding-top">
                      <span className={`sev-chip ${meta.cls}`}>{meta.label}</span>
                      <span className="finding-title">{LABELS[f.category] || f.category}</span>
                      {f.matchPct != null && <span className="pct">~{f.matchPct}%</span>}
                      {f.citationWarning && (
                        <span
                          className="badge badge-citation-warn"
                          title="Edit may have removed a citation"
                        >
                          citation warn
                        </span>
                      )}
                      {f.status !== 'open' && <span className="status-pill">{f.status}</span>}
                      <span className="page">p.{f.page}</span>
                      {f.replacementText && f.status === 'open' && !isSelected && (
                        <button
                          type="button"
                          className="fix-btn"
                          title={`Apply: "${f.replacementText}"`}
                          onClick={(e) => {
                            e.stopPropagation();
                            applyFix(f);
                          }}
                        >
                          Fix
                        </button>
                      )}
                    </div>
                    <p className="excerpt">
                      {isSelected ? f.text : (
                        <>
                          {f.text.slice(0, 140)}
                          {f.text.length > 140 ? '…' : ''}
                        </>
                      )}
                    </p>
                    {f.sourceTitle && (
                      <p className="meta">
                        Matched source: {f.sourceTitle.slice(0, 70)}
                        {f.sourceType === 'student_paper' ? ' · student paper' : ''}
                      </p>
                    )}
                    {f.kind === 'ai' && aiPct == null && (
                      <p className="meta">
                        Flagged by this app&apos;s local heuristics — no external AI report was
                        uploaded.
                      </p>
                    )}
                    {isSelected && renderExpanded(f)}
                  </li>
                );
              })}

              {grammarBatched && openGrammar.length > 0 && !showJournal && (
                <li className="batch-card">
                  <div className="batch-copy">
                    <span className="sev-chip sev-chip-low">Polish</span>
                    <div>
                      <strong>
                        {openGrammar.length} grammar &amp; style suggestion
                        {openGrammar.length === 1 ? '' : 's'}
                      </strong>
                      <p>Small wording and punctuation fixes — handle them in one go.</p>
                    </div>
                  </div>
                  <div className="batch-actions">
                    {safeGrammarFixes > 0 && (
                      <button
                        type="button"
                        className="primary compact"
                        title="Applies only fixes that do not remove a citation"
                        onClick={fixAllGrammar}
                      >
                        Fix {safeGrammarFixes} safe one{safeGrammarFixes === 1 ? '' : 's'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => setKindFilter('grammar')}
                    >
                      See each of the {openGrammar.length}
                    </button>
                  </div>
                </li>
              )}
            </ul>

            {visible.length === 0 && !(grammarBatched && openGrammar.length > 0) && (
              <div className="empty">
                {query ? (
                  <>
                    <p className="empty-title">No matches</p>
                    <p className="empty-copy">
                      Nothing matches “{query}”. Try another word or clear the search.
                    </p>
                  </>
                ) : counts.open === 0 ? (
                  <>
                    <p className="empty-title">Queue is clear</p>
                    <p className="empty-copy">
                      Every finding is reviewed. Export your change log when you&apos;re ready.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="empty-title">Nothing in this filter</p>
                    <p className="empty-copy">
                      Switch to Everything, or turn on the informational toggle if you expect
                      report noise here.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
