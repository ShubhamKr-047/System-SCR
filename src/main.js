import { Chess } from "chess.js";
import { PIECE_IMAGES } from "./pieces.js";
import { CLASSIFICATIONS, classifyMove, calculateAccuracy, calculateEstimatedRating, isMaterialSacrifice } from "./classifications.js";
import { getApiKey, setApiKey, hasApiKey, getCachedCoaching, generateCoaching } from "./gemini.js";
import "./style.css";

const $ = (id) => document.getElementById(id);

const state = {
  chess: new Chess(),
  pgn: "",
  moves: [],
  positions: [],
  analyses: [],
  results: [],
  cursor: 0,
  flipped: false,
  worker: null,
  running: false,
  stopRequested: false,
  pending: null,
  timer: null,
  headers: {},
  selectedSquare: null,
  legalMoves: [],
  showBestMoveArrow: localStorage.getItem("zen-chess-show-arrow") !== "false",
  originalPgn: "",
  originalAnalyses: null,
  originalResults: null,
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

function parsePgn(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const history = chess.history({ verbose: true });
  if (!history.length) {
    throw new Error("No moves found. Make sure this is a PGN for a completed game.");
  }
  const headers = chess.getHeaders();
  const replay = new Chess();
  const positions = [{ fen: replay.fen(), move: null }];
  for (const move of history) {
    replay.move(move.san);
    positions.push({ fen: replay.fen(), move });
  }
  return { headers, moves: history, positions };
}

function readImport() {
  const pgn = $("pgnText").value.trim();
  if (!pgn) {
    setStatus("Paste PGN text or choose a .pgn file first.", true);
    return;
  }
  try {
    const parsed = parsePgn(pgn);
    state.pgn = pgn;
    state.originalPgn = pgn;
    state.originalAnalyses = null;
    state.originalResults = null;
    state.isVariation = false;
    state.selectedSquare = null;
    state.legalMoves = [];
    if ($("resetVariationBtn")) $("resetVariationBtn").style.display = "none";
    state.headers = parsed.headers;
    state.moves = parsed.moves;
    state.positions = parsed.positions;
    state.analyses = [];
    state.results = [];
    state.cursor = 0;
    state.isAnalyzed = false;

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

// Reset Variation / Revert to Main Game
const resetVariationBtn = $("resetVariationBtn");
if (resetVariationBtn) {
  resetVariationBtn.addEventListener("click", () => {
    if (!state.originalPgn) return;
    try {
      const parsed = parsePgn(state.originalPgn);
      state.pgn = state.originalPgn;
      state.isVariation = false;
      state.selectedSquare = null;
      state.legalMoves = [];
      resetVariationBtn.style.display = "none";
      state.headers = parsed.headers;
      state.moves = parsed.moves;
      state.positions = parsed.positions;
      if (state.originalAnalyses && state.originalResults) {
        state.analyses = [...state.originalAnalyses];
        state.results = [...state.originalResults];
        state.isAnalyzed = true;
        if ($("startReviewText")) $("startReviewText").textContent = "Start";
        $("startReview").classList.add("review-mode");
      } else {
        state.analyses = [];
        state.results = [];
        state.isAnalyzed = false;
        if ($("startReviewText")) $("startReviewText").textContent = "Analyze game";
        $("startReview").classList.remove("review-mode");
      }
      updatePlayerHeaders();
      renderMoves();
      renderBoard(0);
      renderSummary();
      setStatus(`Reverted to main game (${state.moves.length} moves).`);
    } catch (e) {
      setStatus(`Error reverting to main game: ${e.message}`, true);
    }
  });
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

let quickAnalysisTimer = null;
function requestQuickAnalysisForCurrentPosition() {
  if (state.running) return;
  clearTimeout(quickAnalysisTimer);
  const cursor = state.cursor;
  if (state.analyses[cursor]?.bestmove) {
    drawBestMoveArrow();
    return;
  }
  quickAnalysisTimer = setTimeout(async () => {
    if (state.running || state.cursor !== cursor) return;
    const pos = state.positions[cursor];
    if (!pos) return;
    try {
      const res = await analyzeFen(pos.fen, 200);
      if (state.cursor === cursor) {
        const whiteScore = scoreWhite(res.score, pos.fen);
        state.analyses[cursor] = { whiteScore, bestmove: res.bestmove, pv: res.pv };
        updateEvaluationDisplay();
        drawBestMoveArrow();
      }
    } catch {}
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

function executeUserMove(fromSq, toSq) {
  const currentPos = state.positions[state.cursor];
  if (!currentPos) return;

  if (state.running) {
    state.stopRequested = true;
    if (state.worker && state.pending) {
      state.worker.postMessage("stop");
    }
  }

  const chess = new Chess(currentPos.fen);
  const moveObj = chess.move({ from: fromSq, to: toSq, promotion: "q" });
  if (!moveObj) return;

  // If user played the identical move already in the main game
  if (state.cursor < state.moves.length && state.moves[state.cursor].san === moveObj.san) {
    renderBoard(state.cursor + 1);
    return;
  }

  // Branching / continuing variation
  if (!state.isVariation) {
    state.isVariation = true;
    if (!state.originalAnalyses && state.isAnalyzed) {
      state.originalAnalyses = [...state.analyses];
      state.originalResults = [...state.results];
    }
  }

  if ($("resetVariationBtn")) {
    $("resetVariationBtn").style.display = "inline-flex";
  }

  // Truncate following moves
  state.moves = state.moves.slice(0, state.cursor);
  state.positions = state.positions.slice(0, state.cursor + 1);
  state.analyses = state.analyses.slice(0, state.cursor + 1);
  state.results = state.results.slice(0, state.cursor);

  const newPly = state.cursor;
  state.moves.push(moveObj);
  state.positions.push({ fen: chess.fen(), move: moveObj });
  state.cursor = newPly + 1;

  switchTab("moves");
  renderMoves();
  renderBoard(state.cursor);
  renderSummary();

  classifyAndFeedbackNewMove(newPly);
}

function scoreFromWhite(whiteScore, fen) {
  if (whiteScore === undefined || !Number.isFinite(whiteScore)) return 0;
  const turn = fen.split(" ")[1];
  return turn === "w" ? whiteScore : -whiteScore;
}

async function classifyAndFeedbackNewMove(newPly) {
  const playedMove = state.moves[newPly];
  if (!playedMove) return;
  const beforeFen = state.positions[newPly].fen;
  const afterFen = state.positions[newPly + 1].fen;
  const moveTime = Number($("moveTime")?.value) || 250;

  $("engineStatus").textContent = `Analyzing variation move ${newPly + 1}…`;
  $("engineStatus").previousElementSibling?.classList.add("running");

  try {
    let before = null;
    if (state.analyses[newPly] && state.analyses[newPly].bestmove) {
      before = {
        score: scoreFromWhite(state.analyses[newPly].whiteScore, beforeFen),
        bestmove: state.analyses[newPly].bestmove,
        pv: state.analyses[newPly].pv || ""
      };
    } else {
      before = await analyzeFen(beforeFen, moveTime);
    }

    const after = await analyzeFen(afterFen, moveTime);

    const beforeWhite = scoreWhite(before.score, beforeFen);
    let afterWhite = scoreWhite(after.score, afterFen);
    const mover = playedMove.color;

    let isDeliveringMate = false;
    try {
      const afterChess = new Chess(afterFen);
      isDeliveringMate = afterChess.isCheckmate() || playedMove.san.endsWith("#");
    } catch {
      isDeliveringMate = playedMove.san.endsWith("#");
    }

    if (isDeliveringMate) {
      afterWhite = mover === "w" ? 10 : -10;
    }

    const beforePlayer = mover === "w" ? beforeWhite : -beforeWhite;
    const afterPlayer = mover === "w" ? afterWhite : -afterWhite;

    let lossCp = isDeliveringMate ? 0 : Math.max(0, Math.min(1000, (beforePlayer - afterPlayer) * 100));

    const playedUci = `${playedMove.from}${playedMove.to}${playedMove.promotion || ""}`;
    const isBest = isDeliveringMate || before.bestmove === playedUci || lossCp <= 10;
    const isSacrifice = isMaterialSacrifice(beforeFen, afterFen, playedMove);

    let legalMovesCount = 10;
    try {
      legalMovesCount = new Chess(beforeFen).moves().length;
    } catch {}

    const classificationObj = classifyMove({
      lossCp,
      ply: newPly,
      isBest,
      beforePlayerScore: beforePlayer,
      afterPlayerScore: afterPlayer,
      legalMovesCount,
      capturedPiece: playedMove.captured,
      playedPiece: playedMove.piece,
      isSacrifice
    });

    const bestSan = convertPvToSan(beforeFen, before.bestmove);

    let punishSan = "";
    let punishPv = "";
    let punishDetails = null;
    if (after?.bestmove) {
      punishSan = convertPvToSan(afterFen, after.bestmove);
      punishPv = after.pv ? convertPvToSan(afterFen, after.pv) : "";
      try {
        const ch = new Chess(afterFen);
        const u = after.bestmove;
        if (u && u.length >= 4) {
          punishDetails = ch.move({
            from: u.slice(0, 2),
            to: u.slice(2, 4),
            promotion: u[4] || "q"
          });
        }
      } catch {}
    }

    let bestDetails = null;
    if (before?.bestmove) {
      try {
        const ch = new Chess(beforeFen);
        const u = before.bestmove;
        if (u && u.length >= 4) {
          bestDetails = ch.move({
            from: u.slice(0, 2),
            to: u.slice(2, 4),
            promotion: u[4] || "q"
          });
        }
      } catch {}
    }

    let coachingTip = "";
    if (classificationObj.key === "brilliant") {
      coachingTip = `Brilliant play! You found a sharp tactical idea, sacrificing material to seize a decisive advantage.`;
    } else if (classificationObj.key === "great") {
      coachingTip = `Great find! You found the critical move to keep the upper hand or turn the tide.`;
    } else if (classificationObj.key === "miss") {
      coachingTip = `You had an opportunity to capitalize decisively. The engine prefers ${bestSan || "a sharper line"}.`;
    } else if (classificationObj.key === "blunder") {
      coachingTip = `Severe evaluation swing. Check for hanging pieces, unguarded squares, and forcing tactics before moving.`;
    } else if (classificationObj.key === "mistake") {
      coachingTip = `This gave away a chunk of your advantage. Compare your move with ${bestSan || "the engine suggestion"}.`;
    } else if (classificationObj.key === "inaccuracy") {
      coachingTip = `A slight concession. Notice how ${bestSan || "the engine line"} maintains more control and pressure.`;
    } else if (classificationObj.key === "best") {
      coachingTip = `Top-notch calculation. This is the optimal continuation that maximizes piece activity.`;
    } else {
      coachingTip = `Good practical choice. Continues developing and preserving a healthy position.`;
    }

    const result = {
      ply: newPly,
      san: playedMove.san,
      color: mover,
      moveColor: mover,
      moveNo: `${Math.floor(newPly / 2) + 1}${mover === "w" ? "." : "…"}` ,
      beforeWhite,
      afterWhite,
      lossCp,
      key: classificationObj.key,
      label: classificationObj.name,
      sign: classificationObj.sign,
      color: classificationObj.color,
      textColor: classificationObj.textColor,
      explanation: classificationObj.description,
      coachingTip,
      pv: before.pv ? convertPvToSan(beforeFen, before.pv) : "",
      bestUci: before.bestmove,
      bestSan,
      bestDetails,
      punishSan,
      punishPv,
      punishDetails,
      playedPiece: playedMove.piece,
      capturedPiece: playedMove.captured,
      from: playedMove.from,
      to: playedMove.to,
      isSacrifice,
      beforeFen,
      afterFen,
      playedUci
    };

    state.analyses[newPly] = { whiteScore: beforeWhite, bestmove: before.bestmove, pv: before.pv };
    state.analyses[newPly + 1] = { whiteScore: afterWhite, bestmove: after.bestmove, pv: after.pv };
    state.results[newPly] = result;

    $("engineStatus").textContent = "Variation move analyzed";
    $("engineStatus").previousElementSibling?.classList.remove("running");

    renderMoves();
    renderSummary();
    if (state.cursor === newPly + 1) {
      renderBoard(state.cursor);
    }
  } catch (err) {
    console.error("Variation analysis error:", err);
    $("engineStatus").textContent = "Engine idle";
    $("engineStatus").previousElementSibling?.classList.remove("running");
  }
}

function renderBoard(index) {
  state.cursor = Math.max(0, Math.min(index, state.positions.length - 1));
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
  const moveNo = Math.ceil(state.cursor / 2);
  if (state.cursor === 0) {
    $("moveCounter").textContent = "Start";
  } else {
    const isWhite = state.cursor % 2 !== 0;
    const san = lastMove ? lastMove.san : "";
    $("moveCounter").textContent = `${moveNo}${isWhite ? "." : "…"} ${san}`;
  }

  // Update Evaluation & Eval Bar
  updateEvaluationDisplay();

  renderFeedback(currentResult);
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

function renderMoves() {
  if (!state.moves.length) {
    $("moveList").innerHTML = '<p class="muted empty-state">Your game’s moves will appear here.</p>';
    return;
  }
  let html = "";
  for (let i = 0; i < state.moves.length; i += 2) {
    const white = state.moves[i];
    const black = state.moves[i + 1];
    const moveNumber = Math.floor(i / 2) + 1;

    html += `<div class="move-row">`;
    html += `<span class="move-number">${moveNumber}.</span>`;
    html += moveButton(i, white);
    html += black ? moveButton(i + 1, black) : '<div class="move-placeholder"></div>';
    html += `</div>`;
  }
  $("moveList").innerHTML = html;
  $("moveList").querySelectorAll("[data-ply]").forEach(btn => {
    btn.addEventListener("click", () => renderBoard(Number(btn.dataset.ply) + 1));
  });
}

function moveButton(i, move) {
  const result = state.results[i];
  const isActive = state.cursor === i + 1;

  let signBadge = "";
  if (result) {
    signBadge = `<span class="move-sign ${result.key}" style="background-color: ${result.color}; color: ${result.textColor};" title="${esc(result.label)}">${esc(result.sign)}</span>`;
  }

  return `<button class="move-chip ${isActive ? "active" : ""}" data-ply="${i}" title="${esc(move.san)}">
    <span class="move-san">${esc(move.san)}</span>
    ${signBadge}
  </button>`;
}

function highlightActiveMoveInList() {
  const allBtns = $("moveList").querySelectorAll(".move-chip");
  allBtns.forEach(btn => {
    const ply = Number(btn.dataset.ply);
    const active = state.cursor === ply + 1;
    btn.classList.toggle("active", active);
    if (active) {
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
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
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
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
    $("feedbackContent").innerHTML = `
      <div class="feedback-empty">
        Select a move after analysis to view its evaluation, classification, and coaching notes.
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
    const targetPly = result.ply;
    const targetSan = result.san;
    generateCoaching(result, beforeFen).then(coaching => {
      const currentActive = state.cursor > 0 ? state.results[state.cursor - 1] : null;
      if (currentActive && currentActive.ply === targetPly && currentActive.san === targetSan) {
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
  const whiteMoves = state.results.filter((_, i) => i % 2 === 0);
  const blackMoves = state.results.filter((_, i) => i % 2 !== 0);

  const completed = state.results.filter(Boolean).length;
  const isComplete = !state.running && !state.stopRequested && Boolean(state.isAnalyzed || (state.moves.length > 0 && completed === state.moves.length));

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

// STOCKFISH WORKER INTEGRATION
function createEngine() {
  if (state.worker) return state.worker;
  const isExtension = typeof browser !== "undefined" && Boolean(browser?.runtime?.id);
  const workerUrl = isExtension
    ? browser.runtime.getURL("engine/stockfish-19-lite-single.js")
    : "/engine/stockfish-19-lite-single.js";

  state.worker = new Worker(workerUrl);
  state.worker.addEventListener("message", e => {
    const line = String(e.data || "");
    if (line === "uciok") state.worker.postMessage("isready");
    if (line === "readyok" && state.pending?.waitingReady) {
      state.pending.waitingReady = false;
      state.pending.start();
    }
    if (line.startsWith("info ") && state.pending) parseInfo(line, state.pending);
    if (line.startsWith("bestmove ") && state.pending) {
      const p = state.pending;
      clearTimeout(state.timer);
      state.timer = null;
      state.pending = null;
      p.resolve({ score: p.score, pv: p.pv, bestmove: line.split(/\s+/)[1] || "" });
    }
  });

  state.worker.addEventListener("error", e => {
    setStatus(`Engine error: ${e.message || "worker failed"}`, true);
    $("engineStatus").textContent = "Engine error";
  });

  state.worker.postMessage("uci");
  return state.worker;
}

function parseInfo(line, pending) {
  const depth = line.match(/\bdepth (\d+)/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)/);
  const pv = line.match(/\bpv (.+)$/);
  if (depth && Number(depth[1]) < (pending.depth || 1)) return;
  if (score) {
    const n = Number(score[2]);
    pending.score = score[1] === "mate"
      ? (n > 0 ? 10 - Math.min(n, 9) * 0.01 : -10 + Math.min(-n, 9) * 0.01)
      : n / 100;
    pending.scoreType = score[1];
    pending.depthSeen = depth ? Number(depth[1]) : pending.depthSeen;
  }
  if (pv) pending.pv = pv[1].split(" ").slice(0, 8).join(" ");
}

function analyzeFen(fen, moveTime) {
  return new Promise((resolve, reject) => {
    const worker = createEngine();
    if (state.pending) {
      reject(new Error("Engine already analyzing"));
      return;
    }
    const p = { resolve, reject, score: 0, pv: "", depth: 1, waitingReady: true, start: null };
    p.start = () => {
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go movetime ${moveTime}`);
    };
    state.pending = p;
    worker.postMessage("isready");
    state.timer = setTimeout(() => {
      if (state.pending === p) {
        state.pending = null;
        reject(new Error("Engine timed out. Try reloading the review page."));
      }
    }, Math.max(15000, moveTime * 10));
  });
}

function scoreWhite(engineScore, fen) {
  const turn = fen.split(" ")[1];
  return turn === "w" ? engineScore : -engineScore;
}

function convertPvToSan(fen, pv) {
  const c = new Chess(fen);
  const sanMoves = [];
  for (const uci of pv.split(/\s+/).slice(0, 8)) {
    if (!uci || uci.length < 4 || uci === "(none)") break;
    try {
      const move = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
      if (!move) { sanMoves.push(uci); break; }
      sanMoves.push(move.san);
    } catch {
      sanMoves.push(uci);
      break;
    }
  }
  return sanMoves.join(" ");
}

async function startReview() {
  if (!state.moves.length || state.running) return;
  state.running = true;
  state.stopRequested = false;
  state.isAnalyzed = false;
  state.results = [];
  state.analyses = new Array(state.positions.length);

  // Switch to Game Summary tab immediately on start
  switchTab("summary");
  updateAnalysisProgress(0, state.moves.length, "Starting engine…", false, false);
  renderSummary();

  $("startReview").style.display = "none";
  if ($("stopReview")) {
    $("stopReview").style.display = "inline-flex";
    $("stopReview").disabled = false;
  }
  $("engineStatus").textContent = "Starting local Stockfish…";
  $("engineStatus").previousElementSibling?.classList.add("running");

  const moveTime = Number($("moveTime").value);

  try {
    for (let i = 0; i < state.moves.length; i++) {
      if (state.stopRequested) break;
      const current = i + 1;
      const total = state.moves.length;

      updateAnalysisProgress(current, total, `Analyzing move ${current} of ${total}`, false, false);
      $("engineStatus").textContent = `Analyzing move ${current} of ${total}…`;

      const beforeFen = state.positions[i].fen;
      const afterFen = state.positions[i + 1].fen;
      const playedMove = state.moves[i];

      const before = await analyzeFen(beforeFen, moveTime);
      if (state.stopRequested) break;
      const after = await analyzeFen(afterFen, moveTime);

      const beforeWhite = scoreWhite(before.score, beforeFen);
      let afterWhite = scoreWhite(after.score, afterFen);
      const mover = playedMove.color;

      let isDeliveringMate = false;
      try {
        const afterChess = new Chess(afterFen);
        isDeliveringMate = afterChess.isCheckmate() || playedMove.san.endsWith("#");
      } catch {
        isDeliveringMate = playedMove.san.endsWith("#");
      }

      if (isDeliveringMate) {
        afterWhite = mover === "w" ? 10 : -10;
      }

      const beforePlayer = mover === "w" ? beforeWhite : -beforeWhite;
      const afterPlayer = mover === "w" ? afterWhite : -afterWhite;

      let lossCp = isDeliveringMate ? 0 : Math.max(0, Math.min(1000, (beforePlayer - afterPlayer) * 100));

      const playedUci = `${playedMove.from}${playedMove.to}${playedMove.promotion || ""}`;
      const isBest = isDeliveringMate || before.bestmove === playedUci || lossCp <= 10;

      const isSacrifice = isMaterialSacrifice(beforeFen, afterFen, playedMove);
      let legalMovesCount = 10;
      try {
        legalMovesCount = new Chess(beforeFen).moves().length;
      } catch {}

      const classificationObj = classifyMove({
        lossCp,
        ply: i,
        isBest,
        beforePlayerScore: beforePlayer,
        afterPlayerScore: afterPlayer,
        legalMovesCount,
        capturedPiece: playedMove.captured,
        playedPiece: playedMove.piece,
        isSacrifice
      });

      const bestSan = convertPvToSan(beforeFen, before.bestmove);

      // Opponent's punishing response and continuation
      let punishSan = "";
      let punishPv = "";
      let punishDetails = null;
      if (after?.bestmove) {
        punishSan = convertPvToSan(afterFen, after.bestmove);
        punishPv = after.pv ? convertPvToSan(afterFen, after.pv) : "";
        try {
          const ch = new Chess(afterFen);
          const u = after.bestmove;
          if (u && u.length >= 4) {
            punishDetails = ch.move({
              from: u.slice(0, 2),
              to: u.slice(2, 4),
              promotion: u[4] || "q"
            });
          }
        } catch {}
      }

      // Player's best move details
      let bestDetails = null;
      if (before?.bestmove) {
        try {
          const ch = new Chess(beforeFen);
          const u = before.bestmove;
          if (u && u.length >= 4) {
            bestDetails = ch.move({
              from: u.slice(0, 2),
              to: u.slice(2, 4),
              promotion: u[4] || "q"
            });
          }
        } catch {}
      }

      let coachingTip = "";
      if (classificationObj.key === "brilliant") {
        coachingTip = `Brilliant play! You found a sharp tactical idea, sacrificing material to seize a decisive advantage.`;
      } else if (classificationObj.key === "great") {
        coachingTip = `Great find! You found the critical move to keep the upper hand or turn the tide.`;
      } else if (classificationObj.key === "miss") {
        coachingTip = `You had an opportunity to capitalize decisively. The engine prefers ${bestSan || "a sharper line"}.`;
      } else if (classificationObj.key === "blunder") {
        coachingTip = `Severe evaluation swing. Check for hanging pieces, unguarded squares, and forcing tactics before moving.`;
      } else if (classificationObj.key === "mistake") {
        coachingTip = `This gave away a chunk of your advantage. Compare your move with ${bestSan || "the engine suggestion"}.`;
      } else if (classificationObj.key === "inaccuracy") {
        coachingTip = `A slight concession. Notice how ${bestSan || "the engine line"} maintains more control and pressure.`;
      } else if (classificationObj.key === "best") {
        coachingTip = `Top-notch calculation. This is the optimal continuation that maximizes piece activity.`;
      } else {
        coachingTip = `Good practical choice. Continues developing and preserving a healthy position.`;
      }

      const result = {
        ply: i,
        san: playedMove.san,
        color: mover,
        moveColor: mover,
        moveNo: `${Math.floor(i / 2) + 1}${mover === "w" ? "." : "…"}` ,
        beforeWhite,
        afterWhite,
        lossCp,
        key: classificationObj.key,
        label: classificationObj.name,
        sign: classificationObj.sign,
        color: classificationObj.color,
        textColor: classificationObj.textColor,
        explanation: classificationObj.description,
        coachingTip,
        pv: before.pv ? convertPvToSan(beforeFen, before.pv) : "",
        bestUci: before.bestmove,
        bestSan,
        bestDetails,
        punishSan,
        punishPv,
        punishDetails,
        playedPiece: playedMove.piece,
        capturedPiece: playedMove.captured,
        from: playedMove.from,
        to: playedMove.to,
        isSacrifice,
        beforeFen,
        afterFen,
        playedUci
      };

      state.analyses[i] = { whiteScore: beforeWhite, bestmove: before.bestmove, pv: before.pv };
      state.analyses[i + 1] = { whiteScore: afterWhite, bestmove: after.bestmove, pv: after.pv };
      state.results[i] = result;

      renderMoves();
      renderSummary();
      if (state.cursor === i + 1) {
        renderBoard(state.cursor);
      }
    }

    const completed = state.results.filter(Boolean).length;
    if (state.stopRequested) {
      updateAnalysisProgress(completed, state.moves.length, "Analysis stopped", false, true);
      $("engineStatus").textContent = "Analysis stopped";
      setStatus("Review stopped. You can analyze again to restart.");
    } else {
      updateAnalysisProgress(completed, state.moves.length, "Review complete", true, false);
      $("engineStatus").textContent = "Analysis complete — engine ran locally";
      setStatus("Analysis complete! Click any move or open Game Summary.");
    }

    renderSummary();
  } catch (e) {
    $("engineStatus").textContent = "Analysis interrupted";
    setStatus(`Analysis stopped: ${e.message}`, true);
  } finally {
    state.running = false;
    if ($("stopReview")) {
      $("stopReview").style.display = "none";
      $("stopReview").disabled = true;
    }
    $("startReview").style.display = "inline-flex";

    const completed = state.results.filter(Boolean).length;
    if (!state.stopRequested && completed === state.moves.length && state.moves.length > 0) {
      state.isAnalyzed = true;
      state.originalAnalyses = [...state.analyses];
      state.originalResults = [...state.results];
      if ($("startReviewText")) $("startReviewText").textContent = "Start";
      $("startReview").title = "Start Review (Move 1)";
      $("startReview").classList.add("review-mode");
      $("startReview").disabled = false;
    } else {
      state.isAnalyzed = false;
      if ($("startReviewText")) $("startReviewText").textContent = "Analyze game";
      $("startReview").title = "Analyze game";
      $("startReview").classList.remove("review-mode");
      $("startReview").disabled = false;
    }

    $("engineStatus").previousElementSibling?.classList.remove("running");
    renderMoves();
    renderSummary();
    renderBoard(state.cursor);
  }
}

$("startReview").addEventListener("click", () => {
  if (state.isAnalyzed) {
    switchTab("moves");
    renderBoard(1);
    return;
  }
  startReview();
});
$("stopReview").addEventListener("click", () => {
  state.stopRequested = true;
  if (state.worker && state.pending) {
    state.worker.postMessage("stop");
  }
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
