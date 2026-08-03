import { useCallback, useRef, useState } from 'react';
import {
  assertUploadFile,
  formatBytes,
  PAPER_MAX_BYTES,
  REPORT_MAX_BYTES,
  sizeWarning,
  type UploadKind,
} from '../lib/files/limits';

export interface UploadFiles {
  paper: File | null;
  similarity: File | null;
  ai: File | null;
  title: string;
  /** Pipeline always runs deep citation; kept for type compatibility */
  deepCitationCheck: boolean;
}

interface Props {
  files: UploadFiles;
  onChange: (f: UploadFiles | ((prev: UploadFiles) => UploadFiles)) => void;
  onAnalyze: () => void;
  busy: boolean;
  error: string | null;
}

function FileSlot({
  label,
  hint,
  required,
  file,
  onFile,
  disabled,
  acceptedExts = ['.pdf'],
  kind,
  onReject,
}: {
  label: string;
  hint: string;
  required?: boolean;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  acceptedExts?: string[];
  kind: UploadKind;
  onReject: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const warn = file ? sizeWarning(file, kind) : null;

  const accept = (f: File | null) => {
    if (!f) {
      onFile(null);
      return;
    }
    const name = f.name.toLowerCase();
    if (!acceptedExts.some((ext) => name.endsWith(ext))) {
      if (kind === 'paper' && name.endsWith('.doc') && !name.endsWith('.docx')) {
        onReject(
          'Old .doc Word files are not supported. Save As / Download as .docx, then upload again.'
        );
        return;
      }
      onReject(`${acceptedExts.join(' or ')} only.`);
      return;
    }
    try {
      assertUploadFile(f, kind);
    } catch (e) {
      onReject(e instanceof Error ? e.message : String(e));
      return;
    }
    onFile(f);
  };

  return (
    <div
      className={`slot ${drag ? 'drag' : ''} ${file ? 'has-file' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the slot (not a child element)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (disabled) return;
        accept(e.dataTransfer.files?.[0] || null);
      }}
      onClick={(e) => {
        // Pointer convenience only — keyboard users have the explicit Browse button,
        // so the container itself must not be a (nested) interactive control.
        // Once a file is chosen, only Clear replaces it (avoid surprise re-open of the picker).
        if (disabled || file) return;
        if ((e.target as HTMLElement).closest('button')) return;
        inputRef.current?.click();
      }}
    >
      <div className="slot-label">
        {label}
        {required ? <span className="req"> required</span> : <span className="opt"> optional</span>}
      </div>
      <div className="slot-hint">{hint}</div>
      <div className="slot-file">
        {file ? (
          <>
            <span className="fname">{file.name}</span>
            <span className="fsize">{formatBytes(file.size)}</span>
            <button
              type="button"
              className="linkish"
              disabled={disabled}
              aria-label={`Clear ${label.toLowerCase()} file ${file.name}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onFile(null);
              }}
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <span className="placeholder">Drop a file here, or</span>
            <button
              type="button"
              className="linkish slot-browse"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              browse{label ? ` for ${label.toLowerCase()}` : ''}
            </button>
          </>
        )}
      </div>
      {warn && <div className="slot-warn">{warn}</div>}
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={acceptedExts.join(',')}
        disabled={disabled}
        onChange={(e) => {
          accept(e.target.files?.[0] || null);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function UploadZone({ files, onChange, onAnalyze, busy, error }: Props) {
  const patch = useCallback(
    (partial: Partial<UploadFiles>) => {
      onChange((prev) => ({ ...prev, ...partial }));
    },
    [onChange]
  );

  const [localError, setLocalError] = useState<string | null>(null);
  const reject = (message: string) => setLocalError(message);
  const shownError = localError || error;

  const readyBits = [
    files.paper ? 'Manuscript' : null,
    files.similarity ? 'Similarity' : null,
    files.ai ? 'AI report' : null,
  ].filter(Boolean) as string[];

  return (
    <section className={`upload-panel${busy ? ' is-busy' : ''}`}>
      <header className="hero">
        <div className="hero-visual" aria-hidden>
          <img
            src="/hero-manuscript.jpg"
            alt=""
            width={1600}
            height={900}
            decoding="async"
            fetchPriority="low"
          />
          <div className="hero-visual-fade" />
        </div>
        <p className="brand-mark">Revision Assistant</p>
        <h1>Review flags. Cite carefully. Keep your voice.</h1>
        <p className="lede">
          A private, browser-side pass over your manuscript and optional similarity or
          AI-writing reports — for thesis chapters, journal drafts, and grant narratives.
        </p>
      </header>

      <div className="title-row">
        <label htmlFor="title">Working title</label>
        <div className="title-field">
          <input
            id="title"
            type="text"
            value={files.title}
            disabled={busy}
            placeholder="e.g. Chapter 3 — Methods draft"
            onChange={(e) => patch({ title: e.target.value })}
            aria-describedby="title-hint"
          />
          {files.title.trim() ? (
            <span id="title-hint" className="title-hint ok">
              Appears on your change log and PDF export
            </span>
          ) : (
            <span id="title-hint" className="title-hint">
              Optional — we&apos;ll use the manuscript file name if blank
            </span>
          )}
        </div>
      </div>

      <div className="slots">
        <FileSlot
          label="Manuscript"
          hint={`PDF or DOCX · up to ${formatBytes(PAPER_MAX_BYTES)} · old .doc? Save As .docx in Word first`}
          required
          file={files.paper}
          onFile={(paper) => {
            setLocalError(null);
            patch({ paper });
          }}
          disabled={busy}
          acceptedExts={['.pdf', '.docx']}
          kind="paper"
          onReject={reject}
        />
        <FileSlot
          label="Similarity report"
          hint={`PDF · optional originality / similarity report · up to ${formatBytes(REPORT_MAX_BYTES)}`}
          file={files.similarity}
          onFile={(similarity) => {
            setLocalError(null);
            patch({ similarity });
          }}
          disabled={busy}
          kind="similarity"
          onReject={reject}
        />
        <FileSlot
          label="AI writing report"
          hint={`PDF · optional AI-writing report · up to ${formatBytes(REPORT_MAX_BYTES)}`}
          file={files.ai}
          onFile={(ai) => {
            setLocalError(null);
            patch({ ai });
          }}
          disabled={busy}
          kind="ai"
          onReject={reject}
        />
      </div>

      {shownError && (
        <div className="error-banner" role="alert">
          <strong className="error-banner-label">Couldn&apos;t use that file</strong>
          <span>{shownError}</span>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary analyze-btn"
          disabled={busy || !files.paper}
          onClick={(e) => {
            e.preventDefault();
            setLocalError(null);
            onAnalyze();
          }}
        >
          {busy ? 'Analyzing…' : files.paper ? 'Analyze manuscript' : 'Add a manuscript to begin'}
        </button>
        <div className="actions-meta">
          {readyBits.length > 0 && (
            <p className="ready-chip" aria-live="polite">
              Ready: {readyBits.join(' · ')}
            </p>
          )}
          <p className="fineprint">
            Manuscript alone covers grammar, citation gaps, Apply-all fixes, draft rewrite, and
            watermarked PDF export. If you add a similarity or AI report, its flagged passages
            are matched onto your manuscript text — the report itself is never modified. Reports
            stay on this device for analysis.
          </p>
        </div>
      </div>
    </section>
  );
}
