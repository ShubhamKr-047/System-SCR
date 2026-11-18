// The replacement coach's explicit-action boundary. Constructing, observing,
// cancelling, or changing a target never invokes the provider.
export function createCoachingController({ prepare, generate, validate, cache, quota,
  identity, onChange = () => {}, timeoutMs = 25000 }) {
  const jobs = new Map();
  let target = null;
  let credentialRevision = 0;

  const publish = job => {
    if (target === job.key && jobs.get(job.key) === job) onChange({ ...job.state });
  };
  const transition = (job, status, extra = {}) => {
    job.state = { status, ...extra };
    publish(job);
  };
  function cancel() {
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  }
  function select(input) {
    const key = input ? identity(input) : null;
    if (key !== target) { cancel(); target = key; }
  }
  function credentialsChanged() {
    credentialRevision++;
    cancel();
  }
  function explain(input) {
    const key = identity(input);
    select(input);
    if (jobs.has(key)) return jobs.get(key).promise;
    const job = { key, controller: new AbortController(), state: { status: 'preparing' } };
    const revision = credentialRevision;
    const { signal } = job.controller;
    const check = () => {
      if (signal.aborted || key !== target || revision !== credentialRevision) {
        throw new DOMException('Explanation cancelled', 'AbortError');
      }
    };
    jobs.set(key, job);
    // Start after promise assignment, including when injected functions are synchronous.
    job.promise = Promise.resolve().then(async () => {
      let timer;
      let submitted = false;
      let reservation;
      let evidence;
      let timedOut = false;
      try {
        check();
        publish(job);
        const cached = await cache.get(key);
        check();
        if (cached) {
          transition(job, 'ready', { result: cached, source: 'cache' });
          return cached;
        }
        evidence = await prepare(input, { signal });
        check();
        if (evidence.localResult) {
          transition(job, 'ready', { result: evidence.localResult, source: 'local' });
          return evidence.localResult;
        }
        reservation = await quota.reserve(evidence);
        check();
        if (!reservation.allowed) {
          transition(job, 'cooldown', { retryAt: reservation.retryAt,
            reason: reservation.reason, fallback: evidence.fallback });
          return null;
        }
        transition(job, 'writing', { fallback: evidence.fallback });
        check();
        timer = setTimeout(() => { timedOut=true; job.controller.abort(); }, timeoutMs);
        // Exactly one invocation; no retry or repair path exists here.
        submitted = true;
        const response = await generate(evidence, { signal });
        clearTimeout(timer);
        const retryAt = await quota.reconcile(reservation, response);
        check();
        if (response.error) {
          transition(job, 'error', { error:response.error,
            retryAt:response.status === 429 ? retryAt : undefined, fallback:evidence.fallback });
          return null;
        }
        let result;
        try {
          result = validate(response.result, evidence);
        } catch (error) {
          transition(job, 'error', { error:error.message, fallback:evidence.fallback });
          return null;
        }
        await cache.set(key, result);
        check();
        transition(job, 'ready', { result, source: 'groq' });
        return result;
      } catch (error) {
        if(submitted) {
          try { await quota.failed?.(reservation); } catch { /* persisted lease expires */ }
        }
        if (!signal.aborted && key === target && revision === credentialRevision) {
          transition(job, 'error', { error: error.message, fallback:evidence?.fallback });
        } else {
          transition(job, timedOut ? 'error' : 'cancelled', {error:timedOut ? 'Groq took too long to respond. You can retry.' : undefined});
        }
        return null;
      } finally {
        clearTimeout(timer);
        // Ambiguous submitted requests retain their quota reservation.
        if (reservation?.allowed && !submitted) await quota.release(reservation);
        if (jobs.get(key) === job) jobs.delete(key);
      }
    });
    return job.promise;
  }
  return { select, explain, cancel, credentialsChanged };
}
