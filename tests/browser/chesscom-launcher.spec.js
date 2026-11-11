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
async function setup(page,path='/play/online',html='<div class="board" data-game-id="123456">Playing</div>',configure=null) {
  await page.route('https://www.chess.com/**',route=>route.fulfill({contentType:'text/html',body:`<html><body>${html}</body></html>`}));
  await page.goto('https://www.chess.com'+path);
  await page.evaluate(()=>{
    window.sent=[];window.saved=null;
    window.browser={runtime:{getURL:p=>'https://extension.test/'+p,sendMessage:async message=>{
      if(message.type==='ZEN_GAME_STATUS') return {ok:true,gameId:message.url.split('/').pop(),finished:true};
      window.sent.push(message);
      return message.type==='ZEN_FETCH_COMPLETED_GAME'?{ok:true,pgn:'1. e4 e5 *',gameId:'123456'}:{ok:true};
    }},storage:{local:{set:async value=>{window.saved=value;}}}};
  });
  if(configure) await page.evaluate(configure);
  await page.addScriptTag({content:source});
}
const launcher=page=>page.locator('#zen-chess-review-launcher');
test('connection failures explain reload recovery and use real line breaks',async({page})=>{
  await setup(page,'/game/live/123456');
  await expect(launcher(page)).toBeEnabled();
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
  await expect(launcher(page)).toHaveCount(0);
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
test('same game URL stays hidden during play and appears only after confirmed completion',async({page})=>{
  await setup(page,'/game/186987966486','<div class="board">Playing</div>',()=>{
    window.finished=false;window.statusCalls=0;
    window.browser.runtime.sendMessage=async message=>{
      window.statusCalls++;
      return {ok:true,gameId:message.url.split('/').pop(),finished:window.finished};
    };
  });
  await expect.poll(()=>page.evaluate(()=>window.statusCalls)).toBeGreaterThan(0);
  await expect(launcher(page)).toHaveCount(0);
  await page.evaluate(()=>{window.finished=true;});
  await expect(launcher(page)).toBeEnabled({timeout:8000});
  await expect(page).toHaveURL('https://www.chess.com/game/186987966486');
  await page.evaluate(()=>{document.querySelector('.board').remove();});
  await expect(launcher(page)).toBeEnabled();
  await page.evaluate(()=>{history.pushState({},'','/game/999999');window.finished=false;});
  await expect(launcher(page)).toHaveCount(0);
});

test('late completion response cannot enable a rematch',async({page})=>{
  await setup(page,'/game/123456','<div class="board">Playing</div>',()=>{
    window.browser.runtime.sendMessage=message=>new Promise(resolve=>{
      if(message.url.endsWith('/123456'))window.resolveOld=resolve;
      else resolve({ok:true,gameId:'999999',finished:false});
    });
  });
  await expect.poll(()=>page.evaluate(()=>typeof window.resolveOld)).toBe('function');
  await page.evaluate(()=>{history.pushState({},'','/game/999999');});
  await page.waitForTimeout(500);
  await page.evaluate(()=>window.resolveOld({ok:true,gameId:'123456',finished:true}));
  await page.waitForTimeout(100);
  await expect(launcher(page)).toHaveCount(0);
});

test('metadata requires matching ID and explicit completion, including at import',async({page})=>{
  await page.goto('/popup.html');
  await page.evaluate(()=>{
    window.browser={runtime:{onMessage:{addListener:fn=>{window.listener=fn;}}}};
    window.fetch=async()=>new Response(JSON.stringify({game:window.fixture}));
  });
  await page.addScriptTag({content:background});
  const responses=await page.evaluate(async()=>{
    const send=type=>new Promise(resolve=>window.listener({type,url:'https://www.chess.com/game/123456'},{},resolve));
    const results=[];
    for(const game of [{id:123456,isFinished:false},{id:999999,isFinished:true},{id:123456},{id:123456,isFinished:true}]){
      window.fixture=game;results.push(await send('ZEN_GAME_STATUS'));
    }
    window.fixture={id:123456,isFinished:false};results.push(await send('ZEN_FETCH_COMPLETED_GAME'));
    return results;
  });
  expect(responses[0]).toEqual({ok:true,gameId:'123456',finished:false});
  expect(responses[1].ok).toBe(false);expect(responses[2].ok).toBe(false);
  expect(responses[3]).toEqual({ok:true,gameId:'123456',finished:true});
  expect(responses[4].ok).toBe(false);
  expect(responses[4].error).toContain('still in progress');
});
