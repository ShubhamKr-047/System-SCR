import { Chess } from "chess.js";
import { PIECE_IMAGES } from "./pieces.js";
import { CLASSIFICATIONS, calculateAccuracy, calculateEstimatedRating } from "./classifications.js";
import { getApiKey, setApiKey, hasApiKey, getCachedCoaching, generateCoaching } from "./gemini.js";
import { GameTree, moveLabel } from "./game-tree.js";
import { EngineQueue } from "./engine.js";
import { analyzeMove } from "./analysis.js";
import "./style.css";

const $ = (id) => document.getElementById(id);

const state = {
  moves: [],
  positions: [],
  analyses: [],
  results: [],
  cursor: 0,
  flipped: false,
  running: false,
  headers: {},
  selectedSquare: null,
  legalMoves: [],
  showBestMoveArrow: localStorage.getItem("zen-chess-show-arrow") !== "false",
  tree: null,
  line: [],
  session: new AbortController(),
  reviewController: null,
  isVariation: false
};

function setStatus(message, error = false) {
  const el = $("importStatus");
  if (el) {
    el.textContent = message;
    el.classList.toggle("error", error);
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function readImport() {
  const pgn = $("pgnText").value.trim();
  if (!pgn) {
    setStatus("Paste PGN text or choose a .pgn file first.", true);
    return;
  }
  try {
    const tree = new GameTree(pgn);
    state.session.abort();
    state.reviewController?.abort();
    engine.clear();
    clearTimeout(quickAnalysisTimer);
    quickController?.abort();
    state.session = new AbortController();
    state.tree = tree;
    state.headers = tree.headers;
    state.running = false;
    state.selectedSquare = null;
    state.legalMoves = [];
    syncActiveLine();

    if ($("startReviewText")) $("startReviewText").textContent = "Analyze game";
    if ($("startReview")) {
      $("startReview").disabled = false;
      $("startReview").title = "Analyze game";
      $("startReview").classList.remove("review-mode");
      $("startReview").style.display = "inline-flex";
    }
    if ($("stopReview")) $("stopReview").style.display = "none";

    updatePlayerHeaders();

    $("reviewProgress").textContent = `${state.moves.length} half-moves loaded`;
    setStatus(`Loaded ${state.moves.length} half-moves. Ready to analyze.`);
    $("engineStatus").textContent = "Engine idle";
    updateAnalysisProgress(0, state.moves.length, "Ready to analyze", false, false);

    if ($("topPlayerRatingEstimate")) $("topPlayerRatingEstimate").style.display = "none";
    if ($("bottomPlayerRatingEstimate")) $("bottomPlayerRatingEstimate").style.display = "none";
    if ($("topPlayerAccuracy")) $("topPlayerAccuracy").style.display = "none";
    if ($("bottomPlayerAccuracy")) $("bottomPlayerAccuracy").style.display = "none";
    if ($("summaryWhiteRating")) $("summaryWhiteRating").textContent = "—";
    if ($("summaryBlackRating")) $("summaryBlackRating").textContent = "—";
    if ($("summaryWhiteAcc")) $("summaryWhiteAcc").textContent = "—";
    if ($("summaryBlackAcc")) $("summaryBlackAcc").textContent = "—";

    // Switch back to moves tab
    switchTab("moves");
    renderMoves();
    renderBoard(0);
    renderFeedback(null);
    setNavEnabled();
  } catch (e) {
    setStatus(`Could not read PGN: ${e.message}`, true);
  }
}

function updatePlayerHeaders() {
  const whiteName = state.headers.White || "White";
  const blackName = state.headers.Black || "Black";
  const whiteElo = state.headers.WhiteElo ? `(${state.headers.WhiteElo})` : "";
  const blackElo = state.headers.BlackElo ? `(${state.headers.BlackElo})` : "";

  // Update hidden elements for compatibility
  if ($("whiteName")) $("whiteName").textContent = whiteName;
  if ($("blackName")) $("blackName").textContent = blackName;

  const whiteAvatarHtml = `<img src="${PIECE_IMAGES.wk}" class="avatar-piece" alt="White piece">`;
  const blackAvatarHtml = `<img src="${PIECE_IMAGES.bk}" class="avatar-piece" alt="Black piece">`;

  if (state.flipped) {
    // Flipped: White is at top, Black is at bottom
    $("topPlayerName").textContent = whiteName;
    $("topPlayerRating").textContent = whiteElo;
    $("topAvatar").innerHTML = whiteAvatarHtml;
    $("topAvatar").className = "avatar-circle white-player";

    $("bottomPlayerName").textContent = blackName;
    $("bottomPlayerRating").textContent = blackElo;
    $("bottomAvatar").innerHTML = blackAvatarHtml;
    $("bottomAvatar").className = "avatar-circle black-player";
  } else {
    // Normal: Black is at top, White is at bottom
    $("topPlayerName").textContent = blackName;
    $("topPlayerRating").textContent = blackElo;
    $("topAvatar").innerHTML = blackAvatarHtml;
    $("topAvatar").className = "avatar-circle black-player";

    $("bottomPlayerName").textContent = whiteName;
    $("bottomPlayerRating").textContent = whiteElo;
    $("bottomAvatar").innerHTML = whiteAvatarHtml;
    $("bottomAvatar").className = "avatar-circle white-player";
  }

  $("summaryWhiteName").textContent = whiteName;
  $("summaryBlackName").textContent = blackName;
  if ($("summaryWhiteAvatar")) $("summaryWhiteAvatar").innerHTML = `<img src="${PIECE_IMAGES.wk}" alt="White">`;
  if ($("summaryBlackAvatar")) $("summaryBlackAvatar").innerHTML = `<img src="${PIECE_IMAGES.bk}" alt="Black">`;
}

// Hamburger Menu Wiring
const hamburgerBtn = $("hamburgerBtn");
const hamburgerMenu = $("hamburgerMenu");
const closeHamburgerBtn = $("closeHamburgerBtn");

function closeHamburger() {
  if (hamburgerMenu) hamburgerMenu.style.display = "none";
  if (hamburgerBtn) {
    hamburgerBtn.classList.remove("active");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  }
}

if (hamburgerBtn && hamburgerMenu) {
  hamburgerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = hamburgerMenu.style.display === "none";
    hamburgerMenu.style.display = isHidden ? "block" : "none";
    hamburgerBtn.classList.toggle("active", isHidden);
    hamburgerBtn.setAttribute("aria-expanded", String(isHidden));
  });

  if (closeHamburgerBtn) {
    closeHamburgerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeHamburger();
    });
  }

  // Click outside to close
  document.addEventListener("click", (e) => {
    if (!hamburgerMenu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
      closeHamburger();
    }
  });
}

$("pgnFile").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  $("pgnText").value = await file.text();
  setStatus(`Loaded file: ${file.name}. Click “Load game”.`);
  readImport();
  closeHamburger();
});

$("loadPgn").addEventListener("click", () => {
  readImport();
  if (state.moves.length) closeHamburger();
});

$("pgnText").addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    readImport();
    if (state.moves.length) closeHamburger();
  }
});

// Toggle Paste PGN Drawer
const togglePasteBtn = $("togglePastePgn");
const pasteDrawer = $("pasteDrawer");
if (togglePasteBtn && pasteDrawer) {
  togglePasteBtn.addEventListener("click", () => {
    const isHidden = pasteDrawer.style.display === "none";
    pasteDrawer.style.display = isHidden ? "block" : "none";
    togglePasteBtn.classList.toggle("active", isHidden);
    if (isHidden) {
      $("pgnText").focus();
    }
  });
}

const drawerLoadBtn = $("drawerLoadBtn");
if (drawerLoadBtn) {
  drawerLoadBtn.addEventListener("click", () => {
    readImport();
    if (state.moves.length) {
      if (pasteDrawer) pasteDrawer.style.display = "none";
      togglePasteBtn?.classList.remove("active");
      closeHamburger();
    }
  });
}

// Gemini AI Settings Wiring
function updateGeminiUi() {
  const hasKey = hasApiKey();
  const statusEl = $("geminiStatus");
  const inputEl = $("geminiApiKey");
  const clearBtn = $("clearGeminiKey");

  if (statusEl) {
    statusEl.className = hasKey ? "gemini-status-dot on" : "gemini-status-dot off";
    statusEl.title = hasKey ? "Gemini AI Coach Active (Google AI Studio)" : "Gemini AI Coach Disabled";
  }
  if (inputEl) {
    inputEl.value = getApiKey();
  }
  if (clearBtn) {
    clearBtn.style.display = hasKey ? "inline-flex" : "none";
  }
}

function openGeminiSettings() {
  if (hamburgerMenu) hamburgerMenu.style.display = "block";
  if (hamburgerBtn) {
    hamburgerBtn.classList.add("active");
    hamburgerBtn.setAttribute("aria-expanded", "true");
  }
  $("geminiApiKey")?.focus();
}

const saveGeminiKeyBtn = $("saveGeminiKey");
if (saveGeminiKeyBtn) {
  saveGeminiKeyBtn.addEventListener("click", () => {
    const val = $("geminiApiKey")?.value || "";
    setApiKey(val);
    updateGeminiUi();
    if (val.trim()) {
      setStatus("Gemini API key saved! AI Coach is active.");
    } else {
      setStatus("Gemini API key removed.");
    }
    if (state.cursor > 0 && state.results[state.cursor - 1]) {
      renderFeedback(state.results[state.cursor - 1]);
    }
  });
}

const clearGeminiKeyBtn = $("clearGeminiKey");
if (clearGeminiKeyBtn) {
  clearGeminiKeyBtn.addEventListener("click", () => {
    setApiKey("");
    updateGeminiUi();
    setStatus("Gemini API key cleared.");
    if (state.cursor > 0 && state.results[state.cursor - 1]) {
      renderFeedback(state.results[state.cursor - 1]);
    }
  });
}

const geminiApiKeyInput = $("geminiApiKey");
if (geminiApiKeyInput) {
  geminiApiKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      saveGeminiKeyBtn?.click();
    }
  });
}

// Flip Board Toggle
$("flipBoard").addEventListener("click", () => {
  state.flipped = !state.flipped;
  updatePlayerHeaders();
  renderBoard(state.cursor);
  renderSummary();
});

// Toggle Best Move Arrow Switch in Hamburger
const arrowToggle = $("toggleBestMoveArrow");
if (arrowToggle) {
  arrowToggle.checked = state.showBestMoveArrow;
  arrowToggle.addEventListener("change", (e) => {
    state.showBestMoveArrow = e.target.checked;
    localStorage.setItem("zen-chess-show-arrow", state.showBestMoveArrow ? "true" : "false");
    drawBestMoveArrow();
  });
}

// Returning keeps all branches and their evaluations in the tree.
$("resetVariationBtn").addEventListener("click", () => {
  if (!state.tree) return;
  navigateNode(state.tree.returnToGame());
});
$("parentVariationBtn").addEventListener("click", () => {
  if (state.tree) navigateNode(state.tree.branchOrigin());
});

function syncActiveLine() {
  const tree = state.tree;
  if (!tree) return;
  state.line = tree.line();
  state.moves = state.line.slice(1).map(node => node.move);
  state.positions = state.line.map(node => ({ fen: node.fen, move: node.move }));
  state.analyses = state.line.map(node => node.analysis);
  state.results = state.line.slice(1).map(node => node.result);
  state.cursor = tree.current.ply;
  state.isVariation = !tree.current.mainline;
  const moveTime = Number($("moveTime").value);
  state.isAnalyzed = tree.mainline.slice(1).every(node => node.result && node.resultTime >= moveTime);
  const origin = tree.nodes.get(tree.returnId);
  const back = $("resetVariationBtn");
  back.hidden = !origin;
  back.style.display = origin ? "inline-flex" : "none";
  back.textContent = origin ? `Back to game - ${moveLabel(origin)}` : "Back to game";
  back.title = "Return to the original position where this variation started";
  const parent = tree.branchOrigin();
  $("parentVariationBtn").hidden = !state.isVariation || parent.mainline;
  $("variationIndicator").hidden = !state.isVariation;
  if (!state.running) {
    $("startReviewText").textContent = state.isAnalyzed ? "Start" : "Analyze game";
    $("startReview").classList.toggle("review-mode", state.isAnalyzed);
    $("startReview").title = state.isAnalyzed ? "Start original game review" : "Analyze original game";
  }
}

function navigateNode(node) {
  if (!state.tree || !node) return;
  state.tree.select(node);
  state.selectedSquare = null;
  state.legalMoves = [];
  syncActiveLine();
  renderBoard(state.cursor);
}

// Tab Switching
function switchTab(tab) {
  if (tab === "moves") {
    $("tabMoves").classList.add("active");
    $("tabSummary").classList.remove("active");
    $("moveListWrapper").style.display = "flex";
    $("summaryPanel").style.display = "none";
  } else {
    $("tabSummary").classList.add("active");
    $("tabMoves").classList.remove("active");
    $("moveListWrapper").style.display = "none";
    $("summaryPanel").style.display = "block";
    renderSummary();
  }
}
$("tabMoves").addEventListener("click", () => switchTab("moves"));
$("tabSummary").addEventListener("click", () => switchTab("summary"));

function getSquareCenter(sq) {
  if (!sq || sq.length < 2) return null;
  const fileChar = sq[0].toLowerCase();
  const rankChar = sq[1];
  const file = fileChar.charCodeAt(0) - 97; // 0..7
  const rank = parseInt(rankChar, 10);      // 1..8
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;

  const col = state.flipped ? 7 - file : file;
  const row = state.flipped ? rank - 1 : 8 - rank;

  return {
    x: (col + 0.5) * 12.5,
    y: (row + 0.5) * 12.5
  };
}

function drawBestMoveArrow() {
  const svg = $("boardArrows");
  if (!svg) return;
  if (!state.showBestMoveArrow) {
    svg.innerHTML = "";
    return;
  }

  // Look up engine recommendation for current position
  const currentAnalysis = state.analyses[state.cursor];
  const bestmove = currentAnalysis?.bestmove;
  if (!bestmove || bestmove.length < 4 || bestmove === "(none)") {
    svg.innerHTML = "";
    return;
  }

  const fromSq = bestmove.slice(0, 2);
  const toSq = bestmove.slice(2, 4);
  const c1 = getSquareCenter(fromSq);
  const c2 = getSquareCenter(toSq);
  if (!c1 || !c2) {
    svg.innerHTML = "";
    return;
  }

  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) {
    svg.innerHTML = "";
    return;
  }

  // Calculate direction vector and trim slightly for marker head
  const ux = dx / dist;
  const uy = dy / dist;
  const startX = (c1.x + ux * 1.5).toFixed(2);
  const startY = (c1.y + uy * 1.5).toFixed(2);
  const endX = (c2.x - ux * 2.2).toFixed(2);
  const endY = (c2.y - uy * 2.2).toFixed(2);

  svg.innerHTML = `
    <defs>
      <marker id="bestMoveArrowHead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
      </marker>
      <filter id="arrowShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="0.8" flood-color="#000000" flood-opacity="0.5" />
      </filter>
    </defs>
    <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}"
          stroke="#10b981" stroke-width="2.6" stroke-linecap="round"
          opacity="0.9" filter="url(#arrowShadow)"
          marker-end="url(#bestMoveArrowHead)" />
  `;
}

const engine = new EngineQueue(() => {
  const isExtension = typeof browser !== "undefined" && Boolean(browser?.runtime?.id);
  const url = isExtension
    ? browser.runtime.getURL("engine/stockfish-19-lite-single.js")
    : "/engine/stockfish-19-lite-single.js";
  return new Worker(url);
});

let quickAnalysisTimer = null;
let quickController = null;

async function evaluateNode(node, { moveTime, priority = 0, signal }) {
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  if (node.analysis?.moveTime >= moveTime) return node.analysis;
  const chess = new Chess(node.fen);
  let result;
  if (chess.isGameOver()) {
    result = { score: chess.isCheckmate() ? -10 : 0, bestmove: "", pv: "", moveTime };
  } else {
    result = await engine.evaluate(node.fen, moveTime, { priority, signal });
  }
  if (signal?.aborted) throw new DOMException("Analysis cancelled", "AbortError");
  const whiteScore = node.fen.split(" ")[1] === "w" ? result.score : -result.score;
  const analysis = { ...result, whiteScore };
  if (!node.analysis || node.analysis.moveTime <= moveTime) node.analysis = analysis;
  return analysis;
}

function refreshPositionAnalysis() {
  const node = state.tree?.current;
  if (!node) return;
  $("engineStatus").previousElementSibling?.classList.toggle("running", state.running || node.analysisStatus === "pending");
  if (state.running) return;
  $("engineStatus").textContent = node.analysisStatus === "pending" ? "Analyzing move..."
    : node.analysisStatus === "error" ? `Analysis failed: ${node.error}`
    : node.result ? "Move analyzed" : "Engine idle";
}

function refreshAnalysisView() {
  syncActiveLine();
  renderMoves();
  renderSummary();
  updateEvaluationDisplay();
  drawBestMoveArrow();
  const node = state.tree.current;
  renderFeedback(node.result);
  refreshPositionAnalysis();
  // Engine completion never replaces the squares underneath a user's click.
  $("board").querySelectorAll(".square-badge").forEach(badge => badge.remove());
  $("board").querySelectorAll(".brilliant-move").forEach(square => square.classList.remove("brilliant-move"));
  if (node.result && node.move) {
    const square = $("board").querySelector(`[data-square="${node.move.to}"]`);
    if (!square) return;
    const result = node.result;
    const badge = document.createElement("div");
    badge.className = `square-badge ${result.key}`;
    badge.style.backgroundColor = result.color;
    badge.style.color = result.textColor;
    badge.textContent = result.sign;
    badge.title = `${result.label}: ${result.sign}`;
    square.append(badge);
    square.classList.toggle("brilliant-move", result.key === "brilliant");
  }
}

async function ensureMoveAnalysis(node, { moveTime, priority = 1, signal = state.session.signal } = {}) {
  if (!node.move) return;
  if (node.result && node.resultTime >= moveTime) return node.result;
  const tree = state.tree;
  if (node.analysisPromise) {
    await node.analysisPromise;
    if (signal.aborted || state.tree !== tree) return;
    if (node.resultTime >= moveTime) return node.result;
  }
  if (signal.aborted) return;
  node.analysisStatus = "pending";
  node.error = "";
  const task = (async () => {
    try {
      const result = await analyzeMove(node, evaluateNode, { moveTime, priority, signal });
      if (signal.aborted) return;
      node.result = result;
      node.resultTime = moveTime;
      node.analysisStatus = "complete";
      return result;
    } catch (error) {
      node.analysisStatus = error.name === "AbortError" ? "idle" : "error";
      node.error = error.message;
      if (error.name !== "AbortError") throw error;
    }
  })();
  node.analysisPromise = task;
  if (state.tree === tree) {
    renderMoves();
    refreshPositionAnalysis();
    if (tree.current === node) renderFeedback(node.result);
  }
  try {
    return await task;
  } finally {
    if (node.analysisPromise === task) node.analysisPromise = null;
    if (state.tree === tree) refreshAnalysisView();
  }
}

function requestQuickAnalysisForCurrentPosition() {
  clearTimeout(quickAnalysisTimer);
  quickController?.abort();
  const tree = state.tree;
  const node = tree?.current;
  if (!node) return;
  engine.focus([node.fen, node.parent?.fen].filter(Boolean));
  refreshPositionAnalysis();
  // Every explored move gets full feedback, including after a cancelled review.
  const moveTime = Number($("moveTime")?.value) || 250;
  if (!node.mainline && node.analysisStatus !== "pending" && node.resultTime < moveTime && node.analysisStatus !== "error") {
    ensureMoveAnalysis(node, { moveTime, priority: 3 }).catch(() => {});
    return;
  }
  if (node.analysis || node.analysisStatus === "pending" || state.running) return;
  quickController = new AbortController();
  const signal = AbortSignal.any([quickController.signal, state.session.signal]);
  quickAnalysisTimer = setTimeout(async () => {
    try {
      await evaluateNode(node, { moveTime: 200, priority: 4, signal });
      if (state.tree === tree && tree.current === node) {
        syncActiveLine();
        updateEvaluationDisplay();
        drawBestMoveArrow();
      }
    } catch (error) {
      if (error.name !== "AbortError" && state.tree === tree && tree.current === node) {
        $("engineStatus").textContent = `Analysis failed: ${error.message}`;
      }
    }
  }, 140);
}

function handleSquareClick(sqName) {
  if (!state.positions.length) return;
  const currentPos = state.positions[state.cursor];
  if (!currentPos) return;

  const chess = new Chess(currentPos.fen);
  if (chess.isGameOver()) return;
  const turn = chess.turn();

  // If a piece is already selected and user clicked a legal target square
  if (state.selectedSquare && state.legalMoves.some(m => m.to === sqName)) {
    const fromSq = state.selectedSquare;
    const toSq = sqName;
    state.selectedSquare = null;
    state.legalMoves = [];
    executeUserMove(fromSq, toSq);
    return;
  }

  // If user clicked on a piece belonging to the side to move
  const pieceOnSq = chess.get(sqName);
  if (pieceOnSq && pieceOnSq.color === turn) {
    if (state.selectedSquare === sqName) {
      state.selectedSquare = null;
      state.legalMoves = [];
    } else {
      state.selectedSquare = sqName;
      state.legalMoves = chess.moves({ square: sqName, verbose: true });
    }
    renderBoard(state.cursor);
    return;
  }

  // Clicked elsewhere -> deselect
  if (state.selectedSquare) {
    state.selectedSquare = null;
    state.legalMoves = [];
    renderBoard(state.cursor);
  }
}

function stopReview() {
  state.reviewController?.abort();
}

function executeUserMove(fromSq, toSq, promotion = "q") {
  if (!state.tree) return;
  if (state.running) stopReview();
  // Promotion must be chosen explicitly, including underpromotion.
  const chess = new Chess(state.tree.current.fen);
  const candidates = chess.moves({ square: fromSq, verbose: true }).filter(move => move.to === toSq);
  if (candidates.some(move => move.promotion) && arguments.length < 3) {
    openPromotionPicker(fromSq, toSq);
    return;
  }
  try {
    const node = state.tree.play({ from: fromSq, to: toSq, promotion });
    syncActiveLine();
    switchTab("moves");
    renderBoard(node.ply);
  } catch (error) {
    setStatus(`Could not play move: ${error.message}`, true);
  }
}

function openPromotionPicker(from, to) {
  const dialog = $("promotionDialog");
  dialog.replaceChildren();
  const label = document.createElement("p");
  label.textContent = "Promote pawn to:";
  dialog.append(label);
  for (const [piece, name] of [["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]]) {
    const button = document.createElement("button");
    button.textContent = name;
    button.type = "button";
    button.addEventListener("click", () => {
      dialog.close();
      executeUserMove(from, to, piece);
    }, { once: true });
    dialog.append(button);
  }
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.close(), { once: true });
  dialog.append(cancel);
  dialog.showModal();
}

function renderBoard(index) {
  if (!state.tree) return;
  const target = state.line[Math.max(0, Math.min(index, state.line.length - 1))];
  if (target !== state.tree.current) {
    state.selectedSquare = null;
    state.legalMoves = [];
    state.tree.select(target);
  }
  syncActiveLine();
  const currentPos = state.positions[state.cursor];
  const fen = currentPos.fen;
  const chessInstance = new Chess(fen);
  const boardData = chessInstance.board();

  const lastMove = state.cursor ? state.moves[state.cursor - 1] : null;
  const lastSquares = lastMove ? [lastMove.from, lastMove.to] : [];
  const currentResult = state.cursor > 0 ? state.results[state.cursor - 1] : null;

  // Find king square if in check
  let checkSquare = null;
  if (chessInstance.inCheck()) {
    const turn = chessInstance.turn();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = boardData[r][c];
        if (p && p.type === 'k' && p.color === turn) {
          checkSquare = String.fromCharCode(97 + c) + (8 - r);
          break;
        }
      }
      if (checkSquare) break;
    }
  }

  let html = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      // Map display row/col to chess rank/file based on flipped orientation
      const boardRow = state.flipped ? 7 - r : r;
      const boardCol = state.flipped ? 7 - c : c;

      const sq = boardData[boardRow][boardCol];
      const rankNum = 8 - boardRow;
      const fileChar = String.fromCharCode(97 + boardCol);
      const sqName = fileChar + rankNum;

      // Color calculation invariant to board orientation:
      // a1 (col 0, rank 1) is dark
      const isDark = (boardCol + (rankNum - 1)) % 2 === 0;
      const shade = isDark ? "dark" : "light";

      const isLast = lastSquares.includes(sqName);
      const isCheck = sqName === checkSquare;
      const isSelected = sqName === state.selectedSquare;
      const legalMove = state.legalMoves.find(m => m.to === sqName);
      const isLegalTarget = Boolean(legalMove);

      // Piece Image
      let pieceHtml = "";
      if (sq) {
        const pieceKey = sq.color + sq.type;
        const pieceSrc = PIECE_IMAGES[pieceKey] || "";
        pieceHtml = `<img class="piece" src="${pieceSrc}" alt="${sq.color === 'w' ? 'White' : 'Black'} ${sq.type}" draggable="false" />`;
      }

      // Legal move hints
      let legalHintHtml = "";
      if (isLegalTarget) {
        if (legalMove.captured || sq || (legalMove.flags && legalMove.flags.includes('e'))) {
          legalHintHtml = '<div class="legal-capture-ring"></div>';
        } else {
          legalHintHtml = '<div class="legal-hint-dot"></div>';
        }
      }

      // Coordinates (Chess.com style)
      let coordRank = "";
      let coordFile = "";
      if (c === 0) {
        coordRank = `<span class="coord-rank">${rankNum}</span>`;
      }
      if (r === 7) {
        coordFile = `<span class="coord-file">${fileChar}</span>`;
      }

      // Move classification badge on the move's destination square
      let badgeHtml = "";
      const isBrilliant = Boolean(currentResult?.key === "brilliant" && lastMove && sqName === lastMove.to);
      if (currentResult && lastMove && sqName === lastMove.to) {
        badgeHtml = `<div class="square-badge ${currentResult.key}" style="background-color: ${currentResult.color}; color: ${currentResult.textColor};" title="${esc(currentResult.label)}: ${esc(currentResult.sign)}">${esc(currentResult.sign)}</div>`;
      }

      html += `<div class="square ${shade} ${isLast ? 'last-move' : ''} ${isCheck ? 'in-check' : ''} ${isBrilliant ? 'brilliant-move' : ''} ${isSelected ? 'selected' : ''} ${isLegalTarget ? 'legal-target' : ''}" data-square="${sqName}">${pieceHtml}${coordRank}${coordFile}${badgeHtml}${legalHintHtml}</div>`;
    }
  }

  $("board").innerHTML = html;

  // Attach click listeners to board squares
  $("board").querySelectorAll(".square").forEach(el => {
    el.addEventListener("click", () => handleSquareClick(el.dataset.square));
  });

  // Draw best move arrow if available
  drawBestMoveArrow();

  // Update Move Counter
  if (state.cursor === 0) {
    $("moveCounter").textContent = "Start";
  } else {
    $("moveCounter").textContent = moveLabel(state.tree.current);
  }

  // Update Evaluation & Eval Bar
  updateEvaluationDisplay();

  renderFeedback(currentResult);
  renderMoves();
  highlightActiveMoveInList();
  setNavEnabled();

  // If position has no engine evaluation yet, request quick analysis
  requestQuickAnalysisForCurrentPosition();
}

function updateEvaluationDisplay() {
  const currentEval = state.analyses[state.cursor];
  let whiteScore = currentEval?.whiteScore;

  if (whiteScore === undefined) {
    const currentPos = state.positions[state.cursor];
    if (currentPos) {
      try {
        const ch = new Chess(currentPos.fen);
        if (ch.isCheckmate()) {
          whiteScore = ch.turn() === "w" ? -10 : 10;
        }
      } catch {}
    }
  }

  const hasScore = whiteScore !== undefined && Number.isFinite(whiteScore);
  const effectiveScore = hasScore ? whiteScore : 0;
  const scoreText = hasScore ? formatScore(effectiveScore) : "—";

  const topEvalEl = $("topPlayerEval");
  const bottomEvalEl = $("bottomPlayerEval");

  if (state.flipped) {
    if (topEvalEl) topEvalEl.textContent = hasScore ? scoreText : "—";
    if (bottomEvalEl) bottomEvalEl.textContent = hasScore ? formatScore(-effectiveScore) : "—";
  } else {
    if (topEvalEl) topEvalEl.textContent = hasScore ? formatScore(-effectiveScore) : "—";
    if (bottomEvalEl) bottomEvalEl.textContent = hasScore ? scoreText : "—";
  }

  // Update Vertical Eval Bar
  const evalBar = $("evalBar");
  const evalBarFill = $("evalBarWhite");
  const evalBarScore = $("evalBarScore");

  if (state.flipped) {
    evalBar.classList.add("flipped");
  } else {
    evalBar.classList.remove("flipped");
  }

  if (!hasScore) {
    evalBarFill.style.height = "50%";
    evalBarScore.textContent = "0.0";
    evalBar.classList.remove("black-winning");
    evalBarScore.style.top = "auto";
    evalBarScore.style.bottom = "6px";
    evalBarScore.style.color = "#17241c";
    return;
  }

  // Check for forced mate: Math.abs >= 9
  const isMate = Math.abs(effectiveScore) >= 9;
  let pct;
  if (isMate) {
    // Forced mate fills the eval bar completely (100% for White, 0% for Black)
    pct = effectiveScore > 0 ? 100 : 0;
  } else {
    // Regular evaluation: smooth scale, capped between 4% and 96%
    pct = 50 + (effectiveScore * 6.5);
    pct = Math.max(4, Math.min(96, pct));
  }

  evalBarFill.style.height = `${pct}%`;
  evalBarScore.textContent = formatEvalBarScore(effectiveScore);

  // Position score on winning side of eval bar
  const isWhiteWinning = effectiveScore >= 0;
  const isScoreAtTop = state.flipped ? isWhiteWinning : !isWhiteWinning;
  const isScoreOnWhite = isWhiteWinning;

  if (isScoreAtTop) {
    evalBarScore.style.top = "6px";
    evalBarScore.style.bottom = "auto";
  } else {
    evalBarScore.style.top = "auto";
    evalBarScore.style.bottom = "6px";
  }

  evalBarScore.style.color = isScoreOnWhite ? "#17241c" : "#ffffff";
}

let renderedTree = null;
let renderedNodeCount = 0;

$("moveList").addEventListener("click", event => {
  const button = event.target.closest("[data-node], [data-retry]");
  if (!button || !state.tree) return;
  if (button.dataset.node) navigateNode(state.tree.nodes.get(button.dataset.node));
  else ensureMoveAnalysis(state.tree.nodes.get(button.dataset.retry), {
    moveTime: Number($("moveTime").value), priority: 3
  }).catch(() => {});
});

function renderMoves() {
  const tree = state.tree;
  if (!tree) {
    $("moveList").innerHTML = '<p class="muted empty-state">Your game moves will appear here.</p>';
    return;
  }
  function chip(node) {
    const result = node.result;
    const status = node.analysisStatus;
    const badge = result ? `<span class="move-sign ${result.key}" style="background-color:${result.color};color:${result.textColor}" title="${esc(result.label)}">${esc(result.sign)}</span>` : "";
    return `<button type="button" class="move-chip ${node === tree.current ? "active" : ""}" data-node="${node.id}" aria-current="${node === tree.current ? "step" : "false"}" title="${esc(moveLabel(node))}">
      <span class="move-number">${node.parent.fen.split(" ")[5]}${node.move.color === "w" ? "." : "..."}</span>
      <span class="move-san">${esc(node.move.san)}</span>${badge}
      ${status === "pending" ? '<span class="analysis-pending" aria-label="Analysis pending">...</span>' : ""}
      ${status === "error" ? '<span class="analysis-error" aria-label="Analysis failed">!</span>' : ""}
    </button>${status === "error" ? `<button type="button" class="retry-analysis" data-retry="${node.id}" title="${esc(node.error)}">Retry</button>` : ""}`;
  }
  function branch(first) {
    return `<details class="variation-branch" data-branch="${first.id}" ${first.collapsed ? "" : "open"}>
      <summary>Variation: ${esc(moveLabel(first))}</summary>
      <div class="variation-moves">${branchLine(first)}</div>
    </details>`;
  }
  function branchLine(first) {
    let html = "";
    let node = first;
    while (node) {
      html += chip(node);
      const next = node.children[0];
      if (node.mainline && next && !next.mainline) {
        html += node.children.map(branch).join("");
        break;
      }
      html += node.children.slice(1).map(branch).join("");
      node = next;
    }
    return html;
  }
  const first = tree.root.children[0];
  const html = first ? tree.root.children.slice(1).map(branch).join("") + branchLine(first) : "";
  if (renderedTree === tree && renderedNodeCount === tree.nodes.size) {
    // Keep buttons stable while their results arrive, including between
    // pointerdown and click. Only adding a move changes the list structure.
    const template = document.createElement("template");
    template.innerHTML = html;
    $("moveList").querySelectorAll("[data-node]").forEach(button => {
      const replacement = template.content.querySelector(`[data-node="${button.dataset.node}"]`);
      button.className = replacement.className;
      button.setAttribute("aria-current", replacement.getAttribute("aria-current"));
      if (button.innerHTML !== replacement.innerHTML) button.innerHTML = replacement.innerHTML;
      const oldRetry = $("moveList").querySelector(`[data-retry="${button.dataset.node}"]`);
      const newRetry = template.content.querySelector(`[data-retry="${button.dataset.node}"]`);
      if (newRetry && !oldRetry) button.after(newRetry.cloneNode(true));
      if (!newRetry) oldRetry?.remove();
    });
    $("moveList").querySelectorAll("[data-branch]").forEach(details => {
      const open = !tree.nodes.get(details.dataset.branch).collapsed;
      if (details.open !== open) details.open = open;
    });
    return;
  }
  renderedTree = tree;
  renderedNodeCount = tree.nodes.size;
  $("moveList").innerHTML = html;
  $("moveList").querySelectorAll("[data-branch]").forEach(details => {
    details.querySelector("summary").addEventListener("click", event => {
      // Persist synchronously: an engine result can rebuild the list before
      // the browser dispatches its asynchronous details toggle event.
      event.preventDefault();
      const first = tree.nodes.get(details.dataset.branch);
      first.collapsed = details.open;
      details.open = !first.collapsed;
    });
    details.addEventListener("toggle", () => {
      if (details.isConnected) tree.nodes.get(details.dataset.branch).collapsed = !details.open;
    });
  });
}

function highlightActiveMoveInList() {
  $("moveList").querySelector(`[data-node="${state.tree?.current.id}"]`)?.scrollIntoView({ block: "nearest" });
}

function setNavEnabled() {
  const has = state.moves.length > 0;
  $("firstMove").disabled = !has || state.cursor === 0;
  $("prevMove").disabled = !has || state.cursor === 0;
  $("nextMove").disabled = !has || state.cursor >= state.moves.length;
  $("lastMove").disabled = !has || state.cursor >= state.moves.length;
  $("stopReview").disabled = !state.running;
}

$("firstMove").addEventListener("click", () => renderBoard(0));
$("prevMove").addEventListener("click", () => renderBoard(state.cursor - 1));
$("nextMove").addEventListener("click", () => renderBoard(state.cursor + 1));
$("lastMove").addEventListener("click", () => renderBoard(state.moves.length));

// Global Keyboard Navigation
window.addEventListener("keydown", e => {
  if (["TEXTAREA", "INPUT", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable || $("promotionDialog").open) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    renderBoard(state.cursor - 1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    renderBoard(state.cursor + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    renderBoard(0);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    renderBoard(state.moves.length);
  } else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "x") {
    e.preventDefault();
    state.flipped = !state.flipped;
    updatePlayerHeaders();
    renderBoard(state.cursor);
    renderSummary();
  }
});

function formatScore(score) {
  if (!Number.isFinite(score)) return "—";
  if (Math.abs(score) >= 9) {
    const moves = Math.round((10 - Math.abs(score)) * 100);
    return score > 0 ? `+M${moves || 1}` : `-M${moves || 1}`;
  }
  return `${score > 0 ? "+" : ""}${score.toFixed(1)}`;
}

function formatEvalBarScore(score) {
  if (!Number.isFinite(score)) return "0.0";
  if (Math.abs(score) >= 9) {
    const moves = Math.round((10 - Math.abs(score)) * 100);
    return `M${moves || 1}`;
  }
  return Math.abs(score).toFixed(1);
}

function getLocalDetailedFeedback(result) {
  if (!result) return { whyText: "", tipText: "", concept: "" };

  const pieceNames = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const isWhite = result.moveColor === "w" || (result.ply !== undefined ? result.ply % 2 === 0 : false);
  const moverName = isWhite ? "White" : "Black";
  const opponentName = isWhite ? "Black" : "White";
  const pName = pieceNames[result.playedPiece?.toLowerCase()] || "piece";
  const toSq = result.to || "";
  const bestSan = result.bestSan;
  const punishSan = result.punishSan;
  const punishPv = result.punishPv;
  const punishDetails = result.punishDetails;
  const bestDetails = result.bestDetails;

  const isDirectHang = Boolean(punishDetails && punishDetails.captured && punishDetails.to === result.to);
  const isOtherHang = Boolean(punishDetails && punishDetails.captured && punishDetails.to !== result.to);
  const isMate = Boolean(punishDetails && (punishDetails.san?.endsWith("#") || Math.abs(result.afterWhite) >= 9.5));
  const isCheck = Boolean(punishDetails && punishDetails.san?.endsWith("+"));

  let moveDesc = "";
  if (result.san === "O-O") {
    moveDesc = `${moverName} castled kingside (O-O).`;
  } else if (result.san === "O-O-O") {
    moveDesc = `${moverName} castled queenside (O-O-O).`;
  } else if (result.capturedPiece) {
    const capName = pieceNames[result.capturedPiece?.toLowerCase()] || "piece";
    moveDesc = `${moverName} played ${result.san}, capturing ${opponentName}'s ${capName} on ${toSq} with the ${pName}.`;
  } else {
    moveDesc = `${moverName} played ${result.san}, advancing the ${pName} to ${toSq}.`;
  }

  let whyText = "";
  let tipText = "";
  let concept = "";

  switch (result.key) {
    case "blunder": {
      let punishmentDesc = "";
      if (isDirectHang) {
        concept = "Hanging Piece";
        punishmentDesc = `${moverName} moved the ${pName} to ${toSq}, but left it completely undefended! ${opponentName} can punish this immediately with <strong>${punishSan}</strong>, winning the ${pName} for free${punishPv ? ` (${punishPv})` : ''}.`;
      } else if (isOtherHang) {
        const hungPiece = pieceNames[punishDetails.captured?.toLowerCase()] || "piece";
        concept = "Hanging Material";
        punishmentDesc = `${moveDesc} However, this leaves the ${hungPiece} on ${punishDetails.to} completely unguarded! ${opponentName} can strike immediately with <strong>${punishSan}</strong>, winning material${punishPv ? ` (${punishPv})` : ''}.`;
      } else if (isMate) {
        concept = "Mating Threat";
        punishmentDesc = `${moveDesc} This fatally exposes the king to an unstoppable mating attack! ${opponentName} has forced checkmate starting with <strong>${punishSan}</strong>${punishPv ? ` (${punishPv})` : ''}.`;
      } else if (isCheck) {
        concept = "Exposed King";
        punishmentDesc = `${moveDesc} This walks directly into a dangerous check. ${opponentName} can punish this immediately with <strong>${punishSan}</strong>${punishPv ? ` (${punishPv})` : ''}, taking full control.`;
      } else if (punishSan) {
        concept = "Tactical Oversight";
        punishmentDesc = `${moveDesc} A critical blunder that surrenders the initiative. ${opponentName} can punish this right away with <strong>${punishSan}</strong>${punishPv ? ` (${punishPv})` : ''}.`;
      } else {
        concept = "Tactical Blunder";
        punishmentDesc = `${moveDesc} A critical error that hands ${opponentName} a decisive advantage.`;
      }

      let betterAlternative = "";
      if (bestSan) {
        if (bestDetails?.captured) {
          const capName = pieceNames[bestDetails.captured?.toLowerCase()] || "piece";
          betterAlternative = `Instead of ${result.san}, ${moverName} needed to play <strong>${bestSan}</strong> to capture the ${capName} on ${bestDetails.to}.`;
        } else if (bestDetails?.piece === "k") {
          betterAlternative = `Instead of ${result.san}, ${moverName} had to play <strong>${bestSan}</strong> to step the king out of danger and secure safety.`;
        } else {
          betterAlternative = `Instead of ${result.san}, ${moverName} had to play <strong>${bestSan}</strong> to keep pieces defended and prevent ${opponentName}'s threats.`;
        }
      }

      whyText = `${punishmentDesc} ${betterAlternative}`;
      tipText = isDirectHang
        ? `Always run a quick "undefended piece check" before moving: is your destination square guarded? Does your opponent have an immediate capture?`
        : `Whenever you make a move, pause to ask: what did my piece stop defending? Look for opponent checks, captures, and counter-threats.`;
      break;
    }

    case "mistake": {
      let mistakeDesc = "";
      if (punishSan && (isDirectHang || isOtherHang)) {
        const hungPiece = pieceNames[punishDetails.captured?.toLowerCase()] || "material";
        concept = "Dropped Material";
        mistakeDesc = `${moveDesc} This allows ${opponentName} to win material with <strong>${punishSan}</strong>.`;
      } else if (punishSan && isCheck) {
        concept = "King Weakness";
        mistakeDesc = `${moveDesc} This gives ${opponentName} a dangerous check with <strong>${punishSan}</strong>, disorganizing ${moverName}'s pieces.`;
      } else if (punishSan) {
        concept = "Positional Slip";
        mistakeDesc = `${moveDesc} This concession allows ${opponentName} to seize the upper hand with <strong>${punishSan}</strong>${punishPv ? ` (${punishPv})` : ''}.`;
      } else {
        concept = "Positional Mistake";
        mistakeDesc = `${moveDesc} This compromises ${moverName}'s position and hands ${opponentName} control.`;
      }

      let betterAlternative = "";
      if (bestSan) {
        betterAlternative = `${moverName} should have chosen <strong>${bestSan}</strong> to maintain a solid, active position.`;
      }

      whyText = `${mistakeDesc} ${betterAlternative}`;
      tipText = `Watch out for moves that surrender central control or let your opponent's pieces jump into active squares with tempo.`;
      break;
    }

    case "miss": {
      let missDesc = "";
      if (bestDetails?.san?.endsWith("#")) {
        concept = "Missed Checkmate";
        missDesc = `${moveDesc} ${moverName} missed a forced checkmate! Playing <strong>${bestSan}</strong> would have ended the game on the spot.`;
      } else if (bestDetails?.captured) {
        const targetCap = pieceNames[bestDetails.captured?.toLowerCase()] || "piece";
        concept = "Missed Material Win";
        missDesc = `${moveDesc} ${moverName} missed a winning tactical opportunity! Finding <strong>${bestSan}</strong> would have won ${opponentName}'s ${targetCap} on ${bestDetails.to}.`;
      } else if (bestDetails?.san?.endsWith("+")) {
        concept = "Missed Tactical Blow";
        missDesc = `${moveDesc} ${moverName} missed a decisive tactical attack. <strong>${bestSan}</strong> would have shattered ${opponentName}'s king defenses.`;
      } else {
        concept = "Missed Opportunity";
        missDesc = `${moveDesc} ${moverName} missed a chance to capitalize decisively. Playing <strong>${bestSan}</strong> would have kept crushing pressure on ${opponentName}.`;
      }

      whyText = `${missDesc} Instead, the position slips back toward equality.`;
      tipText = `Whenever the opponent's king or pieces look vulnerable, always calculate every check and forcing capture first before choosing a quiet move.`;
      break;
    }

    case "inaccuracy": {
      concept = "Minor Inaccuracy";
      whyText = `${moveDesc} A slightly imprecise move that lets ${opponentName} equalize or relieve pressure. The engine preferred <strong>${bestSan || "a sharper line"}</strong> to keep active control and maintain tempo.`;
      tipText = `Compare your move with ${bestSan || 'the engine suggestion'}: notice how the engine continuation coordinates more aggressively toward central outposts.`;
      break;
    }

    case "brilliant": {
      concept = "Tactical Sacrifice";
      const sacrificeNote = result.isSacrifice
        ? `A brilliant material sacrifice! ${moverName} boldly gives up the ${pName} to blow open ${opponentName}'s defenses and launch an unstoppable attack.`
        : `A brilliant tactical strike that completely paralyzes ${opponentName}'s position.`;
      const refutationNote = punishSan
        ? ` Even if ${opponentName} tries to respond with ${punishSan}, ${moverName}'s continuation is totally winning.`
        : ``;
      whyText = `${moveDesc} ${sacrificeNote}${refutationNote}`;
      tipText = `Sacrifices that decisively expose the enemy king require calculating all forced responses. Superb tactical vision!`;
      break;
    }

    case "great": {
      concept = "Critical Find";
      whyText = `${moveDesc} A critical continuation! In a high-pressure position, ${result.san} was the only move that maintains the initiative or prevents ${opponentName} from turning the tables.`;
      tipText = `When under tactical tension, finding the single winning resource separates master games from missed opportunities.`;
      break;
    }

    case "best": {
      concept = "Optimal Move";
      whyText = `${moveDesc} Stockfish's top engine choice. Maximizes piece activity, maintains central harmony, and leaves ${opponentName} with zero counterplay.`;
      tipText = `Consistent best moves compound pressure over time. Notice how seamlessly this aligns with king safety and piece coordination.`;
      break;
    }

    case "excellent": {
      concept = "Strong Continuation";
      whyText = `${moveDesc} A very strong practical choice. Retains full control and keeps the position healthy, nearly identical in strength to ${bestSan || "the engine line"}.`;
      tipText = `Practical moves that keep your initiative intact are just as effective as engine top choices.`;
      break;
    }

    case "good": {
      concept = "Solid Move";
      whyText = `${moveDesc} A sound and sensible move that continues piece development and keeps the position solid.`;
      tipText = `Look for opportunities to transition from solid development into active threats against weak squares in the opponent's camp.`;
      break;
    }

    case "book": {
      concept = "Opening Theory";
      whyText = `${moveDesc} Standard grandmaster opening theory. Follows established master principles for early piece development and king safety.`;
      tipText = `In the opening, focus on rapid development, central control, and king safety before launching premature attacks.`;
      break;
    }

    default: {
      concept = "Move Analysis";
      whyText = `${moveDesc} The engine preferred ${bestSan || "a different continuation"}.`;
      tipText = `Analyze the difference between this move and the engine recommendation ${bestSan || ''}.`;
    }
  }

  return { whyText, tipText, concept };
}

function renderAiCoachCardHtml(coaching) {
  if (!coaching) return "";
  const conceptHtml = coaching.concept
    ? `<span class="ai-concept-badge">⚡ ${esc(coaching.concept)}</span>`
    : "";

  return `
    <div id="aiCoachSection" class="ai-coach-card">
      <div class="ai-coach-header">
        <div class="ai-coach-title">
          <span class="ai-sparkle-icon">✦</span>
          <span>Gemini AI Coach</span>
        </div>
        ${conceptHtml}
      </div>
      <p class="ai-coach-why">${esc(coaching.why || "")}</p>
    </div>`;
}

function renderFeedback(result) {
  if (!result) {
    const node = state.tree?.current;
    const message = node?.analysisStatus === "pending" ? "Analyzing this move with Stockfish..."
      : node?.analysisStatus === "error" ? `Analysis failed: ${node.error}. Use Retry beside the move.`
      : "Select a move after analysis to view its evaluation, classification, and coaching notes.";
    $("feedbackContent").innerHTML = `
      <div class="feedback-empty">
        ${esc(message)}
      </div>`;
    return;
  }

  const local = getLocalDetailedFeedback(result);
  const beforeFen = result.beforeFen || (state.cursor > 0 ? state.positions[state.cursor - 1]?.fen : "");
  const cachedAi = getCachedCoaching(result, beforeFen);

  let aiSectionHtml = "";
  if (hasApiKey()) {
    if (cachedAi) {
      aiSectionHtml = renderAiCoachCardHtml(cachedAi);
    } else {
      aiSectionHtml = `
        <div id="aiCoachSection" class="ai-coach-loading">
          <div class="ai-loading-spinner"></div>
          <span>Analyzing position with Gemini AI Coach...</span>
        </div>`;
    }
  } else {
    aiSectionHtml = `
      <div class="ai-coach-banner">
        <div class="ai-banner-left">
          <span class="ai-banner-icon">✦</span>
          <div class="ai-banner-text">
            <strong>Unlock Grandmaster AI Explanations</strong>
            Connect free Google Gemini for deep natural-language move coaching.
          </div>
        </div>
        <button id="openAiSettingsBtn" class="ai-banner-btn" type="button">Connect AI</button>
      </div>`;
  }

  $("feedbackContent").innerHTML = `
    <div class="feedback-header-box ${result.key}">
      <div class="feedback-title-group">
        <span class="feedback-badge" style="background-color: ${result.color}; color: ${result.textColor};">
          ${esc(result.sign)} ${esc(result.label)}
        </span>
        <span class="feedback-move-text">${esc(result.moveNo)} ${esc(result.san)}</span>
      </div>
    </div>

    ${aiSectionHtml}

    <div class="feedback-block">
      <div class="feedback-block-header">
        <h3>Tactical & Positional Breakdown</h3>
        <span class="feedback-concept-pill">${esc(local.concept)}</span>
      </div>
      <p>${local.whyText}</p>
    </div>

    <div class="feedback-block">
      <h3>Engine’s recommended continuation</h3>
      <p class="pv-line">${esc(result.pv || "No continuation reported.")}</p>
    </div>`;

  const openAiBtn = $("openAiSettingsBtn");
  if (openAiBtn) {
    openAiBtn.addEventListener("click", openGeminiSettings);
  }

  if (hasApiKey() && !cachedAi) {
    const targetTree = state.tree;
    const targetNode = state.tree?.current;
    generateCoaching(result, beforeFen).then(coaching => {
      const currentActive = state.cursor > 0 ? state.results[state.cursor - 1] : null;
      if (state.tree === targetTree && state.tree.current === targetNode && currentActive === result) {
        const aiSec = $("aiCoachSection");
        if (aiSec && coaching) {
          aiSec.outerHTML = renderAiCoachCardHtml(coaching);
        } else if (aiSec && !coaching) {
          aiSec.style.display = "none";
        }
      }
    });
  }
}

function updateAnalysisProgress(current, total, statusText, isDone = false, isStopped = false) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const dockFill = $("dockProgressBarFill");
  const reviewProgress = $("reviewProgress");

  if (dockFill) dockFill.style.width = `${pct}%`;

  if (isDone) {
    if (reviewProgress) reviewProgress.textContent = `100% · Complete (${total} moves)`;
  } else if (isStopped) {
    if (reviewProgress) reviewProgress.textContent = `Stopped · ${pct}% (${current}/${total})`;
  } else if (current === 0) {
    if (reviewProgress) reviewProgress.textContent = total > 0 ? `${total} moves loaded` : "Not analyzed";
  } else {
    if (reviewProgress) reviewProgress.textContent = `${pct}% · ${current}/${total}`;
  }
}

function renderSummary() {
  const nodes = state.tree?.mainline.slice(1) || [];
  const whiteMoves = nodes.filter(node => node.move.color === "w" && node.result).map(node => node.result);
  const blackMoves = nodes.filter(node => node.move.color === "b" && node.result).map(node => node.result);
  const isComplete = nodes.length > 0 && nodes.every(node => Boolean(node.result));

  if (isComplete) {
    const whiteAcc = calculateAccuracy(whiteMoves);
    const blackAcc = calculateAccuracy(blackMoves);

    const whiteRating = calculateEstimatedRating(whiteMoves, whiteAcc, state.headers.WhiteElo);
    const blackRating = calculateEstimatedRating(blackMoves, blackAcc, state.headers.BlackElo);

    if ($("summaryWhiteAcc")) $("summaryWhiteAcc").textContent = `${whiteAcc}%`;
    if ($("summaryBlackAcc")) $("summaryBlackAcc").textContent = `${blackAcc}%`;

    if ($("summaryWhiteRating")) {
      $("summaryWhiteRating").textContent = whiteRating;
    }
    if ($("summaryBlackRating")) {
      $("summaryBlackRating").textContent = blackRating;
    }

    // Show accuracy and estimated rating on player bars
    if (state.flipped) {
      if ($("topPlayerAccuracy")) {
        $("topPlayerAccuracy").textContent = `${whiteAcc}%`;
        $("topPlayerAccuracy").style.display = "inline-block";
      }
      if ($("topPlayerRatingEstimate")) {
        $("topPlayerRatingEstimate").textContent = `Est. ${whiteRating}`;
        $("topPlayerRatingEstimate").style.display = "inline-block";
      }

      if ($("bottomPlayerAccuracy")) {
        $("bottomPlayerAccuracy").textContent = `${blackAcc}%`;
        $("bottomPlayerAccuracy").style.display = "inline-block";
      }
      if ($("bottomPlayerRatingEstimate")) {
        $("bottomPlayerRatingEstimate").textContent = `Est. ${blackRating}`;
        $("bottomPlayerRatingEstimate").style.display = "inline-block";
      }
    } else {
      if ($("topPlayerAccuracy")) {
        $("topPlayerAccuracy").textContent = `${blackAcc}%`;
        $("topPlayerAccuracy").style.display = "inline-block";
      }
      if ($("topPlayerRatingEstimate")) {
        $("topPlayerRatingEstimate").textContent = `Est. ${blackRating}`;
        $("topPlayerRatingEstimate").style.display = "inline-block";
      }

      if ($("bottomPlayerAccuracy")) {
        $("bottomPlayerAccuracy").textContent = `${whiteAcc}%`;
        $("bottomPlayerAccuracy").style.display = "inline-block";
      }
      if ($("bottomPlayerRatingEstimate")) {
        $("bottomPlayerRatingEstimate").textContent = `Est. ${whiteRating}`;
        $("bottomPlayerRatingEstimate").style.display = "inline-block";
      }
    }
  } else {
    // Only show predicted rating and accuracy after complete analysis
    if ($("summaryWhiteAcc")) $("summaryWhiteAcc").textContent = "—";
    if ($("summaryBlackAcc")) $("summaryBlackAcc").textContent = "—";
    if ($("summaryWhiteRating")) $("summaryWhiteRating").textContent = "—";
    if ($("summaryBlackRating")) $("summaryBlackRating").textContent = "—";

    if ($("topPlayerAccuracy")) $("topPlayerAccuracy").style.display = "none";
    if ($("topPlayerRatingEstimate")) $("topPlayerRatingEstimate").style.display = "none";
    if ($("bottomPlayerAccuracy")) $("bottomPlayerAccuracy").style.display = "none";
    if ($("bottomPlayerRatingEstimate")) $("bottomPlayerRatingEstimate").style.display = "none";
  }

  // Count classifications
  const keys = ["brilliant", "great", "best", "excellent", "good", "book", "inaccuracy", "mistake", "miss", "blunder"];
  let rowsHtml = "";
  for (const k of keys) {
    const cls = CLASSIFICATIONS[k];
    if (!cls) continue;
    const wCount = whiteMoves.filter(m => m?.key === k).length;
    const bCount = blackMoves.filter(m => m?.key === k).length;

    rowsHtml += `
      <div class="breakdown-row">
        <span class="breakdown-count white-count ${wCount === 0 ? "zero" : ""}" title="White">${wCount}</span>
        <div class="breakdown-badge-name">
          <span class="move-sign ${cls.key}" style="background-color: ${cls.color}; color: ${cls.textColor};">${cls.sign}</span>
          <span class="breakdown-name">${cls.name}</span>
        </div>
        <span class="breakdown-count black-count ${bCount === 0 ? "zero" : ""}" title="Black">${bCount}</span>
      </div>`;
  }
  $("breakdownTable").innerHTML = rowsHtml;
}

async function startReview() {
  const tree = state.tree;
  if (!tree || state.running) return;
  state.running = true;
  state.reviewController = new AbortController();
  const controller = state.reviewController;
  const signal = AbortSignal.any([controller.signal, state.session.signal]);
  const moveTime = Number($("moveTime").value);
  const nodes = tree.mainline.slice(1);
  clearTimeout(quickAnalysisTimer);
  quickController?.abort();
  switchTab("summary");
  $("startReview").style.display = "none";
  $("stopReview").style.display = "inline-flex";
  $("stopReview").disabled = false;
  try {
    for (const node of nodes) {
      if (signal.aborted) break;
      $("engineStatus").textContent = `Analyzing original game move ${node.ply} of ${nodes.length}...`;
      await ensureMoveAnalysis(node, { moveTime, priority: 0, signal });
      if (state.tree !== tree) return;
      updateAnalysisProgress(nodes.filter(n => n.result).length, nodes.length, "Analyzing game");
    }
    if (state.tree !== tree) return;
    const completed = nodes.filter(node => node.result).length;
    updateAnalysisProgress(completed, nodes.length, signal.aborted ? "Analysis stopped" : "Review complete", !signal.aborted, signal.aborted);
    setStatus(signal.aborted ? "Review stopped. Completed moves are retained; Analyze game resumes the review." : "Analysis complete. Select a move to review or explore a variation.");
  } catch (error) {
    if (state.tree === tree && error.name !== "AbortError") setStatus(`Analysis stopped: ${error.message}`, true);
  } finally {
    if (state.tree === tree && state.reviewController === controller) {
      state.running = false;
      $("stopReview").style.display = "none";
      $("stopReview").disabled = true;
      $("startReview").style.display = "inline-flex";
      refreshAnalysisView();
      setNavEnabled();
      requestQuickAnalysisForCurrentPosition();
    }
  }
}

$("startReview").addEventListener("click", () => {
  if (state.isAnalyzed) {
    switchTab("moves");
    navigateNode(state.tree.mainline[1]);
  } else startReview();
});
$("stopReview").addEventListener("click", stopReview);
$("moveTime").addEventListener("change", () => {
  if (state.tree) renderBoard(state.cursor);
});

// AUTOMATIC IMPORT
async function autoImportPendingGame() {
  const params = new URLSearchParams(location.search);
  if (params.get("source") !== "chesscom") return;
  try {
    const api = globalThis.browser ?? globalThis.chrome;
    if (!api?.storage?.local) return;
    const stored = await api.storage.local.get(["zenChessPendingPgn", "zenChessPendingMeta"]);
    const pgn = stored.zenChessPendingPgn;
    if (!pgn) {
      setStatus("No imported game was found. Return to the completed Chess.com game and click Analyze with Zen.", true);
      return;
    }
    $("pgnText").value = pgn;
    await api.storage.local.remove(["zenChessPendingPgn", "zenChessPendingMeta"]);
    readImport();
    const meta = stored.zenChessPendingMeta || {};
    setStatus(`Imported automatically from Chess.com${meta.white && meta.black ? `: ${meta.white} vs ${meta.black}` : ""}. Ready to analyze!`);
  } catch (e) {
    setStatus(`Automatic import failed: ${e.message || e}`, true);
  }
}
updatePlayerHeaders();
updateGeminiUi();
autoImportPendingGame();
