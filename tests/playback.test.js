import test from "node:test";
import assert from "node:assert/strict";
import { GameTree } from "../src/game-tree.js";
import { Chess } from "chess.js";
import { continuationFrames, commitContinuation } from "../src/playback.js";

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


test("preview commits the entire continuation only after a legal user move and reuses existing branches", () => {
  const tree = new GameTree("1. f3 e5 *");
  tree.select(tree.mainline[1]);
  const origin = tree.current;
  origin.analysis = { whiteScore: -1 };
  const frames = continuationFrames({ beforeFen: tree.root.fen, pv: "e4 e5 Nf3" });
  assert.equal(tree.nodes.size, 3);
  assert.equal(tree.current, origin);
  assert.throws(() => commitContinuation(tree, tree.root, frames, { from: "a1", to: "a8" }));
  assert.equal(tree.nodes.size, 3);
  assert.equal(tree.current, origin);
  const end = commitContinuation(tree, tree.root, frames, { from: "b8", to: "c6" });
  assert.deepEqual(tree.path(end).slice(1).map(n => n.move.san), ["e4", "e5", "Nf3", "Nc6"]);
  assert.deepEqual(tree.mainline.slice(1).map(n => n.move.san), ["f3", "e5"]);
  assert.deepEqual(origin.analysis, { whiteScore: -1 });
  const count = tree.nodes.size;
  assert.equal(commitContinuation(tree, tree.root, frames, { from: "b8", to: "c6" }), end);
  assert.equal(tree.nodes.size, count);
});

test("continuing a preview on a fresh analysis board saves a variation rather than extending mainline", () => {
  const tree = new GameTree();
  const frames = continuationFrames({ beforeFen: tree.root.fen, pv: "e4 e5" });
  const end = commitContinuation(tree, tree.root, frames, { from: "g1", to: "f3" });
  assert.equal(end.mainline, false);
  assert.equal(tree.mainline.length, 1);
  assert.equal(tree.returnToGame(), tree.root);
});
