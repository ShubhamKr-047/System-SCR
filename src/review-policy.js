import { CLASSIFICATION_VERSION } from "./move-quality.js";

export const REVIEW_POLICY_VERSION = 4;
export const DEFAULT_REVIEW_TIME = 125;

export function reviewPolicy(time = DEFAULT_REVIEW_TIME) {
  const fast = time <= DEFAULT_REVIEW_TIME;
  const deep = time >= 1000;
  return {
    targetMs: fast ? 45000 : deep ? 90000 : 60000,
    initialMs: fast ? 15000 : deep ? 30000 : 20000,
    reserveMs: fast ? 5000 : deep ? 7000 : 5000,
    depthTargets: fast ? [14, 17, 18] : deep ? [18, 21, 22] : [16, 19, 20],
    screen: fast ? 100 : Math.min(250, Math.max(150, time * 0.8)),
    confirmation: Math.min(1000, Math.max(600, time)),
    refinement: Math.min(4000, Math.max(2500, time * 4))
  };
}

export function hasReview(node, time, { complete = true } = {}) {
  const result = node.result;
  return result?.classificationVersion === CLASSIFICATION_VERSION &&
    result.reviewQuality?.version === REVIEW_POLICY_VERSION &&
    result.reviewQuality.baseTime >= time && (!complete || result.reviewQuality.complete);
}

export async function reviewGame(nodes, { moveTime = DEFAULT_REVIEW_TIME, analyze, signal, onProgress = () => {},
  selected = () => null, now = () => performance.now() } = {}) {
  const policy = reviewPolicy(moveTime);
  const deadline = now() + policy.targetMs - policy.reserveMs;
  // At most two new root searches per ply after neighboring position reuse.
  const searchTime = Math.max(40, Math.min(moveTime, Math.floor(policy.initialMs / Math.max(1, nodes.length * 2 + 1))));
  const checkCancelled = () => { if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError"); };
  const initial = () => nodes.filter(node => hasReview(node, moveTime, { complete: false })).length;
  onProgress({ phase: "initial", completed: initial(), total: nodes.length });
  for (const node of nodes) {
    checkCancelled();
    if (!hasReview(node, moveTime, { complete: false })) {
      await analyze(node, { moveTime, searchTime, deadline, signal, refine: false });
      checkCancelled();
      onProgress({ phase: "initial", completed: initial(), total: nodes.length });
    }
  }
  const pending = nodes.filter(node => !hasReview(node, moveTime));
  const checks = pending.length;
  const used = nodes.filter(node => hasReview(node, moveTime))
    .reduce((total, node) => total + (node.result.refinement?.spentMs || 0), 0);
  let remaining = Math.max(0, policy.targetMs - policy.initialMs - policy.reserveMs - used);
  let checked = 0;
  while (pending.length) {
    checkCancelled();
    const current = selected();
    pending.sort((a, b) => (b === current ? 10 : b.result.refinement.priority) -
      (a === current ? 10 : a.result.refinement.priority) || a.ply - b.ply);
    const node = pending.shift();
    onProgress({ phase: "refinement", completed: checked, total: checks });
    // A zero remaining budget finalizes the supported ordinary label without
    // launching optional searches. Resume never discards the first-pass result.
    if (!hasReview(node, moveTime)) {
      await analyze(node, { moveTime, searchTime, deadline, signal, refine: true,
        refinementBudget: Math.max(0, Math.min(remaining, deadline - now())) });
      checkCancelled();
      remaining = Math.max(0, remaining - node.result.refinement.spentMs);
    }
    checked++;
  }
  onProgress({ phase: "done", completed: nodes.length, total: nodes.length });
}
