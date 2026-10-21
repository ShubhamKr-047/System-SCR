// Node adapter for exercising the exact single-threaded engine shipped to browsers.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export class StockfishWorker {
  constructor() {
    this.listeners = {};
    this.process = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url))],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    createInterface({ input: this.process.stdout }).on("line", line => this.listeners.message?.({ data: line }));
    this.process.stderr.on("data", data => this.listeners.error?.({ message: String(data) }));
    this.process.on("error", error => this.listeners.error?.(error));
    this.process.on("exit", code => { if (!this.stopped) this.listeners.error?.({ message: `Stockfish exited: ${code}` }); });
  }
  addEventListener(event, callback) { this.listeners[event] = callback; }
  postMessage(command) { this.process.stdin.write(`${command}\n`); }
  terminate() { this.stopped = true; this.process.kill(); }
}
