import { Chess } from "chess.js";

// Validate the user's continuation before making the temporary line permanent.
export function commitContinuation(tree, base, frames, input) {
  const chess = new Chess(frames.at(-1)?.fen || base.fen);
  chess.move(input);
  tree.select(base);
  for (const { move } of frames) {
    tree.play({ from: move.from, to: move.to, promotion: move.promotion }, { variation: true });
  }
  return tree.play(input, { variation: true });
}

// Replay the displayed line from BEFORE the reviewed move, stopping at any
// invalid suffix. Preview positions never enter the user's game tree.
export function continuationFrames(result) {
  if (!result?.beforeFen) return [];
  try {
    const chess = new Chess(result.beforeFen);
    const line = result.pv || result.engineEvidence?.before?.pv || result.bestUci || result.bestSan || "";
    const frames = [];
    for (const token of line.trim().split(/\s+/).slice(0, 8)) {
      try {
        const input = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)
          ? { from: token.slice(0, 2), to: token.slice(2, 4), promotion: token[4] }
          : token;
        const move = chess.move(input);
        frames.push({ fen: chess.fen(), move });
      } catch { break; }
    }
    return frames;
  } catch { return []; }
}
