import { Chess } from "chess.js";

export const CLASSIFICATION_VERSION = 2;
// Percentage-point losses, calibrated against the human-game curve documented
// at https://lichess.org/page/accuracy. These are SCR rules, not Chess.com's model.
export const QUALITY_THRESHOLDS = Object.freeze({ excellent: 2, good: 5, inaccuracy: 10, mistake: 20 });
const VALUES = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 0 };
export const uciMove = move => `${move.from}${move.to}${move.promotion || ""}`;
export const playUci = (chess, uci) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

export function winningChances(pawns) {
  return 100 / (1 + Math.exp(-0.368208 * pawns));
}

// All returned scores are from the player who made the move's perspective.
export function playerEvaluation(analysis, turn, mover) {
  const sign = turn === mover ? 1 : -1;
  const mate = analysis.outcome === "checkmate" ? -sign
    : analysis.scoreType === "mate" ? Math.sign(analysis.rawScore) * sign : 0;
  const pawns = analysis.score * sign;
  return { pawns, mate, mateDistance: analysis.scoreType === "mate" ? Math.abs(analysis.rawScore) : null,
    chances: analysis.outcome === "draw" ? 50 : mate ? (mate > 0 ? 100 : 0) : winningChances(pawns) };
}

export function reliableSearch(analysis) {
  return !analysis.bound && analysis.depth >= 14 && analysis.stable === true;
}

export function materialBalance(fen, color) {
  return new Chess(fen).board().flat().reduce((sum, piece) => !piece ? sum
    : sum + (piece.color === color ? 1 : -1) * VALUES[piece.type], 0);
}

// Static exchange minimax: each side may stop capturing, or choose any legal
// recapture on the square. Legality handles pins, kings and promotions.
function exchangeBalance(chess, square, color, remaining = 8) {
  const current = materialBalance(chess.fen(), color);
  if (!remaining) return current;
  const outcomes = [current];
  for (const move of chess.moves({ verbose: true }).filter(move => move.to === square && move.captured)) {
    chess.move(move);
    outcomes.push(exchangeBalance(chess, square, color, remaining - 1));
    chess.undo();
  }
  return chess.turn() === color ? Math.max(...outcomes) : Math.min(...outcomes);
}

export function sacrificeCandidates(beforeFen, afterFen, played) {
  if (!played) return [];
  const before = new Chess(beforeFen);
  const after = new Chess(afterFen);
  const baseline = materialBalance(beforeFen, played.color);
  const oldFields = beforeFen.split(" ");
  oldFields[1] = after.turn();
  oldFields[3] = "-";
  const opponentBefore = new Chess(oldFields.join(" "));
  const candidates = [];
  for (const capture of after.moves({ verbose: true })) {
    if (!capture.captured || ["p", "k"].includes(capture.captured)) continue;
    // A promotion creates material rather than offering a pre-existing piece.
    if (played.promotion && capture.to === played.to) continue;
    // Do not rediscover a piece that was already available to the opponent.
    const originalSquare = capture.to === played.to ? played.from : capture.to;
    if (!before.get(originalSquare)) continue;
    const alreadyLost = opponentBefore.moves({ verbose: true }).filter(move => move.to === originalSquare && move.captured)
      .some(move => {
        opponentBefore.move(move);
        const loss = baseline - exchangeBalance(opponentBefore, originalSquare, played.color);
        opponentBefore.undo();
        return loss >= 1.5;
      });
    if (alreadyLost) continue;
    const sim = new Chess(afterFen);
    sim.move(capture);
    const loss = baseline - exchangeBalance(sim, capture.to, played.color);
    if (loss < 1.5) continue;
    // A lower-valued capture of a defended piece can still be an exchange sacrifice.
    candidates.push({ uci: uciMove(capture), san: capture.san, square: capture.to,
      piece: capture.captured, loss, fen: sim.fen(), move: capture });
  }
  return candidates;
}

export function classifyEvidence({ before, played, isBest, lossCp, legalMovesCount,
  opening, critical = false, sacrifice = null, opponentOpportunity = false, confirmed = false }) {
  const loss = Math.max(0, before.chances - played.chances);
  const t = QUALITY_THRESHOLDS;
  const severity = loss >= t.mistake ? "blunder" : loss >= t.inaccuracy ? "mistake" : loss >= t.good ? "inaccuracy"
    : loss > t.excellent ? "good" : "excellent";
  const missedMate = before.mate > 0 && !played.mate;
  const missedOpportunity = opponentOpportunity && before.chances >= 70 && played.chances <= 60 && loss >= 8;
  const result = (key, reason) => ({ key, reason, severity, chanceLoss: loss,
    missedOpportunity, missedMate, confirmed });
  if (legalMovesCount === 1) return result("forced", "There was exactly one legal move.");
  if ((played.mate < 0 && before.mate >= 0) || loss >= t.mistake) {
    return result("blunder", played.mate < 0 ? "This allows a forced checkmate that could have been avoided."
      : `This loses ${loss.toFixed(1)} percentage points of estimated winning chances.`);
  }
  if (confirmed && missedOpportunity) return result("miss", "The opponent offered a winning opportunity, but this move lets it slip away.");
  if (loss >= t.inaccuracy) return result("mistake", `This loses ${loss.toFixed(1)} percentage points of estimated winning chances.`);
  if (loss >= t.good) return result("inaccuracy", "A stronger continuation would preserve more of the position's chances.");
  if (opening && loss <= t.excellent && lossCp <= 30 && !missedMate && !played.mate) {
    return result("book", `Recognized opening line: ${opening.eco} — ${opening.name}.`);
  }
  // Near-equivalence requires a score tolerance too: saturated winning-chance
  // curves must not turn every move in an already won/lost position into Best.
  const equivalent = Math.abs(before.pawns - played.pawns) <= 0.100001 && lossCp <= 10 && loss <= 0.5 && before.mate === played.mate;
  if ((isBest && loss <= 2) || equivalent || (before.mate > 0 && played.mate > 0)) {
    if (confirmed && sacrifice?.verified && played.chances >= 48) {
      return result("brilliant", "A sound piece sacrifice: deeper analysis confirms compensation if the opponent accepts it.");
    }
    if (confirmed && critical) return result("great", "A critical find: the strongest alternative substantially worsens the outcome.");
    return result("best", before.mate > 0 && played.mate > 0
      ? "This preserves forced checkmate." : "This is Stockfish's best move or an equivalent continuation.");
  }
  return result(severity, severity === "excellent" ? "Almost as strong as Stockfish's best continuation."
    : "A playable move, with a small concession compared with Stockfish's recommendation.");
}

export function moveAccuracy(move) {
  const loss = Number.isFinite(move.chanceLoss) ? move.chanceLoss
    : Math.max(0, winningChances((move.lossCp || 0) / 100) - 50);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669));
}

export function gameAccuracy(moves) {
  const scored = (moves || []).filter(move => move && move.key !== "forced");
  if (!scored.length) return moves?.length ? 100 : 0;
  const scores = scored.map(moveAccuracy);
  const harmonic = scores.some(score => score === 0) ? 0 : scores.length / scores.reduce((sum, score) => sum + 1 / score, 0);
  // Weight moves where the position was changing, using a five-move local window.
  const weights = scored.map((move, i) => {
    const window = scored.slice(Math.max(0, i - 2), i + 3).flatMap(item => [item.beforeChances, item.afterChances]).filter(Number.isFinite);
    if (!window.length) return 1;
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    return Math.max(0.5, Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length));
  });
  const weighted = scores.reduce((sum, score, i) => sum + score * weights[i], 0) / weights.reduce((sum, value) => sum + value, 0);
  return Math.round((weighted + harmonic) / 2 * 10) / 10;
}
