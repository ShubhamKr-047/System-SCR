import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachingController } from '../src/coaching/controller.js';
import { createQuotaLedger, retryAfterMilliseconds } from '../src/coaching/quota.js';

function setup(overrides = {}) {
  const results = new Map(), states = [];
  let calls = 0;
  const controller = createCoachingController({
    identity: input => JSON.stringify(input),
    prepare: async () => ({ estimatedTokens: 2000 }),
    generate: async () => { calls++; return { result: { summary: 'Develops the knight.' } }; },
    validate: value => value,
    cache: { get: key => results.get(key), set: (key, value) => results.set(key, value) },
    quota: createQuotaLedger(), onChange: state => states.push(state), ...overrides
  });
  return { controller, states, calls: () => calls };
}
const move = { position: 'position-with-history', move: 'g1f3', evidenceVersion: 1 };

test('selection and credential changes do not request explanations', () => {
  const s = setup();
  s.controller.select(move); s.controller.credentialsChanged(); s.controller.cancel();
  assert.equal(s.calls(), 0);
});
test('double clicks coalesce, compatible results are reused, changed evidence is fresh', async () => {
  const s = setup();
  const first = s.controller.explain(move);
  assert.equal(s.controller.explain(move), first);
  await first;
  await s.controller.explain(move);
  assert.equal(s.calls(), 1);
  assert.equal(s.states.at(-1).source, 'cache');
  await s.controller.explain({ ...move, evidenceVersion: 2 });
  assert.equal(s.calls(), 2);
});
test('navigation during preparation prevents provider submission', async () => {
  let resume;
  const s = setup({ prepare: () => new Promise(resolve => { resume = resolve; }) });
  const pending = s.controller.explain(move);
  await new Promise(resolve => setImmediate(resolve));
  s.controller.select({ ...move, move: 'e2e4' });
  resume({ estimatedTokens: 2000 });
  await pending;
  assert.equal(s.calls(), 0);
});
test('local outcomes and cooldowns require no request or automatic retry', async () => {
  const local = setup({ prepare: async () => ({ localResult: { summary: 'Checkmate.' } }) });
  await local.controller.explain(move);
  assert.equal(local.calls(), 0);
  const limited = setup({ quota: { reserve: () => ({ allowed: false, retryAt: 100 }) } });
  await limited.controller.explain(move);
  assert.equal(limited.calls(), 0);
  assert.equal(limited.states.at(-1).status, 'cooldown');
});
test('invalid prose is not repaired automatically; retry needs another explicit action', async () => {
  const s = setup({ validate: () => { throw new Error('Unsupported claim'); } });
  await s.controller.explain(move);
  assert.equal(s.calls(), 1);
  assert.equal(s.states.at(-1).status, 'error');
  await s.controller.explain(move);
  assert.equal(s.calls(), 2);
});
test('key removal prevents late result publication and caching', async () => {
  let resume, writes = 0;
  const s = setup({ generate: () => new Promise(resolve => { resume = resolve; }),
    cache: { get: () => null, set: () => { writes++; } } });
  const pending = s.controller.explain(move);
  await new Promise(resolve => setImmediate(resolve));
  s.controller.credentialsChanged();
  resume({ result: { summary: 'Late result' } });
  await pending;
  assert.equal(writes, 0);
  assert.ok(!s.states.some(state => state.status === 'ready'));
});
test('token and daily admission differ; unknown submitted usage stays reserved', () => {
  let time = 0;
  const q = createQuotaLedger({ now: () => time, minuteTokens: 3000, dayRequests: 1 });
  const reservation = q.reserve({ estimatedTokens: 2000 });
  assert.equal(reservation.allowed, true);
  q.reconcile(reservation, {});
  time = 61000;
  assert.equal(q.reserve({ estimatedTokens: 2000 }).retryAt, 86400000);
  time = 86400000;
  assert.equal(q.reserve({ estimatedTokens: 2000 }).allowed, true);
});
test('usage reconciliation, cooldown metadata, and oversized reports', () => {
  let time = 0;
  const q = createQuotaLedger({ now: () => time, minuteTokens: 3000 });
  const r = q.reserve({ estimatedTokens: 2500 });
  q.reconcile(r, { usage: { total_tokens: 500 }, retryAfterMs: 90000 });
  assert.equal(q.reserve({ estimatedTokens: 2000 }).retryAt, 90000);
  time = 90000;
  assert.equal(q.reserve({ estimatedTokens: 2000 }).allowed, true);
  assert.equal(q.reserve({ estimatedTokens: 9000 }).retryAt, null);
  assert.equal(retryAfterMilliseconds('2'), 2000);
  assert.equal(retryAfterMilliseconds('invalid'), 60000);
  assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60000);
});

test('cancellation after quota reservation releases capacity before submission', async () => {
  let admit, released = 0;
  const s = setup({ quota: {
    reserve: () => new Promise(resolve => { admit = resolve; }),
    release: () => { released++; }
  } });
  const pending = s.controller.explain(move);
  await new Promise(resolve => setImmediate(resolve));
  s.controller.select(null);
  admit({ allowed: true, id: 1 });
  await pending;
  assert.equal(s.calls(), 0);
  assert.equal(released, 1);
});

test('ambiguous network failure retains reservation and never repeats submission', async () => {
  let generated = 0, released = 0;
  const s = setup({
    quota: { reserve: () => ({ allowed: true, id: 1 }), release: () => { released++; } },
    generate: async () => { generated++; throw new TypeError('Network failure'); }
  });
  await s.controller.explain(move);
  assert.equal(generated, 1);
  assert.equal(released, 0);
  assert.equal(s.states.at(-1).status, 'error');
});
