import { useEffect, useMemo, useState } from 'react';
import type { Finding, ParsedPaper } from '../types';
import { scoreReadiness, type JournalSuggestion, type ReadinessResult } from '../lib/journal/scoreReadiness';
import { exportJournalReadinessPdf } from '../lib/journal/exportReadinessPdf';
import { scoreJournalModelSignals } from '../lib/journal/journalReadinessModel';
import {
  requestJournalSuggestions,
  type LlmVenueSuggestion,
} from '../lib/journal/journalSuggestClient';

interface Props {
  paper: ParsedPaper;
  findings: Finding[];
  title: string;
  similarityPct: number | null;
  aiPct: number | null;
  accessToken?: string | null;
  onSelectFinding?: (id: string) => void;
}

function abstractSnippet(paper: ParsedPaper): string {
  const abs = paper.sections.find((s) => s.name === 'Abstract');
  if (abs) {
    return paper.fullText.slice(abs.startOffset, Math.min(abs.endOffset, abs.startOffset + 1200));
  }
  return paper.fullText.slice(0, 1200);
}

function mergeSuggestions(
  local: JournalSuggestion[],
  llm: LlmVenueSuggestion[]
): JournalSuggestion[] {
  const out: JournalSuggestion[] = local.map((j) => ({ ...j, source: j.source || 'heuristic' }));
  const seen = new Set(out.map((j) => j.name.toLowerCase()));
  for (const s of llm) {
    const key = s.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: s.name,
      publisherHint: s.openAccessHint || 'LLM open-venue idea (verify yourself)',
      reason: s.reason,
      confidence: s.confidence,
      caution: s.caution,
      matchKeywords: [],
      source: 'llm',
    });
  }
  return out.slice(0, 15);
}

export function JournalReadiness({
  paper,
  findings,
  title,
  similarityPct,
  aiPct,
  accessToken,
  onSelectFinding,
}: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [modelBoost, setModelBoost] = useState<{
    available: boolean;
    source?: 'hub' | 'local' | 'none';
    q1Boost?: number;
    q2Boost?: number;
    ieeeBoost?: number;
  } | null>(null);
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle');
  const [llmRows, setLlmRows] = useState<LlmVenueSuggestion[]>([]);
  const [llmThemes, setLlmThemes] = useState<string[]>([]);
  const [llmMsg, setLlmMsg] = useState<string | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);

  const lead = useMemo(() => `${title}\n${abstractSnippet(paper)}`, [title, paper]);

  useEffect(() => {
    let cancelled = false;
    setModelStatus('loading');
    void scoreJournalModelSignals(lead).then((sig) => {
      if (cancelled) return;
      if (sig.available) {
        setModelBoost(sig);
        setModelStatus('ready');
      } else {
        setModelBoost(null);
        setModelStatus('none');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lead]);

  const base: ReadinessResult = useMemo(
    () =>
      scoreReadiness(paper, findings, {
        title,
        similarityPct,
        aiPct,
        model: modelBoost,
      }),
    [paper, findings, title, similarityPct, aiPct, modelBoost]
  );

  const readiness: ReadinessResult = useMemo(
    () => ({
      ...base,
      journalSuggestions: mergeSuggestions(base.journalSuggestions, llmRows),
    }),
    [base, llmRows]
  );

  const onExport = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const name = await exportJournalReadinessPdf({ title, readiness });
      setExportMsg(`Downloaded \`${name}\`.`);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const refreshLlm = async (force = true) => {
    setLlmBusy(true);
    setLlmMsg(null);
    try {
      const res = await requestJournalSuggestions({
        title,
        abstract: abstractSnippet(paper),
        fields: readiness.fieldGuess,
        accessToken,
        force,
      });
      setLlmRows(res.suggestions);
      setLlmThemes(res.themes);
      if (res.error && !res.suggestions.length) {
        setLlmMsg(res.error);
      } else {
        setLlmMsg(
          res.cached
            ? 'Showing cached open-venue refresh (session).'
            : res.disclaimer
        );
      }
    } catch (e) {
      setLlmMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLlmBusy(false);
    }
  };

  return (
    <div className="journal-readiness">
      <header className="jr-header">
        <p className="jr-kicker">Journal readiness</p>
        <h3>Heuristic publishability signals</h3>
        <p className="jr-disclaimer">
          Scores below are <strong>heuristic estimates</strong> from manuscript signals —{' '}
          <strong>not</strong> peer review, <strong>not</strong> affiliated with IEEE, Elsevier,
          Clarivate, or Scimago, and they <strong>do not guarantee</strong> acceptance or indexing
          quartile. “Q1-like / Q2-like” means an internal checklist bar, not a real quartile rank.
        </p>
        <p className="jr-model-status muted">
          {modelStatus === 'loading' && 'Loading optional local readiness model…'}
          {modelStatus === 'ready' &&
            `Local readiness model active (${modelBoost?.source || 'hub'}) — adjusts checklist bars only.`}
          {modelStatus === 'none' &&
            'Local readiness model unavailable — pure structure/findings heuristics.'}
        </p>
      </header>

      <div className="jr-scores" role="group" aria-label="Readiness scores">
        <ScoreCard
          label="Q1-like bar"
          value={readiness.q1LikeScore}
          hint="Stricter internal checklist"
        />
        <ScoreCard
          label="Q2-like bar"
          value={readiness.q2LikeScore}
          hint="More lenient internal checklist"
        />
        <ScoreCard
          label="IEEE-oriented"
          value={readiness.ieeeScore}
          hint="Engineering/CS craft heuristic — weigh it lightly outside those fields; not IEEE affiliation"
        />
      </div>

      <p className="jr-summary">{readiness.summary}</p>
      <p className="jr-fields muted">Inferred fields: {readiness.fieldGuess.join(', ')}</p>

      {readiness.scoreBreakdown.length > 0 && (
        <section className="jr-section jr-breakdown-section">
          <h4>Score breakdown</h4>
          <p className="jr-note">
            What raised or lowered each bar. Deltas are approximate checklist points before
            clamping to 0–100 — not acceptance odds.
          </p>
          <ul className="jr-breakdown">
            {readiness.scoreBreakdown.map((b) => (
              <li key={b.id} className={`effect-${b.effect}`}>
                <span className="jr-bd-effect" aria-hidden>
                  {b.effect === 'raised' ? '+' : '−'}
                </span>
                <div>
                  <strong>{b.label}</strong>
                  <p className="jr-bd-deltas">
                    Q1-like {fmtDelta(b.q1Delta)} · Q2-like {fmtDelta(b.q2Delta)} · IEEE{' '}
                    {fmtDelta(b.ieeeDelta)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="jr-actions">
        <button
          type="button"
          className="primary"
          disabled={exporting}
          onClick={() => void onExport()}
        >
          {exporting ? 'Generating…' : 'Generate journal-readiness PDF'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={llmBusy}
          onClick={() => void refreshLlm(true)}
          title="Sends title + abstract snippet only (never the full PDF)"
        >
          {llmBusy ? 'Refreshing…' : 'Refresh open-venue suggestions'}
        </button>
        {exportMsg && (
          <p className="jr-export-msg" role="status">
            {exportMsg}
          </p>
        )}
        {llmMsg && (
          <p className="jr-export-msg" role="status">
            {llmMsg}
          </p>
        )}
      </div>

      {llmThemes.length > 0 && (
        <p className="jr-themes muted">
          Open themes (LLM): {llmThemes.join(' · ')}
        </p>
      )}

      <section className="jr-section">
        <h4>Checklist mapping</h4>
        <p className="jr-note">{readiness.mappingNote}</p>
        <ul className="jr-checklist">
          {readiness.checklist.map((c) => (
            <li key={c.id} className={c.passed ? 'pass' : 'gap'}>
              <span className="jr-check-mark" aria-hidden>
                {c.passed ? '✓' : '○'}
              </span>
              <div>
                <strong>{c.label}</strong>
                <p>{c.note}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="jr-section">
        <h4>What to correct</h4>
        {readiness.gaps.length === 0 ? (
          <p className="muted">No priority gaps from current open findings and structure heuristics.</p>
        ) : (
          <ul className="jr-gaps">
            {readiness.gaps.map((g) => (
              <li key={g.id} className={`sev-${g.severity}`}>
                <div className="jr-gap-head">
                  <span className="jr-sev">{g.severity}</span>
                  <strong>{g.title}</strong>
                </div>
                <p>{g.detail}</p>
                {g.relatedFindingIds.length > 0 && onSelectFinding && (
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onSelectFinding(g.relatedFindingIds[0])}
                  >
                    Jump to related finding
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="jr-section jr-venues-section">
        <h4>Suggested venues</h4>
        <p className="jr-note">
          Merged curated heuristics + optional LLM open-venue refresh. Each row shows its source.
          Confidence is low or medium only — never a claim that a journal will accept the paper.
        </p>
        {readiness.journalSuggestions.length === 0 ? (
          <p className="jr-venues-empty" role="status">
            No venue rows yet — re-run analysis with a manuscript title/abstract, or use Refresh
            open-venue suggestions. Local catalog should normally fill this list automatically.
          </p>
        ) : (
          <ul className="jr-venues">
            {readiness.journalSuggestions.map((j) => (
              <li key={`${j.source}-${j.name}`}>
                <div className="jr-venue-head">
                  <strong className="jr-venue-name">{j.name}</strong>
                  <span className={`jr-conf conf-${j.confidence}`}>{j.confidence} confidence</span>
                  <span className={`jr-source src-${j.source || 'heuristic'}`}>
                    {j.source === 'llm'
                      ? 'LLM refresh'
                      : j.source === 'local_model'
                        ? 'Local model'
                        : 'Local heuristic'}
                  </span>
                </div>
                <p className="jr-venue-publisher">{j.publisherHint}</p>
                <p className="jr-venue-reason">
                  <span className="jr-why-label">Why fit</span>
                  {j.reason}
                </p>
                {j.matchKeywords.length > 0 && (
                  <p className="jr-venue-kws muted">
                    Tokens: {j.matchKeywords.slice(0, 6).join(' · ')}
                  </p>
                )}
                {j.caution && <p className="jr-caution">{j.caution}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  const tone = value >= 75 ? 'ok' : value >= 55 ? 'mid' : 'low';
  return (
    <div
      className={`jr-score-card tone-${tone}`}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} — ${hint}`}
    >
      <p className="jr-score-label">{label}</p>
      <p className="jr-score-value">
        {value}
        <span>/100</span>
      </p>
      <p className="jr-score-hint">{hint}</p>
    </div>
  );
}

function fmtDelta(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `+${r}`;
  if (r < 0) return `${r}`;
  return '0';
}
