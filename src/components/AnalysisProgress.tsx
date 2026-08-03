import type { PipelineProgress, PipelineStage } from '../types';

const STEPS: { id: PipelineStage; label: string }[] = [
  { id: 'parsing_paper', label: 'Manuscript' },
  { id: 'parsing_reports', label: 'Reports' },
  { id: 'aligning', label: 'Align' },
  { id: 'categorizing', label: 'Sort' },
  { id: 'citation_need', label: 'Citations' },
  { id: 'manuscript_quality', label: 'Quality' },
  { id: 'grammar_check', label: 'Grammar' },
  { id: 'explaining', label: 'Guidance' },
  { id: 'done', label: 'Ready' },
];

const ORDER: PipelineStage[] = STEPS.map((s) => s.id);

function stepState(
  stepId: PipelineStage,
  current: PipelineStage
): 'done' | 'active' | 'pending' {
  if (current === 'error') return 'pending';
  const cur = ORDER.indexOf(current === 'done' ? 'done' : current);
  const idx = ORDER.indexOf(stepId);
  if (cur < 0) return 'pending';
  if (idx < cur) return 'done';
  if (idx === cur) return current === 'done' ? 'done' : 'active';
  return 'pending';
}

interface Props {
  progress: PipelineProgress;
}

export function AnalysisProgress({ progress }: Props) {
  const activeLabel =
    STEPS.find((s) => stepState(s.id, progress.stage) === 'active')?.label ?? 'Working';

  return (
    <div className="progress-wrap" role="status" aria-live="polite">
      <div className="progress-head">
        <div>
          <div className="progress-kicker">In your browser</div>
          <div className="progress-title">{activeLabel}</div>
        </div>
        <div className="progress-pct">{Math.round(progress.percent)}%</div>
      </div>
      <div className="progress-bar" aria-hidden>
        <div style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="progress-msg">{progress.message}</p>
      <ol className="progress-steps">
        {STEPS.map((step) => {
          const state = stepState(step.id, progress.stage);
          return (
            <li key={step.id} className={`progress-step is-${state}`}>
              <span className="progress-dot" aria-hidden />
              <span className="progress-step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
