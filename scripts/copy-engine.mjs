import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  resolve("node_modules/stockfish/bin"),
  resolve("node_modules/stockfish")
];
let source = null;
for (const candidate of candidates) {
  if (existsSync(resolve(candidate, "stockfish-19-lite-single.js"))) {
    source = candidate;
    break;
  }
}
if (!source) {
  console.error("Could not find Stockfish 19 lite single-threaded files in node_modules/stockfish.");
  console.error("Check the installed stockfish package contents and update scripts/copy-engine.mjs if the package layout changes.");
  process.exit(1);
}
const dest = resolve("public/engine");
mkdirSync(dest, { recursive: true });
for (const name of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm", "Copying.txt"]) {
  const from = resolve(source, name);
  if (existsSync(from)) copyFileSync(from, resolve(dest, name));
}
if (!existsSync(resolve(dest, "stockfish-19-lite-single.js")) ||
    !existsSync(resolve(dest, "stockfish-19-lite-single.wasm"))) {
  console.error("Stockfish JS/WASM pair was not copied. Inspect the stockfish package's bin directory.");
  process.exit(1);
}
console.log("Copied local Stockfish engine files.");
