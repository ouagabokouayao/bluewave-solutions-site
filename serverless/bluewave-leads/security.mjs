const WINDOW_MS = 15 * 60 * 1000;
const DUPLICATE_MS = 5 * 60 * 1000;

export async function submissionFingerprint(lead) {
  const bytes = new TextEncoder().encode(`${lead.email}|${lead.type}|${lead.need}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function createMemoryGuard({ now = () => Date.now(), rateLimit = 5, windowMs = WINDOW_MS, duplicateWindowMs = DUPLICATE_MS } = {}) {
  const rates = new Map();
  const submissions = new Map();
  return {
    allowRate(key) {
      const recent = (rates.get(key) ?? []).filter(time => time > now() - windowMs);
      if (recent.length >= rateLimit) return false;
      recent.push(now()); rates.set(key, recent); return true;
    },
    claimSubmission(key) {
      if ((submissions.get(key) ?? 0) > now()) return false;
      submissions.set(key, now() + duplicateWindowMs); return true;
    }
  };
}

export function requestClientKey(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}
