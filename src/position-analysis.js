import { Chess } from "chess.js";

export function positionHistory(node) {
  const moves = [];
  let root = node;
  while (root.parent && root.move) {
    moves.unshift(`${root.move.from}${root.move.to}${root.move.promotion || ""}`);
    root = root.parent;
  }
  return { fen: root.fen, moves };
}

export function chessAtNode(node) {
  const position = positionHistory(node);
  const chess = new Chess(position.fen);
  for (const uci of position.moves) chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess;
}

export function legalBestMove(fen, analysis) {
  if (!analysis) return "";
  const chess = new Chess(fen);
  if (chess.isGameOver()) return "";
  const legal = chess.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion || ""}`);
  return [analysis.bestmove, analysis.pv?.split(/\s+/)[0]].find(uci => legal.includes(uci)) || "";
}

export async function evaluatePosition(node, engine, { moveTime, priority = 0, signal, multiPv = 1, searchMoves = [], nodes } = {}) {
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  const chess = chessAtNode(node);
  const terminal = chess.isGameOver();
  const position = node.parent ? positionHistory(node) : undefined;
  const searchOptions = { priority, signal, position, multiPv, searchMoves, nodes };
  const signature = JSON.stringify([position, multiPv, searchMoves, nodes]);
  const normalSearch = multiPv === 1 && !searchMoves.length && !nodes;
  if (normalSearch && node.analysis?.moveTime >= moveTime &&
    (!node.analysis.signature || node.analysis.signature === signature) &&
    (terminal || legalBestMove(node.fen, node.analysis))) return node.analysis;
  let result = terminal
    ? { score: chess.isCheckmate() ? -10 : 0, scoreType: chess.isCheckmate() ? "mate" : "cp", rawScore: 0,
      outcome: chess.isCheckmate() ? "checkmate" : "draw", bestmove: "", pv: "", moveTime,
      depth: 0, complete: true, stable: true, candidates: [] }
    : await engine.evaluate(node.fen, moveTime, searchOptions);
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  if (!terminal) {
    const bestmove = legalBestMove(node.fen, result);
    if (!bestmove) {
      engine.invalidate(node.fen, moveTime, searchOptions);
      throw new Error("Engine returned no legal best move. Retry analysis.");
    }
    result = { ...result, bestmove };
  }
  const whiteScore = result.score === 0 ? 0 : node.fen.split(" ")[1] === "w" ? result.score : -result.score;
  const analysis = { ...result, whiteScore, terminal, signature };
  if (normalSearch && (!node.analysis || node.analysis.moveTime <= moveTime ||
    (!terminal && !legalBestMove(node.fen, node.analysis)))) node.analysis = analysis;
  node.positionError = "";
  return analysis;
}
