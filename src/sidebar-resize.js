const STORAGE_KEY = "zen-chess-feedback-split";

// Keep the divider outside the feedback card, which is replaced for each move.
export function initSidebarResize() {
  const panel = document.querySelector(".sidebar-panel");
  const feedback = document.getElementById("feedbackContainer");
  const splitter = document.getElementById("feedbackSplitter");
  if (!panel || !feedback || !splitter) return;

  const tabs = panel.querySelector(".sidebar-tabs");
  const footer = panel.querySelector(".sidebar-footer");
  const movesView = document.getElementById("gameMovesView");
  let ratio = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null && Number.isFinite(Number(saved))) {
      ratio = Math.max(0, Math.min(1, Number(saved)));
    }
  } catch { /* Resizing still works when storage is unavailable. */ }

  const outerHeight = element => {
    if (!element) return 0;
    const style = getComputedStyle(element);
    return element.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0)
      + (parseFloat(style.marginBottom) || 0);
  };
  function limits() {
    const style = getComputedStyle(panel);
    const header = panel.querySelector(".moves-view-header");
    const available = panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      - outerHeight(header) - outerHeight(splitter) - outerHeight(tabs) - outerHeight(footer);
    const max = Math.max(0, available - 140);
    return { available, min: Math.min(100, max), max };
  }
  function update() {
    const { available, min, max } = limits();
    if (ratio !== null) {
      const height = Math.max(min, Math.min(max, available * ratio));
      panel.style.setProperty("--feedback-height", `${height}px`);
      panel.classList.add("has-feedback-split");
    }
    splitter.setAttribute("aria-valuemin", String(Math.round(min)));
    splitter.setAttribute("aria-valuemax", String(Math.round(max)));
    splitter.setAttribute("aria-valuenow", String(Math.round(feedback.getBoundingClientRect().height)));
    splitter.setAttribute("aria-valuetext", `${Math.round(feedback.getBoundingClientRect().height)} pixels of feedback`);
  }
  function resize(height) {
    const { available, min, max } = limits();
    ratio = Math.max(min, Math.min(max, height)) / Math.max(1, available);
    update();
  }
  function save() {
    try {
      if (ratio === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(ratio));
    } catch { /* Storage is optional. */ }
  }

  let drag = null;
  splitter.addEventListener("pointerdown", event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    splitter.focus({ preventScroll: true });
    drag = { id: event.pointerId, y: event.clientY, height: feedback.getBoundingClientRect().height };
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("is-dragging");
    document.body.classList.add("resizing-feedback");
  });
  splitter.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) resize(drag.height + event.clientY - drag.y);
  });
  const finish = event => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    splitter.classList.remove("is-dragging");
    document.body.classList.remove("resizing-feedback");
    save();
  };
  splitter.addEventListener("pointerup", finish);
  splitter.addEventListener("pointercancel", finish);
  splitter.addEventListener("lostpointercapture", finish);
  splitter.addEventListener("keydown", event => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const { min, max } = limits();
    const height = feedback.getBoundingClientRect().height;
    resize(event.key === "Home" ? min : event.key === "End" ? max
      : height + (event.key === "ArrowUp" ? -20 : 20));
    save();
  });
  splitter.addEventListener("dblclick", () => {
    ratio = null;
    panel.classList.remove("has-feedback-split");
    panel.style.removeProperty("--feedback-height");
    save();
    update();
  });

  // Re-clamp the saved proportion as the viewport or footer changes size.
  let frame;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  });
  for (const element of [panel, feedback, tabs, footer, movesView]) {
    if (element) observer.observe(element);
  }
  update();
}
