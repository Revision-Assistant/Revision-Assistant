/**
 * Client helper for the Netlify coverLetter function.
 * Sends title + abstract snippet + venue name only — never the manuscript.
 */

export interface CoverLetterResult {
  letter: string;
  tips: string[];
  disclaimer: string;
  error?: string;
}

export async function requestCoverLetter(opts: {
  title: string;
  abstract: string;
  venue?: string;
  contribution?: string;
  articleType?: string;
  accessToken?: string | null;
}): Promise<CoverLetterResult> {
  const res = await fetch('/.netlify/functions/coverLetter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    body: JSON.stringify({
      title: opts.title.trim().slice(0, 300),
      abstract: opts.abstract.trim().slice(0, 1200),
      venue: (opts.venue || '').trim().slice(0, 160),
      contribution: (opts.contribution || '').trim().slice(0, 500),
      articleType: (opts.articleType || '').trim().slice(0, 60),
    }),
  });

  if (!res.ok && res.status !== 429) {
    const t = await res.text();
    return {
      letter: '',
      tips: [],
      disclaimer: '',
      error: `HTTP ${res.status}: ${t.slice(0, 180)}`,
    };
  }

  const data = (await res.json()) as {
    letter?: string;
    tips?: string[];
    disclaimer?: string;
    error?: string;
  };
  return {
    letter: String(data.letter || ''),
    tips: (data.tips || []).map((t) => String(t)).slice(0, 4),
    disclaimer:
      data.disclaimer ||
      'AI-assisted draft — verify every declaration is true and edit before sending.',
    error: data.error,
  };
}
