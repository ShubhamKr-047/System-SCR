(() => {
  const BUTTON_ID = "zen-chess-review-launcher";
  let insertTimer = null;
  let status = { url: null, finished: false, pending: false, next: 0, failures: 0 };
  const ROOK = '<svg class="rook-icon" viewBox="0 0 70 72" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5 H19 Q21 5 21 7 V13 Q21 15 23 15 H28 Q30 15 30 13 V7 Q30 5 32 5 H38 Q40 5 40 7 V13 Q40 15 42 15 H47 Q49 15 49 13 V7 Q49 5 51 5 H56 Q58 5 58 7 V18 Q58 26 50 26 H20 Q12 26 12 18 Z"/><path d="M20 31H50L54 54H16Z"/><path d="M16 58 H54 Q61 58 61 65 V67 H9 V65 Q9 58 16 58 Z"/></svg>';

  function canonicalGame(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (!['www.chess.com', 'chess.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/(?:game|analysis\/game)\/(?:(live|daily)\/)?(\d+)\/?$/);
      if (match) return `${location.origin}/game/${match[1] || 'live'}/${match[2]}`;
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
    const url = context?.url || null;
    if (status.url !== url) status = { url, finished: false, pending: false, next: 0, failures: 0 };
    if (url && !status.finished && !status.pending && !document.hidden && Date.now() >= status.next) {
      const request = status;
      request.pending = true;
      const api = globalThis.browser ?? globalThis.chrome;
      Promise.resolve().then(() => api.runtime.sendMessage({type:'ZEN_GAME_STATUS', url})).then(response => {
        if (status !== request || gameContext()?.url !== url) return;
        if (!response?.ok || String(response.gameId) !== url.split('/').pop() || typeof response.finished !== 'boolean') throw new Error('Unverified game status');
        request.finished = response.finished === true;
        request.failures = 0;
      }).catch(() => { request.failures++; }).finally(() => {
        request.pending = false;
        request.next = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(request.failures, 4));
        scheduleButton();
      });
    }
    const existing = document.getElementById(BUTTON_ID);
    if (!status.finished) { existing?.remove(); return; }
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
    button.className = "scr-analyze-launcher";
    button.type = "button";
    button.innerHTML = `${ROOK}<span>Analyze</span>`;
    button.dataset.gameUrl = context.url || '';
    button.disabled = !context.url;
    button.title = "Analyze this completed game in System SCR";
    if (!context.url) button.title = 'Waiting for the completed game link';
    button.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483647";
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { status.next = 0; scheduleButton(); }
  });
})();
