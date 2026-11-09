import { mkdir, writeFile } from "node:fs/promises";
import { GameTree } from "../src/game-tree.js";
import { EngineQueue } from "../src/engine.js";
import { evaluatePosition } from "../src/position-analysis.js";
import { analyzeMove } from "../src/analysis.js";
import { StockfishWorker } from "./lib/stockfish-worker.mjs";
import fixtures from "../tests/fixtures/classification-positions.json" with { type: "json" };
import { DEFAULT_REVIEW_TIME } from "../src/review-policy.js";

const times = process.argv.includes("--compare") ? [DEFAULT_REVIEW_TIME, 1500] : [DEFAULT_REVIEW_TIME];
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
const metrics = {};
for (const report of reports.filter(r => r.expected.length === 1)) {
  const expected = report.expected[0], predicted = report.classification;
  for (const label of new Set([expected, predicted])) {
    const m = metrics[label] ||= { tp: 0, fp: 0, fn: 0 };
    if (expected === label && predicted === label) m.tp++;
    else if (predicted === label) m.fp++; else m.fn++;
  }
}
for (const m of Object.values(metrics)) {
  m.precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : null;
  m.recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : null;
}
await writeFile('test-results/classification-metrics.json', JSON.stringify({
  scope: 'Only singleton-label fixtures; unrepresented labels have no measured accuracy. This small corpus is not population calibration.', metrics }, null, 2));
if (reports.some(report => !report.pass)) process.exitCode = 1;
