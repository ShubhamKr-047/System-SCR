const api = globalThis.browser ?? globalThis.chrome;

let lichessRetryAt = 0;
let lichessQueue = Promise.resolve();
const lichessRequests = new Map();
function lichessGameId(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'lichess.org') throw new Error('Unsupported Lichess game URL.');
  const match = url.pathname.match(/^\/(?:(?:game|analysis)\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/);
  if (!match || ['analysis', 'training', 'practice', 'insights'].includes(match[1])) throw new Error('Open a Lichess game first.');
  return match[1];
}

async function lichessExport(raw, withPgn = false) {
  const id = lichessGameId(raw);
  if (Date.now() < lichessRetryAt) throw new Error('Lichess rate limit reached. Wait at least one minute before retrying.');
  const key = `${id}:${withPgn}`;
  if (lichessRequests.has(key)) return lichessRequests.get(key);
  const request = lichessQueue.then(async () => {
    if (Date.now() < lichessRetryAt) throw new Error('Lichess rate limit reached. Wait at least one minute before retrying.');
    const query = new URLSearchParams({ moves:String(withPgn), tags:String(withPgn), pgnInJson:String(withPgn), clocks:'false', evals:'false', opening:'false' });
    const response = await fetch(`https://lichess.org/game/export/${id}?${query}`, {
      headers:{Accept:'application/json'}, credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(10000)
    });
    if (response.status === 429) {
      lichessRetryAt = Date.now() + Math.max(60000, (Number(response.headers.get('Retry-After')) || 60) * 1000);
      throw new Error('Lichess rate limit reached. Wait at least one minute before retrying.');
    }
    if (!response.ok) throw new Error(`Lichess returned HTTP ${response.status}. The game may be unavailable.`);
    const game = await response.json();
    const finished = ['mate','resign','stalemate','timeout','draw','outoftime','cheat','unknownFinish','insufficientMaterialClaim','variantEnd'].includes(game.status);
    if (game.id !== id || typeof game.variant !== 'string' || typeof game.status !== 'string') throw new Error('Could not verify this Lichess game.');
    if (!withPgn) return {ok:true, gameId:id, finished, supported:game.variant === 'standard'};
    if (!finished) throw new Error('This game is still in progress or was aborted. Analyze is available for completed games.');
    if (game.variant !== 'standard') throw new Error('Only standard chess games are supported. Lichess variants cannot be imported.');
    if (typeof game.pgn !== 'string' || !/\[Result "(?:1-0|0-1|1\/2-1\/2)"\]/.test(game.pgn)) throw new Error('Lichess did not return a completed game PGN. Please retry shortly.');
    return {ok:true, gameId:id, pgn:game.pgn, meta:{source:'Lichess',
      white:game.players?.white?.user?.name || 'White', black:game.players?.black?.user?.name || 'Black'}};
  });
  lichessQueue = request.catch(() => {});
  lichessRequests.set(key, request);
  try { return await request; } finally { lichessRequests.delete(key); }
}

function parseGameUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !['www.chess.com', 'chess.com'].includes(url.hostname)) throw new Error('Unsupported game URL.');
  const match = url.pathname.match(/^\/(?:game|analysis\/game)\/(?:(live|daily)\/)?(\d+)\/?$/);
  if (!match) throw new Error("Open a Chess.com live or daily game page first.");
  return { kind: match[1] || 'live', id: match[2] };
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Chess.com returned HTTP ${response.status}.`);
  return response.json();
}

async function gameMetadata(rawUrl) {
  const { kind, id } = parseGameUrl(rawUrl);
  const callbackUrl = `https://www.chess.com/callback/${kind}/game/${id}`;
  let callback;
  try {
    callback = await fetchJson(callbackUrl);
  } catch (e) {
    throw new Error(`Couldn't read Chess.com's game data (${e.message}).`);
  }
  const game = callback?.game;
  if (String(game?.id) !== id || typeof game?.isFinished !== 'boolean') throw new Error('Could not verify the current game status.');
  return { game, kind, id };
}

async function retrieveCompletedGame(rawUrl) {
  const { game, kind, id } = await gameMetadata(rawUrl);
  if (game.isFinished !== true) throw new Error('This game is still in progress. Analyze is available after it finishes.');
  const headers = game?.pgnHeaders || {};
  const username = String(headers.White || "").trim().toLowerCase();
  const date = String(headers.Date || "");
  const dateMatch = date.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!username || !dateMatch) {
    throw new Error("Chess.com did not return the game's public archive details. Make sure the game is completed and public.");
  }
  const [, year, month] = dateMatch;
  const archiveUrl = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${year}/${month}`;
  let archive;
  try {
    archive = await fetchJson(archiveUrl);
  } catch (e) {
    throw new Error(`Couldn't access the public game archive (${e.message}). The game may not be published yet.`);
  }
  const wanted = String(id);
  const match = (archive?.games || []).find(item => {
    const itemUrl = String(item.url || "");
    const found = itemUrl.match(/\/(\d+)\/?$/);
    return found && found[1] === wanted;
  });
  if (!match?.pgn) {
    throw new Error("This game wasn't found in Chess.com's published archive yet. It may be ongoing, private, or too recent to appear.");
  }
  // Public monthly archive only contains finished games. This is our completed-game gate.
  return {
    ok: true,
    pgn: match.pgn,
    gameId: wanted,
    meta: {
      source: "Chess.com public archive",
      white: headers.White || "",
      black: headers.Black || "",
      date,
      kind
    }
  };
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let response;
  if (message?.type === 'ZEN_LICHESS_STATUS') response = lichessExport(message.url);
  if (message?.type === 'ZEN_FETCH_LICHESS_GAME') response = lichessExport(message.url, true);
  if (message?.type === 'ZEN_GAME_STATUS') {
    response = gameMetadata(message.url).then(({game, id}) => ({ok:true, gameId:id, finished:game.isFinished}));
  }
  if (message?.type === "ZEN_FETCH_COMPLETED_GAME") {
    response = retrieveCompletedGame(message.url);
  }
  if (message?.type === "ZEN_OPEN_REVIEW" && message.url) {
    response = api.tabs.create({ url: message.url }).then(() => ({ ok: true }));
  }
  if (!response) return undefined;
  response.then(sendResponse, error => sendResponse({ ok: false, error: error.message || String(error) }));
  // Keep asynchronous responses compatible with Chrome and Firefox.
  return true;
});
