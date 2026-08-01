import { useCallback, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { UploadZone, type UploadFiles } from './components/UploadZone';
import { PaperView } from './components/PaperView';
import { FindingsQueue } from './components/FindingsQueue';
import { AuthBar } from './components/AuthBar';
import {
  runPipeline,
  UnsupportedReportFormatError,
} from './lib/pipeline';
import type { AnalysisResult, Finding, PipelineProgress } from './types';
import { exportRevisionPackage } from './lib/export/changeLog';
import { exportTrainingData } from './lib/export/trainingData';
import { saveProject, supabase } from './lib/supabase/client';
import './App.css';

export default function App() {
  const [files, setFiles] = useState<UploadFiles>({
    paper: null,
    similarity: null,
    ai: null,
    title: '',
    deepCitationCheck: true,
  });
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

  const onSession = useCallback((u: User | null, s: Session | null) => {
    setUser(u);
    setSession(s);
  }, []);

  const analyze = async () => {
    if (!files.paper) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setFindings([]);
    setProjectId(null);
    try {
      const paperFile = await files.paper.arrayBuffer();
      const paperIsDocx = files.paper.name.toLowerCase().endsWith('.docx');
      const similarityPdf = files.similarity
        ? await files.similarity.arrayBuffer()
        : null;
      const aiPdf = files.ai ? await files.ai.arrayBuffer() : null;

      const res = await runPipeline(
        {
          paperFile,
          paperIsDocx,
          similarityPdf,
          aiPdf,
          title: files.title || files.paper.name.replace(/\.(pdf|docx)$/i, ''),
          requestLlm: true,
          requestGrammar: true,
          requestCitationModel: true,
          accessToken: session?.access_token,
        },
        setProgress
      );

      setResult(res);
      setFindings(res.findings);
      setCitationStyle(res.paper.detectedCitationStyle);
      setSelectedId(res.findings.find((f) => !f.isInformational)?.id ?? res.findings[0]?.id ?? null);

      if (user && supabase) {
        const id = await saveProject(user.id, res.meta, res.findings);
        setProjectId(id);
      }
    } catch (e) {
      if (e instanceof UnsupportedReportFormatError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setProgress({ stage: 'error', message: 'Failed', percent: 0 });
    } finally {
      setBusy(false);
    }
  };

  const onUpdateFinding = (id: string, patch: Partial<Finding>) => {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const doExport = () => {
    if (!result) return;
    exportRevisionPackage(
      result.meta.title,
      result.paper,
      findings,
      {
        similarityPct: result.meta.similarityPct,
        aiPct: result.meta.aiPct,
      }
    );
  };

  const reset = () => {
    setResult(null);
    setFindings([]);
    setSelectedId(null);
    setProgress(null);
    setError(null);
    setProjectId(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">RA</span>
          <div>
            <strong>Revision Assistant</strong>
            <span className="sub">Academic writing repair for any manuscript</span>
          </div>
        </div>
        <AuthBar onSession={onSession} />
      </header>

      {!result && (
        <>
          <UploadZone
            files={files}
            onChange={setFiles}
            onAnalyze={analyze}
            busy={busy}
            error={error}
          />
          {busy && progress && (
            <div className="progress-wrap">
              <div className="progress-bar">
                <div style={{ width: `${progress.percent}%` }} />
              </div>
              <p>
                {progress.message}{' '}
                <span className="muted">({progress.stage})</span>
              </p>
            </div>
          )}
          <section className="principles">
            <div className="principles-head">
              <h2>What this tool does — and refuses to do</h2>
              <p className="principles-sub">
                Built for any academic manuscript. Local models assist; you approve every
                change before it lands in the paper.
              </p>
            </div>
            <div className="principle-grid">
              <article>
                <span className="principle-kicker">Language</span>
                <h3>Grammar</h3>
                <p>
                  Detect and apply reviewable fixes for agreement, articles, tense, and
                  academic tone — including domain terms and units that generic checkers
                  often flag wrongly.
                </p>
                <p className="no">Not silent full-paragraph rewrites you never see.</p>
              </article>
              <article>
                <span className="principle-kicker">Similarity</span>
                <h3>Plagiarism</h3>
                <p>
                  Align Turnitin matches to your manuscript, diagnose each flag, and add
                  correct citations or guide you to restate the passage yourself.
                </p>
                <p className="no">Not synonym-swapping to game a similarity score.</p>
              </article>
              <article>
                <span className="principle-kicker">Voice</span>
                <h3>AI flags</h3>
                <p>
                  Explain machine-like patterns — sentence-length uniformity, hedging,
                  formulaic transitions — so you can revise in your own voice.
                </p>
                <p className="no">Not optimizing text against a detector.</p>
              </article>
            </div>
            <div className="model-strip" aria-label="Supported capabilities">
              <div className="model-chip">
                <span className="chip-status">Supported</span>
                <span className="chip-title">Grammar</span>
                <span className="chip-meta">LanguageTool (public) + domain filters</span>
              </div>
              <div className="model-chip">
                <span className="chip-status">Supported</span>
                <span className="chip-title">Plagiarism</span>
                <span className="chip-meta">Turnitin similarity PDF → aligned, categorized findings</span>
              </div>
              <div className="model-chip ai">
                <span className="chip-status">Supported</span>
                <span className="chip-title">AI flags</span>
                <span className="chip-meta">Your AI report or local voice diagnostics</span>
              </div>
              <div className="model-chip">
                <span className="chip-status">Supported</span>
                <span className="chip-title">Citation-need</span>
                <span className="chip-meta">SciBERT from free HF hosting (or rules)</span>
              </div>
              <div className="model-chip ai">
                <span className="chip-status">Supported</span>
                <span className="chip-title">LLM explain</span>
                <span className="chip-meta">Free-tier Groq / Gemini / OpenRouter via Netlify</span>
              </div>
            </div>
          </section>
        </>
      )}

      {result && (
        <div className="workspace">
          <div className="workspace-bar">
            <div>
              <h2>{result.meta.title}</h2>
              <p className="muted">
                {findings.filter((f) => !f.isInformational && f.status === 'open').length} open
                actionable · {findings.filter((f) => f.isInformational).length} informational
                {projectId ? ` · saved ${projectId.slice(0, 8)}…` : ''}
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
              <button type="button" className="primary" onClick={doExport}>
                Export revised + change log
              </button>
              <button
                type="button"
                title="Your accept/dismiss decisions as JSONL — training data for training/false_positive_classifier.ipynb"
                onClick={() => {
                  if (!result) return;
                  const n = exportTrainingData(result.meta, result.paper, findings);
                  if (n === 0) {
                    alert('No decisions recorded yet — accept or dismiss some findings first.');
                  }
                }}
              >
                Export training labels
              </button>
              <button type="button" className="ghost" onClick={reset}>
                New analysis
              </button>
            </div>
          </div>

          <div className="split">
            <PaperView
              paper={result.paper}
              findings={findings}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <FindingsQueue
              findings={findings}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUpdate={onUpdateFinding}
              similarityPct={result.meta.similarityPct}
              aiPct={result.meta.aiPct}
            />
          </div>
        </div>
      )}

      <footer className="site-footer">
        <p>
          Parsing happens in-browser. Files are never uploaded to our servers. Findings JSON
          only is stored when you sign in. This is a revision assistant, not a score-reduction
          service. Check your institution&apos;s policy before using Turnitin reports with any
          third-party tool.
        </p>
      </footer>
    </div>
  );
}
