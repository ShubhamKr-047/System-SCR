import { Chess } from "chess.js";
import { classifyMove, isMaterialSacrifice } from "./classifications.js";

export async function analyzeMove(node, evaluate, options) {
  const playedMove = node.move;
  const newPly = node.ply - 1;
  const beforeFen = node.parent.fen;
  const afterFen = node.fen;
  const before = await evaluate(node.parent, options);
  const after = await evaluate(node, options);
  const beforeWhite = scoreWhite(before.score, beforeFen);
  let afterWhite = scoreWhite(after.score, afterFen);
  const mover = playedMove.color;

  let isDeliveringMate = false;
  try {
    const afterChess = new Chess(afterFen);
    isDeliveringMate = afterChess.isCheckmate() || playedMove.san.endsWith("#");
  } catch {
    isDeliveringMate = playedMove.san.endsWith("#");
  }

  if (isDeliveringMate) {
    afterWhite = mover === "w" ? 10 : -10;
  }

  const beforePlayer = mover === "w" ? beforeWhite : -beforeWhite;
  const afterPlayer = mover === "w" ? afterWhite : -afterWhite;

  const lossCp = isDeliveringMate ? 0 : Math.max(0, Math.min(1000, (beforePlayer - afterPlayer) * 100));

  const playedUci = `${playedMove.from}${playedMove.to}${playedMove.promotion || ""}`;
  const isBest = isDeliveringMate || before.bestmove === playedUci || lossCp <= 10;
  const isSacrifice = isMaterialSacrifice(beforeFen, afterFen, playedMove);

  let legalMovesCount = 10;
  try {
    legalMovesCount = new Chess(beforeFen).moves().length;
  } catch {}

  const classificationObj = classifyMove({
    lossCp,
    ply: newPly,
    isBest,
    beforePlayerScore: beforePlayer,
    afterPlayerScore: afterPlayer,
    legalMovesCount,
    capturedPiece: playedMove.captured,
    playedPiece: playedMove.piece,
    isSacrifice
  });

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

  let coachingTip = "";
  if (classificationObj.key === "brilliant") {
    coachingTip = `Brilliant play! You found a sharp tactical idea, sacrificing material to seize a decisive advantage.`;
  } else if (classificationObj.key === "great") {
    coachingTip = `Great find! You found the critical move to keep the upper hand or turn the tide.`;
  } else if (classificationObj.key === "miss") {
    coachingTip = `You had an opportunity to capitalize decisively. The engine prefers ${bestSan || "a sharper line"}.`;
  } else if (classificationObj.key === "blunder") {
    coachingTip = `Severe evaluation swing. Check for hanging pieces, unguarded squares, and forcing tactics before moving.`;
  } else if (classificationObj.key === "mistake") {
    coachingTip = `This gave away a chunk of your advantage. Compare your move with ${bestSan || "the engine suggestion"}.`;
  } else if (classificationObj.key === "inaccuracy") {
    coachingTip = `A slight concession. Notice how ${bestSan || "the engine line"} maintains more control and pressure.`;
  } else if (classificationObj.key === "best") {
    coachingTip = `Top-notch calculation. This is the optimal continuation that maximizes piece activity.`;
  } else {
    coachingTip = `Good practical choice. Continues developing and preserving a healthy position.`;
  }

  const result = {
    ply: newPly,
    san: playedMove.san,
    moveColor: mover,
    moveNo: `${beforeFen.split(" ")[5]}${mover === "w" ? "." : "..."}`,
    beforeWhite,
    afterWhite,
    lossCp,
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
      before: { score: beforeWhite, moveTime: before.moveTime, bestmove: before.bestmove, pv: before.pv || "" },
      after: { score: afterWhite, moveTime: after.moveTime, bestmove: after.bestmove, pv: after.pv || "" }
    }
  };

  return result;
}

function scoreWhite(engineScore, fen) {
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
