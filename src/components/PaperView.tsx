import { useEffect, useMemo, useRef, useState } from 'react';
import type { Finding, ParsedPaper } from '../types';
import { applyAcceptedEdits } from '../lib/export/changeLog';

interface Props {
  paper: ParsedPaper;
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
};

interface Seg {
  start: number;
  end: number;
  finding?: Finding;
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

export function PaperView({ paper, findings, selectedId, onSelect }: Props) {
  const selectedRef = useRef<HTMLElement | null>(null);
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

  const revisedText = useMemo(
    () => (showRevised ? applyAcceptedEdits(paper, findings) : paper.fullText),
    [showRevised, paper, findings]
  );

  const segs = useMemo(
    () => (showRevised ? [] : buildSegments(paper.fullText.length, findings)),
    [showRevised, paper.fullText, findings]
  );

  useEffect(() => {
    if (!showRevised && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedId, showRevised]);

  return (
    <div className="paper-view">
      <div className="paper-toolbar">
        <span>
          {paper.pageCount} page{paper.pageCount === 1 ? '' : 's'} · style:{' '}
          <strong>{paper.detectedCitationStyle}</strong> · {paper.references.length} refs ·{' '}
          {paper.citations.length} in-text cites
        </span>
        <label className="toggle" title="Applies accepted grammar fixes and saved rewrites into the preview">
          <input
            type="checkbox"
            checked={showRevised}
            disabled={editCount === 0}
            onChange={(e) => setShowRevised(e.target.checked)}
          />
          Show revised{editCount > 0 ? ` (${editCount})` : ''}
        </label>
      </div>
      <article className={`paper-body ${showRevised ? 'is-revised' : ''}`}>
        {showRevised ? (
          <span>{revisedText}</span>
        ) : (
          segs.map((s, i) => {
            const chunk = paper.fullText.slice(s.start, s.end);
            if (!s.finding) return <span key={i}>{chunk}</span>;
            const f = s.finding;
            const cls = [
              'hl',
              CATEGORY_CLASS[f.category] || 'hl-warn',
              f.isInformational ? 'hl-muted' : '',
              f.status !== 'open' ? `hl-${f.status}` : '',
              selectedId === f.id ? 'hl-selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <mark
                key={i}
                ref={selectedId === f.id ? selectedRef : undefined}
                className={cls}
                title={f.category}
                data-id={f.id}
                onClick={() => onSelect(f.id)}
              >
                {chunk}
              </mark>
            );
          })
        )}
      </article>
    </div>
  );
}
