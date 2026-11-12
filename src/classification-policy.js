// Provisional SCR policy. Keep exceptional labels conservative in decided games.
export const EXCEPTIONAL_POLICY = Object.freeze({
  sacrificeAlternative: 75, conversionAlternative: 90, conversionGap: 10,
  criticalGap: 12, winningChances: 85, winningAlternative: 70, winningGap: 15,
  delayedPlies: 6
});

export function brilliantAlternative(played, alternative) {
  const p = EXCEPTIONAL_POLICY;
  return Boolean(alternative && (alternative.chances < p.sacrificeAlternative ||
    (alternative.chances < p.conversionAlternative && played.chances - alternative.chances >= p.conversionGap)));
}

export function criticalAlternative(played, alternative) {
  if (!alternative) return false;
  const p = EXCEPTIONAL_POLICY, gap = played.chances - alternative.chances;
  return gap >= p.criticalGap && ((played.chances >= 48 && alternative.chances <= 35) ||
    (played.chances >= 70 && alternative.chances <= 55) ||
    (played.chances >= p.winningChances && alternative.chances <= p.winningAlternative && gap >= p.winningGap));
}

export function isRecapture(move, previous) {
  return Boolean(move?.captured && previous?.captured && previous.to === move.to);
}
