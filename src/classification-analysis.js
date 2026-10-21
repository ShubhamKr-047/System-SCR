import { Chess } from "chess.js";
import { lookupOpening } from "./openings.js";
import { chessAtNode } from "./position-analysis.js";
import { CLASSIFICATION_VERSION, classifyEvidence, materialBalance, playerEvaluation,
  playUci, reliableSearch, sacrificeCandidates, uciMove } from "./move-quality.js";

const turnOf = node => node.fen.split(" ")[1];
const asPlayer = (analysis, node, color) => playerEvaluation(analysis, turnOf(node), color);
const lineFor = (analysis, uci) => analysis.bestmove === uci ? analysis
  : analysis.candidates?.find(line => line.pv.split(" ")[0] === uci);
const normal = (evaluate, node, options, time) => evaluate(node, { ...options, moveTime: time, multiPv: 1, searchMoves: [] });

function completed(analysis) {
  return analysis.terminal || reliableSearch(analysis);
}

function opportunityFromPrevious(node, current) {
  const previous = node.parent;
  const old = previous.result;
  if (old?.classificationVersion === CLASSIFICATION_VERSION) return old.chanceLoss >= 8;
  // Selected variations may be analyzed before their parent move is reviewed.
  if (!previous.parent?.analysis || !current) return false;
  const mover = node.move.color;
  const earlier = asPlayer(previous.parent.analysis, previous.parent, mover);
  return asPlayer(current, previous, mover).chances - earlier.chances >= 8;
}

function hasPersistentDeficit(candidate, analysis, baseline, color) {
  const chess = new Chess(candidate.fen);
  let plies = 0;
  for (const uci of (analysis.pv || "").split(/\s+/).slice(0, 4)) {
    try { playUci(chess, uci); plies++; } catch { break; }
    if (chess.isCheckmate()) return chess.turn() !== color;
  }
  return plies >= 2 && baseline - materialBalance(chess.fen(), color) >= 1.5;
}

async function verifySacrifice(node, candidates, evaluate, options, time) {
  // Ambiguous positions get an ordinary quality label rather than an unverified !!.
  if (!candidates.length || candidates.length > 4) return null;
  const baseline = materialBalance(node.parent.fen, node.move.color);
  const evidence = [];
  for (const candidate of candidates) {
    const child = { parent: node, move: candidate.move, fen: candidate.fen };
    const analysis = await normal(evaluate, child, options, time);
    const accepted = asPlayer(analysis, child, node.move.color);
    if (!completed(analysis) || accepted.chances < 48 || accepted.mate < 0) return null;
    // A static offer can turn out to recover material elsewhere immediately.
    // Exclude that offer, while allowing a different genuine sacrifice to qualify.
    if (!hasPersistentDeficit(candidate, analysis, baseline, node.move.color)) continue;
    evidence.push({ capture: candidate.uci, san: candidate.san, piece: candidate.piece, square: candidate.square,
      materialOffered: candidate.loss, evaluation: accepted, search: analysis });
  }
  return evidence.length ? { verified: true, acceptances: evidence } : null;
}

export async function analyzeClassification(node, evaluate, options = {}) {
  const time = options.moveTime || 250;
  const color = node.move.color;
  const playedUci = uciMove(node.move);
  const beforeChess = chessAtNode(node.parent);
  const afterChess = chessAtNode(node);
  const legalMovesCount = beforeChess.moves().length;
  const opening = lookupOpening(node.parent.fen, playedUci);
  let before = await normal(evaluate, node.parent, options, time);
  let after = await normal(evaluate, node, options, time);
  if (afterChess.isGameOver()) after = { ...after, terminal: true,
    outcome: afterChess.isCheckmate() ? "checkmate" : "draw",
    score: afterChess.isCheckmate() ? -10 : 0, scoreType: afterChess.isCheckmate() ? "mate" : "cp", rawScore: 0 };
  let playedSearch = after.terminal ? null : playedUci === before.bestmove ? before
    : await evaluate(node.parent, { ...options, moveTime: time, searchMoves: [playedUci] });
  const evidenceScores = () => ({
    best: asPlayer(before, node.parent, color),
    played: playedSearch ? asPlayer(playedSearch, node.parent, color) : asPlayer(after, node, color)
  });
  let { best, played } = evidenceScores();
  const cpLoss = () => Math.max(0, Math.min(1000, (best.pawns - played.pawns) * 100));
  const loss = () => Math.max(0, best.chances - played.chances);
  const sacrificeOffers = sacrificeCandidates(node.parent.fen, node.fen, node.move);
  const routineRecapture = node.move.captured && node.parent.move?.to === node.move.to;
  const bookQuality = () => opening && loss() <= 2 && cpLoss() <= 30;
  const nearBest = () => loss() <= 2 && (playedUci === before.bestmove || cpLoss() <= 10);
  const confirmationTime = Math.min(2500, Math.max(1000, time * 2));
  const mateTransition = best.mate !== played.mate;
  const borderline = [2, 5, 10, 20].some(threshold => Math.abs(loss() - threshold) < 1);
  const inconsistent = played.chances > best.chances + 1 || played.pawns > best.pawns + 0.3;
  const opportunity = opportunityFromPrevious(node, before);
  const possibleMiss = opportunity && best.chances >= 70 && played.chances <= 60 && loss() >= 8;
  let alternatives = null;
  // Only exceptional candidates pay for multi-line analysis. Ordinary review
  // retains the stronger single-line search and adds a played-move search.
  if (legalMovesCount > 1 && nearBest() && !bookQuality() && !after.terminal &&
    played.chances >= 48 && (!routineRecapture || sacrificeOffers.length)) {
    alternatives = await evaluate(node.parent, { ...options, moveTime: confirmationTime, multiPv: 2, searchMoves: [] });
    if (!alternatives.complete || !reliableSearch(alternatives) ||
      !alternatives.candidates?.every(reliableSearch)) {
      alternatives = await evaluate(node.parent, { ...options, moveTime: Math.min(2500, confirmationTime * 2),
        multiPv: 2, searchMoves: [] });
    }
    before = alternatives;
    playedSearch = lineFor(alternatives, playedUci) || await evaluate(node.parent,
      { ...options, moveTime: confirmationTime, searchMoves: [playedUci] });
    ({ best, played } = evidenceScores());
  } else if ((mateTransition || borderline || inconsistent || possibleMiss || loss() >= 10) && !afterChess.isCheckmate()) {
    before = await normal(evaluate, node.parent, options, confirmationTime);
    playedSearch = after.terminal ? null : playedUci === before.bestmove ? before : await evaluate(node.parent,
      { ...options, moveTime: confirmationTime, searchMoves: [playedUci] });
    ({ best, played } = evidenceScores());
  }
  const confirmed = completed(before) && (playedSearch ? completed(playedSearch) : after.terminal);
  const other = alternatives?.candidates?.find(line => line.pv.split(" ")[0] !== playedUci);
  const alternativeScore = other ? asPlayer(other, node.parent, color) : null;
  const hasAlternatives = alternatives?.complete && reliableSearch(alternatives) && other &&
    reliableSearch(other) && other.depth === alternatives.depth;
  const gap = alternativeScore ? played.chances - alternativeScore.chances : 0;
  const critical = Boolean(hasAlternatives && !routineRecapture && gap >= 12 &&
    ((played.chances >= 48 && alternativeScore.chances <= 35) ||
      (played.chances >= 70 && alternativeScore.chances <= 55)));
  let sacrifice = null;
  if (confirmed && hasAlternatives && nearBest() && sacrificeOffers.length &&
    played.chances >= 48 && alternativeScore.chances < 75) {
    // Verify the opponent's strongest response too, not only accepting the offer.
    after = await normal(evaluate, node, options, confirmationTime);
    if (completed(after) && asPlayer(after, node, color).chances >= 48) {
      sacrifice = await verifySacrifice(node, sacrificeOffers, evaluate, options, confirmationTime);
    }
  }
  let verifiedOpportunity = false;
  let opportunityEvidence = null;
  if (confirmed && opportunity && best.chances >= 70 && played.chances <= 60 && loss() >= 8 && loss() < 20 && node.parent.parent) {
    const previous = node.parent;
    const previousBest = await normal(evaluate, previous.parent, options, confirmationTime);
    const previousPlayed = await evaluate(previous.parent, { ...options, moveTime: confirmationTime,
      searchMoves: [uciMove(previous.move)] });
    const previousColor = previous.move.color;
    const dropped = asPlayer(previousBest, previous.parent, previousColor).chances -
      asPlayer(previousPlayed, previous.parent, previousColor).chances;
    verifiedOpportunity = completed(previousBest) && completed(previousPlayed) && dropped >= 8;
    opportunityEvidence = { best: previousBest, played: previousPlayed, chanceLoss: dropped };
  }
  const classification = classifyEvidence({ before: best, played, isBest: playedUci === before.bestmove,
    lossCp: cpLoss(), legalMovesCount, opening: after.terminal ? null : opening, critical, sacrifice,
    opponentOpportunity: verifiedOpportunity, confirmed });
  return { before, after, playedSearch, best, played, classification,
    lossCp: cpLoss(), opening, legalMovesCount, sacrifice, alternatives, opportunityEvidence,
    classificationVersion: CLASSIFICATION_VERSION };
}
