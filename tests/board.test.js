import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { pieceTransition } from '../src/piece-animation.js';
import { squareCenter, squareAt, annotationBrush } from "../src/board-overlay.js";
import { legalBestMove, evaluatePosition } from "../src/position-analysis.js";

for (const [name, fen, san, expected] of [
  ['pawn move', new Chess().fen(), 'e4', [{from:'e2',to:'e4'}]],
  ['castling', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'O-O', [{from:'e1',to:'g1'},{from:'h1',to:'f1'}]],
  ['en passant', '7k/8/8/3pP3/8/8/8/K7 w - d6 0 1', 'exd6', [{from:'e5',to:'d6'}]],
  ['underpromotion', '7k/P7/8/8/8/8/8/7K w - - 0 1', 'a8=N', [{from:'a7',to:'a8'}]]
]) test(`animation maps ${name} and undo to the correct pieces`, () => {
  const chess = new Chess(fen); chess.move(san);
  assert.deepEqual(pieceTransition(fen,chess.fen()),expected);
  assert.deepEqual(pieceTransition(chess.fen(),fen),expected.map(p=>({from:p.to,to:p.from})));
  assert.equal(pieceTransition(fen,fen),null);
});
test('animation does not invent a transition across a multi-move jump',()=>{
  const chess=new Chess(), start=chess.fen();chess.move('e4');chess.move('e5');
  assert.equal(pieceTransition(start,chess.fen()),null);
});

test("every square maps back correctly across board orientations and sizes", () => {
  for (const size of [320, 517, 820]) {
    const bounds = { left: 43, top: 79, width: size, height: size, right: 43 + size, bottom: 79 + size };
    for (const flipped of [false, true]) {
      for (const file of "abcdefgh") for (let rank = 1; rank <= 8; rank++) {
        const square = `${file}${rank}`;
        const center = squareCenter(square, flipped);
        assert.equal(squareAt(bounds.left + center.x * size / 100, bounds.top + center.y * size / 100, bounds, flipped), square);
      }
    }
  }
});

test("outside-board releases never map to a legal square", () => {
  const bounds = { left: 10, top: 20, right: 410, bottom: 420, width: 400, height: 400 };
  assert.equal(squareAt(9, 30, bounds), null);
  assert.equal(squareAt(410, 30, bounds), null);
  assert.equal(squareAt(20, 420, bounds), null);
  assert.equal(squareAt(20, 19, bounds), null);
  assert.equal(squareCenter("i9"), null);
});

test("annotation modifiers distinguish all five colors including Shift-right-click", () => {
  assert.equal(annotationBrush({}), "orange");
  assert.equal(annotationBrush({ ctrlKey: true }), "red");
  assert.equal(annotationBrush({ altKey: true }), "blue");
  assert.equal(annotationBrush({ shiftKey: true }), "green");
  assert.equal(annotationBrush({ ctrlKey: true, altKey: true }), "yellow");
  assert.equal(annotationBrush({ metaKey: true }), "blue");
});

test("suggestions must be legal for the displayed position, including promotions", () => {
  const fen = new Chess().fen();
  assert.equal(legalBestMove(fen, { bestmove: "e7e5" }), "");
  assert.equal(legalBestMove(fen, { bestmove: "(none)", pv: "e2e4 e7e5" }), "e2e4");
  assert.equal(legalBestMove(fen, { bestmove: "e2e4" }), "e2e4");
  const promotion = "7k/P7/8/8/8/8/8/7K w - - 0 30";
  assert.equal(legalBestMove(promotion, { bestmove: "a7a8" }), "");
  assert.equal(legalBestMove(promotion, { bestmove: "a7a8n" }), "a7a8n");
});

test("an existing score without a best move triggers recovery despite its higher analysis time", async () => {
  const node = { fen: new Chess().fen(), analysis: { whiteScore: 0.2, score: 0.2, moveTime: 1000, bestmove: "" } };
  let calls = 0;
  const engine = { evaluate: async () => { calls++; return { score: 0.3, bestmove: "e2e4", pv: "e2e4", moveTime: 200 }; } };
  await evaluatePosition(node, engine, { moveTime: 200 });
  assert.equal(calls, 1);
  assert.equal(node.analysis.bestmove, "e2e4");
  await evaluatePosition(node, engine, { moveTime: 200 });
  assert.equal(calls, 1);
});

test("invalid engine suggestions are evicted so Retry can recover", async () => {
  const node = { fen: new Chess().fen() };
  let invalidated = false;
  const engine = {
    evaluate: async () => ({ score: 0.2, bestmove: invalidated ? "d2d4" : "e7e5", pv: "", moveTime: 200 }),
    invalidate: (fen, time) => { assert.equal(fen, node.fen); assert.equal(time, 200); invalidated = true; }
  };
  await assert.rejects(evaluatePosition(node, engine, { moveTime: 200 }), /no legal best move/);
  assert.equal(node.analysis, undefined);
  await evaluatePosition(node, engine, { moveTime: 200 });
  assert.equal(node.analysis.bestmove, "d2d4");
});

test("cancelled evaluations cannot attach results even if an engine finishes late", async () => {
  const node = { fen: new Chess().fen() };
  const controller = new AbortController();
  let finish;
  const engine = { evaluate: () => new Promise(resolve => { finish = resolve; }) };
  const pending = evaluatePosition(node, engine, { moveTime: 200, signal: controller.signal });
  controller.abort();
  finish({ score: 0.4, bestmove: "e2e4", pv: "", moveTime: 200 });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(node.analysis, undefined);
});

test("mate and stalemate positions need no engine request or suggestion", async () => {
  const engine = { evaluate: () => { throw new Error("Terminal position called the engine"); } };
  const mate = { fen: "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1" };
  const stalemate = { fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1" };
  await evaluatePosition(mate, engine, { moveTime: 200 });
  await evaluatePosition(stalemate, engine, { moveTime: 200 });
  assert.equal(mate.analysis.whiteScore, 10);
  assert.equal(stalemate.analysis.whiteScore, 0);
  assert.equal(legalBestMove(mate.fen, mate.analysis), "");
  assert.equal(legalBestMove(stalemate.fen, stalemate.analysis), "");
});
