export const BRUSHES = { green: "#66aa66", red: "#dd6666", blue: "#6688cc", yellow: "#e0b84d" };

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

export function annotationBrush(event) {
  const red = event.ctrlKey; // Avoid Firefox's native Shift + right-click menu.
  const blue = event.altKey || event.metaKey;
  return red ? (blue ? "yellow" : "red") : blue ? "blue" : "green";
}

export class BoardOverlay {
  constructor(svg, isFlipped) {
    this.svg = svg;
    this.isFlipped = isFlipped;
    this.shapes = [];
    this.preview = null;
    this.bestmove = "";
    svg.innerHTML = `<defs>${Object.entries({ engine: "#75BFFF", ...BRUSHES }).map(([key, color]) =>
      `<marker id="arrow-${key}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.4" markerHeight="3.4" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`).join("")}</defs>
      <g data-layer="engine" opacity="0.55"></g><g data-layer="planning" opacity="0.7"></g><g data-layer="preview" opacity="0.5"></g>`;
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
    const a = squareCenter(from, this.isFlipped());
    const b = squareCenter(to, this.isFlipped());
    if (!a || !b) return "";
    const color = engine ? "#75BFFF" : BRUSHES[brush];
    if (!color) return "";
    if (from === to) return `<circle cx="${a.x}" cy="${a.y}" r="5.3" fill="none" stroke="${color}" stroke-width="0.9"/>`;
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
    const startTrim = 1.2, endTrim = 2.3;
    return `<line x1="${a.x + dx / distance * startTrim}" y1="${a.y + dy / distance * startTrim}" x2="${b.x - dx / distance * endTrim}" y2="${b.y - dy / distance * endTrim}" stroke="${color}" stroke-width="${engine ? 1.4 : 1.5}" stroke-linecap="round" marker-end="url(#arrow-${engine ? "engine" : brush})"/>`;
  }

  render() {
    this.svg.querySelector('[data-layer="engine"]').innerHTML = this.bestmove
      ? this.shapeSvg({ from: this.bestmove.slice(0, 2), to: this.bestmove.slice(2, 4) }, true) : "";
    this.svg.querySelector('[data-layer="planning"]').innerHTML = this.shapes.map(shape => this.shapeSvg(shape)).join("");
    this.svg.querySelector('[data-layer="preview"]').innerHTML = this.preview ? this.shapeSvg(this.preview) : "";
  }
}
