import { useCallback, useRef, useState } from 'react';

export interface UploadFiles {
  paper: File | null;
  similarity: File | null;
  ai: File | null;
  title: string;
  /** Kept for type compatibility; deep citation is always on in the pipeline */
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
}: {
  label: string;
  hint: string;
  required?: boolean;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  acceptedExts?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const accept = (f: File | null) => {
    if (!f) {
      onFile(null);
      return;
    }
    const name = f.name.toLowerCase();
    if (!acceptedExts.some((ext) => name.endsWith(ext))) {
      alert(`${acceptedExts.join(' or ')} only.`);
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
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (disabled) return;
        accept(e.dataTransfer.files?.[0] || null);
      }}
      onClick={() => {
        if (disabled) return;
        inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
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
            <button
              type="button"
              className="linkish"
              disabled={disabled}
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
          <span className="placeholder">Drop file or click to browse</span>
        )}
      </div>
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

  return (
    <section className="upload-panel">
      <header className="hero">
        <p className="brand-mark">Revision Assistant</p>
        <h1>Locate every flag. Rewrite with integrity.</h1>
        <p className="lede">
          Upload your own manuscript and optional Turnitin reports. Parsing, grammar,
          citation checks, and alignment run in your browser — files stay on this device
          unless you choose to sign in and save findings.
        </p>
      </header>

      <div className="title-row">
        <label htmlFor="title">Project title</label>
        <input
          id="title"
          type="text"
          value={files.title}
          disabled={busy}
          placeholder="e.g. Thesis chapter draft"
          onChange={(e) => patch({ title: e.target.value })}
        />
      </div>

      <div className="slots">
        <FileSlot
          label="Your paper"
          hint="PDF or DOCX of the manuscript you want to revise"
          required
          file={files.paper}
          onFile={(paper) => patch({ paper })}
          disabled={busy}
          acceptedExts={['.pdf', '.docx']}
        />
        <FileSlot
          label="Similarity report"
          hint="Turnitin similarity / originality PDF (optional)"
          file={files.similarity}
          onFile={(similarity) => patch({ similarity })}
          disabled={busy}
        />
        <FileSlot
          label="AI report"
          hint="Turnitin AI writing report (optional)"
          file={files.ai}
          onFile={(ai) => patch({ ai })}
          disabled={busy}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || !files.paper}
          onClick={(e) => {
            e.preventDefault();
            onAnalyze();
          }}
        >
          {busy ? 'Analyzing…' : 'Analyze in browser'}
        </button>

        <p className="fineprint">
          Paper alone is enough for grammar and citation integrity — a trained model checks
          for claims that need a citation even where Turnitin finds nothing. Add Turnitin
          reports to also align plagiarism and AI flags.
        </p>
      </div>
    </section>
  );
}
