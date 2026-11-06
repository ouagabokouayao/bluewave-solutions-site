const WINDOW_MS = 15 * 60 * 1000;

export function createMemoryGuard({ now = () => Date.now(), rateLimit = 5, windowMs = WINDOW_MS } = {}) {
  const rates = new Map();
  return {
    allowRate(key) {
      const recent = (rates.get(key) ?? []).filter(time => time > now() - windowMs);
      if (recent.length >= rateLimit) return false;
      recent.push(now()); rates.set(key, recent); return true;
    }
  };
}

export function requestClientKey(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown';
}
