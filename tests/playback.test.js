import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { continuationFrames } from "../src/playback.js";

test("preview replays recommendations from before the played move, without changing its source", () => {
  const before = new Chess();
  const result = { beforeFen: before.fen(), pv: "e4 e5 Nf3", san: "f3" };
  const snapshot = JSON.stringify(result);
  const frames = continuationFrames(result);
  assert.deepEqual(frames.map(frame => frame.move.san), ["e4", "e5", "Nf3"]);
  assert.equal(new Chess(frames[0].fen).get("e4").type, "p");
  assert.equal(JSON.stringify(result), snapshot);
});

test("invalid line suffixes stop the preview at the last legal position", () => {
  assert.deepEqual(continuationFrames({ beforeFen: new Chess().fen(), pv: "e4 e5 e8=Q Nf3" }).map(frame => frame.move.san), ["e4", "e5"]);
  assert.deepEqual(continuationFrames(null), []);
  assert.deepEqual(continuationFrames({ pv: "e4" }), []);
  assert.deepEqual(continuationFrames({ beforeFen: "invalid", pv: "e4" }), []);
});

test("continuations preserve castling, en passant, underpromotion and Black-to-move FEN", () => {
  for (const [beforeFen, pv, square, piece] of [
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O", "f1", "r"],
    ["7k/8/8/3pP3/8/8/8/7K w - d6 0 20", "exd6", "d6", "p"],
    ["7k/P7/8/8/8/8/8/7K w - - 0 30", "a8=N", "a8", "n"],
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", "e5", "e5", "p"]
  ]) {
    const frames = continuationFrames({ beforeFen, pv });
    assert.equal(frames.length, 1);
    assert.equal(new Chess(frames[0].fen).get(square).type, piece);
  }
});

test("raw engine UCI lines and a single best move also replay legally", () => {
  const beforeFen = new Chess().fen();
  assert.deepEqual(continuationFrames({ beforeFen, engineEvidence: { before: { pv: "d2d4 d7d5" } } }).map(frame => frame.move.san), ["d4", "d5"]);
  assert.equal(continuationFrames({ beforeFen, bestUci: "g1f3" })[0].move.san, "Nf3");
  assert.deepEqual(continuationFrames({ beforeFen, pv: "(none)" }), []);
});
