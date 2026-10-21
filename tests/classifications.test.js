import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { GameTree } from "../src/game-tree.js";
import { evaluatePosition, chessAtNode, positionHistory } from "../src/position-analysis.js";
import { analyzeMove } from "../src/analysis.js";
import { lookupOpening } from "../src/openings.js";
import { classifyEvidence, playerEvaluation, sacrificeCandidates, winningChances, gameAccuracy } from "../src/move-quality.js";

const score = (pawns, mate = 0) => ({ pawns, mate, chances: mate ? mate > 0 ? 100 : 0 : winningChances(pawns) });
const classify = (before, after, options = {}) => classifyEvidence({ before: score(before), played: score(after),
  lossCp: Math.max(0, (before - after) * 100), legalMovesCount: 20, ...options });

for (const [name, before, after, options] of [
  ["best", 0.5, 0.5, { isBest: true }],
  ["excellent", 0.5, 0.35, {}],
  ["good", 0.5, 0.15, {}],
  ["inaccuracy", 0.5, -0.3, {}],
  ["mistake", 0.5, -1.2, {}],
  ["blunder", 0, -3, {}],
  ["forced", 0, -3, { legalMovesCount: 1 }],
  ["book", 0.5, 0.5, { opening: { eco: "C20", name: "King's Pawn Game" } }],
  ["great", 0.5, 0.5, { isBest: true, critical: true, confirmed: true }],
  ["brilliant", 0.5, 0.5, { isBest: true, sacrifice: { verified: true }, confirmed: true }],
  ["miss", 2.4, 0.7, { opponentOpportunity: true, confirmed: true }]
]) test(`${name} has an explicit evidence-based classification`, () => assert.equal(classify(before, after, options).key, name));

test("equal centipawn losses have different impact in balanced and decided games", () => {
  assert.equal(classify(0, -3).key, "blunder");
  assert.equal(classify(8, 5).key, "inaccuracy");
  assert.notEqual(classify(-8, -11).key, "blunder");
});

test("saturation cannot mark a clearly inferior move as Best", () => {
  assert.notEqual(classify(20, 12).key, "best");
  assert.notEqual(classify(-12, -20).key, "best");
});

test("threshold boundaries use percentage points consistently", () => {
  for (const [loss, key] of [[2, "excellent"], [2.001, "good"], [5, "inaccuracy"], [10, "mistake"], [20, "blunder"]]) {
    assert.equal(classifyEvidence({ before: { chances: 50, pawns: 0 }, played: { chances: 50 - loss, pawns: -1 },
      lossCp: 100, legalMovesCount: 20 }).key, key);
  }
});

test("book recognition and missed opportunities never hide a blunder", () => {
  const result = classify(2.4, -3, { opening: { eco: "A00", name: "Named trap" }, opponentOpportunity: true, confirmed: true });
  assert.equal(result.key, "blunder");
  assert.equal(result.missedOpportunity, true);
});

test("an accurate early move is not automatically Book", () => assert.equal(classify(0, 0, { isBest: true, ply: 0 }).key, "best"));
test("Great and Brilliant require confirmation; a hanging piece alone is insufficient", () => {
  assert.equal(classify(0, 0, { isBest: true, critical: true, sacrifice: { verified: true } }).key, "best");
  assert.equal(classify(0, 0, { isBest: true, confirmed: true, sacrifice: { verified: false } }).key, "best");
});
test("Miss requires a new opponent opportunity, not merely losing an old advantage", () => {
  assert.equal(classify(2.3, 0.7, { confirmed: true }).key, "mistake");
  assert.equal(classify(2.3, 0.7, { opponentOpportunity: true }).key, "mistake");
});

test("White and Black evaluations normalize symmetrically, including mate", () => {
  for (const pawns of [-8, -1, 0, 1, 8]) {
    assert.deepEqual(playerEvaluation({ score: pawns }, "w", "w"), playerEvaluation({ score: pawns }, "b", "b"));
    assert.equal(playerEvaluation({ score: pawns }, "w", "b").chances, winningChances(-pawns));
  }
  assert.equal(playerEvaluation({ score: -9.97, scoreType: "mate", rawScore: -3 }, "b", "w").mate, 1);
  assert.equal(playerEvaluation({ score: -10, scoreType: "mate", rawScore: 0, outcome: "checkmate" }, "b", "w").chances, 100);
  assert.equal(playerEvaluation({ score: 0, outcome: "draw" }, "b", "w").chances, 50);
});

test("a longer forced mate remains Best; already forced losses are not new blunders", () => {
  assert.equal(classify(9.97, 9.91, { before: score(9.97, 1), played: score(9.91, 1) }).key, "best");
  assert.equal(classify(-9.97, -9.98, { before: score(-9.97, -1), played: score(-9.98, -1), isBest: true }).key, "best");
  assert.equal(classify(0, -10, { played: score(-10, -1) }).key, "blunder");
});

test("opening index recognizes deep theory and transposed positions without move counters", () => {
  const chess = new Chess();
  for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"]) chess.move(san);
  assert.ok(lookupOpening(chess.fen(), "f8e7"));
  const first = new Chess(); first.loadPgn("1. d4 Nf6 2. c4 e6 3. Nf3 d5 *");
  const other = new Chess(); other.loadPgn("1. d4 d5 2. Nf3 Nf6 3. c4 e6 *");
  assert.deepEqual(lookupOpening(first.fen(), "b1c3"), lookupOpening(other.fen(), "b1c3"));
  assert.ok(lookupOpening(first.fen(), "b1c3"));
  assert.equal(lookupOpening(new Chess().fen(), "a1a8"), null);
});

test("sacrifice evidence excludes equal exchanges, existing losses and promotions", () => {
  const chess = new Chess(); chess.loadPgn("1. e4 d5 2. exd5 Qxd5 *");
  const move = chess.history({ verbose: true }).at(-1);
  assert.equal(sacrificeCandidates(move.before, move.after, move).length, 0);
  const promotion = new Chess("7k/P7/1r6/8/8/8/8/7K w - - 0 30");
  const promote = promotion.move("a8=Q+");
  assert.equal(sacrificeCandidates(promote.before, promote.after, promote).length, 0);
});

test("Legal's trap identifies a newly offered queen and ignores a routine defended piece", () => {
  const chess = new Chess(); chess.loadPgn("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *");
  const move = chess.history({ verbose: true }).at(-1);
  const candidates = sacrificeCandidates(move.before, move.after, move);
  assert.ok(candidates.some(candidate => candidate.uci === "g4d1" && candidate.piece === "q"));
  const normal = new Chess(); normal.loadPgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 *");
  const quiet = normal.history({ verbose: true }).at(-1);
  assert.equal(sacrificeCandidates(quiet.before, quiet.after, quiet).length, 0);
});

test("repetition history is reconstructed, preventing another engine search after a draw", async () => {
  const tree = new GameTree("1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *");
  const node = tree.mainline.at(-1);
  assert.equal(chessAtNode(node).isThreefoldRepetition(), true);
  assert.equal(positionHistory(node).moves.length, 8);
  const result = await evaluatePosition(node, { evaluate: () => { throw new Error("Already drawn"); } }, { moveTime: 250 });
  assert.equal(result.outcome, "draw");
  assert.equal(result.score, 0);
});

test("restricted and MultiPV searches cannot replace the displayed single-line evaluation", async () => {
  const tree = new GameTree("1. e4 *"); const node = tree.mainline[1];
  node.analysis = { score: -0.2, whiteScore: 0.2, moveTime: 250, bestmove: "e7e5" };
  const original = node.analysis;
  const engine = { evaluate: async (fen, time, options) => ({ score: -0.8, bestmove: options.searchMoves[0] || "c7c5", moveTime: time }) };
  await evaluatePosition(node, engine, { moveTime: 1000, searchMoves: ["a7a6"] });
  await evaluatePosition(node, engine, { moveTime: 1000, multiPv: 2 });
  assert.equal(node.analysis, original);
});

test("accuracy uses chance loss, weights critical positions, and excludes Forced", () => {
  assert.equal(gameAccuracy([{ chanceLoss: 0, key: "best" }]), 100);
  const moves = [{ chanceLoss: 2, key: "excellent" }, { chanceLoss: 20, key: "blunder" }];
  assert.equal(gameAccuracy([...moves, { chanceLoss: 0, key: "forced" }]), gameAccuracy(moves));
  assert.ok(gameAccuracy([{ chanceLoss: 5 }]) > gameAccuracy([{ chanceLoss: 10 }]));
  assert.equal(gameAccuracy([]), 0);
});

test("stalemating a winning position is classified as a lost win, including when engine top move is stale", async () => {
  const tree = new GameTree('[SetUp "1"]\n[FEN "7k/8/5KQ1/8/8/8/8/8 w - - 0 20"]\n\n20. Qf7 *');
  const node = tree.mainline[1];
  const result = await analyzeMove(node, async (n, options) => n === node
    ? { score: 0, terminal: true, outcome: "draw", bestmove: "", pv: "", moveTime: options.moveTime }
    : { score: 9.97, scoreType: "mate", rawScore: 3, bestmove: "g6f7", pv: "g6f7", depth: 20, stable: true }, { moveTime: 250 });
  assert.equal(result.key, "blunder");
  assert.equal(result.chanceLoss, 50);
  assert.equal(result.afterWhite, 0);
});

function search(scoreValue, bestmove, pv = bestmove) {
  return { score: scoreValue, scoreType: "cp", rawScore: scoreValue * 100, bestmove,
    pv, depth: 20, stable: true, complete: true, moveTime: 1000 };
}

test("Brilliant is awarded only after acceptance lines and the strongest reply are verified", async () => {
  const tree = new GameTree("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *");
  const node = tree.mainline.at(-1);
  const requests = [];
  const result = await analyzeMove(node, async (position, options) => {
    requests.push({ position, options });
    if (position === node.parent) {
      const primary = search(2, "f3e5", "f3e5 d6e5 d1g4");
      if (options.multiPv === 2) return { ...primary, candidates: [
        { ...primary, rank: 1 }, { ...search(0, "d2d4"), rank: 2 }
      ] };
      return primary;
    }
    if (position === node) return search(-2, "d6e5", "d6e5 d1g4");
    if (position.move.to === "d1") return { ...search(9.98, "c4f7", "c4f7 e8e7 c3d5"), scoreType: "mate", rawScore: 2 };
    return search(2, "d1g4", "d1g4 g8f6");
  }, { moveTime: 250 });
  assert.equal(result.key, "brilliant");
  assert.equal(result.classificationEvidence.sacrifice.verified, true);
  assert.ok(result.classificationEvidence.sacrifice.acceptances.some(item => item.capture === "g4d1"));
  assert.ok(requests.some(({ position }) => position.parent === node));
});

test("uncertain alternatives cannot trigger Great, regardless of an evaluation jump", async () => {
  const tree = new GameTree('[SetUp "1"]\n[FEN "7k/pp3ppp/8/8/8/8/PP3PPP/6K1 w - - 0 20"]\n\n20. Kf1 *');
  const node = tree.mainline[1];
  for (const complete of [false, true]) {
    const result = await analyzeMove(node, async (position, options) => {
      if (position === node) return search(-3, "h8g8");
      const primary = { ...search(3, "g1f1"), complete };
      return options.multiPv === 2 ? { ...primary, candidates: [
        { ...primary, rank: 1 }, { ...search(-3, "g1h1"), rank: 2 }
      ] } : primary;
    }, { moveTime: 250 });
    assert.equal(result.key, complete ? "great" : "best");
  }
});

test("an unsound acceptance refutes a Brilliant candidate", async () => {
  const tree = new GameTree("1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 5. Nxe5 *");
  const node = tree.mainline.at(-1);
  const result = await analyzeMove(node, async (position, options) => {
    if (position === node.parent) {
      const primary = search(2, "f3e5");
      return options.multiPv === 2 ? { ...primary, candidates: [primary, search(0, "d2d4")] } : primary;
    }
    return position === node ? search(-2, "d6e5") : search(-3, "c4f7");
  }, { moveTime: 250 });
  assert.notEqual(result.key, "brilliant");
});

test("Miss verifies the opponent's preceding mistake rather than trusting its cached label", async () => {
  const tree = new GameTree("1. h3 e5 2. a3 *");
  const node = tree.mainline[3];
  node.parent.result = { classificationVersion: 2, chanceLoss: 15 };
  for (const opponentReallyErred of [true, false]) {
    const result = await analyzeMove(node, async (position, options) => {
      if (position === node.parent.parent) return options.searchMoves?.length
        ? search(opponentReallyErred ? -2.4 : -0.6, "e7e5") : search(-0.5, "d7d5");
      if (position === node) return search(-0.7, "b8c6");
      return options.searchMoves?.length ? search(0.7, "a2a3") : search(2.4, "g1f3");
    }, { moveTime: 250 });
    assert.equal(result.key, opponentReallyErred ? "miss" : "mistake");
    assert.ok(result.classificationEvidence.opportunity);
  }
});
