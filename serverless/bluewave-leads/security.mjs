const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function submissionFingerprint(lead) {
  return hashText(`${lead.email}|${lead.type}|${lead.need}`);
}

export function createMemoryGuard({
  now = () => Date.now(),
  rateLimit = 5,
  windowMs = DEFAULT_WINDOW_MS,
  duplicateWindowMs = DEFAULT_DUPLICATE_WINDOW_MS
} = {}) {
  const rates = new Map();
  const submissions = new Map();

  return {
    allowRate(key) {
      const cutoff = now() - windowMs;
      const recent = (rates.get(key) ?? []).filter(timestamp => timestamp > cutoff);
      if (recent.length >= rateLimit) return false;
      recent.push(now());
      rates.set(key, recent);
      return true;
    },
    claimSubmission(fingerprint) {
      const current = now();
      const expiresAt = submissions.get(fingerprint) ?? 0;
      if (expiresAt > current) return false;
      submissions.set(fingerprint, current + duplicateWindowMs);
      return true;
    }
  };
}

export function requestClientKey(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}
