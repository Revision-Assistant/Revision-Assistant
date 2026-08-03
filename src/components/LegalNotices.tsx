import { useState } from 'react';
import { supabaseConfigured } from '../lib/supabase/client';

const CITATION_MODEL_ID =
  (import.meta.env.VITE_CITATION_MODEL_ID as string | undefined)?.trim() || null;
const QUALITY_MODEL_ID =
  (import.meta.env.VITE_QUALITY_MODEL_ID as string | undefined)?.trim() || null;
const JOURNAL_MODEL_ID =
  (import.meta.env.VITE_JOURNAL_MODEL_ID as string | undefined)?.trim() || null;

/**
 * Public legal, privacy, and third-party attribution notices (website only).
 * Keep this as the sole user-facing license / training-data disclosure.
 */
export function LegalNotices() {
  const [open, setOpen] = useState(false);

  return (
    <footer className="site-footer legal-notices">
      <div className="legal-lead">
        <p>
          <strong>Revision Assistant</strong> is an independent manuscript-review aid. It is{' '}
          <strong>not affiliated with, endorsed by, or a partner of</strong> IEEE, Elsevier,
          Clarivate, Scimago, any commercial plagiarism or AI-detection vendor, or any journal
          ranking body. It does not guarantee similarity scores, AI scores, acceptance, or
          indexing quartile. You remain responsible for every wording, citation, and submission
          decision, and for following your institution&apos;s academic-integrity policy.
        </p>
        <p>
          Analysis runs in your browser. Upload file handles are dropped when analysis starts;
          text and findings clear after 10 minutes without activity.
          {supabaseConfigured
            ? ' Optional sign-in stores findings JSON only — never your PDF or DOCX.'
            : ' Nothing is uploaded to our servers for analysis.'}{' '}
          Optional LLM features (explain, humanize drafts, open-venue refresh, cover-letter and
          reviewer-response drafting) send only short truncated metadata, flagged spans, or text
          you explicitly paste — never your full manuscript PDF — to serverless endpoints. The
          Resubmission Reformatter keeps the manuscript in-browser; optional Crossref enrichment
          sends only reference strings you opt in to look up. Do not
          upload documents you are not permitted to process with a third-party tool.
        </p>
        <p className="legal-training">
          Models used for citation-need, manuscript-quality flags, journal-readiness signal heads,
          and offline paraphrase research were trained only on <strong>public open research
          datasets</strong> (e.g. unarXive / ParaSCI / SciHRA / open arXiv-derived text on Hugging
          Face) — <strong>not</strong> on private student papers, closed textbooks, paywalled full
          texts, commercial detection reports, or scraped Clarivate/Scimago rank tables. Dataset
          copyright remains with the original rightsholders; we do not claim ownership of those
          corpora. Live “humanize” drafts and venue refresh use optional serverless LLM APIs and
          require your review.
        </p>
      </div>

      <button
        type="button"
        className="legal-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide' : 'Show'} attributions &amp; third-party terms
      </button>

      {open && (
        <div className="legal-detail">
          <h3>How we use third-party services</h3>
          <ul>
            <li>
              <strong>LanguageTool</strong> — grammar suggestions via the{' '}
              <a
                href="https://languagetool.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                LanguageTool
              </a>{' '}
              public API (or a URL you configure). Subject to LanguageTool&apos;s terms and
              rate limits; we do not rebrand their engine as ours.
            </li>
            <li>
              <strong>Optional LLM guidance / humanize drafts / grammar filter / open-venue refresh</strong>{' '}
              — short flagged spans or title/abstract/keyword snippets may be sent to serverless
              explain, humanize, grammarFilter, or journalSuggest endpoints (Groq, Google Gemini,
              and/or OpenRouter). Payloads are truncated; full PDFs are never uploaded for these
              calls. Grammar filtering only keeps or drops existing LanguageTool suggestions — it
              never invents new findings. Drafts and venue ideas are reviewable; nothing is written
              into the manuscript until you Accept or Save. Subject to each provider&apos;s terms
              and daily usage caps when configured. Venue refresh must not invent Impact Factors or
              fake Q1/Q2 ranks.
            </li>
            <li>
              <strong>Open training corpora (attribution)</strong> — cite upstream works as
              required by their licenses/terms, including unarXive / citrec-style citation data,
              ParaSCI scientific paraphrases, and SciHRA humanization pairs. This product does
              not redistribute those full datasets.
            </li>
            <li>
              <strong>Citation-need model</strong> — optional in-browser ONNX inference via{' '}
              <a
                href="https://huggingface.co/docs/transformers.js"
                target="_blank"
                rel="noopener noreferrer"
              >
                Hugging Face Transformers.js
              </a>
              {CITATION_MODEL_ID ? (
                <>
                  {' '}
                  from{' '}
                  <a
                    href={`https://huggingface.co/${CITATION_MODEL_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {CITATION_MODEL_ID}
                  </a>
                </>
              ) : (
                <> (hosted weights when configured)</>
              )}
              . Respect the model card license (often Apache-2.0); we do not claim authorship of
              the base SciBERT weights.
            </li>
            <li>
              <strong>Manuscript-quality model</strong> — optional in-browser ONNX classifier for
              ambiguous numerical phrasing, common publication-craft issues, and unsubstantiated
              novelty <em>claim</em> wording
              {QUALITY_MODEL_ID ? (
                <>
                  {' '}
                  (
                  <a
                    href={`https://huggingface.co/${QUALITY_MODEL_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {QUALITY_MODEL_ID}
                  </a>
                  )
                </>
              ) : null}
              . A separate client-side rule pass also flags high-precision{' '}
              <em>numerical inconsistencies</em> (same metric/unit reported with different values).
              Advisory only — not a literature search, peer-review verdict, or formal statistical
              audit.
            </li>
            <li>
              <strong>Journal readiness</strong> — workspace tab that combines (1) checklist
              heuristics from structure + open findings, (2) an optional in-browser multi-label
              SciBERT ONNX model trained on open arXiv/unarXive-derived text for readiness{' '}
              <em>signal heads</em>
              {JOURNAL_MODEL_ID ? (
                <>
                  {' '}
                  (
                  <a
                    href={`https://huggingface.co/${JOURNAL_MODEL_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {JOURNAL_MODEL_ID}
                  </a>
                  )
                </>
              ) : (
                <> (when <code>VITE_JOURNAL_MODEL_ID</code> is set)</>
              )}
              , and (3) optional LLM “open-venue” refresh from title/abstract only. Scores are
              labeled <em>Q1-like / Q2-like bar</em> and <em>IEEE-oriented craft</em> —{' '}
              <strong>not</strong> Scimago, Clarivate, or publisher quartiles;{' '}
              <strong>not</strong> peer review; <strong>not</strong> affiliated with IEEE,
              Elsevier, Clarivate, or Scimago; and they <strong>do not guarantee</strong>{' '}
              acceptance or indexing. Venue names are topical examples or open-literature ideas
              only. We do not scrape paywalled journal-rank databases for live quartile truth. If
              the ONNX model is missing, the UI falls back to pure heuristics.
            </li>
            <li>
              <strong>Crossref</strong> — optional metadata lookup to enrich citation
              suggestions when a confident match exists, optional retraction checks that
              send only the DOI strings from your reference list, and optional Resubmission
              Reformatter enrichment that sends only individual reference strings (never
              manuscript prose) when you opt in. Uses the free public{' '}
              <a href="https://www.crossref.org/" target="_blank" rel="noopener noreferrer">
                Crossref
              </a>{' '}
              API (which includes publisher and Retraction Watch update notices). Absence of a
              notice is not a guarantee that a work is unretracted.
            </li>
            <li>
              <strong>Resubmission Reformatter</strong> — restyles your bibliography locally via
              Citation Style Language (CSL) templates and a curated venue-requirements checklist.
              Requirements are written in our own words from public guideline patterns with a
              &quot;last verified&quot; date — <strong>not</strong> scraped publisher pages and{' '}
              <strong>not</strong> official author instructions. Always verify on the journal
              site. We do not promise layout-preserving PDF / Word template reformatting.
            </li>
            <li>
              <strong>Submission toolkit</strong> — the checklist compares your manuscript
              against style <em>archetypes</em> ("IEEE-style", "Elsevier-style", generic) that
              are <strong>not</strong> the official author guidelines of any publisher; always
              verify against the target journal&apos;s own Instructions for Authors.
              Reference-hygiene "venue caution" rows are <strong>heuristic pattern flags asking
              you to verify a venue&apos;s indexing yourself</strong> (e.g. via DOAJ or Scopus) —
              they are never an accusation that a journal is predatory. Ethics /
              data-availability / conflict / funding statement templates, cover-letter drafts,
              and reviewer-response scaffolds are <strong>drafts with placeholders</strong>: you
              are responsible for the truth of every statement (originality, consent, approval
              numbers, funding) before submission. Cover-letter drafting sends only your title,
              abstract snippet, and typed venue name; reviewer-response scaffolding sends only
              the comment text you paste — check your journal&apos;s review-confidentiality
              policy before pasting reviewer text into any third-party tool. We do not scrape
              paywalled databases (Scopus, Web of Science) or journal blacklists.
            </li>
          </ul>

          <h3>Open-source libraries (attribution)</h3>
          <ul>
            <li>
              <a
                href="https://mozilla.github.io/pdf.js/"
                target="_blank"
                rel="noopener noreferrer"
              >
                PDF.js
              </a>{' '}
              (Mozilla) — PDF text extraction; Apache-2.0.
            </li>
            <li>
              <a
                href="https://github.com/mwilliamson/mammoth.js"
                target="_blank"
                rel="noopener noreferrer"
              >
                Mammoth
              </a>{' '}
              — DOCX text extraction; BSD-2-Clause.
            </li>
            <li>
              <a href="https://pdf-lib.js.org/" target="_blank" rel="noopener noreferrer">
                pdf-lib
              </a>{' '}
              — watermarked PDF export (including journal-readiness reports); MIT.
            </li>
            <li>
              <a href="https://react.dev/" target="_blank" rel="noopener noreferrer">
                React
              </a>{' '}
              — UI; MIT.
            </li>
            <li>
              Fuse.js, Citation.js (MPL-2.0), and other dependencies retain their upstream
              copyright notices in this project&apos;s package tree.
            </li>
            <li>
              <strong>Citation Style Language (CSL)</strong> — style definitions are{' '}
              <a
                href="https://citationstyles.org/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Citation Style Language
              </a>{' '}
              content (typically CC BY-SA 3.0). Reformatter maps many journal names to the
              closest bundled citation-js templates (APA, Vancouver, Harvard) with honest
              approximation notes.
            </li>
            <li>
              <strong>citeproc-js</strong> (via @citation-js/plugin-csl) — citation formatting
              engine under the Common Public Attribution License (CPAL-1.0) / AGPL-3.0 dual
              license. Attribution: citeproc-js / Citation Style Language project. See the{' '}
              <a
                href="https://github.com/Juris-M/citeproc-js"
                target="_blank"
                rel="noopener noreferrer"
              >
                citeproc-js repository
              </a>{' '}
              for full terms.
            </li>
          </ul>

          <h3>What we ask of you</h3>
          <ul>
            <li>Upload only manuscripts and reports you have the right to process.</li>
            <li>
              Treat similarity / AI-writing PDFs as confidential institutional documents when
              your policy requires it.
            </li>
            <li>
              Do not use this tool to evade detection, to misrepresent authorship, or to claim
              official journal-quartile readiness — it is for careful revision, citation repair,
              and heuristic self-checks.
            </li>
          </ul>
        </div>
      )}
    </footer>
  );
}
