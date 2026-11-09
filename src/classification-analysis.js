import { Chess } from "chess.js";
import { lookupOpening } from "./openings.js";
import { DEFAULT_REVIEW_TIME, reviewPolicy } from "./review-policy.js";
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
  // A first-pass parent may still change. Treat it as a candidate opportunity,
  // then require the same verified preceding-move evidence before awarding Miss.
  if (old?.classificationVersion === CLASSIFICATION_VERSION) return old.chanceLoss >= 8 || old.reviewQuality?.complete === false;
  // Selected variations may be analyzed before their parent move is reviewed.
  if (!previous.parent?.analysis || !current) return false;
  const mover = node.move.color;
  const earlier = asPlayer(previous.parent.analysis, previous.parent, mover);
  return asPlayer(current, previous, mover).chances - earlier.chances >= 8;
}

function hasPersistentDeficit(candidate, analysis, baseline, color) {
  const chess = new Chess(candidate.fen);
  let plies = 0;
  let sustained = false;
  for (const uci of (analysis.pv || "").split(/\s+/).slice(0, 10)) {
    try { playUci(chess, uci); plies++; } catch { break; }
    if (chess.isCheckmate()) return chess.turn() !== color;
    if (plies >= 2 && baseline - materialBalance(chess.fen(), color) >= 1.5) sustained = true;
  }
  return sustained;
}

async function verifySacrifice(node, candidates, evaluate, options, time) {
  // Ambiguous positions get an ordinary quality label rather than an unverified !!.
  if (!candidates.length || candidates.length > 4) return null;
  const baseline = materialBalance(node.parent.fen, node.move.color);
  const evidence = [];
  for (const candidate of candidates) {
    const child = { parent: node, move: candidate.move, fen: candidate.fen };
    const analysis = await normal(evaluate, child, options, time);
    if (!analysis) return null;
    const accepted = asPlayer(analysis, child, node.move.color);
    if (!completed(analysis)) return null;
    if (accepted.chances < 48 || accepted.mate < 0) return { verified: false, rejected: true };
    // A static offer can turn out to recover material elsewhere immediately.
    // Exclude that offer, while allowing a different genuine sacrifice to qualify.
    if (!hasPersistentDeficit(candidate, analysis, baseline, node.move.color)) continue;
    evidence.push({ capture: candidate.uci, san: candidate.san, piece: candidate.piece, square: candidate.square,
      materialOffered: candidate.loss, evaluation: accepted, search: analysis });
  }
  return evidence.length ? { verified: true, acceptances: evidence } : { verified: false, rejected: true };
}

export async function analyzeClassification(node, evaluate, options = {}) {
  const time = options.moveTime || DEFAULT_REVIEW_TIME;
  const policy = reviewPolicy(time);
  const baseDepth = policy.depthTargets[0];
  options = { ...options, targetDepth: baseDepth };
  const searchTime = options.searchTime || node.result?.reviewQuality?.searchTime || time;
  const color = node.move.color;
  const playedUci = uciMove(node.move);
  const beforeChess = chessAtNode(node.parent);
  const afterChess = chessAtNode(node);
  const legalMovesCount = beforeChess.moves().length;
  const opening = lookupOpening(node.parent.fen, playedUci);
  let before = await normal(evaluate, node.parent, options, searchTime);
  let after = await normal(evaluate, node, options, searchTime);
  if (afterChess.isGameOver()) after = { ...after, terminal: true,
    outcome: afterChess.isCheckmate() ? "checkmate" : "draw",
    score: afterChess.isCheckmate() ? -10 : 0, scoreType: afterChess.isCheckmate() ? "mate" : "cp", rawScore: 0 };
  let playedSearch = after.terminal ? null : playedUci === before.bestmove ? before
    : await evaluate(node.parent, { ...options, moveTime: searchTime, searchMoves: [playedUci] });
  const evidenceScores = () => ({
    best: asPlayer(before, node.parent, color),
    played: playedSearch ? asPlayer(playedSearch, node.parent, color) : asPlayer(after, node, color)
  });
  let { best, played } = evidenceScores();
  const cpLoss = () => Math.max(0, Math.min(1000, (best.pawns - played.pawns) * 100));
  const loss = () => Math.max(0, best.chances - played.chances);

  const routineRecapture = node.move.captured && node.parent.move?.to === node.move.to;
  const bookQuality = () => opening && loss() <= 2 && cpLoss() <= 30;
  const nearBest = () => loss() <= 2 && (playedUci === before.bestmove || cpLoss() <= 10);
  const mateTransition = best.mate !== played.mate;
  const mateDisagreement = asPlayer(after, node, color).mate !== played.mate;
  // Chance loss saturates in heavily losing positions. A king move or check
  // evasion can still newly allow forced mate despite a tiny numeric change.
  const kingDanger = !played.mate && played.chances < 10 && loss() < 5 &&
    (node.move.piece === "k" || beforeChess.isCheck());
  const borderline = [2, 5, 10, 20].some(threshold => Math.abs(loss() - threshold) < 0.75);
  const inconsistent = played.chances > best.chances + 1 || played.pawns > best.pawns + 0.3;
  const opportunity = opportunityFromPrevious(node, before);
  const possibleMiss = opportunity && best.chances >= 70 && played.chances <= 60 && loss() >= 8;
  const uncertain = !completed(before) || !(playedSearch ? completed(playedSearch) : after.terminal);
  const exceptional = legalMovesCount > 1 && loss() <= 5 && !after.terminal &&
    played.chances >= 48;
  // Static exchange analysis is useful only for a plausible exceptional move.
  const sacrificeOffers = exceptional ? sacrificeCandidates(node.parent.fen, node.fen, node.move) : [];
  const compareAlternatives = exceptional && (!bookQuality() || sacrificeOffers.length) && (!routineRecapture || sacrificeOffers.length);
  const recheck = legalMovesCount > 1 && !afterChess.isCheckmate() &&
    (mateTransition || mateDisagreement || kingDanger || inconsistent || possibleMiss || (uncertain && (borderline || loss() >= 5)));
  const reasons = [recheck && (mateTransition || mateDisagreement || kingDanger) && 'mate', recheck && inconsistent && 'inconsistent', recheck && possibleMiss && 'miss',
    recheck && 'uncertain', compareAlternatives && (sacrificeOffers.length ? 'sacrifice' : 'alternatives')].filter(Boolean);
  const candidateLimit = sacrificeOffers.length ? Math.max(6000, policy.refinement) : policy.refinement;
  const budget = Math.max(0, Math.min(candidateLimit, options.refinementBudget ?? candidateLimit));
  let spent = 0;
  const failedChecks = [];
  const extra = async (position, requested, searchOptions = {}) => {
    const wallRemaining = options.deadline == null ? Infinity : options.deadline - performance.now();
    // Charge conservatively: a node cache may hold a different depth target or
    // history signature and cannot be assumed to make this request free.
    const available = Math.min(requested, budget - spent, wallRemaining);
    if (available < 100) return null;
    spent += available;
    try {
      return await evaluate(position, { ...options, moveTime: available, multiPv: 1, searchMoves: [], retry: false, targetDepth: searchOptions.multiPv ? policy.depthTargets[1] : policy.depthTargets[2], ...searchOptions });
    } catch (error) {
      if (error.name === "AbortError" || options.signal?.aborted) throw error;
      // Optional verification may be inconclusive at a tight search limit.
      // Keep the valid ordinary result; never synthesize an evaluation.
      failedChecks.push(error.message);
      return null;
    }
  };
  let alternatives = null;
  if (options.refine !== false && recheck) {
    // Reserve enough budget for both sides of a disputed comparison.
    const confirmation = kingDanger || mateDisagreement ? Math.max(1000, policy.confirmation) : policy.confirmation;
    const each = Math.min(confirmation, Math.floor((budget - spent) / (after.terminal ? 1 : 2)));
    const stronger = await extra(node.parent, each);
    if (stronger) {
      const evaluated = after.terminal ? null : playedUci === stronger.bestmove ? stronger :
        await extra(node.parent, each, { searchMoves: [playedUci] });
      if (after.terminal || evaluated) {
        before = stronger;
        playedSearch = evaluated;
        ({ best, played } = evidenceScores());
      }
    }
  }
  if (options.refine !== false && compareAlternatives) {
    // A short screen finds a meaningful gap. An inconclusive ordinary best move
    // never triggers the old unconditional 1s + 2s MultiPV retry sequence.
    alternatives = await extra(node.parent, policy.screen, { multiPv: 2 });
    const screenPlayed = alternatives && lineFor(alternatives, playedUci);
    const screenOther = alternatives?.candidates?.find(line => line.pv.split(' ')[0] !== playedUci);
    const screenGap = screenPlayed && screenOther ?
      asPlayer(screenPlayed, node.parent, color).chances - asPlayer(screenOther, node.parent, color).chances : 0;
    const strong = alternatives?.complete && completed(alternatives) &&
      alternatives.candidates?.every(completed);
    if (!strong && (sacrificeOffers.length || screenGap >= 8)) {
      alternatives = await extra(node.parent, sacrificeOffers.length ? Math.max(1200, policy.confirmation) : policy.confirmation, { multiPv: 2 }) || alternatives;
    }
    const compared = alternatives && lineFor(alternatives, playedUci);
    if (alternatives?.complete && compared && completed(alternatives) && completed(compared)) {
      before = alternatives;
      playedSearch = compared;
      ({ best, played } = evidenceScores());
    }
  }
  const confirmed = completed(before) && (playedSearch ? completed(playedSearch) : after.terminal);
  const other = alternatives?.candidates?.find(line => line.pv.split(' ')[0] !== playedUci);
  const alternativeScore = other ? asPlayer(other, node.parent, color) : null;
  const hasAlternatives = alternatives?.complete && before === alternatives && reliableSearch(alternatives) && other &&
    reliableSearch(other) && other.depth === alternatives.depth;
  const gap = alternativeScore ? played.chances - alternativeScore.chances : 0;
  const critical = Boolean(hasAlternatives && !routineRecapture && gap >= 12 &&
    ((played.chances >= 48 && alternativeScore.chances <= 35) ||
      (played.chances >= 70 && alternativeScore.chances <= 55)));
  let sacrifice = null;
  if (options.refine !== false && confirmed && hasAlternatives && nearBest() && sacrificeOffers.length &&
    played.chances >= 48 && alternativeScore.chances < 75) {
    // Reserve a fair share for the strongest reply and every acceptance. No
    // partially checked sacrifice can earn Brilliant when its budget expires.
    const each = Math.min(Math.max(1000, policy.confirmation), Math.floor((budget - spent) / (sacrificeOffers.length + 1)));
    const reply = await extra(node, each);
    if (reply && completed(reply) && asPlayer(reply, node, color).chances >= 48) {
      after = reply;
      sacrifice = await verifySacrifice(node, sacrificeOffers,
        (position, opts) => extra(position, opts.moveTime), options, each);
    }
  }
  let verifiedOpportunity = false;
  let opportunityEvidence = null;
  if (options.refine !== false && confirmed && possibleMiss && best.chances >= 70 && played.chances <= 60 &&
    loss() >= 8 && node.parent.parent) {
    const previous = node.parent;
    // Reuse verified same-root evidence, including a preceding review result.
    const old = previous.result;
    const cached = old?.classificationVersion === CLASSIFICATION_VERSION && old.classificationEvidence?.confirmed &&
      old.reviewQuality?.baseTime >= time && old.reviewQuality.complete;
    if (cached) {
      verifiedOpportunity = old.chanceLoss >= 8;
      opportunityEvidence = { reused: true, chanceLoss: old.chanceLoss };
    } else {
      const each = Math.min(policy.confirmation, Math.floor((budget - spent) / 2));
      const previousBest = await extra(previous.parent, each);
      const previousPlayed = previousBest && await extra(previous.parent, each,
        { searchMoves: [uciMove(previous.move)] });
      if (previousBest && previousPlayed) {
        const previousColor = previous.move.color;
        const dropped = asPlayer(previousBest, previous.parent, previousColor).chances -
          asPlayer(previousPlayed, previous.parent, previousColor).chances;
        verifiedOpportunity = completed(previousBest) && completed(previousPlayed) && dropped >= 8;
        opportunityEvidence = { best: previousBest, played: previousPlayed, chanceLoss: dropped };
      }
    }
  }
  const unresolved = [];
  if (reasons.includes("sacrifice") && !sacrifice) unresolved.push("sacrifice");
  if (reasons.includes("alternatives") && !hasAlternatives) unresolved.push("alternatives");
  if (possibleMiss && !opportunityEvidence) unresolved.push("miss");
  if (recheck && !confirmed) unresolved.push("evaluation");
  const refinement = { unresolved, verificationComplete: !unresolved.length, reasons, priority: mateTransition || mateDisagreement || kingDanger ? 4 : possibleMiss || inconsistent ? 3 :
    sacrificeOffers.length ? 2 : recheck ? 1 : 0, spentMs: spent, failedChecks,
    complete: options.refine !== false || !reasons.length };
  const classification = classifyEvidence({ before: best, played, isBest: playedUci === before.bestmove,
    lossCp: cpLoss(), legalMovesCount, opening: after.terminal ? null : opening,
    critical: critical && (!sacrificeOffers.length || Boolean(sacrifice)), sacrifice,
    opponentOpportunity: verifiedOpportunity, confirmed });
  return { before, after, playedSearch, best, played, classification,
    lossCp: cpLoss(), opening, legalMovesCount, sacrifice, alternatives, opportunityEvidence, refinement,
    classificationVersion: CLASSIFICATION_VERSION };
}
