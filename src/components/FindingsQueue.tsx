import { useMemo, useState } from 'react';
import type { Finding, FindingCategory, FindingKind, FindingStatus } from '../types';
import { checkCitationIntegrity, formatLostCitationsWarning } from '../lib/citation/guard';

interface Props {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Finding>) => void;
  similarityPct: number | null;
  aiPct: number | null;
}

const LABELS: Record<FindingCategory, string> = {
  reference_entry: 'Reference list entry',
  properly_quoted: 'Properly quoted',
  already_cited: 'Already cited nearby',
  common_phrase: 'Common phrase',
  methods_boilerplate: 'Methods boilerplate',
  missing_in_text_citation: 'Missing in-text citation',
  needs_new_citation: 'Needs new citation',
  needs_restatement: 'Needs restatement',
  source_unidentifiable: 'Source unidentifiable',
  ai_flagged: 'AI-flagged passage',
  orphan_reference: 'Orphan reference',
  broken_citation: 'Broken citation',
  review_manually: 'Review manually',
  grammar_error: 'Grammar / style',
  trivial_match: 'Trivial match (<1%)',
  needs_citation_claim: 'Claim needs a citation',
};

/** Short "what do I do about it" line shown once per group, not per finding. */
const GROUP_HINTS: Partial<Record<FindingCategory, string>> = {
  missing_in_text_citation: 'You already cite this source — it just needs an in-text marker here. Fastest wins.',
  needs_citation_claim: 'Turnitin cannot see these: claims about prior work with no citation nearby.',
  needs_new_citation: 'Matched a source that is not in your reference list.',
  needs_restatement: 'Substantial overlap with no citation — restate in your own words.',
  source_unidentifiable: 'Student-paper or unindexed match. No citation can be proposed; use your judgement.',
  ai_flagged: 'Reads as machine-generated. Add specificity and your own analytic voice.',
  grammar_error: 'Reviewable edits — apply or reject each one.',
  trivial_match: 'Turnitin weights these under 1%. Shown so your queue matches the report, not hidden.',
  reference_entry: 'Matches inside your bibliography are expected.',
  already_cited: 'A citation is already present nearby.',
};

type KindFilter = 'all' | 'similarity' | 'citation' | 'ai' | 'grammar';

const KIND_GROUPS: Record<Exclude<KindFilter, 'all'>, FindingKind[]> = {
  similarity: ['similarity'],
  citation: ['citation_need', 'orphan_ref', 'broken_citation'],
  ai: ['ai'],
  grammar: ['grammar'],
};

export function FindingsQueue({
  findings,
  selectedId,
  onSelect,
  onUpdate,
  similarityPct,
  aiPct,
}: Props) {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [showInformational, setShowInformational] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const counts = useMemo(() => {
    const actionable = findings.filter((f) => !f.isInformational).length;
    const info = findings.filter((f) => f.isInformational).length;
    const open = findings.filter((f) => f.status === 'open' && !f.isInformational).length;
    const resolved = findings.filter((f) => f.status !== 'open').length;
    const byKind = (k: Exclude<KindFilter, 'all'>) =>
      findings.filter((f) => KIND_GROUPS[k].includes(f.kind) && !f.isInformational).length;
    return {
      all: findings.length,
      actionable,
      info,
      open,
      resolved,
      similarity: byKind('similarity'),
      citation: byKind('citation'),
      ai: byKind('ai'),
      grammar: byKind('grammar'),
    };
  }, [findings]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter((f) => {
      if (!showInformational && f.isInformational) return false;
      if (openOnly && f.status !== 'open') return false;
      if (kindFilter !== 'all' && !KIND_GROUPS[kindFilter].includes(f.kind)) return false;
      if (q && !f.text.toLowerCase().includes(q) && !(LABELS[f.category] || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [findings, kindFilter, openOnly, showInformational, query]);

  /** Group by category, preserving the severity order the pipeline already sorted into. */
  const groups = useMemo(() => {
    const map = new Map<FindingCategory, Finding[]>();
    for (const f of visible) {
      const list = map.get(f.category);
      if (list) list.push(f);
      else map.set(f.category, [f]);
    }
    return [...map.entries()];
  }, [visible]);

  const selected = findings.find((f) => f.id === selectedId) || null;

  const setStatus = (id: string, status: FindingStatus, extra?: Partial<Finding>) => {
    onUpdate(id, { status, ...extra });
  };

  const toggleGroup = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const editIntegrity = useMemo(
    () => (selected ? checkCitationIntegrity(selected.text, editText) : { ok: true, lost: [] }),
    [selected, editText]
  );

  /**
   * One-click apply for grammar fixes. Still runs the same citation-integrity check as a
   * manual edit — if the flagged span happens to overlap a citation marker, this routes
   * through the guarded edit box instead of silently applying.
   */
  const applyFix = (f: Finding) => {
    if (!f.replacementText) return;
    const integrity = checkCitationIntegrity(f.text, f.replacementText);
    if (integrity.ok) {
      setStatus(f.id, 'accepted', { editedText: f.replacementText, citationWarning: false });
    } else {
      onSelect(f.id);
      setEditId(f.id);
      setEditText(f.replacementText);
    }
  };

  /** Accept every remaining grammar fix in a group that doesn't touch a citation. */
  const applyAllInGroup = (items: Finding[]) => {
    for (const f of items) {
      if (f.status !== 'open' || !f.replacementText) continue;
      if (checkCitationIntegrity(f.text, f.replacementText).ok) {
        setStatus(f.id, 'accepted', { editedText: f.replacementText, citationWarning: false });
      }
    }
  };

  return (
    <div className="findings-queue">
      <div className="queue-summary">
        <div className="stat">
          <span className="stat-val">{similarityPct ?? '—'}</span>
          <span className="stat-lbl">Similarity %</span>
        </div>
        <div className="stat">
          <span className="stat-val">{aiPct ?? '—'}</span>
          <span className="stat-lbl">AI %</span>
        </div>
        <div className="stat">
          <span className="stat-val">{counts.open}</span>
          <span className="stat-lbl">To review</span>
        </div>
        <div className="stat">
          <span className="stat-val">{counts.resolved}</span>
          <span className="stat-lbl">Resolved</span>
        </div>
      </div>

      <div className="filters">
        {(
          [
            ['all', `All (${counts.actionable})`],
            ['similarity', `Plagiarism (${counts.similarity})`],
            ['citation', `Citations (${counts.citation})`],
            ['ai', `AI (${counts.ai})`],
            ['grammar', `Grammar (${counts.grammar})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={kindFilter === k ? 'chip active' : 'chip'}
            onClick={() => setKindFilter(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="queue-tools">
        <input
          type="search"
          className="queue-search"
          value={query}
          placeholder="Search findings…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="toggle">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Unresolved only
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showInformational}
            onChange={(e) => setShowInformational(e.target.checked)}
          />
          Explained ({counts.info})
        </label>
      </div>

      <div className="finding-list">
        {groups.map(([cat, items]) => {
          const isCollapsed = collapsed.has(cat);
          const openCount = items.filter((f) => f.status === 'open').length;
          const fixable = items.filter((f) => f.status === 'open' && f.replacementText).length;
          return (
            <section key={cat} className={`group ${items[0]?.isInformational ? 'group-info' : ''}`}>
              <header className="group-head">
                <button type="button" className="group-toggle" onClick={() => toggleGroup(cat)}>
                  <span className={`caret ${isCollapsed ? 'closed' : ''}`}>▾</span>
                  <span className="group-name">{LABELS[cat] || cat}</span>
                  <span className="group-count">
                    {openCount > 0 ? `${openCount} open` : 'done'} · {items.length}
                  </span>
                </button>
                {fixable > 1 && (
                  <button
                    type="button"
                    className="group-action"
                    title="Applies only fixes that do not remove a citation"
                    onClick={() => applyAllInGroup(items)}
                  >
                    Fix all {fixable}
                  </button>
                )}
              </header>

              {!isCollapsed && (
                <>
                  {GROUP_HINTS[cat] && <p className="group-hint">{GROUP_HINTS[cat]}</p>}
                  <ul className="group-items">
                    {items.map((f) => (
                      <li
                        key={f.id}
                        className={[
                          'finding-card',
                          f.isInformational ? 'informational' : '',
                          selectedId === f.id ? 'selected' : '',
                          f.status,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => onSelect(f.id)}
                      >
                        <div className="finding-top">
                          <span className="page">p.{f.page}</span>
                          {f.matchPct != null && <span className="pct">~{f.matchPct}%</span>}
                          {f.citationWarning && (
                            <span className="badge badge-citation-warn" title="Edit may have removed a citation">
                              ⚠ citation
                            </span>
                          )}
                          {f.status !== 'open' && <span className="status-pill">{f.status}</span>}
                          {f.replacementText && f.status === 'open' && (
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
                          {f.text.slice(0, 160)}
                          {f.text.length > 160 ? '…' : ''}
                        </p>
                        {f.sourceTitle && (
                          <p className="meta">
                            {f.sourceTitle.slice(0, 70)}
                            {f.sourceType === 'student_paper' ? ' · student paper' : ''}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          );
        })}
        {groups.length === 0 && (
          <p className="empty">
            {query ? `Nothing matches “${query}”.` : 'Nothing in this filter.'}
          </p>
        )}
      </div>

      {selected && (
        <div className="detail-panel">
          <h3>{LABELS[selected.category] || selected.category}</h3>
          {selected.citationWarning && editId !== selected.id && (
            <p className="citation-alert">
              ⚠ Your saved rewrite may have dropped a citation that was in the original
              passage. Re-open Edit text to review.
            </p>
          )}
          <p className="detail-text">{selected.text}</p>
          {selected.explanation && (
            <div className="block">
              <h4>Why it was flagged</h4>
              <p className="pre">{selected.explanation}</p>
            </div>
          )}
          {selected.suggestion && (
            <div className="block">
              <h4>What to change</h4>
              <p className="pre">{selected.suggestion}</p>
            </div>
          )}
          {selected.aiFeatures && (
            <div className="block">
              <h4>Local AI diagnostics</h4>
              <ul className="feat-list">
                <li>Sentence length variance: {selected.aiFeatures.sentenceLengthVariance}</li>
                <li>Hedging density: {selected.aiFeatures.hedgingDensity}</li>
                <li>Concrete entities/numbers: {selected.aiFeatures.concreteEntityCount}</li>
                <li>Nearby citations: {selected.aiFeatures.citationCount}</li>
                <li>Avg sentence length: {selected.aiFeatures.avgSentenceLength}</li>
              </ul>
            </div>
          )}
          {selected.confidence < 0.6 && (
            <p className="low-conf">Low confidence — prefer manual review over automated guidance.</p>
          )}

          <div className="detail-actions">
            {selected.replacementText ? (
              <button type="button" className="primary" onClick={() => applyFix(selected)}>
                Apply fix: "{selected.replacementText}"
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => setStatus(selected.id, 'accepted')}
              >
                Accept guidance
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditId(selected.id);
                setEditText(selected.editedText || selected.text);
              }}
            >
              Edit text
            </button>
            {selected.suggestion &&
              (selected.category === 'needs_new_citation' ||
                selected.category === 'missing_in_text_citation') && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(selected.suggestion || '');
                  }}
                >
                  Copy citation guidance
                </button>
              )}
            <button
              type="button"
              className="ghost"
              onClick={() => setStatus(selected.id, 'dismissed')}
            >
              Dismiss
            </button>
          </div>

          {editId === selected.id && (
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
                    setStatus(selected.id, 'edited', {
                      editedText: editText,
                      citationWarning: false,
                    });
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
                      setStatus(selected.id, 'edited', {
                        editedText: editText,
                        citationWarning: true,
                      });
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

          <label className="note-label" htmlFor="user-note">
            Author note (optional)
          </label>
          <input
            id="user-note"
            type="text"
            value={selected.userNote || ''}
            placeholder="e.g. Will rephrase after lab meeting"
            onChange={(e) => onUpdate(selected.id, { userNote: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
