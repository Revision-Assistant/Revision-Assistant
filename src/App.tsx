import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { UploadZone, type UploadFiles } from './components/UploadZone';
import { PaperView } from './components/PaperView';
import { FindingsQueue } from './components/FindingsQueue';
import { AuthBar } from './components/AuthBar';
import {
  runPipeline,
  UnsupportedReportFormatError,
} from './lib/pipeline';
import {
  assertUploadFile,
  FileTooLargeError,
  UnsupportedPaperFormatError,
} from './lib/files/limits';
import {
  formatCountdown,
  usePrivacySession,
} from './hooks/usePrivacySession';
import type { AnalysisResult, Finding, PipelineProgress } from './types';
import { exportRevisionPackage, applyAllSafeReplacements } from './lib/export/changeLog';
import { exportWatermarkedPdf } from './lib/export/exportPdf';
import { checkCitationIntegrity } from './lib/citation/guard';
import { saveProject, supabase, supabaseConfigured } from './lib/supabase/client';
import { LegalNotices } from './components/LegalNotices';
import { AnalysisProgress } from './components/AnalysisProgress';
import { ReformatWorkbench } from './components/ReformatWorkbench';
import './App.css';

type AppMode = 'revise' | 'reformat';

const EMPTY_FILES: UploadFiles = {
  paper: null,
  similarity: null,
  ai: null,
  title: '',
  deepCitationCheck: true,
};

function readInitialMode(): AppMode {
  if (typeof window === 'undefined') return 'revise';
  const hash = window.location.hash.replace(/^#\/?/, '');
  return hash.startsWith('reformat') ? 'reformat' : 'revise';
}

interface ExportMenuProps {
  onExportLog: () => void;
  onExportPdf: () => void;
  pdfHint: string;
  exporting: boolean;
}

function ExportMenu({ onExportLog, onExportPdf, pdfHint, exporting }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Focus the first menu item so arrow-key navigation works immediately
    const first = wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(
      wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
    );
    if (items.length === 0) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = idx <= 0 ? items.length - 1 : idx - 1;
    else if (e.key === 'End') next = items.length - 1;
    items[next].focus();
  };

  return (
    <div className="export-menu" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={exporting}
        onClick={() => setOpen((v) => !v)}
      >
        {exporting ? 'Exporting…' : 'Export'}
        <span className="export-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="export-menu-panel" role="menu" onKeyDown={onMenuKeyDown}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onExportLog();
            }}
          >
            <strong>Change log + revised text</strong>
            <span>
              .txt of the revised manuscript and a Markdown decision log — handy for pasting
              accepted edits back into your Word or LaTeX source
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={exporting}
            onClick={() => {
              close();
              onExportPdf();
            }}
          >
            <strong>PDF + revision instructions</strong>
            <span>{pdfHint}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<AppMode>(readInitialMode);
  const [files, setFiles] = useState<UploadFiles>(EMPTY_FILES);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [citationStyle, setCitationStyle] = useState<string>('unknown');
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [preferRevisedToken, setPreferRevisedToken] = useState(0);
  const [applyAllMsg, setApplyAllMsg] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [reformatKey, setReformatKey] = useState(0);
  const [reformatHasData, setReformatHasData] = useState(false);
  const analyzeGenRef = useRef(0);

  const onSession = useCallback((u: User | null, s: Session | null) => {
    setUser(u);
    setSession(s);
  }, []);

  const wipeSensitive = useCallback(() => {
    analyzeGenRef.current += 1;
    setFiles(EMPTY_FILES);
    setResult(null);
    setFindings([]);
    setSelectedId(null);
    setProgress(null);
    setProjectId(null);
    setError(null);
    setApplyAllMsg(null);
    setBusy(false);
    setReformatKey((k) => k + 1);
    setReformatHasData(false);
    setPrivacyNotice(
      'Session cleared for privacy. Uploaded files and analysis results were removed after 10 minutes without activity. Export your change log before that if you need a record.'
    );
  }, []);

  const hasSensitiveData = Boolean(
    files.paper ||
      files.similarity ||
      files.ai ||
      result ||
      findings.length > 0 ||
      reformatHasData
  );

  useEffect(() => {
    const onHash = () => setMode(readInitialMode());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { secondsRemaining, markActive } = usePrivacySession({
    hasSensitiveData,
    onWipe: wipeSensitive,
  });

  const switchMode = (next: AppMode) => {
    setMode(next);
    if (typeof window !== 'undefined') {
      window.location.hash = next === 'reformat' ? '/reformat' : '/revise';
    }
    markActive();
  };

  const analyze = async () => {
    if (!files.paper) return;
    const gen = ++analyzeGenRef.current;
    setBusy(true);
    setError(null);
    setPrivacyNotice(null);
    setResult(null);
    setFindings([]);
    setProjectId(null);
    setApplyAllMsg(null);
    try {
      assertUploadFile(files.paper, 'paper');
      if (files.similarity) assertUploadFile(files.similarity, 'similarity');
      if (files.ai) assertUploadFile(files.ai, 'ai');

      const paperFile = await files.paper.arrayBuffer();
      const paperIsDocx = files.paper.name.toLowerCase().endsWith('.docx');
      const similarityPdf = files.similarity
        ? await files.similarity.arrayBuffer()
        : null;
      const aiPdf = files.ai ? await files.ai.arrayBuffer() : null;
      const title = files.title || files.paper.name.replace(/\.(pdf|docx)$/i, '');

      const res = await runPipeline(
        {
          paperFile,
          paperIsDocx,
          similarityPdf,
          aiPdf,
          title,
          requestLlm: true,
          requestGrammar: true,
          requestCitationModel: true,
          requestQualityModel: true,
          accessToken: session?.access_token,
        },
        (p) => {
          if (analyzeGenRef.current === gen) setProgress(p);
        }
      );

      if (analyzeGenRef.current !== gen) return;

      // Drop File handles only after a successful run so retries keep the uploads.
      setFiles((prev) => ({
        ...prev,
        paper: null,
        similarity: null,
        ai: null,
      }));

      setResult(res);
      setFindings(res.findings);
      setCitationStyle(res.paper.detectedCitationStyle);
      setSelectedId(res.findings.find((f) => !f.isInformational)?.id ?? res.findings[0]?.id ?? null);

      if (user && supabase) {
        const id = await saveProject(user.id, res.meta, res.findings);
        if (analyzeGenRef.current === gen) setProjectId(id);
      }
    } catch (e) {
      if (analyzeGenRef.current !== gen) return;
      if (
        e instanceof UnsupportedReportFormatError ||
        e instanceof FileTooLargeError ||
        e instanceof UnsupportedPaperFormatError
      ) {
        setError(e.message);
      } else if (
        e instanceof RangeError ||
        (e instanceof Error && /out of memory|allocation|Array buffer/i.test(e.message))
      ) {
        setError(
          'This file is too large for the browser to parse in memory. Compress the PDF, export fewer pages from your similarity report, or save the Word document as a smaller .docx without embedded images, then try again.'
        );
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setProgress({ stage: 'error', message: 'Failed', percent: 0 });
    } finally {
      if (analyzeGenRef.current === gen) setBusy(false);
    }
  };

  const onUpdateFinding = (id: string, patch: Partial<Finding>) => {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    if (patch.editedText != null && (patch.status === 'accepted' || patch.status === 'edited')) {
      setPreferRevisedToken((n) => n + 1);
    }
  };

  const applyAllFixes = () => {
    if (
      fixableCount > 0 &&
      !window.confirm(
        `Apply ${fixableCount} grammar/style fix${fixableCount === 1 ? '' : 'es'}? Each applied fix can be reopened individually afterwards (turn on "Show reviewed").`
      )
    ) {
      return;
    }
    const { next, applied, skipped } = applyAllSafeReplacements(findings);
    setFindings(next);
    if (applied > 0) setPreferRevisedToken((n) => n + 1);
    setApplyAllMsg(
      applied === 0 && skipped === 0
        ? 'No open grammar-style fixes with a ready replacement.'
        : `Applied ${applied} fix${applied === 1 ? '' : 'es'}${skipped ? ` · skipped ${skipped} (citation risk)` : ''}.`
    );
  };

  const fixableCount = findings.filter(
    (f) => f.status === 'open' && f.replacementText && checkCitationIntegrity(f.text, f.replacementText).ok
  ).length;

  const doExport = () => {
    if (!result) return;
    exportRevisionPackage(result.meta.title, result.paper, findings, {
      similarityPct: result.meta.similarityPct,
      aiPct: result.meta.aiPct,
    });
  };

  const doExportPdf = async () => {
    if (!result || exportingPdf) return;
    setExportingPdf(true);
    try {
      const info = await exportWatermarkedPdf({
        title: result.meta.title,
        paper: result.paper,
        findings,
        sourceBytes: result.sourceBytes,
        sourceKind: result.sourceKind,
      });
      setApplyAllMsg(info.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingPdf(false);
    }
  };

  const reset = () => {
    const unexported = findings.some((f) => f.status !== 'open');
    if (
      result &&
      !window.confirm(
        unexported
          ? 'Start over? Your analysis and the edits you have made will be discarded unless you exported them.'
          : 'Start over? This clears the current analysis.'
      )
    ) {
      return;
    }
    analyzeGenRef.current += 1;
    setBusy(false);
    setResult(null);
    setFindings([]);
    setSelectedId(null);
    setProgress(null);
    setError(null);
    setProjectId(null);
    setFiles(EMPTY_FILES);
    setPrivacyNotice(null);
    setApplyAllMsg(null);
  };

  const openCount = findings.filter((f) => !f.isInformational && f.status === 'open').length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            RA
          </span>
          <div>
            <strong>Revision Assistant</strong>
            <span className="sub">Manuscript review for researchers</span>
          </div>
        </div>
        <nav className="mode-switch" aria-label="App mode">
          <button
            type="button"
            className={mode === 'revise' ? 'active' : undefined}
            aria-pressed={mode === 'revise'}
            onClick={() => switchMode('revise')}
          >
            Revise
          </button>
          <button
            type="button"
            className={mode === 'reformat' ? 'active' : undefined}
            aria-pressed={mode === 'reformat'}
            onClick={() => switchMode('reformat')}
          >
            Reformat
          </button>
        </nav>
        {supabaseConfigured ? <AuthBar onSession={onSession} /> : null}
      </header>

      {hasSensitiveData && secondsRemaining != null && (
        <div
          className={`privacy-banner${secondsRemaining <= 120 ? ' warn' : ''}`}
          role="status"
        >
          {secondsRemaining <= 120 ? (
            <>
              <span>
                Privacy wipe in {formatCountdown(secondsRemaining)} — export your change log if
                you still need it.
              </span>
              <button type="button" className="linkish" onClick={markActive}>
                I&apos;m still working — keep session
              </button>
            </>
          ) : (
            `In-browser session · auto-clears after 10 min idle (${formatCountdown(secondsRemaining)})`
          )}
        </div>
      )}
      {privacyNotice && (
        <div className="privacy-banner wiped" role="status">
          <span>{privacyNotice}</span>
          <button type="button" className="linkish" onClick={() => setPrivacyNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {mode === 'reformat' ? (
        <ReformatWorkbench
          key={reformatKey}
          onActivity={markActive}
          onSensitiveChange={setReformatHasData}
        />
      ) : (
        <>
          {!result && (
            <>
              {!busy && !files.paper && (
                <section className="mode-doors" aria-label="Choose a starting path">
                  <button type="button" className="mode-door active" onClick={() => switchMode('revise')}>
                    <span className="mode-door-label">Revise a manuscript</span>
                    <span className="mode-door-desc">
                      Align similarity / AI reports, fix grammar and citations, export a change log.
                    </span>
                  </button>
                  <button type="button" className="mode-door" onClick={() => switchMode('reformat')}>
                    <span className="mode-door-label">Reformat for resubmission</span>
                    <span className="mode-door-desc">
                      Restyle references and get a venue checklist. Researchers report a median 14
                      hours formatting per manuscript.
                    </span>
                  </button>
                </section>
              )}
              <UploadZone
                files={files}
                onChange={setFiles}
                onAnalyze={analyze}
                busy={busy}
                error={error}
              />
              {busy && progress && <AnalysisProgress progress={progress} />}
              {!busy && (
                <section className="scope">
                  <h2>What this session covers</h2>
                  <p className="scope-lede">
                    One careful pass — you decide every wording change.
                  </p>
                  <ul className="scope-list">
                    <li>
                      <strong>Grammar &amp; style</strong> — LanguageTool suggestions with{' '}
                      <em>Apply all fixes</em> when replacements are citation-safe.
                    </li>
                    <li>
                      <strong>Similarity alignment</strong> — optional originality PDF mapped onto
                      your manuscript with citation / restatement guidance.
                    </li>
                    <li>
                      <strong>AI-writing cues</strong> — optional AI report, or light local heuristics;
                      <em> Draft rewrite</em> / <em>Draft all</em> then Accept (no silent rewrite).
                    </li>
                    <li>
                      <strong>Citation gaps</strong> — claims that may need attribution even when no
                      similarity match appears (local citation-need model).
                    </li>
                    <li>
                      <strong>Manuscript quality</strong> — local model flags ambiguous numerical
                      phrasing, common publication-craft issues, and unsubstantiated novelty{' '}
                      <em>claims</em>, plus a rule pass for conflicting quantities (same metric,
                      different values). Not a literature search or formal stats review. Review under
                      the Quality filter in the workspace.
                    </li>
                    <li>
                      <strong>Journal readiness</strong> — heuristic Q1-like / Q2-like checklist bars
                      and an IEEE-oriented craft score from structure + open findings, with a clear
                      score breakdown, example venue suggestions, and a downloadable PDF. Not peer
                      review, not a real quartile, and not affiliated with IEEE or ranking databases.
                    </li>
                    <li>
                      <strong>Resubmission reformatter</strong> — switch to{' '}
                      <em>Reformat</em> to restyle the bibliography for a new venue and export a
                      requirements checklist (manuscript stays in-browser).
                    </li>
                    <li>
                      <strong>Export</strong> — revised .txt / change log, plus PDF in your{' '}
                      <em>original page layout</em> (when the manuscript is a PDF) with watermark.
                    </li>
                  </ul>
                  <p className="scope-note">
                    Not a score optimiser, not a silent rewriter, and not affiliated with any
                    commercial plagiarism or AI-detection vendor. You remain responsible for every
                    wording decision. See the footer for privacy and third-party attributions.
                  </p>
                </section>
              )}
            </>
          )}

          {result && (
            <div className="workspace">
              <div className="workspace-bar">
                <div className="workspace-title-block">
                  <p className="workspace-kicker">Revision workspace</p>
                  <h2>{result.meta.title}</h2>
                  <p className="muted workspace-meta">
                    {openCount === 0
                      ? 'All findings reviewed — ready to export'
                      : `${openCount} finding${openCount === 1 ? '' : 's'} left to review`}
                    {projectId ? ' · saved to cloud' : ''}
                  </p>
                </div>
                <div className="workspace-actions">
                  <label className="style-select">
                    Citation style
                    <select
                      value={citationStyle}
                      onChange={(e) => {
                        setCitationStyle(e.target.value);
                        if (result) {
                          result.paper.detectedCitationStyle = e.target
                            .value as typeof result.paper.detectedCitationStyle;
                        }
                      }}
                    >
                      <option value="IEEE">IEEE</option>
                      <option value="APA">APA</option>
                      <option value="Harvard">Harvard</option>
                      <option value="Vancouver">Vancouver</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="primary"
                    disabled={fixableCount === 0}
                    title="Grammar and style only — applies each suggested replacement that does not remove a citation. Never rewrites flagged similarity or AI passages."
                    onClick={applyAllFixes}
                  >
                    {fixableCount > 0
                      ? `Apply ${fixableCount} safe grammar fix${fixableCount === 1 ? '' : 'es'}`
                      : 'Apply safe grammar fixes'}
                  </button>
                  <ExportMenu
                    onExportLog={doExport}
                    onExportPdf={() => void doExportPdf()}
                    pdfHint={
                      result.sourceKind === 'pdf'
                        ? 'Original page layout with watermark, plus a PDF listing each edit'
                        : 'Reflowed PDF (upload a PDF manuscript to preserve layout), plus edit list'
                    }
                    exporting={exportingPdf}
                  />
                  <button type="button" className="ghost" onClick={reset}>
                    Start over
                  </button>
                </div>
              </div>
              {applyAllMsg && (
                <p className="apply-all-msg" role="status">
                  {applyAllMsg}{' '}
                  <button type="button" className="linkish" onClick={() => setApplyAllMsg(null)}>
                    Dismiss
                  </button>
                </p>
              )}

              <div className="split">
                <PaperView
                  paper={result.paper}
                  findings={findings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  preferRevisedToken={preferRevisedToken}
                />
                <FindingsQueue
                  findings={findings}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onUpdate={onUpdateFinding}
                  similarityPct={result.meta.similarityPct}
                  aiPct={result.meta.aiPct}
                  citationStyle={citationStyle}
                  accessToken={session?.access_token}
                  onHumanizeMessage={(msg) => setApplyAllMsg(msg)}
                  paper={result.paper}
                  paperTitle={result.meta.title}
                />
              </div>
            </div>
          )}
        </>
      )}

      <LegalNotices />
    </div>
  );
}
