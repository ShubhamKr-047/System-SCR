import { Chess } from 'chess.js';

// Only animate a legal single move (or its undo). Importing/jumping between
// unrelated positions snaps immediately rather than guessing piece identities.
export function pieceTransition(beforeFen, afterFen) {
  if (!beforeFen || beforeFen === afterFen) return null;
  const find = (from, to, reverse) => {
    const chess = new Chess(from);
    for (const move of chess.moves({ verbose: true })) {
      chess.move(move);
      const matches = chess.fen() === to;
      chess.undo();
      if (!matches) continue;
      const pieces = [{ from: move.from, to: move.to }];
      if (move.flags.includes('k') || move.flags.includes('q')) {
        const rank = move.from[1], kingSide = move.to[0] === 'g';
        pieces.push({ from: (kingSide ? 'h' : 'a') + rank, to: (kingSide ? 'f' : 'd') + rank });
      }
      return pieces.map(p => reverse ? { from: p.to, to: p.from } : p);
    }
    return null;
  };
  return find(beforeFen, afterFen, false) || find(afterFen, beforeFen, true);
}

export class PieceAnimator {
  constructor(board, { duration = 190 } = {}) {
    this.board = board;
    this.duration = duration;
    this.active = new Map();
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', () => this.cancel());
    window.addEventListener('resize', () => this.cancel());
    this.resizeObserver = new ResizeObserver(() => {
      if (this.active.size && Math.abs(this.board.getBoundingClientRect().width - this.width) > 0.5) this.cancel();
    });
    this.resizeObserver.observe(board);
    // A new gesture always starts from a stable, interactive board.
    board.addEventListener('pointerdown', () => this.cancel(), { capture: true });
  }

  cancel() {
    for (const record of this.active.values()) {
      record.animation.cancel();
      record.ghost.remove();
      record.target.style.visibility = '';
    }
    this.active.clear();
  }

  render({ fen, flipped, tree, instant = false }, paint) {
    const before = new Map([...this.board.querySelectorAll('.square > .piece')].map(piece =>
      [piece.parentElement.dataset.square, { rect: piece.getBoundingClientRect(), image: piece }]));
    const continuing = [];
    for (const [square, record] of this.active) {
      before.set(square, { rect: record.ghost.getBoundingClientRect(), image: record.ghost });
      continuing.push({ from: square, to: square, duration: Math.max(0, record.end - performance.now()) });
    }
    const bounds = this.board.getBoundingClientRect();
    const compatible = this.tree === tree && this.flipped === flipped && this.width === bounds.width;
    let moves = null;
    if (compatible && !instant && !this.motion.matches && this.board.animate) {
      moves = this.fen === fen ? continuing : pieceTransition(this.fen, fen);
    }
    this.cancel();
    paint();
    if (this.fen !== fen && this.drop) {
      // The dragged piece already followed the pointer to its destination.
      // Castling's rook can still slide; the king should not jump back first.
      moves = moves?.filter(move => move.from !== this.drop.from || move.to !== this.drop.to);
      this.drop = null;
    }
    Object.assign(this, { fen, flipped, tree, width: bounds.width });
    for (const move of moves || []) {
      const source = before.get(move.from);
      const target = this.board.querySelector(`[data-square="${move.to}"] > .piece`);
      if (!source || !target) continue;
      const end = target.getBoundingClientRect();
      const ghost = source.image.cloneNode();
      ghost.className = 'move-animation-piece';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.alt = '';
      Object.assign(ghost.style, { left: `${end.left - bounds.left}px`, top: `${end.top - bounds.top}px`,
        width: `${end.width}px`, height: `${end.height}px`, visibility: '' });
      this.board.append(ghost);
      target.style.visibility = 'hidden';
      const duration = move.duration ?? this.duration;
      const animation = ghost.animate([
        { transform: `translate(${source.rect.left - end.left}px, ${source.rect.top - end.top}px)` },
        { transform: 'translate(0, 0)' }
      ], { duration, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'both' });
      const record = { animation, ghost, target, end: performance.now() + duration };
      this.active.set(move.to, record);
      animation.onfinish = () => {
        if (this.active.get(move.to) !== record) return;
        target.style.visibility = '';
        ghost.remove();
        this.active.delete(move.to);
      };
    }
  }
}
