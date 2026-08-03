/**
 * Required-statement checker: detects whether the manuscript likely needs ethics,
 * consent, data-availability, conflict-of-interest, and funding statements — and
 * whether they are present. Missing statements are a common desk-rejection trigger.
 *
 * All detection is local keyword heuristics; templates are DRAFTS the author must
 * adapt and verify against the target journal's requirements.
 */

import type { ParsedPaper } from '../../types';

export type StatementStatus = 'ok' | 'missing' | 'not_needed' | 'check';

export interface StatementCheck {
  id: string;
  label: string;
  status: StatementStatus;
  why: string;
  template?: string;
}

export interface StatementCheckResult {
  items: StatementCheck[];
  missingCount: number;
  summary: string;
}

function methodsText(paper: ParsedPaper): string {
  const methods = paper.sections.find((s) => s.name === 'Methods');
  if (methods) return paper.fullText.slice(methods.startOffset, methods.endOffset);
  return paper.fullText;
}

const SIGNALS = {
  human:
    /\b(participants?|patients?|volunteers?|respondents?|human subjects?|questionnaires?|surveyed|interviews?|focus groups?|cohort|clinical trial)\b/i,
  animal:
    /\b(mice|rats?|murine|zebrafish|rabbits?|in vivo|animal (model|stud|experiment)|c57bl|sprague.?dawley)\b/i,
  data: /\b(datasets?|data set|corpus|corpora|benchmark|database|collected data|raw data|measurement data)\b/i,
  code: /\b(source code|github|gitlab|open.?source (code|implementation)|our (code|implementation)|scripts? (are|is) available)\b/i,
};

const PRESENCE = {
  ethics:
    /\b(ethic(s|al)?\s+(approval|committee|review board|clearance)|institutional review board|\bIRB\b|declaration of helsinki|animal care and use committee|IACUC)\b/i,
  consent: /\b(informed consent|written consent|consent (was|were) obtained|consent form)\b/i,
  dataAvailability:
    /\b(data availability|data (are|is|will be) (openly |publicly |freely )?available|available (at|from|upon|on) (https|request|reasonable request|zenodo|figshare|github|osf))\b/i,
  conflict:
    /\b(conflicts? of interest|competing interests?|no (known )?(conflict|competing)|declare no)\b/i,
  funding:
    /\b(this (work|research|study) (was|is) (partially |partly )?(supported|funded)|funding:?\s|grant (no|number|agreement)|financial support)\b/i,
};

const TEMPLATES: Record<string, string> = {
  ethics_human:
    'Ethics approval: This study involving human participants was reviewed and approved by [INSTITUTION] institutional review board / ethics committee (approval no. [NUMBER], dated [DATE]). All procedures complied with the Declaration of Helsinki.',
  ethics_animal:
    'Ethics approval: All animal procedures were approved by [INSTITUTION] animal care and use committee (protocol no. [NUMBER]) and complied with applicable national and institutional guidelines for the care and use of animals.',
  consent:
    'Informed consent: Written informed consent was obtained from all individual participants included in the study. [If applicable: Consent for publication of identifying information/images was also obtained.]',
  dataAvailability:
    'Data availability: The data supporting the findings of this study are available at [REPOSITORY + DOI/URL] / available from the corresponding author upon reasonable request. [If restricted: state why and how access can be requested.]',
  conflict:
    'Conflicts of interest: The authors declare no conflicts of interest. [Or: Author X has received funding/honoraria from COMPANY; the remaining authors declare no competing interests.]',
  funding:
    'Funding: This work was supported by [FUNDER] under grant no. [NUMBER]. [Or: This research received no external funding.]',
};

export function checkStatements(paper: ParsedPaper): StatementCheckResult {
  const full = paper.fullText;
  const methods = methodsText(paper);

  const hasHuman = SIGNALS.human.test(methods);
  const hasAnimal = SIGNALS.animal.test(methods);
  const hasData = SIGNALS.data.test(full) || SIGNALS.code.test(full);

  const items: StatementCheck[] = [];

  // Ethics approval
  const ethicsPresent = PRESENCE.ethics.test(full);
  if (hasHuman || hasAnimal) {
    items.push({
      id: 'ethics',
      label: 'Ethics approval statement',
      status: ethicsPresent ? 'ok' : 'missing',
      why: hasHuman
        ? 'The Methods text mentions human participants (surveys, patients, interviews…), so most journals require a named ethics approval.'
        : 'The Methods text mentions animal work, so most journals require an animal-ethics approval statement.',
      template: ethicsPresent ? undefined : hasAnimal && !hasHuman ? TEMPLATES.ethics_animal : TEMPLATES.ethics_human,
    });
  } else {
    items.push({
      id: 'ethics',
      label: 'Ethics approval statement',
      status: ethicsPresent ? 'ok' : 'not_needed',
      why: ethicsPresent
        ? 'An ethics statement is present.'
        : 'No human/animal-subject signals were detected, so an ethics statement is likely not required — confirm against your study design.',
    });
  }

  // Informed consent (human work only)
  if (hasHuman) {
    const consentPresent = PRESENCE.consent.test(full);
    items.push({
      id: 'consent',
      label: 'Informed consent statement',
      status: consentPresent ? 'ok' : 'missing',
      why: 'Human-participant signals were detected; journals typically require an explicit informed-consent statement.',
      template: consentPresent ? undefined : TEMPLATES.consent,
    });
  }

  // Data availability
  const dataPresent = PRESENCE.dataAvailability.test(full);
  items.push({
    id: 'data',
    label: 'Data availability statement',
    status: dataPresent ? 'ok' : hasData ? 'missing' : 'check',
    why: dataPresent
      ? 'A data-availability statement was detected.'
      : hasData
        ? 'The paper mentions datasets/code, and most journals now require a data-availability statement even when data is only available on request.'
        : 'No dataset signals detected, but many journals require the statement regardless — check the author guidelines.',
    template: dataPresent ? undefined : TEMPLATES.dataAvailability,
  });

  // Conflict of interest
  const coiPresent = PRESENCE.conflict.test(full);
  items.push({
    id: 'conflict',
    label: 'Conflict-of-interest disclosure',
    status: coiPresent ? 'ok' : 'missing',
    why: coiPresent
      ? 'A conflict/competing-interests disclosure was detected.'
      : 'Nearly all journals require a conflict-of-interest disclosure, even a simple "the authors declare none".',
    template: coiPresent ? undefined : TEMPLATES.conflict,
  });

  // Funding
  const fundingPresent = PRESENCE.funding.test(full);
  items.push({
    id: 'funding',
    label: 'Funding statement',
    status: fundingPresent ? 'ok' : 'check',
    why: fundingPresent
      ? 'A funding acknowledgment was detected.'
      : 'No funding statement detected. If the work was funded, most journals require the funder and grant number; if unfunded, many still want "no external funding".',
    template: fundingPresent ? undefined : TEMPLATES.funding,
  });

  const missingCount = items.filter((i) => i.status === 'missing').length;
  const summary =
    missingCount > 0
      ? `${missingCount} likely-required statement(s) appear to be missing. Missing declarations are an increasingly strict desk-rejection ground — use the draft templates below and adapt them.`
      : 'No clearly missing statements detected. Still verify against the target journal — statement wording requirements vary.';

  return { items, missingCount, summary };
}
