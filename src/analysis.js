import { Chess } from "chess.js";
import { CLASSIFICATIONS } from "./classifications.js";
import { analyzeClassification } from "./classification-analysis.js";

export async function analyzeMove(node, evaluate, options) {
  const playedMove = node.move;
  const newPly = node.ply - 1;
  const beforeFen = node.parent.fen;
  const afterFen = node.fen;
  const evidence = await analyzeClassification(node, evaluate, options);
  const { before, after, best, played, classification, opening } = evidence;
  const beforeWhite = scoreWhite(before.score, beforeFen);
  const afterWhite = scoreWhite(after.score, afterFen);
  const mover = playedMove.color;
  const lossCp = evidence.lossCp;
  const playedUci = `${playedMove.from}${playedMove.to}${playedMove.promotion || ""}`;
  const isSacrifice = Boolean(evidence.sacrifice?.verified);
  const classificationObj = CLASSIFICATIONS[classification.key];

  const bestSan = convertPvToSan(beforeFen, before.bestmove);

  let punishSan = "";
  let punishPv = "";
  let punishDetails = null;
  if (after?.bestmove) {
    punishSan = convertPvToSan(afterFen, after.bestmove);
    punishPv = after.pv ? convertPvToSan(afterFen, after.pv) : "";
    try {
      const ch = new Chess(afterFen);
      const u = after.bestmove;
      if (u && u.length >= 4) {
        punishDetails = ch.move({
          from: u.slice(0, 2),
          to: u.slice(2, 4),
          promotion: u[4] || "q"
        });
      }
    } catch {}
  }

  let bestDetails = null;
  if (before?.bestmove) {
    try {
      const ch = new Chess(beforeFen);
      const u = before.bestmove;
      if (u && u.length >= 4) {
        bestDetails = ch.move({
          from: u.slice(0, 2),
          to: u.slice(2, 4),
          promotion: u[4] || "q"
        });
      }
    } catch {}
  }

  const coachingTip = classification.reason;

  const result = {
    ply: newPly,
    san: playedMove.san,
    moveColor: mover,
    moveNo: `${beforeFen.split(" ")[5]}${mover === "w" ? "." : "..."}`,
    beforeWhite,
    afterWhite,
    lossCp,
    classificationVersion: evidence.classificationVersion,
    chanceLoss: classification.chanceLoss,
    beforeChances: best.chances,
    afterChances: played.chances,
    classificationReason: classification.reason,
    classificationEvidence: { ...classification, opening, legalMovesCount: evidence.legalMovesCount,
      sacrifice: evidence.sacrifice, alternatives: evidence.alternatives?.candidates || [],
      opportunity: evidence.opportunityEvidence },
    key: classificationObj.key,
    label: classificationObj.name,
    sign: classificationObj.sign,
    color: classificationObj.color,
    textColor: classificationObj.textColor,
    explanation: classificationObj.description,
    coachingTip,
    pv: before.pv ? convertPvToSan(beforeFen, before.pv) : "",
    bestUci: before.bestmove,
    bestSan,
    bestDetails,
    punishSan,
    punishPv,
    punishDetails,
    playedPiece: playedMove.piece,
    capturedPiece: playedMove.captured,
    from: playedMove.from,
    to: playedMove.to,
    isSacrifice,
    beforeFen,
    afterFen,
    playedUci,
    engineEvidence: {
      classificationVersion: evidence.classificationVersion,
      before: { ...before, score: beforeWhite, scorePerspective: "White" },
      played: evidence.playedSearch ? { ...evidence.playedSearch, scorePerspective: "mover" } : null,
      after: { ...after, score: afterWhite, scorePerspective: "White" }
    }
  };

  return result;
}

function scoreWhite(engineScore, fen) {
  if (engineScore === 0) return 0;
  const turn = fen.split(" ")[1];
  return turn === "w" ? engineScore : -engineScore;
}

function convertPvToSan(fen, pv) {
  const c = new Chess(fen);
  const sanMoves = [];
  for (const uci of pv.split(/\s+/).slice(0, 8)) {
    if (!uci || uci.length < 4 || uci === "(none)") break;
    try {
      const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
      if (!move) { sanMoves.push(uci); break; }
      sanMoves.push(move.san);
    } catch {
      sanMoves.push(uci);
      break;
    }
  }
  return sanMoves.join(" ");
}
