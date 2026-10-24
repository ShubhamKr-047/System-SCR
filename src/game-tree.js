import { Chess } from "chess.js";

export const moveUci = move => `${move.from}${move.to}${move.promotion || ""}`;

// Nodes are positions; a node's result describes the move from its parent.
export class GameTree {
  constructor(pgn = "") {
    const chess = new Chess();
    if (typeof pgn === "string" && pgn.trim()) {
      chess.loadPgn(pgn, { strict: false });
    }
    const history = chess.history({ verbose: true });
    this.isAnalysisBoard = !history.length;
    this.headers = chess.getHeaders();
    this.nodes = new Map();
    const startFen = history.length ? history[0].before : chess.fen();
    this.root = this.create(null, null, startFen, true);
    this.mainline = [this.root];
    let parent = this.root;
    for (const move of history) {
      parent = this.create(parent, move, move.after, true);
      this.mainline.push(parent);
    }
    this.current = this.root;
    this.returnId = null;
  }

  create(parent, move, fen, mainline = false) {
    const node = {
      id: String(this.nodes.size), parent, move, fen, mainline,
      ply: parent ? parent.ply + 1 : 0, children: [], selected: null,
      analysis: null, result: null, analysisStatus: "idle", error: "",
      resultTime: 0, collapsed: false
    };
    this.nodes.set(node.id, node);
    if (parent) parent.children.push(node);
    return node;
  }

  path(node = this.current) {
    const path = [];
    for (; node; node = node.parent) path.unshift(node);
    return path;
  }

  select(node) {
    if (!node || this.nodes.get(node.id) !== node) return;
    if (node.mainline) {
      this.returnId = null;
    } else {
      this.returnId = this.path(node).filter(n => n.mainline).at(-1).id;
    }
    for (const step of this.path(node)) {
      step.collapsed = false;
      if (step.parent) step.parent.selected = step;
    }
    this.current = node;
  }

  continuation(node) {
    // Returning to any original-game position resumes the original game.
    return node.children.find(n => n.mainline) || node.selected || node.children[0];
  }

  line() {
    const line = this.path();
    let next = this.continuation(this.current);
    while (next) {
      line.push(next);
      next = this.continuation(next);
    }
    return line;
  }

  play(input, { variation = false } = {}) {
    const chess = new Chess(this.current.fen);
    const move = chess.move(input);
    const parent = this.current;
    const isExtendingMainline = Boolean(!variation && this.isAnalysisBoard && parent.mainline && parent === this.mainline.at(-1));
    const existing = parent.children.find(n => moveUci(n.move) === moveUci(move));
    const node = existing || this.create(parent, move, chess.fen(), isExtendingMainline);
    if (!existing && isExtendingMainline) {
      this.mainline.push(node);
    }
    this.select(node);
    return node;
  }

  branchOrigin(node = this.current) {
    while (node.parent) {
      if ((!node.mainline && node.parent.mainline) || node.parent.children[0] !== node) return node.parent;
      node = node.parent;
    }
    return this.root;
  }

  returnToGame() {
    const origin = this.nodes.get(this.returnId);
    if (origin) this.select(origin);
    return this.current;
  }
}

export function moveLabel(node) {
  if (!node?.move) return "Start";
  const [,, , , , fullmove] = node.parent.fen.split(" ");
  return `${fullmove}${node.move.color === "w" ? "." : "..."} ${node.move.san}`;
}
