import { positionHistory } from './position-analysis.js';

export const rootIdentity = node => JSON.stringify(positionHistory(node));
// Missing provenance must never authorize historical cache reuse.
export function verifiedPrevious(result, node, version, time) {
  const evidence = result?.classificationEvidence;
  return result?.classificationVersion === version && result.reviewQuality?.complete &&
    result.reviewQuality.baseTime >= time && evidence?.confirmed &&
    evidence.comparison?.root === rootIdentity(node.parent) &&
    evidence.comparison.playedMove === `${node.move.from}${node.move.to}${node.move.promotion || ''}` &&
    evidence.comparison.mover === node.move.color;
}

export function mateTransition(before, played) {
  if (before.mate > 0 && played.mate > 0) return 'preserved-win';
  if (before.mate < 0 && played.mate < 0) return 'existing-forced-loss';
  if (played.mate < 0 && before.mate >= 0) return before.chances <= 10 ? 'confirmed-already-losing' : 'new-forced-loss';
  if (before.mate > 0 && !played.mate) return 'missed-mate';
  return 'ordinary';
}
