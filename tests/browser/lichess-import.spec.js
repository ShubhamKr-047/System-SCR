import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const background = readFileSync(new URL('../../background.js',import.meta.url),'utf8');
const content = readFileSync(new URL('../../lichess-content.js',import.meta.url),'utf8');
const mock = 'http://127.0.0.1:4930/lichess';
test.afterEach(async ({page}) => { await page.unrouteAll({behavior:'wait'}); });

async function setup(page, path, html) {
  await page.route('https://lichess.org/**', route => route.fulfill({contentType:'text/html',body:`<html><body>${html}</body></html>`}));
  await page.route('https://lichess.org/game/export/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({url:mock + url.pathname + url.search,timeout:15000});
    await route.fulfill({response});
  });
  await page.goto('https://lichess.org' + path);
  await page.evaluate(() => {
    window.calls=[]; window.saved=null; window.opened=null;
    window.browser={runtime:{getURL:p=>'http://127.0.0.1:4173/'+p,
      onMessage:{addListener:fn=>{window.listener=fn;}},
      sendMessage:message=>new Promise(resolve=>{window.calls.push(message);window.listener(message,{},resolve);})},
      storage:{local:{set:async value=>{window.saved=value;}}},tabs:{create:async ({url})=>{window.opened=url;}}};
  });
  await page.addScriptTag({content:background});
  await page.addScriptTag({content});
}
const launcher = page => page.locator('#scr-lichess-launcher');
const send = (page,type,id) => page.evaluate(({type,id})=>window.browser.runtime.sendMessage({type,url:'https://lichess.org/'+id}),{type,id});

test('same live game shows Analyze promptly on completion and imports into review',async({page,request})=>{
  await request.get(mock+'/control/reset');
  await setup(page,'/game/live0001abcd','<main class="round"><cg-board></cg-board></main>');
  await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBeGreaterThan(0);
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(()=>{const el=document.createElement('div');el.className='result-wrap';el.textContent='0-1';document.querySelector('main').append(el);});
  await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.type === 'ZEN_LICHESS_STATUS').length)).toBeGreaterThan(1);
  await request.get(mock+'/control/finish');
  await expect(launcher(page)).toBeVisible({timeout:4000});
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://lichess.org/live0001');
  await launcher(page).click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toContain('source=lichess');
  const saved=await page.evaluate(()=>window.saved), opened=await page.evaluate(()=>window.opened);
  await page.addInitScript(value=>{window.browser={storage:{local:{get:async()=>value,remove:async()=>{}}}};},saved);
  await page.goto(opened);
  await expect(page.locator('#moveList .move-chip')).toHaveCount(4);
  await expect(page.locator('#bottomPlayerName')).toHaveText('WhiteFixture');
});

test('history imports selected game and handles appended rows without background exports',async({page})=>{
  await setup(page,'/@/fixture/all','<article class="game-row"><a class="game-row__overlay" href="/done0001/black">Game</a><div class="game-row__infos">Finished</div></article>');
  await expect(page.locator('.game-row .scr-lichess-analyze')).toHaveCount(1);
  expect(await page.evaluate(()=>window.calls.length)).toBe(0);
  await page.locator('.scr-lichess-analyze').click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toContain('gameId=done0001');
  await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<article class="game-row"><a class="game-row__overlay" href="/done0002">Next</a></article>'));
  await expect(page.locator('.game-row .scr-lichess-analyze')).toHaveCount(2);
  await page.locator('[data-game-url="https://lichess.org/done0002"]').click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toContain('gameId=done0002');
  await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<article class="game-row"><a class="game-row__overlay" href="/gone0001">Missing</a></article>'));
  let error;
  page.once('dialog',async dialog=>{error=dialog.message();await dialog.accept();});
  await page.locator('[data-game-url="https://lichess.org/gone0001"]').click();
  await expect.poll(()=>error).toContain('404');
  await expect(page.locator('[data-game-url="https://lichess.org/gone0001"]')).toBeEnabled();
});

test('completion, variants, malformed PGN and HTTP errors are enforced by background',async({page,request})=>{
  await request.get(mock+'/control/reset');
  await setup(page,'/@/fixture/all','');
  for (const [id,reason] of [['live0001','in progress'],['abor0001','aborted'],['vari0001','standard'],['badp0001','PGN'],['gone0001','404'],['oops0001','503']]) {
    const response=await send(page,'ZEN_FETCH_LICHESS_GAME',id);
    expect(response.ok).toBe(false); expect(response.error).toContain(reason);
  }
  const invalid = await page.evaluate(()=>window.browser.runtime.sendMessage({type:'ZEN_FETCH_LICHESS_GAME',url:'https://example.org/done0001'}));
  expect(invalid.ok).toBe(false);
  expect(invalid.error).toContain('Unsupported');
  expect((await send(page,'ZEN_FETCH_LICHESS_GAME','slow0001')).ok).toBe(false);
  expect((await send(page,'ZEN_FETCH_LICHESS_GAME','rate0001')).error).toContain('rate limit');
  expect((await send(page,'ZEN_FETCH_LICHESS_GAME','done0001')).error).toContain('one minute');
  expect(await page.evaluate(()=>window.saved)).toBeNull();
});

test('completed analysis links load on refresh and stale status cannot survive navigation',async({page})=>{
  await setup(page,'/analysis/done0001/black','<main class="analyse"><cg-board></cg-board></main>');
  await expect(launcher(page)).toBeVisible();
  await page.evaluate(()=>history.pushState({},'','/training'));
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(()=>history.pushState({},'','/done0002/white'));
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://lichess.org/done0002');
  await expect(launcher(page)).toHaveCount(1);
});

test('current /game/ owner URLs and history links use the public eight-character ID',async({page})=>{
  await setup(page,'/game/3i0Nufl2F3fr','<main class="round"><cg-board></cg-board></main>');
  await expect(launcher(page)).toBeVisible();
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://lichess.org/3i0Nufl2');
  await launcher(page).click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toContain('gameId=3i0Nufl2');
  const direct=await page.evaluate(()=>window.browser.runtime.sendMessage({type:'ZEN_FETCH_LICHESS_GAME',url:location.href}));
  expect(direct.ok).toBe(true);
  expect(direct.gameId).toBe('3i0Nufl2');
  await page.evaluate(()=>{
    history.pushState({},'','/@/fixture/all');
    document.querySelector('main').remove();
    document.body.insertAdjacentHTML('beforeend','<article class="game-row"><a class="game-row__overlay" href="/game/done0001/black">Previous game</a><div class="game-row__infos">Finished</div></article>');
  });
  await expect(launcher(page)).toHaveCount(0);
  await expect(page.locator('.game-row .scr-lichess-analyze')).toBeVisible();
  await page.locator('.game-row .scr-lichess-analyze').click();
  await expect.poll(()=>page.evaluate(()=>window.opened)).toContain('gameId=done0001');
});
