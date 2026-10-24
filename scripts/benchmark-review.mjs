import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { GameTree } from "../src/game-tree.js";
import { EngineQueue } from "../src/engine.js";
import { evaluatePosition } from "../src/position-analysis.js";
import { analyzeMove } from "../src/analysis.js";
import { reviewGame } from "../src/review-policy.js";
import { StockfishWorker } from "./lib/stockfish-worker.mjs";
import games from "../tests/fixtures/review-games.json" with { type: "json" };

const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const time = Number(argument("time") || 250);
const baseline = argument("baseline");
const filter = argument("game");
const output = resolve("logs/review-benchmarks");
const suffix = baseline ? "baseline" : time === 250 ? "quick" : `reference-${time}`;
await mkdir(output, { recursive: true });
let implementation = { EngineQueue, evaluatePosition, analyzeMove };
if (baseline) {
  // Snapshot only the local classification modules; no checkout or network needed.
  const directory = `${output}/baseline`;
  await mkdir(`${directory}/data`, { recursive: true });
  for (const file of ["analysis.js", "classification-analysis.js", "classifications.js", "engine.js",
    "position-analysis.js", "move-quality.js", "openings.js", "data/openings.json"]) {
    await writeFile(`${directory}/${file}`, execFileSync("git", ["show", `${baseline}:src/${file}`], { maxBuffer: 3e6 }));
  }
  implementation = Object.assign({}, ...await Promise.all(["analysis", "engine", "position-analysis"].map(name =>
    import(pathToFileURL(`${directory}/${name}.js`).href))));
}
const reports = [];
for (const game of games.filter(game => !filter || game.name.toLowerCase().includes(filter.toLowerCase()))) {
  const searches = [];
  let multiPv = 1;
  const engine = new implementation.EngineQueue(() => {
    const worker = new StockfishWorker();
    const post = worker.postMessage.bind(worker);
    worker.postMessage = command => {
      if (command.startsWith("setoption name MultiPV")) multiPv = Number(command.split(" ").at(-1));
      if (command.startsWith("go ")) searches.push({ command, multiPv });
      post(command);
    };
    return worker;
  });
  const tree = new GameTree(game.pgn);
  const start = performance.now();
  let initialMs = null;
  let repeatMs = null;
  let repeatSearches = null;
  const analyze = async (node, options) => {
    try {
      node.result = await implementation.analyzeMove(node, (position, opts) =>
        implementation.evaluatePosition(position, engine, opts), options);
    } catch (error) {
      console.error(JSON.stringify({ game: game.name, ply: node.ply, san: node.move.san, options, error: error.message }));
      throw error;
    }
  };
  try {
    if (baseline) {
      for (const node of tree.mainline.slice(1)) await analyze(node, { moveTime: time });
    } else {
      await reviewGame(tree.mainline.slice(1), { moveTime: time, analyze,
        onProgress: ({ phase }) => {
          if (phase !== "initial" && initialMs === null) initialMs = Math.round(performance.now() - start);
        } });
    }
    const elapsedMs = Math.round(performance.now() - start);
    const count = searches.length;
    if (!baseline) {
      const repeatStart = performance.now();
      await reviewGame(tree.mainline.slice(1), { moveTime: time, analyze });
      repeatMs = Math.round(performance.now() - repeatStart);
      repeatSearches = searches.length - count;
    }
    const report = { game: game.name, time, baseline, plies: tree.mainline.length - 1,
      initialMs, elapsedMs, searches: count, repeatMs, repeatSearches,
      requestedEngineMs: searches.reduce((total, search) => total + Number(search.command.match(/movetime (\d+)/)?.[1] || 0), 0),
      moves: tree.mainline.slice(1).map(node => ({ ply: node.ply, san: node.move.san, key: node.result.key,
        chanceLoss: node.result.chanceLoss, reason: node.result.classificationReason,
        confirmed: node.result.classificationEvidence.confirmed, refinement: node.result.refinement,
        engine: Object.fromEntries(["before", "played", "after"].map(key => [key,
          node.result.engineEvidence[key] && { score: node.result.engineEvidence[key].score,
            type: node.result.engineEvidence[key].scoreType, raw: node.result.engineEvidence[key].rawScore,
            depth: node.result.engineEvidence[key].depth, stable: node.result.engineEvidence[key].stable }])) })) };
    reports.push(report);
    await writeFile(`${output}/review-${suffix}.json`, JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ ...report, moves: undefined }));
  } finally { engine.clear(); }
}
