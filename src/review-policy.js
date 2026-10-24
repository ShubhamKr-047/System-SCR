import { CLASSIFICATION_VERSION } from "./move-quality.js";

export const REVIEW_POLICY_VERSION = 1;

export function reviewPolicy(time = 250) {
  return {
    screen: Math.min(250, Math.max(150, time * 0.8)),
    confirmation: Math.min(1000, Math.max(600, time)),
    refinement: Math.min(4000, Math.max(2500, time * 4)),
    // This is additional engine time, beyond the ordinary first pass.
    gameRefinement: count => Math.max(2500, count * Math.min(400, time * 0.8))
  };
}

export function hasReview(node, time, { complete = true } = {}) {
  const result = node.result;
  return result?.classificationVersion === CLASSIFICATION_VERSION &&
    result.reviewQuality?.version === REVIEW_POLICY_VERSION &&
    result.reviewQuality.baseTime >= time && (!complete || result.reviewQuality.complete);
}

export async function reviewGame(nodes, { moveTime = 250, analyze, signal, onProgress = () => {},
  selected = () => null } = {}) {
  const checkCancelled = () => { if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError"); };
  const initial = () => nodes.filter(node => hasReview(node, moveTime, { complete: false })).length;
  onProgress({ phase: "initial", completed: initial(), total: nodes.length });
  for (const node of nodes) {
    checkCancelled();
    if (!hasReview(node, moveTime, { complete: false })) {
      await analyze(node, { moveTime, signal, refine: false });
      checkCancelled();
      onProgress({ phase: "initial", completed: initial(), total: nodes.length });
    }
  }
  const pending = nodes.filter(node => !hasReview(node, moveTime));
  const checks = pending.length;
  const used = nodes.filter(node => hasReview(node, moveTime))
    .reduce((total, node) => total + (node.result.refinement?.spentMs || 0), 0);
  let remaining = Math.max(0, reviewPolicy(moveTime).gameRefinement(nodes.length) - used);
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
      await analyze(node, { moveTime, signal, refine: true, refinementBudget: remaining });
      checkCancelled();
      remaining = Math.max(0, remaining - node.result.refinement.spentMs);
    }
    checked++;
  }
  onProgress({ phase: "done", completed: nodes.length, total: nodes.length });
}
