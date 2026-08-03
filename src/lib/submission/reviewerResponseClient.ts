/**
 * Client helper for the Netlify reviewerResponse function.
 * Sends only the reviewer comments the author pastes (capped) — never the manuscript.
 */

export interface ReviewerResponsePoint {
  label: string;
  comment: string;
  response: string;
}

export interface ReviewerResponseResult {
  preamble: string;
  points: ReviewerResponsePoint[];
  disclaimer: string;
  error?: string;
}

export async function requestReviewerResponse(opts: {
  comments: string;
  accessToken?: string | null;
}): Promise<ReviewerResponseResult> {
  const res = await fetch('/.netlify/functions/reviewerResponse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    body: JSON.stringify({ comments: opts.comments.trim().slice(0, 6000) }),
  });

  if (!res.ok && res.status !== 429 && res.status !== 400) {
    const t = await res.text();
    return {
      preamble: '',
      points: [],
      disclaimer: '',
      error: `HTTP ${res.status}: ${t.slice(0, 180)}`,
    };
  }

  const data = (await res.json()) as {
    preamble?: string;
    points?: { label?: string; comment?: string; response?: string }[];
    disclaimer?: string;
    error?: string;
  };
  return {
    preamble: String(data.preamble || ''),
    points: (data.points || [])
      .filter((p) => p && p.comment && p.response)
      .map((p) => ({
        label: String(p.label || 'Point'),
        comment: String(p.comment),
        response: String(p.response),
      })),
    disclaimer:
      data.disclaimer ||
      'Templates only — you supply the scientific substance and verify every statement.',
    error: data.error,
  };
}

/** Flatten the scaffold to plain text for copy/paste into a response document. */
export function formatResponseDocument(result: ReviewerResponseResult): string {
  const parts: string[] = [];
  if (result.preamble) parts.push(result.preamble, '');
  for (const p of result.points) {
    parts.push(`--- ${p.label} ---`, `Comment: ${p.comment}`, '', `Response: ${p.response}`, '');
  }
  return parts.join('\n');
}
