import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { GameTree } from '../src/game-tree.js';
import { EngineQueue } from '../src/engine.js';
import { evaluatePosition } from '../src/position-analysis.js';
import { analyzeMove } from '../src/analysis.js';
import { StockfishWorker } from './lib/stockfish-worker.mjs';
const games = JSON.parse(await readFile(new URL('../tests/fixtures/mating-sacrifices.json', import.meta.url)));
const reports = [];
for (const game of games) for (const moveTime of [125, 500, 1000]) {
  const engine = new EngineQueue(() => new StockfishWorker());
  try {
    const node = new GameTree(game.pgn).mainline[game.ply];
    const start = performance.now();
    const result = await analyzeMove(node, (position, options) => evaluatePosition(position, engine, options), { moveTime });
    const report = { game: game.name, mode: moveTime, move: node.move.san, label: result.key,
      elapsedMs: Math.round(performance.now() - start), proof: result.refinement.mateProof };
    reports.push(report); console.log(JSON.stringify(report));
    assert.equal(result.key, 'brilliant');
    assert.equal(result.refinement.mateProof?.proven, true);
  } finally { engine.clear(); }
}
await mkdir('logs/review-benchmarks', { recursive: true });
await writeFile('logs/review-benchmarks/mating-sacrifices.json', JSON.stringify(reports, null, 2));
// Exhaust the legal-proof node limit deliberately to exercise the independent
// engine-confirmed route, including its distinct confidence and explanation.
for (const game of games) {
  const engine = new EngineQueue(() => new StockfishWorker());
  try {
    const node = new GameTree(game.pgn).mainline[game.ply];
    const result = await analyzeMove(node, (p,o) => evaluatePosition(p,engine,o), { moveTime: 1000, proofLimits: { maxNodes: 0 } });
    assert.equal(result.key, 'brilliant');
    assert.equal(result.classificationEvidence.sacrifice.kind, 'engine-mate');
    assert.equal(result.classificationEvidence.sacrifice.confidence, 'engine-confirmed');
    assert.equal(result.refinement.mateProof.proven, false);
    console.log(JSON.stringify({ game: game.name, fallback: 'engine-confirmed', label: result.key }));
  } finally { engine.clear(); }
}
