(() => {
  const BUTTON_ID = "zen-chess-review-launcher";
  let insertTimer = null;
  const ROOK = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M4 3h4v4h2V3h4v4h2V3h4v7l-3 2v6h2v3H5v-3h2v-6l-3-2V3zm5 9v6h6v-6H9z"/></svg>';

  function canonicalGame(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!['www.chess.com', 'chess.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/(?:game|analysis\/game)\/(live|daily)\/(\d+)\/?$/);
      if (match) return `${location.origin}/game/${match[1]}/${match[2]}`;
      const id = url.searchParams.get('gameId');
      if (/^\/analysis(?:\/|$)/.test(url.pathname) && /^\d+$/.test(id || '')) return `${location.origin}/game/live/${id}`;
    } catch { /* Links can be incomplete during live page updates. */ }
    return null;
  }

  function visible(el) {
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  function gameContext() {
    const direct = canonicalGame(location.href);
    if (direct) return { url: direct };
    if (!/^\/(?:play\/online|play\/daily|live)(?:\/|$)/.test(location.pathname)) return null;
    const panels = [...document.querySelectorAll('[class*="game-over"], [class*="gameOver"], [data-cy*="game-over"], [data-test-element*="game-over"], [role="dialog"]')].filter(el => visible(el) &&
      (/game.?over/i.test(el.className + ' ' + el.getAttribute('data-cy') + ' ' + el.getAttribute('data-test-element')) ||
      /\b(?:you won|you lost|game over|checkmate|stalemate|draw by|game drawn|white won|black won)\b/i.test(el.textContent)));
    for (const panel of panels) for (const link of panel.querySelectorAll('a[href]')) {
      const url = canonicalGame(link.href);
      if (url) return { url };
    }
    const links = [...document.querySelectorAll('a[href*="/game/"], a[href*="/analysis"]')].filter(el => visible(el) &&
      /(?:game\s*review|analy[sz]e|review game)/i.test(el.textContent) && canonicalGame(el.href));
    if (links.length === 1) return { url: canonicalGame(links[0].href) };
    if (!panels.length) return null;
    for (const board of document.querySelectorAll('wc-chess-board, chess-board, .board, [data-game-id]')) {
      if (!visible(board)) continue;
      const id = board.getAttribute('data-game-id') || board.getAttribute('game-id');
      if (/^\d+$/.test(id || '')) return { url: `${location.origin}/game/live/${id}` };
    }
    return { url: null }; // Visible immediately; enabled when the current game identity arrives.
  }

  function addButton() {
    const context = gameContext();
    const existing = document.getElementById(BUTTON_ID);
    if (!context) { existing?.remove(); return; }
    if (existing) {
      if (existing.dataset.gameUrl !== (context.url || '')) {
        existing.dataset.gameUrl = context.url || '';
        existing.disabled = !context.url;
        existing.innerHTML = `${ROOK}<span>Analyze</span>`;
        existing.title = context.url ? 'Analyze this completed game in System SCR' : 'Waiting for the completed game link';
      }
      return;
    }
    if (!document.body) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.innerHTML = `${ROOK}<span>Analyze</span>`;
    button.dataset.gameUrl = context.url || '';
    button.disabled = !context.url;
    button.title = "Analyze this completed game in System SCR";
    if (!context.url) button.title = 'Waiting for the completed game link';
    button.style.cssText = [
      "position:fixed", "right:22px", "bottom:22px", "z-index:2147483647",
      "display:flex", "align-items:center", "gap:9px", "padding:13px 17px",
      "border:1px solid #b8f0ce", "border-radius:12px", "background:#81b64c",
      "color:#ffffff", "font:700 14px/1.2 system-ui,sans-serif",
      "box-shadow:0 8px 28px #0006", "cursor:pointer"
    ].join(";");
    button.addEventListener("mouseenter", () => { button.style.background = "#96bc4b"; });
    button.addEventListener("mouseleave", () => { button.style.background = "#81b64c"; });
    button.addEventListener("click", async () => {
      const gameUrl = button.dataset.gameUrl;
      if (!gameUrl) return;
      button.disabled = true;
      button.innerHTML = '<span aria-hidden="true">…</span> Fetching completed game';
      button.style.opacity = ".8";
      try {
        const api = globalThis.browser ?? globalThis.chrome;
        const response = await api.runtime.sendMessage({
          type: "ZEN_FETCH_COMPLETED_GAME",
          url: gameUrl
        });
        if (!button.isConnected || button.dataset.gameUrl !== gameUrl) return;
        if (!response?.ok) throw new Error(response?.error || "Could not retrieve this game.");
        await api.storage.local.set({
          zenChessPendingPgn: response.pgn,
          zenChessPendingMeta: response.meta || {}
        });
        if (!button.isConnected || button.dataset.gameUrl !== gameUrl) return;
        const reviewUrl = api.runtime.getURL("review.html") + "?source=chesscom&gameId=" + encodeURIComponent(response.gameId || "");
        api.runtime.sendMessage({ type: "ZEN_OPEN_REVIEW", url: reviewUrl }).catch(() => {
          window.open(reviewUrl, "_blank", "noopener");
        });
        button.innerHTML = `${ROOK}<span>Analyze</span>`;
        button.disabled = false;
        button.style.opacity = '1';
      } catch (error) {
        button.disabled = false;
        if (!button.isConnected || button.dataset.gameUrl !== gameUrl) return;
        button.innerHTML = `${ROOK}<span>Analyze</span>`;
        button.style.opacity = "1";
        const connectionError = /receiving end does not exist|could not establish connection|extension context invalidated/i.test(error?.message || '');
        alert("System SCR could not import this game automatically.\n\n" +
          (error?.message || "The game may be private, ongoing, or not yet available in Chess.com's public archive.") +
          (connectionError
            ? "\n\nReload System SCR in your browser's extensions page, then refresh this Chess.com tab and try Analyze again."
            : "\n\nIf the game just finished, its public archive may still be updating. Try Analyze again shortly."));
      }
    });
    document.body.appendChild(button);
  }

  function scheduleButton() {
    if (insertTimer !== null) return;
    insertTimer = setTimeout(() => { insertTimer = null; addButton(); }, 50);
  }

  scheduleButton();
  const observer = new MutationObserver(() => {
    scheduleButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'href', 'hidden', 'data-game-id', 'game-id'] });

  // Chess.com is a single-page app; re-check after URL changes.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
      scheduleButton();
    }
    else scheduleButton();
  }, 400);
  window.addEventListener('popstate', scheduleButton);
  window.addEventListener('pageshow', scheduleButton);
})();
