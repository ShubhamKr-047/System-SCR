import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { GameTree, moveLabel } from "../src/game-tree.js";
import { analyzeMove } from "../src/analysis.js";

const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *";

test("return restores the exact departure position, original continuation, and partial analysis", () => {
  const tree = new GameTree(PGN);
  const origin = tree.mainline[4];
  origin.analysis = { whiteScore: 0.4 };
  tree.mainline[5].result = { key: "best" };
  tree.select(origin);
  const branch = tree.play("Bc4");
  tree.play("Nf6");
  assert.equal(tree.returnId, origin.id);
  tree.returnToGame();
  assert.equal(tree.current, origin);
  assert.equal(tree.current.fen, origin.fen);
  assert.equal(tree.continuation(origin), tree.mainline[5]);
  assert.deepEqual(origin.analysis, { whiteScore: 0.4 });
  assert.deepEqual(tree.mainline[5].result, { key: "best" });
  assert.equal(origin.children[1], branch);
  assert.equal(branch.children[0].move.san, "Nf6");
});

test("replaying existing moves reuses nodes without duplicating branches", () => {
  const tree = new GameTree(PGN);
  assert.equal(tree.play("e4"), tree.mainline[1]);
  assert.equal(tree.returnId, null);
  tree.select(tree.mainline[4]);
  const branch = tree.play("Bc4");
  branch.result = { key: "good" };
  tree.returnToGame();
  assert.equal(tree.play("Bc4"), branch);
  assert.equal(tree.nodes.size, 8);
  assert.deepEqual(branch.result, { key: "good" });
});

test("nested branches retain the outer game anchor and expose the nearest parent fork", () => {
  const tree = new GameTree(PGN);
  tree.select(tree.mainline[4]);
  const first = tree.play("Bc4");
  const reply = tree.play("Nf6");
  tree.select(first);
  const alternate = tree.play("Bc5");
  tree.play("d3");
  assert.equal(tree.branchOrigin(), first);
  assert.equal(tree.returnId, tree.mainline[4].id);
  tree.select(tree.branchOrigin());
  assert.equal(tree.current, first);
  tree.select(alternate);
  assert.deepEqual(tree.line().map(n => n.move?.san), [undefined, "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3"]);
  assert.equal(first.children[0], reply);
  tree.returnToGame();
  assert.equal(tree.current, tree.mainline[4]);
});

test("selecting a different saved variation updates its return point", () => {
  const tree = new GameTree(PGN);
  tree.select(tree.mainline[1]);
  const sicilian = tree.play("c5");
  tree.select(tree.mainline[4]);
  tree.play("Bc4");
  tree.select(sicilian);
  assert.equal(tree.returnId, tree.mainline[1].id);
  tree.returnToGame();
  assert.equal(tree.current, tree.mainline[1]);
});

test("branch from the initial position returns to root and preserves the full original game", () => {
  const tree = new GameTree(PGN);
  const branch = tree.play("d4");
  tree.play("d5");
  tree.returnToGame();
  assert.equal(tree.current, tree.root);
  assert.equal(tree.mainline.length, 7);
  assert.equal(tree.root.children[1], branch);
});

test("continuations beyond the final imported move still have a main-game anchor", () => {
  const tree = new GameTree("1. e4 *");
  tree.select(tree.mainline[1]);
  tree.play("c5");
  assert.equal(tree.branchOrigin(), tree.mainline[1]);
  tree.returnToGame();
  assert.equal(tree.current, tree.mainline[1]);
});

test("custom starting FEN and Black move numbers survive import and branching", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12";
  const tree = new GameTree(`[SetUp "1"]\n[FEN "${fen}"]\n\n12... e5 13. Nf3 *`);
  assert.equal(tree.root.fen, fen);
  assert.equal(moveLabel(tree.mainline[1]), "12... e5");
  assert.equal(moveLabel(tree.mainline[2]), "13. Nf3");
  const branch = tree.play("c5");
  assert.equal(moveLabel(branch), "12... c5");
  tree.returnToGame();
  assert.equal(tree.current.fen, fen);
});

test("castling and en passant retain complete legal board state", () => {
  const tree = new GameTree(PGN);
  tree.select(tree.mainline[6]);
  const castle = tree.play("O-O");
  assert.equal(new Chess(castle.fen).get("g1").type, "k");
  assert.equal(new Chess(castle.fen).get("f1").type, "r");
  const ep = new GameTree("1. e4 a6 2. e5 d5 3. Nf3 *");
  ep.select(ep.mainline[4]);
  const capture = ep.play("exd6");
  assert.equal(capture.move.captured, "p");
  assert.equal(new Chess(capture.fen).get("d5"), undefined);
  assert.equal(new Chess(capture.fen).get("d6").color, "w");
});

test("underpromotion creates distinct reusable branches", () => {
  const tree = new GameTree('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 30"]\n\n30. a8=Q+ *');
  const knight = tree.play({ from: "a7", to: "a8", promotion: "n" });
  assert.equal(new Chess(knight.fen).get("a8").type, "n");
  assert.equal(moveLabel(knight), "30. a8=N");
  tree.returnToGame();
  assert.equal(tree.play({ from: "a7", to: "a8", promotion: "n" }), knight);
  assert.equal(tree.root.children.length, 2);
});

test("invalid moves leave the selected position and existing branches intact", () => {
  const tree = new GameTree(PGN);
  assert.throws(() => tree.play({ from: "e2", to: "e5" }));
  assert.equal(tree.current, tree.root);
  assert.equal(tree.nodes.size, 7);
});

test("analysis evaluates both endpoints and keeps feedback attached to its original move", async () => {
  const tree = new GameTree(PGN);
  tree.select(tree.mainline[4]);
  const node = tree.play("Bc4");
  const evaluated = [];
  const result = await analyzeMove(node, async n => {
    evaluated.push(n);
    const move = new Chess(n.fen).moves({ verbose: true })[0];
    return { score: n.fen.split(" ")[1] === "w" ? 0.5 : -0.2, bestmove: `${move.from}${move.to}`, pv: "" };
  }, {});
  assert.deepEqual(evaluated, [node.parent, node]);
  assert.equal(result.beforeWhite, 0.5);
  assert.equal(result.afterWhite, 0.2);
  assert.ok(Math.abs(result.lossCp - 30) < 0.001);
  assert.equal(result.beforeFen, node.parent.fen);
  assert.equal(result.afterFen, node.fen);
  assert.equal(result.san, "Bc4");
  assert.equal(result.moveNo, "3.");
  assert.equal(tree.mainline[5].result, null);
});

test("checkmating move gets zero loss and a winning score", async () => {
  const tree = new GameTree("1. f3 e5 2. g4 Qh4# 0-1");
  const node = tree.mainline[4];
  const result = await analyzeMove(node, async n => ({ score: n === node ? -10 : 9.99, bestmove: n === node ? "" : "d8h4", pv: "" }), {});
  assert.equal(result.afterWhite, -10);
  assert.equal(result.lossCp, 0);
  assert.equal(result.moveNo, "2...");
});

test("fresh analysis board starts with empty moves and extends mainline as moves are played", () => {
  const tree = new GameTree();
  assert.equal(tree.isAnalysisBoard, true);
  assert.equal(tree.mainline.length, 1);
  assert.equal(tree.root.fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const m1 = tree.play("e4");
  assert.equal(m1.mainline, true);
  assert.equal(tree.mainline.length, 2);
  const m2 = tree.play("e5");
  assert.equal(m2.mainline, true);
  assert.equal(tree.mainline.length, 3);
  // Branch off move 1
  tree.select(m1);
  const branch = tree.play("c5");
  assert.equal(branch.mainline, false);
  assert.equal(tree.mainline.length, 3);
  assert.equal(tree.continuation(m1), m2);
});
