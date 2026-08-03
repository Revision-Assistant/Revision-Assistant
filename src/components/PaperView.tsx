import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Finding, ParsedPaper } from '../types';
import { applyAcceptedEditsDetailed } from '../lib/export/changeLog';
import { LABELS } from './FindingsQueue';

interface Props {
  paper: ParsedPaper;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Bumped when an edit is applied so view switches to revised */
  preferRevisedToken?: number;
}

const CATEGORY_CLASS: Record<string, string> = {
  needs_restatement: 'hl-action',
  needs_new_citation: 'hl-action',
  missing_in_text_citation: 'hl-action',
  source_unidentifiable: 'hl-warn',
  ai_flagged: 'hl-ai',
  broken_citation: 'hl-action',
  orphan_reference: 'hl-warn',
  review_manually: 'hl-warn',
  already_cited: 'hl-info',
  methods_boilerplate: 'hl-info',
  common_phrase: 'hl-info',
  properly_quoted: 'hl-info',
  reference_entry: 'hl-info',
  grammar_error: 'hl-grammar',
  trivial_match: 'hl-info',
  needs_citation_claim: 'hl-cite',
  numerical_ambiguity: 'hl-quality',
  numerical_inconsistency: 'hl-quality',
  publication_issue: 'hl-quality',
  novelty_issue: 'hl-quality',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Seg {
  start: number;
  end: number;
  finding?: Finding;
  appliedId?: string;
}

function buildSegments(textLen: number, findings: Finding[]): Seg[] {
  const marks = findings
    .filter((f) => f.startOffset >= 0 && f.endOffset > f.startOffset && f.endOffset <= textLen)
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

  const chosen: Finding[] = [];
  let cursor = 0;
  for (const f of marks) {
    if (f.startOffset < cursor) continue;
    chosen.push(f);
    cursor = f.endOffset;
  }

  const segs: Seg[] = [];
  let pos = 0;
  for (const f of chosen) {
    if (f.startOffset > pos) segs.push({ start: pos, end: f.startOffset });
    segs.push({ start: f.startOffset, end: f.endOffset, finding: f });
    pos = f.endOffset;
  }
  if (pos < textLen) segs.push({ start: pos, end: textLen });
  return segs;
}

function buildRevisedSegments(
  text: string,
  applied: { findingId: string; start: number; end: number }[]
): Seg[] {
  const marks = applied
    .filter((a) => a.start >= 0 && a.end > a.start && a.end <= text.length)
    .sort((a, b) => a.start - b.start);
  const segs: Seg[] = [];
  let pos = 0;
  for (const a of marks) {
    if (a.start < pos) continue;
    if (a.start > pos) segs.push({ start: pos, end: a.start });
    segs.push({ start: a.start, end: a.end, appliedId: a.findingId });
    pos = a.end;
  }
  if (pos < text.length) segs.push({ start: pos, end: text.length });
  return segs;
}

function pageAnchor(page: number): ReactNode {
  return (
    <span
      key={`a-${page}`}
      className="page-anchor"
      data-page-anchor={page}
      id={`paper-p-${page}`}
    />
  );
}

export function PaperView({
  paper,
  findings,
  selectedId,
  onSelect,
  preferRevisedToken = 0,
}: Props) {
  const selectedRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  const [showRevised, setShowRevised] = useState(false);

  const editCount = useMemo(
    () =>
      findings.filter(
        (f) =>
          (f.status === 'accepted' || f.status === 'edited') &&
          f.editedText != null &&
          f.editedText !== f.text
      ).length,
    [findings]
  );

  // Switch to the revised view when an edit is applied (token bumps), but let the
  // user toggle back without the view snapping to revised again on every render.
  useEffect(() => {
    if (editCount > 0 && preferRevisedToken > 0) setShowRevised(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on explicit apply
  }, [preferRevisedToken]);

  const detailed = useMemo(
    () => applyAcceptedEditsDetailed(paper, findings),
    [paper, findings]
  );

  const displayText = showRevised ? detailed.text : paper.fullText;

  const segs = useMemo(
    () =>
      showRevised
        ? buildRevisedSegments(detailed.text, detailed.applied)
        : buildSegments(paper.fullText.length, findings),
    [showRevised, detailed, paper.fullText.length, findings]
  );

  const pageStarts = useMemo(() => {
    const pages = paper.pages.length
      ? paper.pages
      : [{ pageNumber: 1, startOffset: 0, endOffset: paper.fullText.length }];
    return pages.map((p) => ({
      page: p.pageNumber,
      // Map original page starts; in revised mode approximate via original offsets
      offset: p.startOffset,
    }));
  }, [paper]);

  const openByPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const f of findings) {
      if (f.status !== 'open' || f.isInformational) continue;
      map.set(f.page, (map.get(f.page) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [findings]);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });
    }
  }, [selectedId, showRevised]);

  const jumpToPage = (page: number) => {
    if (showRevised) {
      const hit = detailed.applied.find((a) => a.page === page);
      if (hit) {
        onSelect(hit.findingId);
        return;
      }
    }
    const open = findings.find((f) => f.page === page && f.status === 'open' && !f.isInformational);
    if (open) {
      onSelect(open.id);
      if (showRevised) setShowRevised(false);
      return;
    }
    const el = bodyRef.current?.querySelector(`[data-page-anchor="${page}"]`);
    el?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const bodyNodes = useMemo(() => {
    const nodes: ReactNode[] = [];
    let key = 0;
    const emitted = new Set<number>();

    const emitAnchorAt = (offset: number) => {
      if (showRevised) return;
      for (const p of pageStarts) {
        if (p.offset === offset && !emitted.has(p.page)) {
          emitted.add(p.page);
          nodes.push(pageAnchor(p.page));
        }
      }
    };

    const pushPlainSlice = (from: number, to: number) => {
      const cuts = pageStarts
        .filter((p) => !showRevised && p.offset > from && p.offset < to)
        .sort((a, b) => a.offset - b.offset);
      let pos = from;
      for (const cut of cuts) {
        if (cut.offset > pos) {
          nodes.push(<span key={key++}>{displayText.slice(pos, cut.offset)}</span>);
        }
        emitAnchorAt(cut.offset);
        pos = cut.offset;
      }
      if (pos < to) {
        nodes.push(<span key={key++}>{displayText.slice(pos, to)}</span>);
      }
    };

    emitAnchorAt(0);

    for (const s of segs) {
      emitAnchorAt(s.start);

      if (!s.finding && !s.appliedId) {
        pushPlainSlice(s.start, s.end);
        continue;
      }

      const chunk = displayText.slice(s.start, s.end);

      if (s.appliedId) {
        const cls = [
          'hl',
          'hl-applied',
          selectedId === s.appliedId ? 'hl-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        nodes.push(
          <mark
            key={key++}
            ref={selectedId === s.appliedId ? selectedRef : undefined}
            className={cls}
            title="Applied edit — click to open finding"
            data-id={s.appliedId}
            onClick={() => onSelect(s.appliedId!)}
          >
            {chunk}
          </mark>
        );
        continue;
      }

      const f = s.finding!;
      const cls = [
        'hl',
        CATEGORY_CLASS[f.category] || 'hl-warn',
        f.isInformational ? 'hl-muted' : '',
        f.status !== 'open' ? `hl-${f.status}` : '',
        selectedId === f.id ? 'hl-selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      nodes.push(
        <mark
          key={key++}
          ref={selectedId === f.id ? selectedRef : undefined}
          className={cls}
          title={LABELS[f.category] || f.category}
          data-id={f.id}
          onClick={() => onSelect(f.id)}
        >
          {chunk}
        </mark>
      );
    }

    return nodes;
  }, [segs, displayText, pageStarts, showRevised, selectedId, onSelect]);

  return (
    <div className="paper-view">
      <div className="paper-toolbar">
        <span>
          {paper.pageCount} page{paper.pageCount === 1 ? '' : 's'} · style:{' '}
          <strong>{paper.detectedCitationStyle}</strong> · {paper.references.length} refs ·{' '}
          {paper.citations.length} in-text cites
        </span>
        <div className="paper-toolbar-actions">
          <label
            className="toggle"
            title="Shows accepted grammar fixes and saved rewrites in the manuscript"
          >
            <input
              type="checkbox"
              checked={showRevised}
              disabled={editCount === 0}
              onChange={(e) => setShowRevised(e.target.checked)}
            />
            Revised manuscript{editCount > 0 ? ` (${editCount})` : ''}
          </label>
        </div>
      </div>

      <div className="paper-nav" aria-label="Page navigation">
        <span className="paper-nav-label">Pages</span>
        <div className="page-chips">
          {pageStarts.map(({ page }) => {
            const open = openByPage.find(([p]) => p === page)?.[1] ?? 0;
            return (
              <button
                key={page}
                type="button"
                className={`page-chip${open > 0 ? ' has-open' : ''}`}
                title={
                  open
                    ? `Page ${page} — ${open} finding${open === 1 ? '' : 's'} to review`
                    : `Go to page ${page}`
                }
                onClick={() => jumpToPage(page)}
              >
                {page}
                {open > 0 ? <span className="page-chip-badge">{open}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="page-strip-hint">Dots show pages with findings left to review</span>
      </div>

      <div className="hl-legend" aria-label="Highlight colour legend">
        <span className="hl-legend-title">Highlights</span>
        <span className="hl-legend-item">
          <i className="hl hl-action" aria-hidden /> Citation fix needed
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-cite" aria-hidden /> May need a citation
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-ai" aria-hidden /> AI-writing cue
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-quality" aria-hidden /> Quality
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-grammar" aria-hidden /> Grammar
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-warn" aria-hidden /> Check manually
        </span>
        <span className="hl-legend-item">
          <i className="hl hl-info" aria-hidden /> Informational
        </span>
      </div>

      <article
        ref={bodyRef}
        className={`paper-body ${showRevised ? 'is-revised' : ''}`}
      >
        {bodyNodes}
      </article>
    </div>
  );
}
