import { mkdir, writeFile } from "node:fs/promises";
import { GameTree } from "../src/game-tree.js";
import { EngineQueue } from "../src/engine.js";
import { evaluatePosition } from "../src/position-analysis.js";
import { analyzeMove } from "../src/analysis.js";
import { StockfishWorker } from "./lib/stockfish-worker.mjs";
import fixtures from "../tests/fixtures/classification-positions.json" with { type: "json" };

const times = process.argv.includes("--compare") ? [250, 1500] : [250];
const reports = [];
for (const time of times) {
  for (const fixture of fixtures) {
    const engine = new EngineQueue(() => new StockfishWorker());
    const start = performance.now();
    try {
      const tree = new GameTree(fixture.pgn);
      const node = tree.mainline.at(-1);
      const result = await analyzeMove(node, (position, options) => evaluatePosition(position, engine, options), { moveTime: time });
      const report = { position: fixture.name, time, classification: result.key, expected: fixture.expected,
        pass: fixture.expected.includes(result.key), elapsedMs: Math.round(performance.now() - start),
        chanceLoss: result.chanceLoss, before: result.beforeChances, after: result.afterChances,
        depth: result.engineEvidence.before.depth, confirmed: result.classificationEvidence.confirmed,
        alternatives: result.classificationEvidence.alternatives.map(line => ({ depth: line.depth, score: line.score,
          stable: line.stable, pv: line.pv })), sacrifice: result.classificationEvidence.sacrifice,
        reason: result.classificationReason };
      reports.push(report);
      console.log(JSON.stringify(report));
    } finally { engine.clear(); engine.resetWorker(); }
  }
}
await mkdir("test-results", { recursive: true });
await writeFile("test-results/classification-benchmark.json", JSON.stringify(reports, null, 2));
if (reports.some(report => !report.pass)) process.exitCode = 1;
