import { useMemo, useState } from 'react';
import type { ParsedPaper } from '../types';
import {
  buildSubmissionChecklist,
  VENUE_STYLES,
  type VenueStyleId,
} from '../lib/submission/checklist';
import {
  analyzeReferenceHygiene,
  checkRetractions,
  type RetractionCheckResult,
} from '../lib/submission/referenceHygiene';
import { checkStatements } from '../lib/submission/statements';
import { requestCoverLetter } from '../lib/submission/coverLetterClient';
import {
  formatResponseDocument,
  requestReviewerResponse,
  type ReviewerResponseResult,
} from '../lib/submission/reviewerResponseClient';

interface Props {
  paper: ParsedPaper;
  title: string;
  accessToken?: string | null;
}

function abstractSnippet(paper: ParsedPaper): string {
  const abs = paper.sections.find((s) => s.name === 'Abstract');
  if (abs) {
    return paper.fullText.slice(abs.startOffset, Math.min(abs.endOffset, abs.startOffset + 1200));
  }
  return paper.fullText.slice(0, 1200);
}

const STATUS_META: Record<string, { mark: string; cls: string }> = {
  pass: { mark: '✓', cls: 'ok' },
  warn: { mark: '!', cls: 'warn' },
  fail: { mark: '✗', cls: 'fail' },
  ok: { mark: '✓', cls: 'ok' },
  missing: { mark: '✗', cls: 'fail' },
  check: { mark: '?', cls: 'warn' },
  not_needed: { mark: '–', cls: 'na' },
};

export function SubmissionToolkit({ paper, title, accessToken }: Props) {
  const [style, setStyle] = useState<VenueStyleId>('generic');

  // Retraction check
  const [retractBusy, setRetractBusy] = useState(false);
  const [retract, setRetract] = useState<RetractionCheckResult | null>(null);
  const [retractMsg, setRetractMsg] = useState<string | null>(null);

  // Cover letter
  const [venue, setVenue] = useState('');
  const [contribution, setContribution] = useState('');
  const [letterBusy, setLetterBusy] = useState(false);
  const [letter, setLetter] = useState('');
  const [letterTips, setLetterTips] = useState<string[]>([]);
  const [letterMsg, setLetterMsg] = useState<string | null>(null);

  // Reviewer response
  const [comments, setComments] = useState('');
  const [respBusy, setRespBusy] = useState(false);
  const [resp, setResp] = useState<ReviewerResponseResult | null>(null);
  const [respMsg, setRespMsg] = useState<string | null>(null);

  const [copied, setCopied] = useState<string | null>(null);

  const checklist = useMemo(
    () => buildSubmissionChecklist(paper, style, title),
    [paper, style, title]
  );
  const hygiene = useMemo(() => analyzeReferenceHygiene(paper.references), [paper]);
  const statements = useMemo(() => checkStatements(paper), [paper]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const runRetractionCheck = async () => {
    setRetractBusy(true);
    setRetractMsg(null);
    try {
      const res = await checkRetractions(paper.references);
      setRetract(res);
      if (res.checked === 0) {
        setRetractMsg(
          'No DOIs found in the parsed reference list — the Crossref retraction check needs DOIs.'
        );
      }
    } catch (e) {
      setRetractMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRetractBusy(false);
    }
  };

  const runCoverLetter = async () => {
    setLetterBusy(true);
    setLetterMsg(null);
    try {
      const res = await requestCoverLetter({
        title,
        abstract: abstractSnippet(paper),
        venue,
        contribution,
        accessToken,
      });
      if (res.letter) {
        setLetter(res.letter);
        setLetterTips(res.tips);
        setLetterMsg(res.disclaimer);
      } else {
        setLetterMsg(res.error || 'No draft returned — check LLM keys on Netlify.');
      }
    } catch (e) {
      setLetterMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLetterBusy(false);
    }
  };

  const runReviewerResponse = async () => {
    setRespBusy(true);
    setRespMsg(null);
    try {
      const res = await requestReviewerResponse({ comments, accessToken });
      if (res.points.length > 0) {
        setResp(res);
        setRespMsg(res.disclaimer);
      } else {
        setResp(null);
        setRespMsg(res.error || 'No template returned — check LLM keys on Netlify.');
      }
    } catch (e) {
      setRespMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRespBusy(false);
    }
  };

  return (
    <div className="submission-toolkit">
      <header className="st-header">
        <p className="st-kicker">Submission toolkit</p>
        <h3>Pre-submission checks &amp; drafting aids</h3>
        <p className="st-disclaimer">
          Checks below target the most common <strong>desk-rejection triggers</strong>: guideline
          non-compliance, missing declarations, and reference problems. Style profiles are
          archetypes, <strong>not</strong> any publisher&apos;s official guidelines — always
          verify against your target journal&apos;s Instructions for Authors. All templates are
          drafts; you are responsible for every statement.
        </p>
      </header>

      {/* ---- Venue-style checklist ---- */}
      <section className="st-section">
        <h4>Submission readiness checklist</h4>
        <div className="filters" role="group" aria-label="Venue style profile">
          {(Object.keys(VENUE_STYLES) as VenueStyleId[]).map((s) => (
            <button
              key={s}
              type="button"
              className={style === s ? 'chip active' : 'chip'}
              aria-pressed={style === s}
              onClick={() => setStyle(s)}
            >
              {VENUE_STYLES[s].label}
            </button>
          ))}
        </div>
        <p className="st-summary">{checklist.summary}</p>
        <ul className="st-checklist">
          {checklist.items.map((item) => {
            const meta = STATUS_META[item.status];
            return (
              <li key={item.id} className={`st-item st-${meta.cls}`}>
                <span className={`st-mark mark-${meta.cls}`} aria-hidden>
                  {meta.mark}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Reference hygiene ---- */}
      <section className="st-section">
        <h4>Reference hygiene</h4>
        <p className="st-summary">{hygiene.summary}</p>
        {hygiene.total > 0 && (
          <p className="st-stats muted">
            {hygiene.total} entries · {hygiene.withDoi} with DOI · {hygiene.recent5} from the last
            5 years · {hygiene.olderThan10} older than 10 years
          </p>
        )}
        {hygiene.issues.length > 0 && (
          <ul className="st-checklist">
            {hygiene.issues.map((iss) => (
              <li key={iss.id} className={`st-item st-${iss.severity === 'warn' ? 'warn' : 'na'}`}>
                <span
                  className={`st-mark mark-${iss.severity === 'warn' ? 'warn' : 'na'}`}
                  aria-hidden
                >
                  {iss.severity === 'warn' ? '!' : 'i'}
                </span>
                <div>
                  <strong>{iss.title}</strong>
                  <p>{iss.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="st-actions">
          <button
            type="button"
            className="secondary"
            disabled={retractBusy || hygiene.total === 0}
            title="Sends only the DOI strings from your reference list to the free public Crossref API — never any manuscript text."
            onClick={() => void runRetractionCheck()}
          >
            {retractBusy ? 'Checking Crossref…' : 'Check for retracted references (Crossref)'}
          </button>
        </div>
        {retract && (
          <div className="st-retract-result" role="status">
            {retract.hits.length === 0 ? (
              <p className="st-ok-note">
                No retraction / withdrawal / concern notices found for the {retract.checked} DOI(s)
                checked
                {retract.skippedNoDoi > 0
                  ? ` (${retract.skippedNoDoi} entries had no DOI and could not be checked)`
                  : ''}
                . Absence of a notice is not a guarantee — Crossref coverage varies.
              </p>
            ) : (
              <ul className="st-checklist">
                {retract.hits.map((h) => (
                  <li key={h.doi} className="st-item st-fail">
                    <span className="st-mark mark-fail" aria-hidden>
                      ✗
                    </span>
                    <div>
                      <strong>
                        Reference [{h.refIndex}] has a “{h.noticeType}” notice
                      </strong>
                      <p>
                        DOI{' '}
                        <a
                          href={`https://doi.org/${h.doi}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {h.doi}
                        </a>{' '}
                        carries a publisher / Retraction Watch update in Crossref. Verify the
                        notice yourself and consider replacing or contextualizing this citation.
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {retractMsg && <p className="st-msg" role="status">{retractMsg}</p>}
      </section>

      {/* ---- Required statements ---- */}
      <section className="st-section">
        <h4>Ethics &amp; declaration statements</h4>
        <p className="st-summary">{statements.summary}</p>
        <ul className="st-checklist">
          {statements.items.map((item) => {
            const meta = STATUS_META[item.status];
            return (
              <li key={item.id} className={`st-item st-${meta.cls}`}>
                <span className={`st-mark mark-${meta.cls}`} aria-hidden>
                  {meta.mark}
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.why}</p>
                  {item.template && (
                    <div className="st-template">
                      <p className="pre">{item.template}</p>
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => void copyText(`tpl-${item.id}`, item.template!)}
                      >
                        {copied === `tpl-${item.id}` ? 'Copied' : 'Copy template'}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- Cover letter ---- */}
      <section className="st-section">
        <h4>Cover letter draft</h4>
        <p className="st-note">
          Sends only your title, abstract snippet, and the venue name you type — never the
          manuscript. The draft uses [PLACEHOLDERS] you must fill; verify every declaration
          (originality, not under review elsewhere) is actually true before sending.
        </p>
        <div className="st-form">
          <label htmlFor="st-venue">Target journal / venue name</label>
          <input
            id="st-venue"
            type="text"
            value={venue}
            placeholder="e.g. IEEE Access"
            onChange={(e) => setVenue(e.target.value)}
          />
          <label htmlFor="st-contribution">One-sentence contribution note (optional)</label>
          <input
            id="st-contribution"
            type="text"
            value={contribution}
            placeholder="e.g. First open benchmark for X under condition Y"
            onChange={(e) => setContribution(e.target.value)}
          />
          <div className="st-actions">
            <button
              type="button"
              className="primary"
              disabled={letterBusy}
              onClick={() => void runCoverLetter()}
            >
              {letterBusy ? 'Drafting…' : 'Draft cover letter'}
            </button>
            {letter && (
              <button
                type="button"
                className="ghost"
                onClick={() => void copyText('letter', letter)}
              >
                {copied === 'letter' ? 'Copied' : 'Copy letter'}
              </button>
            )}
          </div>
        </div>
        {letter && (
          <div className="st-output">
            <p className="pre">{letter}</p>
            {letterTips.length > 0 && (
              <ul className="st-tips">
                {letterTips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {letterMsg && <p className="st-msg" role="status">{letterMsg}</p>}
      </section>

      {/* ---- Response to reviewers ---- */}
      <section className="st-section">
        <h4>Response-to-reviewers scaffold</h4>
        <p className="st-note">
          Paste reviewer comments from your decision letter (max ~6000 characters — they are sent
          to the writing assistant). You get a polite point-by-point template; the scientific
          substance stays yours to write. Check your journal&apos;s confidentiality rules before
          pasting review text into any third-party tool.
        </p>
        <div className="st-form">
          <label htmlFor="st-comments">Reviewer comments</label>
          <textarea
            id="st-comments"
            rows={6}
            value={comments}
            placeholder={'Reviewer 1:\n1. The sample size justification is unclear…\n2. Figure 3 axes are unlabeled…'}
            onChange={(e) => setComments(e.target.value)}
          />
          <div className="st-actions">
            <button
              type="button"
              className="primary"
              disabled={respBusy || comments.trim().length < 30}
              onClick={() => void runReviewerResponse()}
            >
              {respBusy ? 'Building scaffold…' : 'Build response scaffold'}
            </button>
            {resp && (
              <button
                type="button"
                className="ghost"
                onClick={() => void copyText('resp', formatResponseDocument(resp))}
              >
                {copied === 'resp' ? 'Copied' : 'Copy full document'}
              </button>
            )}
          </div>
        </div>
        {resp && (
          <div className="st-output">
            {resp.preamble && <p className="pre st-preamble">{resp.preamble}</p>}
            <ol className="st-points">
              {resp.points.map((p, i) => (
                <li key={`${p.label}-${i}`}>
                  <p className="st-point-label">{p.label}</p>
                  <blockquote className="st-point-comment">{p.comment}</blockquote>
                  <p className="pre st-point-response">{p.response}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
        {respMsg && <p className="st-msg" role="status">{respMsg}</p>}
      </section>
    </div>
  );
}
