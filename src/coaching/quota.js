// Local admission ledger. The eventual extension broker must own one instance
// across tabs; this class alone cannot observe other applications' account use.
export function createQuotaLedger({ now = Date.now, minuteTokens = 6400,
  minuteRequests = 24, dayTokens = 160000, dayRequests = 800 } = {}) {
  let records = [];
  let cooldownUntil = 0;
  let sequence = 0;
  const day = 86400000, minute = 60000;
  function reserve({ estimatedTokens }) {
    const time = now();
    if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) {
      throw new Error('A positive total token reservation is required');
    }
    records = records.filter(r => r.at + day > time);
    if (estimatedTokens > Math.min(minuteTokens, dayTokens)) {
      return { allowed: false, retryAt: null, reason: 'Explanation exceeds the token budget' };
    }
    const active = records.filter(r => r.at + minute > time);
    const total = list => list.reduce((sum, r) => sum + r.tokens, 0);
    let retryAt = cooldownUntil;
    if (active.length >= minuteRequests || total(active) + estimatedTokens > minuteTokens) {
      retryAt = Math.max(retryAt, active[0].at + minute);
    }
    if (records.length >= dayRequests || total(records) + estimatedTokens > dayTokens) {
      retryAt = Math.max(retryAt, records[0].at + day);
    }
    if (retryAt > time) return { allowed: false, retryAt, reason: 'Quota cooldown' };
    const record = { id: ++sequence, at: time, tokens: Math.ceil(estimatedTokens) };
    records.push(record);
    return { allowed: true, id: record.id };
  }
  function reconcile(reservation, { usage, retryAfterMs } = {}) {
    const record = records.find(r => r.id === reservation.id);
    if (record && Number.isFinite(usage?.total_tokens) && usage.total_tokens > 0) {
      record.tokens = Math.ceil(usage.total_tokens);
    }
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      cooldownUntil = Math.max(cooldownUntil, now() + retryAfterMs);
    }
  }
  return { reserve, reconcile,
    release: reservation => { records = records.filter(r => r.id !== reservation.id); } };
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return 60000;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) && duration > 0 ? duration : 60000;
}
