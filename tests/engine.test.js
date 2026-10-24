import test from "node:test";
import assert from "node:assert/strict";
import { EngineQueue } from "../src/engine.js";

class FakeWorker {
  listeners = {};
  commands = [];
  terminated = false;
  addEventListener(event, fn) { this.listeners[event] = fn; }
  postMessage(command) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  emit(line) { this.listeners.message({ data: line }); }
  ready() { this.emit("uciok"); this.emit("readyok"); }
  complete(score = 30, best = "e2e4") { this.emit(`info depth 12 score cp ${score} pv ${best}\nbestmove ${best}`); }
}

function setup(options) {
  const workers = [];
  const engine = new EngineQueue(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, options);
  return { workers, engine };
}

test("serializes searches and waits for UCI initialization before starting", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("first", 250);
  const second = engine.evaluate("second", 500);
  const worker = workers[0];
  assert.deepEqual(worker.commands, ["uci"]);
  worker.ready();
  assert.deepEqual(worker.commands.slice(-2), ["position fen first", "go movetime 250"]);
  worker.complete(25);
  assert.deepEqual(worker.commands.slice(-2), ["position fen second", "go movetime 500"]);
  worker.complete(-10, "e7e5");
  assert.equal((await first).score, 0.25);
  assert.equal((await second).score, -0.1);
  assert.equal(workers.length, 1);
});

test("selected-position priority runs before queued background review", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("first", 250);
  const background = engine.evaluate("background", 250);
  const selected = engine.evaluate("selected", 250, { priority: 4 });
  workers[0].ready();
  workers[0].complete();
  assert.equal(workers[0].commands.at(-2), "position fen selected");
  workers[0].complete();
  assert.equal(workers[0].commands.at(-2), "position fen background");
  workers[0].complete();
  await Promise.all([first, background, selected]);
});

test("cache is isolated by full position and analysis time", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("fen", 250);
  workers[0].ready();
  workers[0].complete(80);
  const result = await first;
  assert.equal(await engine.evaluate("fen", 250), result);
  const stronger = engine.evaluate("fen", 1000);
  assert.equal(workers[0].commands.at(-1), "go movetime 1000");
  workers[0].complete(90);
  assert.equal((await stronger).score, 0.9);
});

test("changing the selected position reprioritizes already queued variation work", async () => {
  const { engine, workers } = setup();
  const active = engine.evaluate("active", 250);
  const old = engine.evaluate("older variation", 250, { priority: 3 });
  const selected = engine.evaluate("selected variation", 250, { priority: 3 });
  engine.focus(["selected variation"]);
  workers[0].ready();
  workers[0].complete();
  assert.equal(workers[0].commands.at(-2), "position fen selected variation");
  workers[0].complete();
  workers[0].complete();
  await Promise.all([active, old, selected]);
});

test("identical queued positions reuse the first completed evaluation", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("same fen", 250);
  const second = engine.evaluate("same fen", 250);
  workers[0].ready();
  workers[0].complete();
  assert.equal(await first, await second);
  assert.equal(workers[0].commands.filter(c => c.startsWith("go ")).length, 1);
});

test("cancelling an active search ignores late output and safely runs the next job", async () => {
  const { engine, workers } = setup();
  const controller = new AbortController();
  const first = engine.evaluate("old", 250, { signal: controller.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = engine.evaluate("new", 250);
  workers[0].ready();
  controller.abort();
  assert.equal(workers[0].terminated, true);
  workers[0].complete(900);
  workers[1].ready();
  workers[1].complete(15);
  await rejected;
  assert.equal((await second).score, 0.15);
});

test("cancelling a queued job leaves the active search intact", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("active", 250);
  const controller = new AbortController();
  const queued = engine.evaluate("queued", 250, { signal: controller.signal });
  const rejected = assert.rejects(queued, { name: "AbortError" });
  controller.abort();
  workers[0].ready();
  workers[0].complete();
  await Promise.all([first, rejected]);
  assert.equal(workers[0].terminated, false);
  assert.ok(!workers[0].commands.includes("position fen queued"));
});

test("new-game reset rejects pending work and clears cached results", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("first", 250);
  const second = engine.evaluate("second", 250);
  const rejected = [assert.rejects(first, { name: "AbortError" }), assert.rejects(second, { name: "AbortError" })];
  engine.clear();
  const newGame = engine.evaluate("first", 250);
  workers[0].complete(900);
  workers[1].ready();
  workers[1].complete(10);
  await Promise.all(rejected);
  assert.equal((await newGame).score, 0.1);
});

test("worker errors reject the affected job and recover for queued work", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("broken", 250);
  const rejected = assert.rejects(first, /worker failed/);
  const second = engine.evaluate("next", 250);
  workers[0].listeners.error({ message: "worker failed" });
  workers[1].ready();
  workers[1].complete();
  await Promise.all([rejected, second]);
});

test("timeouts terminate the old worker and permit a fresh search", async () => {
  const { engine, workers } = setup({ timeoutMs: 10 });
  const timed = engine.evaluate("slow", 0);
  await assert.rejects(timed, /timed out/);
  assert.equal(workers[0].terminated, true);
  const next = engine.evaluate("fresh", 250);
  workers[1].ready();
  workers[1].complete();
  await next;
});

test("missing evaluations fail explicitly instead of caching a fabricated zero", async () => {
  const { engine, workers } = setup();
  const missing = engine.evaluate("fen", 250);
  const rejected = assert.rejects(missing, /no evaluation/);
  workers[0].ready();
  workers[0].emit("bestmove e2e4");
  await rejected;
  const retry = engine.evaluate("fen", 250);
  workers[0].complete(60);
  assert.equal((await retry).score, 0.6);
});

test("already aborted signals reject even a cached position", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("fen", 250);
  workers[0].ready();
  workers[0].complete();
  await first;
  await assert.rejects(engine.evaluate("fen", 250, { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("MultiPV keeps scores with their own lines at a matching depth and ignores bounds", async () => {
  const { engine, workers } = setup();
  const pending = engine.evaluate("fen", 250, { multiPv: 2 });
  const worker = workers[0]; worker.ready();
  for (const depth of [14, 15, 16]) {
    worker.emit(`info depth ${depth} multipv 1 score cp 40 nodes 200 wdl 30 960 10 pv e2e4 e7e5`);
    worker.emit(`info depth ${depth} multipv 2 score cp -100 nodes 220 pv d2d4 d7d5`);
  }
  worker.emit("info depth 17 multipv 1 score cp 900 lowerbound pv e2e4");
  worker.emit("bestmove e2e4");
  const result = await pending;
  assert.equal(result.score, 0.4);
  assert.equal(result.rawScore, 40);
  assert.equal(result.depth, 16);
  assert.equal(result.complete, true);
  assert.equal(result.stable, true);
  assert.equal(result.candidates[1].score, -1);
  assert.equal(result.candidates[1].stable, true);
  assert.deepEqual(result.wdl, [30, 960, 10]);
});

test("mate sign and distance survive parsing separately from numeric display score", async () => {
  const { engine, workers } = setup(); const pending = engine.evaluate("fen", 250);
  workers[0].ready();
  workers[0].emit("info depth 18 score mate -12 pv e2e4 e7e5\nbestmove e2e4");
  const result = await pending;
  assert.equal(result.scoreType, "mate"); assert.equal(result.rawScore, -12);
});

test("candidate snapshots cannot mix depths or mismatch bestmove and score", async () => {
  const { engine, workers } = setup(); const pending = engine.evaluate("fen", 250, { multiPv: 2 });
  workers[0].ready();
  workers[0].emit("info depth 15 multipv 1 score cp 20 pv e2e4");
  workers[0].emit("info depth 15 multipv 2 score cp 10 pv d2d4");
  workers[0].emit("info depth 16 multipv 1 score cp 40 pv e2e4\nbestmove e2e4");
  const result = await pending;
  assert.equal(result.complete, false); assert.equal(result.candidates.length, 1);
});

test("history and restricted moves have separate caches and options reset between jobs", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("fen", 250, { position: { fen: "root", moves: ["e2e4", "e7e5"] }, searchMoves: ["g1f3"] });
  workers[0].ready();
  assert.equal(workers[0].commands.at(-2), "position fen root moves e2e4 e7e5");
  assert.equal(workers[0].commands.at(-1), "go movetime 250 searchmoves g1f3");
  workers[0].complete(10, "g1f3"); await first;
  const second = engine.evaluate("fen", 250, { multiPv: 2 });
  workers[0].complete(20); await second;
  const third = engine.evaluate("fen", 250);
  assert.equal(workers[0].commands.at(-3), "setoption name MultiPV value 1");
  workers[0].complete(); await third;
  assert.equal(workers[0].commands.filter(command => command.startsWith("go ")).length, 3);
});

test("a score belonging to another move is rejected instead of misclassified", async () => {
  const { engine, workers } = setup(); const pending = engine.evaluate("fen", 250);
  const rejected = assert.rejects(pending, /no evaluation/);
  workers[0].ready(); workers[0].emit("info depth 15 score cp 40 pv e2e4\nbestmove d2d4");
  await rejected;
});

test("stronger compatible results serve weaker requests, including queued and restricted searches", async () => {
  const { engine, workers } = setup();
  const options = { position: { fen: "root", moves: ["e2e4"] }, searchMoves: ["e7e5"] };
  const strong = engine.evaluate("fen", 600, options);
  const weak = engine.evaluate("fen", 250, options);
  workers[0].ready(); workers[0].complete(25, "e7e5");
  const result = await strong;
  assert.equal(await weak, result);
  assert.equal(await engine.evaluate("fen", 200, options), result);
  assert.equal(workers[0].commands.filter(command => command.startsWith("go ")).length, 1);
  engine.invalidate("fen", 250, options);
  const retried = engine.evaluate("fen", 250, options);
  workers[0].complete(20, "e7e5"); await retried;
  assert.equal(workers[0].commands.filter(command => command.startsWith("go ")).length, 2);
});

test("stronger cached analysis never crosses history or MultiPV boundaries", async () => {
  const { engine, workers } = setup();
  const first = engine.evaluate("fen", 1000, { position: { fen: "root", moves: ["e2e4"] } });
  workers[0].ready(); workers[0].complete(); await first;
  const otherHistory = engine.evaluate("fen", 250, { position: { fen: "root", moves: ["d2d4"] } });
  workers[0].complete(); await otherHistory;
  const alternatives = engine.evaluate("fen", 250, { position: { fen: "root", moves: ["e2e4"] }, multiPv: 2 });
  workers[0].complete(); await alternatives;
  assert.equal(workers[0].commands.filter(command => command.startsWith("go ")).length, 3);
});
