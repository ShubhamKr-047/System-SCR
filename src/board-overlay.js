export const BRUSHES = {
  orange: "#ffa500", // Chess.com default right-click orange
  red: "#fa412d",    // Chess.com Ctrl + right-click red
  blue: "#52b1ff",   // Chess.com Alt + right-click blue
  green: "#81b64c",  // Chess.com Shift + right-click green
  yellow: "#f7c631"  // Chess.com Ctrl + Alt yellow
};

export function squareCenter(square, flipped = false) {
  if (!/^[a-h][1-8]$/.test(square || "")) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return { x: ((flipped ? 7 - file : file) + 0.5) * 12.5, y: ((flipped ? rank : 7 - rank) + 0.5) * 12.5 };
}

export function squareAt(x, y, bounds, flipped = false) {
  if (!bounds.width || !bounds.height || x < bounds.left || y < bounds.top || x >= bounds.right || y >= bounds.bottom) return null;
  const col = Math.floor((x - bounds.left) / bounds.width * 8);
  const row = Math.floor((y - bounds.top) / bounds.height * 8);
  return String.fromCharCode(97 + (flipped ? 7 - col : col)) + (flipped ? row + 1 : 8 - row);
}

export function annotationBrush(event = {}) {
  const ctrl = Boolean(event.ctrlKey);
  const alt = Boolean(event.altKey || event.metaKey);
  const shift = Boolean(event.shiftKey);

  if (ctrl && alt) return "yellow";
  if (ctrl) return "red";
  if (alt) return "blue";
  if (shift) return "green";
  return "orange";
}

export class BoardOverlay {
  constructor(svg, isFlipped, board = null) {
    this.svg = svg;
    this.isFlipped = isFlipped;
    this.board = board;
    this.shapes = [];
    this.preview = null;
    this.bestmove = "";
    svg.innerHTML = `<defs>${Object.entries({ engine: "#96bc4b", ...BRUSHES }).map(([key, color]) =>
      `<marker id="arrow-${key}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join("")}</defs>
      <g data-layer="engine" opacity="0.55"></g><g data-layer="planning" opacity="0.8"></g><g data-layer="preview" opacity="0.6"></g>`;
  }

  getBoard() {
    return this.board || (typeof document !== "undefined" ? (this.svg?.parentElement?.querySelector("#board") || document.getElementById("board")) : null);
  }

  toggle(shape) {
    const index = this.shapes.findIndex(old => old.from === shape.from && old.to === shape.to);
    const previous = this.shapes[index];
    if (index !== -1) this.shapes.splice(index, 1);
    if (!previous || previous.brush !== shape.brush) this.shapes.push(shape);
    this.preview = null;
    this.render();
  }

  clear() {
    this.shapes = [];
    this.preview = null;
    this.render();
  }

  shapeSvg({ from, to, brush }, engine = false) {
    if (from === to) return "";
    const a = squareCenter(from, this.isFlipped());
    const b = squareCenter(to, this.isFlipped());
    if (!a || !b) return "";
    const color = engine ? "#96bc4b" : (BRUSHES[brush] || BRUSHES.orange);
    if (!color) return "";

    // 2. Check for Knight move (L-shaped arrow)
    const fileFrom = from.charCodeAt(0) - 97;
    const rankFrom = Number(from[1]) - 1;
    const fileTo = to.charCodeAt(0) - 97;
    const rankTo = Number(to[1]) - 1;
    const df = fileTo - fileFrom;
    const dr = rankTo - rankFrom;
    const isKnight = (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);

    const W = 2.4; // Chess.com bold shaft width
    const HW = 6.0; // Arrowhead width
    const HL = 4.8; // Arrowhead length
    const startTrim = 1.6;
    const endTrim = 1.0;

    if (isKnight) {
      let corner;
      let ux, uy;
      if (Math.abs(dr) === 2) {
        corner = { x: a.x, y: b.y };
        ux = Math.sign(b.x - a.x);
        uy = 0;
      } else {
        corner = { x: b.x, y: a.y };
        ux = 0;
        uy = Math.sign(b.y - a.y);
      }

      const tipX = b.x - ux * endTrim;
      const tipY = b.y - uy * endTrim;
      const baseX = tipX - ux * HL;
      const baseY = tipY - uy * HL;

      const nx = -uy;
      const ny = ux;

      const wingLeftX = baseX + nx * (HW / 2);
      const wingLeftY = baseY + ny * (HW / 2);
      const wingRightX = baseX - nx * (HW / 2);
      const wingRightY = baseY - ny * (HW / 2);

      const shaftEndX = baseX + ux * 0.5;
      const shaftEndY = baseY + uy * 0.5;

      const startDirX = Math.sign(corner.x - a.x);
      const startDirY = Math.sign(corner.y - a.y);
      const startX = a.x + startDirX * startTrim;
      const startY = a.y + startDirY * startTrim;

      return `<g class="chesscom-arrow" opacity="${engine ? 0.75 : 0.8}">
        <path d="M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${corner.x.toFixed(2)} ${corner.y.toFixed(2)} L ${shaftEndX.toFixed(2)} ${shaftEndY.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/>
        <polygon points="${tipX.toFixed(2)},${tipY.toFixed(2)} ${wingRightX.toFixed(2)},${wingRightY.toFixed(2)} ${wingLeftX.toFixed(2)},${wingLeftY.toFixed(2)}" fill="${color}"/>
      </g>`;
    }

    // 3. Straight arrow
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return "";

    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy;
    const ny = ux;

    let headW = HW;
    let headL = HL;
    if (dist < headL + startTrim + endTrim) {
      const scale = Math.max(0.4, (dist - startTrim) / (headL + endTrim));
      headW *= scale;
      headL *= scale;
    }

    const startX = a.x + ux * startTrim;
    const startY = a.y + uy * startTrim;
    const tipX = b.x - ux * endTrim;
    const tipY = b.y - uy * endTrim;
    const baseX = tipX - ux * headL;
    const baseY = tipY - uy * headL;

    const wingLeftX = baseX + nx * (headW / 2);
    const wingLeftY = baseY + ny * (headW / 2);
    const wingRightX = baseX - nx * (headW / 2);
    const wingRightY = baseY - ny * (headW / 2);

    const shaftEndX = baseX + ux * 0.5;
    const shaftEndY = baseY + uy * 0.5;

    return `<g class="chesscom-arrow" opacity="${engine ? 0.75 : 0.8}">
      <line x1="${startX.toFixed(2)}" y1="${startY.toFixed(2)}" x2="${shaftEndX.toFixed(2)}" y2="${shaftEndY.toFixed(2)}" stroke="${color}" stroke-width="${W}" stroke-linecap="round"/>
      <polygon points="${tipX.toFixed(2)},${tipY.toFixed(2)} ${wingRightX.toFixed(2)},${wingRightY.toFixed(2)} ${wingLeftX.toFixed(2)},${wingLeftY.toFixed(2)}" fill="${color}"/>
    </g>`;
  }

  render() {
    const board = this.getBoard();
    if (board) {
      board.querySelectorAll("[data-square]").forEach(sq => {
        sq.classList.remove("highlight-red", "highlight-orange", "highlight-blue", "highlight-green", "highlight-yellow");
      });
      const squareMarks = this.shapes.filter(s => s.from === s.to);
      if (this.preview && this.preview.from === this.preview.to) {
        squareMarks.push(this.preview);
      }
      for (const shape of squareMarks) {
        const sqEl = board.querySelector(`[data-square="${shape.from}"]`);
        if (sqEl) {
          sqEl.classList.add(`highlight-${shape.brush || "orange"}`);
        }
      }
    }

    const planningArrows = this.shapes.filter(s => s.from !== s.to);
    const previewArrow = (this.preview && this.preview.from !== this.preview.to) ? this.preview : null;

    this.svg.querySelector('[data-layer="engine"]').innerHTML = this.bestmove
      ? this.shapeSvg({ from: this.bestmove.slice(0, 2), to: this.bestmove.slice(2, 4) }, true) : "";
    this.svg.querySelector('[data-layer="planning"]').innerHTML = planningArrows.map(shape => this.shapeSvg(shape)).join("");
    this.svg.querySelector('[data-layer="preview"]').innerHTML = previewArrow ? this.shapeSvg(previewArrow) : "";
  }
}
