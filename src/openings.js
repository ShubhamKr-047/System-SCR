import data from "./data/openings.json" with { type: "json" };

export const OPENING_SOURCE = { source: data.source, revision: data.revision, license: data.license };
export function lookupOpening(fen, uci) {
  const entry = data.entries[`${fen.split(" ").slice(0, 4).join(" ")}|${uci}`];
  return entry ? { eco: entry[0], name: entry[1] } : null;
}
