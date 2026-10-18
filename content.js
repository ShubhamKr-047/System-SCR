(() => {
  const BUTTON_ID = "zen-chess-review-launcher";
  let insertTimer = null;

  function isSupportedGameUrl() {
    return /\/(?:game|analysis\/game)\/(?:live|daily)\/\d+/.test(location.pathname);
  }

  function addButton() {
    if (!isSupportedGameUrl() || document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.innerHTML = '<span aria-hidden="true">♞</span> Analyze with System SCR';
    button.title = "Analyze this completed game in System SCR";
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
      button.disabled = true;
      button.innerHTML = '<span aria-hidden="true">…</span> Fetching completed game';
      button.style.opacity = ".8";
      try {
        const api = globalThis.browser ?? globalThis.chrome;
        const response = await api.runtime.sendMessage({
          type: "ZEN_FETCH_COMPLETED_GAME",
          url: location.href
        });
        if (!response?.ok) throw new Error(response?.error || "Could not retrieve this game.");
        await api.storage.local.set({
          zenChessPendingPgn: response.pgn,
          zenChessPendingMeta: response.meta || {}
        });
        const reviewUrl = api.runtime.getURL("review.html") + "?source=chesscom&gameId=" + encodeURIComponent(response.gameId || "");
        api.runtime.sendMessage({ type: "ZEN_OPEN_REVIEW", url: reviewUrl }).catch(() => {
          window.open(reviewUrl, "_blank", "noopener");
        });
        button.innerHTML = '<span aria-hidden="true">✓</span> Opening review…';
      } catch (error) {
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">♞</span> Analyze with System SCR';
        button.style.opacity = "1";
        alert("System SCR could not import this game automatically.\\n\\n" +
          (error?.message || "The game may be private, ongoing, or not yet available in Chess.com's public archive.") +
          "\\n\\nTry again from the completed game's page.");
      }
    });
    document.body.appendChild(button);
  }

  function scheduleButton() {
    clearTimeout(insertTimer);
    insertTimer = setTimeout(addButton, 800);
  }

  scheduleButton();
  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID)) scheduleButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Chess.com is a single-page app; re-check after URL changes.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const existing = document.getElementById(BUTTON_ID);
      if (existing) existing.remove();
      scheduleButton();
    }
  }, 800);
})();