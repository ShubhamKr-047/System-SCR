import { annotationBrush, squareAt } from "./board-overlay.js";

// The board element stays mounted while squares are redrawn. Capture gestures
// on that stable element so engine updates and outside-board drops are safe.
export class BoardInput {
  constructor({ board, overlay, context, click, select, move, clearSelection }) {
    Object.assign(this, { board, overlay, context, click, select, move, clearSelection });
    this.gesture = null;
    board.addEventListener("pointerdown", event => this.down(event));
    board.addEventListener("pointermove", event => this.update(event));
    board.addEventListener("pointerup", event => this.up(event));
    board.addEventListener("pointercancel", () => this.cancel());
    board.addEventListener("lostpointercapture", () => this.cancel());
    board.addEventListener("contextmenu", event => event.preventDefault());
    board.addEventListener("dragstart", event => event.preventDefault());
    window.addEventListener("blur", () => this.cancel());
    window.addEventListener("resize", () => this.cancel());
  }

  square(event) {
    return squareAt(event.clientX, event.clientY, this.board.getBoundingClientRect(), this.context()?.flipped);
  }

  down(event) {
    if (event.isPrimary === false || ![0, 2].includes(event.button)) return;
    const context = this.context();
    const from = this.square(event);
    if (!context || !from) return;
    event.preventDefault();
    this.cancel();
    const piece = context.chess.get(from);
    const drawing = event.button === 2;
    if (drawing) this.clearSelection();
    else this.overlay.clear();
    this.gesture = {
      type: drawing ? "draw" : "click", from, to: from,
      key: context.key, flipped: context.flipped, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false,
      brush: annotationBrush(event),
      movable: !drawing && !context.chess.isGameOver() && piece?.color === context.chess.turn(),
      legal: context.chess.moves({ square: from, verbose: true }).map(move => move.to)
    };
    this.board.setPointerCapture(event.pointerId);
    if (drawing) {
      this.overlay.preview = { from, to: from, brush: this.gesture.brush };
      this.overlay.render();
    }
  }

  update(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const context = this.context();
    if (context?.key !== gesture.key || context.flipped !== gesture.flipped) {
      this.cancel();
      return;
    }
    event.preventDefault();
    gesture.to = this.square(event);
    gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 6;
    if (gesture.type === "draw") {
      this.overlay.preview = gesture.to ? { from: gesture.from, to: gesture.to, brush: gesture.brush } : null;
      this.overlay.render();
    } else if (gesture.movable && gesture.moved) {
      if (gesture.type !== "drag") {
        gesture.type = "drag";
        this.select(gesture.from);
        const source = this.board.querySelector(`[data-square="${gesture.from}"]`);
        this.ghost = source.querySelector("img").cloneNode();
        this.ghost.className = "drag-piece";
        this.ghost.setAttribute("aria-hidden", "true");
        const size = this.board.getBoundingClientRect().width / 8;
        this.ghost.style.width = `${size}px`;
        this.ghost.style.height = `${size}px`;
        document.body.append(this.ghost);
        source.classList.add("drag-origin");
        this.board.classList.add("dragging");
      }
      this.ghost.style.left = `${event.clientX}px`;
      this.ghost.style.top = `${event.clientY}px`;
      this.board.querySelectorAll(".drop-target").forEach(square => square.classList.remove("drop-target"));
      if (gesture.to && gesture.legal.includes(gesture.to)) {
        this.board.querySelector(`[data-square="${gesture.to}"]`).classList.add("drop-target");
      }
    }
  }

  up(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const context = this.context();
    const to = this.square(event);
    const valid = context?.key === gesture.key && context.flipped === gesture.flipped;
    this.finish();
    if (!valid) return;
    if (gesture.type === "draw") {
      if (to) this.overlay.toggle({ from: gesture.from, to, brush: gesture.brush });
    } else if (gesture.type === "drag") {
      this.clearSelection();
      if (to && gesture.legal.includes(to)) this.move(gesture.from, to);
    } else if (!gesture.moved && to === gesture.from) this.click(to);
  }

  finish() {
    const gesture = this.gesture;
    this.gesture = null;
    this.ghost?.remove();
    this.ghost = null;
    this.board.classList.remove("dragging");
    this.board.querySelectorAll(".drag-origin, .drop-target").forEach(square => square.classList.remove("drag-origin", "drop-target"));
    this.overlay.preview = null;
    this.overlay.render();
    if (gesture && this.board.hasPointerCapture(gesture.pointerId)) this.board.releasePointerCapture(gesture.pointerId);
  }

  cancel() {
    const dragging = this.gesture?.type === "drag";
    this.finish();
    if (dragging) this.clearSelection();
  }
}
