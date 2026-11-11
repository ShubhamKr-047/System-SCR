import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'node:path';

test('installed Chromium extension imports a game through its background worker', async ({}, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium installation test');
  const extensionPath = resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    // Exercise real extension messaging with controlled archive responses.
    await worker.evaluate(() => {
      globalThis.fetch = async url => {
        if (String(url).includes('/callback/live/game/123456')) return new Response(JSON.stringify({
          game: { id:123456, isFinished:true, pgnHeaders: { White: 'Alice', Black: 'Bob', Date: '2026.11.10' } }
        }));
        if (String(url).includes('/pub/player/alice/games/2026/11')) return new Response(JSON.stringify({
          games: [{ url: 'https://www.chess.com/game/live/123456', pgn: '[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *' }]
        }));
        throw new Error('Unexpected fixture request: ' + url);
      };
    });
    const page = await context.newPage();
    await page.route('https://www.chess.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<html><body>Completed game</body></html>'
    }));
    await page.goto('https://www.chess.com/game/123456');
    const launcher = page.locator('#zen-chess-review-launcher');
    await expect(launcher).toHaveText('Analyze');
    await expect(launcher.locator('svg')).toBeVisible();
    const reviewOpened = context.waitForEvent('page');
    await launcher.click();
    const review = await reviewOpened;
    await expect(review).toHaveURL(`chrome-extension://${extensionId}/review.html?source=chesscom&gameId=123456`);
    await expect(review.locator('#bottomPlayerName')).toHaveText('Alice');
    await expect(review.locator('#topPlayerName')).toHaveText('Bob');
    const response = await review.evaluate(() => chrome.runtime.sendMessage({
      type: 'ZEN_FETCH_COMPLETED_GAME', url: 'https://www.chess.com/'
    }));
    expect(response).toEqual({ ok: false, error: 'Open a Chess.com live or daily game page first.' });
    await expect(launcher).toBeEnabled();
  } finally {
    await context.close();
  }
});
