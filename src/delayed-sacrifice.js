import { Chess } from 'chess.js';
import { sacrificeCandidates, playUci } from './move-quality.js';
import { EXCEPTIONAL_POLICY } from './classification-policy.js';

// Discover only forcing continuations of the initiating piece. Branching defense
// is deliberately inconclusive: a single PV cannot establish a forced sacrifice.
export function delayedSacrifices(node, analysis) {
  if (node.move.promotion || ['p', 'k'].includes(node.move.piece)) return [];
  const color = node.move.color;
  const chess = new Chess(node.fen);
  let parent = node, square = node.move.to;
  for (const uci of (analysis.pv || '').split(/\s+/).slice(0, EXCEPTIONAL_POLICY.delayedPlies)) {
    if (!uci) break;
    if (chess.turn() !== color && chess.moves().length !== 1) return [];
    const before = chess.fen();
    let move;
    try { move = playUci(chess, uci); } catch { return []; }
    if (move.color === color && (move.from !== square || move.promotion)) return [];
    const next = { parent, move, fen: chess.fen() };
    if (move.color === color) {
      square = move.to;
      const offers = sacrificeCandidates(before, next.fen, move)
        .filter(c => c.square === square)
        .map(c => ({ ...c, parent: next, delayed: true }));
      if (offers.length) return offers;
    }
    parent = next;
  }
  return [];
}
