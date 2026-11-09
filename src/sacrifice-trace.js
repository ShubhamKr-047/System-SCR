import { Chess } from 'chess.js';
import { materialBalance, playUci } from './move-quality.js';

export function traceSacrifice(candidate, analysis, baseline, color) {
  const chess = new Chess(candidate.fen);
  const events = [{ ply: 0, balance: materialBalance(chess.fen(), color), acceptance: candidate.uci }];
  let sustained = false, forcingRecovery = false;
  for (const uci of (analysis.pv || '').split(/\s+/).slice(0, 16)) {
    let move;
    try { move = playUci(chess, uci); } catch { break; }
    const balance = materialBalance(chess.fen(), color);
    const deficit = baseline - balance;
    events.push({ ply: events.length, san: move.san, square: move.to, captured: move.captured,
      balance, deficit, check: /[+#]/.test(move.san) });
    if (chess.isCheckmate()) return { qualifies: chess.turn() !== color, mate: true, events };
    if (events.length >= 3 && deficit >= 1.5) sustained = true;
    // A capture elsewhere with check is tactical recovery, not a routine
    // recapture on the offered piece's square. Initial exchange minimax must
    // already have established a real material offer.
    if (move.color === color && move.captured && move.to !== candidate.square && /[+#]/.test(move.san)) forcingRecovery = true;
  }
  return { qualifies: sustained || forcingRecovery, sustained, forcingRecovery, events };
}
