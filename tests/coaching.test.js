import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { buildCoachingContext, getProvider, getApiKey, hasApiKey, setProvider, setApiKey } from "../src/coaching.js";

function result() {
  const chess = new Chess();
  const beforeFen = chess.fen();
  chess.move("e3");
  return { beforeFen, afterFen: chess.fen(), san: "e3", moveColor: "w", from: "e2", to: "e3", playedPiece: "p",
    beforeWhite: 0.3, afterWhite: 0.1, label: "Good", bestSan: "e4", bestUci: "e2e4", punishSan: "d5",
    engineEvidence: { before: { pv: "e2e4 e7e5 g1f3", moveTime: 250 }, after: { pv: "d7d5 d2d4", moveTime: 250 } } };
}

test("coaching context preserves exact positions and White evaluation perspective", () => {
  const context = buildCoachingContext(result());
  assert.equal(context.before.sideToMove, "White");
  assert.equal(context.after.sideToMove, "Black");
  assert.ok(context.after.pieces.White.includes("pawn on e3"));
  assert.deepEqual(context.before.material, { White: 39, Black: 39 });
  assert.equal(context.stockfish.beforeEvaluation, 0.3);
  assert.deepEqual(context.stockfish.recommendedLine.map(move => move.san), ["e4", "e5", "Nf3"]);
  assert.deepEqual(context.stockfish.opponentLine.map(move => move.san), ["d5", "d4"]);
});

test("illegal engine line suffixes never enter the verified continuation", () => {
  const input = result();
  input.engineEvidence.before.pv = "e2e4 e7e5 e4e8 g1f3";
  assert.deepEqual(buildCoachingContext(input).stockfish.recommendedLine.map(move => move.san), ["e4", "e5"]);
  assert.ok(!JSON.stringify(buildCoachingContext(input)).includes("e4e8"));
});

test("custom positions and terminal board facts use FEN instead of move-number assumptions", () => {
  const chess = new Chess("7k/8/5KQ1/8/8/8/8/8 w - - 0 19");
  const beforeFen = chess.fen();
  chess.move("Qg7#");
  const input = { ...result(), beforeFen, afterFen: chess.fen(), playedPiece: "q", from: "g6", to: "g7", san: "Qg7#",
    engineEvidence: { before: { pv: "g6g7" }, after: { pv: "" } } };
  const context = buildCoachingContext(input);
  assert.equal(context.after.checkmate, true);
  assert.deepEqual(context.after.legalMoves, []);
  assert.equal(context.stockfish.recommendedLine[0].checkmate, true);
});

test("provider settings preserve legacy Gemini keys and clear only the selected provider", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([["zen-chess-gemini-key", "gemini-test"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  } });
  try {
    assert.equal(getProvider(), "gemini");
    assert.equal(getApiKey(), "gemini-test");
    setProvider("groq");
    assert.equal(hasApiKey(), false);
    setApiKey(" groq-test ");
    assert.equal(getApiKey(), "groq-test");
    assert.equal(getApiKey("gemini"), "gemini-test");
    setApiKey("");
    assert.equal(hasApiKey(), false);
    assert.equal(getProvider(), "groq");
    assert.equal(getApiKey("gemini"), "gemini-test");
    assert.throws(() => setProvider("constructor"), /Unknown AI provider/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});
