import { Chess } from "chess.js";
import { PIECE_IMAGES } from "./pieces.js";
import { CLASSIFICATIONS, classifyMove, calculateAccuracy, isMaterialSacrifice } from "./classifications.js";
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
  headers: {}
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
    state.headers = parsed.headers;
    state.moves = parsed.moves;
    state.positions = parsed.positions;
    state.analyses = [];
    state.results = [];
    state.cursor = 0;

    $("startReview").disabled = false;
    updatePlayerHeaders();

    $("reviewProgress").textContent = `${state.moves.length} half-moves loaded`;
    setStatus(`Loaded ${state.moves.length} half-moves. Ready to analyze.`);
    $("engineStatus").textContent = "Engine idle";
    updateAnalysisProgress(0, state.moves.length, "Ready to analyze", false, false);

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
}

$("pgnFile").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  $("pgnText").value = await file.text();
  setStatus(`Loaded file: ${file.name}. Click “Load game”.`);
  readImport();
});

$("loadPgn").addEventListener("click", readImport);
$("pgnText").addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") readImport();
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
    if (state.moves.length && pasteDrawer) {
      pasteDrawer.style.display = "none";
      togglePasteBtn?.classList.remove("active");
    }
  });
}

// Flip Board Toggle
$("flipBoard").addEventListener("click", () => {
  state.flipped = !state.flipped;
  updatePlayerHeaders();
  renderBoard(state.cursor);
});

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

      // Piece Image
      let pieceHtml = "";
      if (sq) {
        const pieceKey = sq.color + sq.type;
        const pieceSrc = PIECE_IMAGES[pieceKey] || "";
        pieceHtml = `<img class="piece" src="${pieceSrc}" alt="${sq.color === 'w' ? 'White' : 'Black'} ${sq.type}" draggable="false" />`;
      }

      // Coordinates (Chess.com style)
      // Rank coordinates on left column (c === 0)
      // File coordinates on bottom row (r === 7)
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
      if (currentResult && lastMove && sqName === lastMove.to) {
        badgeHtml = `<div class="square-badge ${currentResult.key}" style="background-color: ${currentResult.color}; color: ${currentResult.textColor};" title="${esc(currentResult.label)}: ${esc(currentResult.sign)}">${esc(currentResult.sign)}</div>`;
      }

      html += `<div class="square ${shade} ${isLast ? 'last-move' : ''} ${isCheck ? 'in-check' : ''}" data-square="${sqName}">${pieceHtml}${coordRank}${coordFile}${badgeHtml}</div>`;
    }
  }

  $("board").innerHTML = html;

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
}

function updateEvaluationDisplay() {
  const currentEval = state.analyses[state.cursor];
  const whiteScore = currentEval?.whiteScore ?? 0;
  const scoreText = formatScore(whiteScore);

  const topEvalEl = $("topPlayerEval");
  const bottomEvalEl = $("bottomPlayerEval");

  if (state.flipped) {
    topEvalEl.textContent = currentEval ? scoreText : "—";
    bottomEvalEl.textContent = currentEval ? formatScore(-whiteScore) : "—";
  } else {
    topEvalEl.textContent = currentEval ? formatScore(-whiteScore) : "—";
    bottomEvalEl.textContent = currentEval ? scoreText : "—";
  }

  // Update Vertical Eval Bar
  const evalBar = $("evalBar");
  const evalBarFill = $("evalBarWhite");
  const evalBarScore = $("evalBarScore");

  if (!currentEval || !Number.isFinite(whiteScore)) {
    evalBarFill.style.height = "50%";
    evalBarScore.textContent = "0.0";
    evalBar.classList.remove("black-winning");
    return;
  }

  // Convert pawn score to percentage: 0.0 -> 50%
  // Using sigmoid / capped linear scale
  let pct = 50 + (whiteScore * 6.5);
  if (whiteScore > 8) pct = 98;
  if (whiteScore < -8) pct = 2;
  pct = Math.max(2, Math.min(98, pct));

  // If flipped, reverse bar
  const finalFill = state.flipped ? (100 - pct) : pct;
  evalBarFill.style.height = `${finalFill}%`;
  evalBarScore.textContent = scoreText;

  if (whiteScore < 0) {
    evalBar.classList.add("black-winning");
  } else {
    evalBar.classList.remove("black-winning");
  }
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

function renderFeedback(result) {
  if (!result) {
    $("feedbackContent").innerHTML = `
      <div class="feedback-empty">
        Select a move after analysis to view its evaluation, classification, and coaching notes.
      </div>`;
    return;
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

    <div class="eval-cards">
      <div class="eval-card">
        <span>Eval before</span>
        <strong>${esc(formatScore(result.beforeWhite))}</strong>
      </div>
      <div class="eval-card">
        <span>Eval after</span>
        <strong>${esc(formatScore(result.afterWhite))}</strong>
      </div>
      <div class="eval-card">
        <span>Advantage loss</span>
        <strong>${result.lossCp > 900 ? "Mate swing" : `${(result.lossCp / 100).toFixed(2)} pawns`}</strong>
      </div>
    </div>

    <div class="feedback-block">
      <h3>Why this classification?</h3>
      <p>${esc(result.explanation)}</p>
    </div>

    <div class="feedback-block">
      <h3>Engine’s recommended continuation</h3>
      <p class="pv-line">${esc(result.pv || "No continuation reported.")}</p>
    </div>

    <div class="feedback-block">
      <h3>Coaching Key</h3>
      <p>${esc(result.coachingTip)}</p>
    </div>`;
}

function updateAnalysisProgress(current, total, statusText, isDone = false, isStopped = false) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const box = $("summaryProgressBarBox");
  const fill = $("summaryProgressBarFill");
  const pctText = $("progressPercentageText");
  const statusLabel = $("progressStatusLabel");
  const detailText = $("progressDetailText");
  const dockFill = $("dockProgressBarFill");
  const reviewProgress = $("reviewProgress");

  if (fill) fill.style.width = `${pct}%`;
  if (dockFill) dockFill.style.width = `${pct}%`;
  if (pctText) pctText.textContent = `${pct}%`;

  if (box) {
    box.classList.toggle("running", !isDone && !isStopped && current > 0 && current < total);
    box.classList.toggle("completed", isDone);
  }

  if (isDone) {
    if (statusLabel) statusLabel.textContent = "Review Complete";
    if (detailText) detailText.textContent = `All ${total} half-moves analyzed (100%)`;
    if (reviewProgress) reviewProgress.textContent = `100% · Complete (${total} moves)`;
  } else if (isStopped) {
    if (statusLabel) statusLabel.textContent = "Analysis Stopped";
    if (detailText) detailText.textContent = `Stopped at ${current}/${total} moves (${pct}%)`;
    if (reviewProgress) reviewProgress.textContent = `Stopped · ${pct}% (${current}/${total})`;
  } else if (current === 0) {
    if (statusLabel) statusLabel.textContent = "Analysis Progress";
    if (detailText) detailText.textContent = total > 0 ? `0 of ${total} moves analyzed` : "Load a game to start analysis";
    if (reviewProgress) reviewProgress.textContent = total > 0 ? `${total} moves loaded` : "Not analyzed";
  } else {
    if (statusLabel) statusLabel.textContent = statusText || "Analyzing game…";
    if (detailText) detailText.textContent = `Analyzing move ${current} of ${total} (${pct}%)`;
    if (reviewProgress) reviewProgress.textContent = `${pct}% · ${current}/${total}`;
  }
}

function renderSummary() {
  const whiteMoves = state.results.filter((_, i) => i % 2 === 0);
  const blackMoves = state.results.filter((_, i) => i % 2 !== 0);

  const whiteAcc = calculateAccuracy(whiteMoves);
  const blackAcc = calculateAccuracy(blackMoves);

  $("summaryWhiteAcc").textContent = whiteMoves.length ? `${whiteAcc}%` : "—";
  $("summaryBlackAcc").textContent = blackMoves.length ? `${blackAcc}%` : "—";

  // Show accuracy on player bars as well
  if (whiteMoves.length) {
    if (state.flipped) {
      $("topPlayerAccuracy").textContent = `${whiteAcc}%`;
      $("topPlayerAccuracy").style.display = "inline-block";
      $("bottomPlayerAccuracy").textContent = `${blackAcc}%`;
      $("bottomPlayerAccuracy").style.display = "inline-block";
    } else {
      $("topPlayerAccuracy").textContent = `${blackAcc}%`;
      $("topPlayerAccuracy").style.display = "inline-block";
      $("bottomPlayerAccuracy").textContent = `${whiteAcc}%`;
      $("bottomPlayerAccuracy").style.display = "inline-block";
    }
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
        <div class="breakdown-badge-name">
          <span class="move-sign ${cls.key}" style="background-color: ${cls.color}; color: ${cls.textColor};">${cls.sign}</span>
          <span>${cls.name}</span>
        </div>
        <div class="breakdown-counts">
          <span>${wCount}</span>
          <span>${bCount}</span>
        </div>
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
  state.results = [];
  state.analyses = new Array(state.positions.length);

  // Switch to Game Summary tab immediately on start
  switchTab("summary");
  updateAnalysisProgress(0, state.moves.length, "Starting engine…", false, false);
  renderSummary();

  $("startReview").disabled = true;
  $("stopReview").disabled = false;
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
        playedUci
      };

      state.analyses[i] = { whiteScore: beforeWhite };
      state.analyses[i + 1] = { whiteScore: afterWhite };
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
    $("startReview").disabled = false;
    $("stopReview").disabled = true;
    $("engineStatus").previousElementSibling?.classList.remove("running");
    renderMoves();
    renderSummary();
    renderBoard(state.cursor);
  }
}

$("startReview").addEventListener("click", startReview);
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
autoImportPendingGame();
