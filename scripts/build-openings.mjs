// Explicit maintenance command; normal builds never download opening data.
import { Chess } from "chess.js";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision || "")) throw new Error("Pass a pinned lichess-org/chess-openings commit SHA");
const entries = {};
const lengths = {};
const digest = createHash("sha256");
let lines = 0;
for (const volume of "abcde") {
  const response = await fetch(`https://raw.githubusercontent.com/lichess-org/chess-openings/${revision}/${volume}.tsv`);
  if (!response.ok) throw new Error(`Opening download failed: ${response.status}`);
  const source = await response.text();
  digest.update(source);
  for (const row of source.trim().split(/\r?\n/).slice(1)) {
    const [eco, name, pgn] = row.split("\t");
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    for (const move of history) {
      const key = `${move.before.split(" ").slice(0, 4).join(" ")}|${move.from}${move.to}${move.promotion || ""}`;
      // Prefer a short, general name when several named lines share a prefix.
      if (!entries[key] || history.length < lengths[key] ||
        (history.length === lengths[key] && name.length < entries[key][1].length)) {
        entries[key] = [eco, name];
        lengths[key] = history.length;
      }
    }
    lines++;
  }
}
await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/openings.json", import.meta.url), JSON.stringify({
  source: "https://github.com/lichess-org/chess-openings", license: "CC0-1.0", revision,
  sha256: digest.digest("hex"), lines, entries
}));
console.log(`${lines} opening lines; ${Object.keys(entries).length} position/move entries`);
