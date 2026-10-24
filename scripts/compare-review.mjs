import { readFile, writeFile } from "node:fs/promises";

const read = name => readFile(`logs/review-benchmarks/review-${name}.json`, "utf8").then(JSON.parse);
const baseline = await read("baseline");
const quick = await read("quick");
const reference = await read("reference-1000").catch(error => { if (error.code !== "ENOENT") throw error; return []; });
const comparisons = quick.map(game => {
  const old = baseline.find(other => other.game === game.game);
  const deep = reference.find(other => other.game === game.game);
  const differences = deep ? game.moves.flatMap((move, index) => {
    const referenceMove = deep.moves[index];
    return referenceMove.key !== move.key ? [{ ply: move.ply, san: move.san, quick: move.key,
      reference: referenceMove.key, quickLoss: move.chanceLoss, referenceLoss: referenceMove.chanceLoss,
      quickReason: move.reason, referenceReason: referenceMove.reason }] : [];
  }) : [];
  return { game: game.game, plies: game.plies, beforeMs: old?.elapsedMs, initialMs: game.initialMs,
    afterMs: game.elapsedMs, speedup: old ? Number((old.elapsedMs / game.elapsedMs).toFixed(2)) : null,
    searchesBefore: old?.searches, searchesAfter: game.searches, repeatMs: game.repeatMs,
    repeatSearches: game.repeatSearches,
    referenceAgreement: deep ? Number(((game.plies - differences.length) / game.plies * 100).toFixed(1)) : null,
    missedReferenceBlunders: differences.filter(move => move.reference === "blunder" && move.quick !== "blunder"),
    extraBrilliants: differences.filter(move => move.quick === "brilliant" && move.reference !== "brilliant"),
    differences };
});
await writeFile("logs/review-benchmarks/review-comparison.json", JSON.stringify(comparisons, null, 2));
for (const comparison of comparisons) console.log(JSON.stringify({ ...comparison, differences: undefined }));
// These need inspection before accepting a speed/quality tradeoff. The deeper
// reference is finite too, so the report keeps the scores and reasons.
if (comparisons.some(game => game.missedReferenceBlunders.length || game.extraBrilliants.length)) process.exitCode = 1;
