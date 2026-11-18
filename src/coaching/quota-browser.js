import { transaction } from './storage.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const DEFAULT_LIMITS = { minuteTokens: 6400, minuteRequests: 24, dayTokens: 160_000, dayRequests: 800 };

function resetDuration(value, fallback) {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value)) return fallback;
  const units = { ms: 1, s: 1000, m: MINUTE, h: 3_600_000, d: DAY };
  const duration = [...value.matchAll(/([\d.]+)(ms|s|m|h|d)/g)]
    .reduce((sum, [, count, unit]) => sum + Number(count) * units[unit], 0);
  return Number.isFinite(duration) ? duration : fallback;
}

function windowRetryAt(records, time, window, tokens, tokenLimit, requestLimit) {
  const active = records.filter(row => row.at + window > time).sort((a, b) => a.at - b.at);
  let used = active.reduce((sum, row) => sum + row.tokens, 0);
  let requests = active.length;
  let retryAt = 0;
  for (const row of active) {
    if (used + tokens <= tokenLimit && requests < requestLimit) break;
    used -= row.tokens;
    requests--;
    retryAt = row.at + window;
  }
  return retryAt;
}

function readBalance(account, key, time) {
  const balance = account[key];
  return balance?.resetAt > time ? balance : null;
}

function settleBalance(account, key, row, time, estimated, actual, remaining, reset, window, limit) {
  if (Number.isSafeInteger(remaining) && remaining >= 0) {
    account[key] = { remaining: Math.min(remaining, limit ?? Infinity), resetAt: time + resetDuration(reset, window), snapshot: row.id };
    return;
  }
  const balance = readBalance(account, key, time);
  if (balance && balance.snapshot === row[key]) {
    balance.remaining = Math.max(0, Math.min(limit ?? Infinity, balance.remaining + estimated - actual));
  }
}

function billableTokens(usage) {
  if (!Number.isFinite(usage?.total_tokens) || usage.total_tokens < 0) return undefined;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  const prompt = usage.prompt_tokens;
  const discount = Number.isFinite(cached) && Number.isFinite(prompt) ? Math.max(0, Math.min(prompt, cached)) : 0;
  return Math.max(0, Math.ceil(usage.total_tokens - discount));
}

const blocked = (code, reason, retryAt = null) => ({ allowed: false, code, reason, retryAt });

export function createBrowserQuota(scope) {
  async function update(fn) {
    return transaction('quota', (store, done) => {
      const read = store.get('ledger');
      read.onsuccess = () => {
        const state = read.result || { accounts: {}, lease: null };
        const time = Date.now();
        const account = state.accounts[scope] ||= { records: [], until: 0 };
        account.records = account.records.filter(row => row.at + DAY > time);
        for (const [key, other] of Object.entries(state.accounts)) {
          if (key !== scope && other.records.every(row => row.at + DAY <= time)
            && other.until <= time && !(other.tokenBalance?.resetAt > time || other.requestBalance?.resetAt > time)) {
            delete state.accounts[key];
          }
        }
        done(fn(account, state, time));
        store.put(state, 'ledger');
      };
    });
  }

  return {
    reserve: ({ estimatedTokens, jobKey }) => update((account, state, time) => {
      const tokens = Math.ceil(estimatedTokens);
      const tokenLimit = account.tokenLimit ?? DEFAULT_LIMITS.minuteTokens;
      const dayRequests = account.requestLimit ?? DEFAULT_LIMITS.dayRequests;
      if (!Number.isFinite(tokens) || tokens <= 0 || tokens > Math.min(tokenLimit, DEFAULT_LIMITS.dayTokens)) {
        return blocked('oversized', 'This explanation exceeds the available token budget.');
      }
      if (account.until > time) {
        return blocked('provider-rate-limit', 'Groq rate limit reached.', account.until);
      }
      if (state.lease?.until > time) {
        const reason = state.lease.jobKey === jobKey
          ? 'This explanation is already being requested in another tab.'
          : 'Another explanation is running. Retry shortly.';
        return blocked('busy', reason);
      }
      const tokenBalance = readBalance(account, 'tokenBalance', time);
      const requestBalance = readBalance(account, 'requestBalance', time);
      const headerRetry = Math.max(
        tokenBalance && tokens > tokenBalance.remaining ? tokenBalance.resetAt : 0,
        requestBalance && requestBalance.remaining < 1 ? requestBalance.resetAt : 0
      );
      const localRetry = Math.max(
        windowRetryAt(account.records, time, MINUTE, tokens, tokenBalance ? Infinity : tokenLimit, DEFAULT_LIMITS.minuteRequests),
        windowRetryAt(account.records, time, DAY, tokens, DEFAULT_LIMITS.dayTokens, requestBalance ? Infinity : dayRequests)
      );
      const retryAt = Math.max(headerRetry, localRetry);
      if (retryAt > time) {
        return headerRetry >= localRetry
          ? blocked('provider-capacity', 'Groq reports limited capacity for this explanation.', retryAt)
          : blocked('local-quota', 'Local quota cooldown. The extension is waiting for enough capacity.', retryAt);
      }
      const id = crypto.randomUUID();
      const row = { id, at: time, tokens };
      if (tokenBalance) {
        row.tokenBalance = tokenBalance.snapshot;
        tokenBalance.remaining -= tokens;
      }
      if (requestBalance) {
        row.requestBalance = requestBalance.snapshot;
        requestBalance.remaining--;
      }
      account.records.push(row);
      state.lease = { id, jobKey, until: time + 40_000 };
      return { allowed: true, id };
    }),
    reconcile: (reservation, response) => update((account, state, time) => {
      const row = account.records.find(item => item.id === reservation.id);
      if (!row) return;
      const measured = billableTokens(response.usage);
      const rejected = [400, 401, 403, 404, 429].includes(response.status);
      const actual = measured ?? (rejected ? 0 : row.tokens);
      const refundRequest = rejected && measured === undefined;
      if (response.retryAfterMs > 0) account.until = Math.max(account.until || 0, time + response.retryAfterMs);
      // An older response can still reconcile its own row, but cannot replace a newer lease's headers.
      if (state.lease?.id === reservation.id) {
        if (response.tokenLimit > 0) account.tokenLimit = response.tokenLimit;
        if (response.requestLimit > 0) account.requestLimit = response.requestLimit;
        settleBalance(account, 'tokenBalance', row, time, row.tokens, actual, response.remainingTokens, response.resetTokens, MINUTE, account.tokenLimit);
        settleBalance(account, 'requestBalance', row, time, 1, refundRequest ? 0 : 1, response.remainingRequests, response.resetRequests, DAY, account.requestLimit);
        state.lease = null;
      }
      row.tokens = actual;
      if (refundRequest) account.records = account.records.filter(item => item.id !== row.id);
      return account.until;
    }),
    failed: reservation => update((_account, state) => {
      if (state.lease?.id === reservation.id) state.lease = null;
    }),
    release: reservation => update((account, state, time) => {
      const row = account.records.find(item => item.id === reservation.id);
      if (row) {
        settleBalance(account, 'tokenBalance', row, time, row.tokens, 0, undefined, undefined, MINUTE, account.tokenLimit);
        settleBalance(account, 'requestBalance', row, time, 1, 0, undefined, undefined, DAY, account.requestLimit);
        account.records = account.records.filter(item => item.id !== row.id);
      }
      if (state.lease?.id === reservation.id) state.lease = null;
    })
  };
}
