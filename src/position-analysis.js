import { Chess } from "chess.js";

export function legalBestMove(fen, analysis) {
  if (!analysis) return "";
  const chess = new Chess(fen);
  if (chess.isGameOver()) return "";
  const legal = chess.moves({ verbose: true }).map(move => `${move.from}${move.to}${move.promotion || ""}`);
  return [analysis.bestmove, analysis.pv?.split(/\s+/)[0]].find(uci => legal.includes(uci)) || "";
}

export async function evaluatePosition(node, engine, { moveTime, priority = 0, signal }) {
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  const chess = new Chess(node.fen);
  const terminal = chess.isGameOver();
  if (node.analysis?.moveTime >= moveTime && (terminal || legalBestMove(node.fen, node.analysis))) return node.analysis;
  let result = terminal
    ? { score: chess.isCheckmate() ? -10 : 0, bestmove: "", pv: "", moveTime }
    : await engine.evaluate(node.fen, moveTime, { priority, signal });
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  if (!terminal) {
    const bestmove = legalBestMove(node.fen, result);
    if (!bestmove) {
      engine.invalidate(node.fen, moveTime);
      throw new Error("Engine returned no legal best move. Retry analysis.");
    }
    result = { ...result, bestmove };
  }
  const whiteScore = result.score === 0 ? 0 : node.fen.split(" ")[1] === "w" ? result.score : -result.score;
  const analysis = { ...result, whiteScore, terminal };
  if (!node.analysis || node.analysis.moveTime <= moveTime || (!terminal && !legalBestMove(node.fen, node.analysis))) node.analysis = analysis;
  node.positionError = "";
  return analysis;
}
