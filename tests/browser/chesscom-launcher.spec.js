import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../content.js',import.meta.url),'utf8');
const background=readFileSync(new URL('../../background.js',import.meta.url),'utf8');
test('background responds asynchronously to imports and review requests',async({page})=>{
  await page.goto('/popup.html');
  await page.evaluate(()=>{
    window.browser={runtime:{onMessage:{addListener:listener=>{window.backgroundListener=listener;}}},
      tabs:{create:async options=>{window.openedReview=options.url;}}};
  });
  await page.addScriptTag({content:background});
  const result=await page.evaluate(async()=>{
    const send=message=>new Promise(resolve=>{
      const keptOpen=window.backgroundListener(message,{},response=>resolve({keptOpen,response}));
    });
    return {invalid:await send({type:'ZEN_FETCH_COMPLETED_GAME',url:'https://www.chess.com/'}),
      opened:await send({type:'ZEN_OPEN_REVIEW',url:'https://extension.test/review.html'})};
  });
  expect(result.invalid).toEqual({keptOpen:true,response:{ok:false,error:'Open a Chess.com live or daily game page first.'}});
  expect(result.opened).toEqual({keptOpen:true,response:{ok:true}});
  expect(await page.evaluate(()=>window.openedReview)).toBe('https://extension.test/review.html');
});
async function setup(page,path='/play/online',html='<div class="board" data-game-id="123456">Playing</div>') {
  await page.route('https://www.chess.com/**',route=>route.fulfill({contentType:'text/html',body:`<html><body>${html}</body></html>`}));
  await page.goto('https://www.chess.com'+path);
  await page.evaluate(()=>{
    window.sent=[];window.saved=null;
    window.browser={runtime:{getURL:p=>'https://extension.test/'+p,sendMessage:async message=>{
      window.sent.push(message);
      return message.type==='ZEN_FETCH_COMPLETED_GAME'?{ok:true,pgn:'1. e4 e5 *',gameId:'123456'}:{ok:true};
    }},storage:{local:{set:async value=>{window.saved=value;}}}};
  });
  await page.addScriptTag({content:source});
}
const launcher=page=>page.locator('#zen-chess-review-launcher');
test('connection failures explain reload recovery and use real line breaks',async({page})=>{
  await setup(page,'/game/live/123456');
  await page.evaluate(()=>{
    window.browser.runtime.sendMessage=async()=>{throw new Error('Could not establish connection. Receiving end does not exist.');};
  });
  let message;
  page.once('dialog',async dialog=>{message=dialog.message();await dialog.accept();});
  await launcher(page).click();
  expect(message).toContain('\n\nReload System SCR');
  expect(message).not.toContain('\\n');
  expect(message).not.toContain('archive may still be updating');
  await expect(launcher(page)).toBeEnabled();
  await expect(launcher(page)).toHaveText('Analyze');
});
test('a result on the same live page shows Analyze despite continuous clock mutations',async({page})=>{
  await setup(page);
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(()=>{
    const clock=document.createElement('div');document.body.append(clock);
    window.clockTimer=setInterval(()=>{clock.textContent=String(Date.now());},10);
    const result=document.createElement('div');result.className='game-over-modal';result.textContent='You won';document.body.append(result);
  });
  await expect(launcher(page)).toBeEnabled({timeout:1500});
  await expect(launcher(page)).toHaveText('Analyze');
  await expect(launcher(page).locator('svg')).toHaveCount(1);
  await launcher(page).click();
  const sent=await page.evaluate(()=>window.sent);
  expect(sent[0].url).toBe('https://www.chess.com/game/live/123456');
  expect(sent[1].type).toBe('ZEN_OPEN_REVIEW');
});
test('reload and SPA navigation use the current completed game without profile navigation',async({page})=>{
  await setup(page,'/play/online','<div class="game-over-modal"><a href="/analysis/game/live/345678">Game Review</a></div>');
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://www.chess.com/game/live/345678');
  await page.evaluate(()=>{history.pushState({},'','/');document.querySelector('.game-over-modal').remove();});
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(()=>{
    history.pushState({},'','/play/online');
    const result=document.createElement('div');result.className='game-over-modal';result.innerHTML='<a href="/game/live/456789">Game Review</a>';document.body.append(result);
  });
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://www.chess.com/game/live/456789');
  await expect(launcher(page)).toHaveCount(1);
});
test('result appears before its game link, then enables as soon as the link arrives',async({page})=>{
  await setup(page,'/play/online','<div class="game-over-modal">Game over</div>');
  await expect(launcher(page)).toBeVisible();await expect(launcher(page)).toBeDisabled();
  await page.evaluate(()=>{
    const a=document.createElement('a');a.href='/analysis/game/live/567890';a.textContent='Game Review';document.querySelector('.game-over-modal').append(a);
  });
  await expect(launcher(page)).toBeEnabled();
  await expect(launcher(page)).toHaveAttribute('data-game-url','https://www.chess.com/game/live/567890');
});
test('numbered live and daily game pages retain the existing import entry point',async({page})=>{
  await setup(page,'/game/daily/678901');
  await expect(launcher(page)).toHaveText('Analyze');
  await expect(launcher(page)).toBeEnabled();
});
