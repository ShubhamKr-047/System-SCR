// Bounded AND/OR search: every defender reply must lose. Attacker checks are
// sufficient for a positive proof; omitted quiet moves can only leave it unknown.
export function proveShortMate(chess, attacker, { plies = 5, maxNodes = 3000,
  deadline = performance.now() + 150, signal } = {}) {
  let nodes = 0;
  const visit = remaining => {
    if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
    if (++nodes > maxNodes || performance.now() >= deadline) return null;
    if (chess.isCheckmate()) return chess.turn() !== attacker;
    if (chess.isGameOver()) return false;
    if (!remaining) return null;
    const attacking = chess.turn() === attacker;
    const moves = chess.moves({ verbose: true }).filter(move => !attacking || /[+#]/.test(move.san));
    let unknown = false;
    for (const move of moves) {
      chess.move(move);
      let result;
      try { result = visit(remaining - 1); } finally { chess.undo(); }
      if (attacking && result === true) return true;
      if (!attacking && result === false) return false;
      if (result === null) unknown = true;
    }
    return attacking ? null : unknown ? null : true;
  };
  const proven = visit(plies) === true;
  return { proven, nodes, status: proven ? "verified-mate" : "inconclusive", plies };
}
