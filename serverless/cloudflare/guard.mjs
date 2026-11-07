// One SQLite-backed object per HMAC client key; no raw IP or lead is persisted.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
export class LeadGuard {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const {action, key} = await request.json();
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return new Response(null, {status:400});
    const now = Date.now();
    const allowed = await this.state.storage.transaction(async txn => {
      if (action === 'rate') {
        const recent = (await txn.get('rates') || []).filter(t => t > now - RATE_WINDOW_MS);
        if (recent.length >= 5) return false;
        recent.push(now);
        await txn.put('rates', recent);
        return true;
      }
      if (action === 'claim') {
        const recent = await txn.get('duplicates') || {};
        for (const [fingerprint, expiry] of Object.entries(recent)) if (expiry <= now) delete recent[fingerprint];
        if ((recent[key] || 0) > now) return false;
        recent[key] = now + DUPLICATE_WINDOW_MS;
        await txn.put('duplicates', recent);
        return true;
      }
      return null;
    });
    if (allowed === null) return new Response(null, {status:400});
    if (allowed) await this.state.storage.setAlarm(now + RATE_WINDOW_MS + DUPLICATE_WINDOW_MS);
    return Response.json({ok:allowed});
  }
  async alarm() {
    await this.state.storage.deleteAll();
  }
}

export function createDistributedGuard(env, request) {
  if (!env.LEAD_GUARD || !env.GUARD_HMAC_KEY || env.GUARD_HMAC_KEY.length < 32) throw new Error('Garde distribuée non configurée');
  const encoder = new TextEncoder();
  const hmacKey = crypto.subtle.importKey('raw', encoder.encode(env.GUARD_HMAC_KEY), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const hash = async value => {
    const signature = await crypto.subtle.sign('HMAC', await hmacKey, encoder.encode(value));
    return [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2,'0')).join('');
  };
  // Only the platform-provided address is used. Browser-controlled X-Forwarded-For is ignored.
  const client = request.headers.get('cf-connecting-ip') || 'unknown';
  const send = async (action, key) => {
    const id = env.LEAD_GUARD.idFromName(await hash(client));
    const response = await env.LEAD_GUARD.get(id).fetch('https://guard.internal/', {method:'POST',body:JSON.stringify({action,key})});
    if (!response.ok) throw new Error('Garde indisponible');
    return (await response.json()).ok === true;
  };
  return {allowRate: async () => send('rate',await hash('rate')), claimSubmission: async fingerprint => send('claim',await hash(fingerprint))};
}
