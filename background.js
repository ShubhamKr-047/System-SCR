const api = globalThis.browser ?? globalThis.chrome;

function parseGameUrl(rawUrl) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/(?:game|analysis\/game)\/(live|daily)\/(\d+)/);
  if (!match) throw new Error("Open a Chess.com live or daily game page first.");
  return { kind: match[1], id: match[2] };
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`Chess.com returned HTTP ${response.status}.`);
  return response.json();
}

async function retrieveCompletedGame(rawUrl) {
  const { kind, id } = parseGameUrl(rawUrl);
  const callbackUrl = `https://www.chess.com/callback/${kind}/game/${id}`;
  let callback;
  try {
    callback = await fetchJson(callbackUrl);
  } catch (e) {
    throw new Error(`Couldn't read Chess.com's game data (${e.message}).`);
  }
  const game = callback?.game;
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

api.runtime.onMessage.addListener((message) => {
  if (message?.type === "ZEN_FETCH_COMPLETED_GAME") {
    return retrieveCompletedGame(message.url).catch(error => ({ ok: false, error: error.message || String(error) }));
  }
  if (message?.type === "ZEN_OPEN_REVIEW" && message.url) {
    return api.tabs.create({ url: message.url }).then(() => ({ ok: true }));
  }
  return undefined;
});