(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const launcherId = 'scr-lichess-launcher';
  const rook = '<svg class="rook-icon" viewBox="0 0 70 72" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5 H19 Q21 5 21 7 V13 Q21 15 23 15 H28 Q30 15 30 13 V7 Q30 5 32 5 H38 Q40 5 40 7 V13 Q40 15 42 15 H47 Q49 15 49 13 V7 Q49 5 51 5 H56 Q58 5 58 7 V18 Q58 26 50 26 H20 Q12 26 12 18 Z"/><path d="M20 31H50L54 54H16Z"/><path d="M16 58 H54 Q61 58 61 65 V67 H9 V65 Q9 58 16 58 Z"/></svg>';
  let timer, current = null;

  function gameUrl(raw) {
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== 'https://lichess.org') return null;
      const match = url.pathname.match(/^\/(?:(?:game|analysis)\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(?:white|black))?\/?$/);
      if (match && !['analysis','training','practice','insights'].includes(match[1])) return `https://lichess.org/${match[1]}`;
    } catch { /* A partially rendered link is not a game. */ }
    return null;
  }

  function button(url, floating = false) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'scr-lichess-analyze scr-analyze-launcher' + (floating ? '' : ' scr-analyze-compact');
    el.dataset.gameUrl = url;
    const reset = () => { el.innerHTML = `${rook}<span>Analyze</span>`; el.disabled = false; };
    reset();
    el.title = 'Analyze this completed game in System SCR';
    el.style.cssText = `position:${floating ? 'fixed' : 'relative'};z-index:${floating ? '2147483647' : '5'};${floating ? 'right:22px;bottom:22px' : 'margin:8px'}`;
    el.addEventListener('click', async event => {
      event.preventDefault(); event.stopPropagation();
      el.disabled = true; el.textContent = 'Importing…';
      try {
        const response = await api.runtime.sendMessage({type:'ZEN_FETCH_LICHESS_GAME', url});
        if (!el.isConnected) return;
        if (!response?.ok) throw new Error(response?.error || 'Could not import this game.');
        await api.storage.local.set({zenChessPendingPgn:response.pgn, zenChessPendingMeta:response.meta});
        const review = api.runtime.getURL('review.html') + '?source=lichess&gameId=' + encodeURIComponent(response.gameId);
        const opened = await api.runtime.sendMessage({type:'ZEN_OPEN_REVIEW', url:review});
        if (!opened?.ok) throw new Error(opened?.error || 'Could not open System SCR.');
      } catch (error) {
        if (el.isConnected) alert(`System SCR could not import this Lichess game.\n\n${error.message}\n\nYou can also download its PGN and import it manually.`);
      } finally { if (el.isConnected) reset(); }
    });
    return el;
  }

  function refresh() {
    // History pages append rows as you scroll. No API calls until a row is clicked.
    for (const row of document.querySelectorAll('.game-row')) {
      const link = row.querySelector('a.game-row__overlay') || [...row.querySelectorAll('a[href]')].find(a => gameUrl(a.href));
      const url = link && gameUrl(link.href);
      const existing = row.querySelector('.scr-lichess-analyze');
      if (existing && existing.dataset.gameUrl !== url) existing.remove();
      if (url && !row.querySelector('.scr-lichess-analyze')) {
        const el = button(url); el.style.alignSelf = 'flex-start';
        (row.querySelector('.game-row__infos') || row).append(el);
      }
    }
    const url = gameUrl(location.href);
    if (current?.url !== url) {
      current = url ? {url, finished:false, next:0, pending:false, result:false, resultChecks:0} : null;
      document.getElementById(launcherId)?.remove();
    }
    if (!current || document.hidden) return;
    const result = Boolean(document.querySelector('.result-wrap, .analyse .result'));
    if (result && !current.result) { current.next = 0; current.resultChecks = 3; }
    current.result = result;
    if (!current.finished && !current.pending && Date.now() >= current.next) {
      const request = current;
      request.pending = true;
      // Poll only an actual game board, never arbitrary eight-character routes.
      if (!document.querySelector('.round, .round__app, .analyse, .analyse__board, cg-board')) { request.pending = false; return; }
      api.runtime.sendMessage({type:'ZEN_LICHESS_STATUS', url}).then(response => {
        if (current !== request) return;
        if (!response?.ok || response.gameId !== url.split('/').pop()) throw new Error(response?.error || 'Status unavailable');
        request.finished = response.finished === true && response.supported === true;
        request.next = response.supported === false ? Infinity : Date.now() + 30000;
        if (!request.finished && response.supported && request.result && request.resultChecks > 0) {
          request.resultChecks--; request.next = Date.now() + 2000;
        }
        // A result can arrive while the initial status request is in flight.
        if (!request.finished && request.result && !result) request.next = 0;
      }).catch(() => { request.next = Date.now() + 60000; }).finally(() => {
        request.pending = false; schedule();
      });
    }
    if (current.finished && !document.getElementById(launcherId)) {
      const el = button(url, true); el.id = launcherId; document.body.append(el);
    }
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; refresh(); }, 50);
  }
  new MutationObserver(schedule).observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['href','class']});
  setInterval(schedule, 1000);
  window.addEventListener('popstate', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();
})();
