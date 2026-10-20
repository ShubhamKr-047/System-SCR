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
