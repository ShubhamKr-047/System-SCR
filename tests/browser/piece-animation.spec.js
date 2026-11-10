import { test, expect } from '@playwright/test';

test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{
    window.pieceAnimations=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){
      const animation=animate.apply(this,args);
      if(this.classList.contains('move-animation-piece')) {
        window.pieceAnimations.push(animation);
        animation.pause();
      }
      return animation;
    };
  });
  await page.goto('/review.html');
  await page.locator('#pgnFile').setInputFiles({name:'animation.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 e5 2. Nf3 Nc6 *')});
});

test('movement slides between squares, undo reverses it, and flipping cancels cleanly',async({page})=>{
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.move-animation-piece')).toHaveCount(1);
  await expect(page.locator('[data-square="e4"] > .piece')).toBeHidden();
  const before=await page.locator('.move-animation-piece').boundingBox();
  await page.evaluate(()=>window.pieceAnimations.at(-1).currentTime=95);
  const midway=await page.locator('.move-animation-piece').boundingBox();
  const destination=await page.locator('[data-square="e4"] > .piece').boundingBox();
  expect(midway.y).toBeLessThan(before.y);
  expect(midway.y).toBeGreaterThan(destination.y);
  await page.evaluate(()=>window.pieceAnimations.at(-1).finish());
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  await expect(page.locator('[data-square="e4"] > .piece')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.move-animation-piece')).toHaveCount(1);
  await page.keyboard.press('f');
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  await expect(page.locator('[data-square="e2"] > .piece')).toBeVisible();
});

test('rapid stepping leaves only the current transition and reduced motion snaps immediately',async({page})=>{
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.move-animation-piece')).toHaveCount(1);
  await expect(page.locator('#board .square > .piece')).toHaveCount(32);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  await expect(page.locator('[data-square="e2"] > .piece')).toBeVisible();
});

test('castling animates both pieces and promotion keeps the pawn visible until arrival',async({page})=>{
  await page.locator('#pgnFile').setInputFiles({name:'castle.pgn',mimeType:'text/plain',buffer:Buffer.from('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. O-O *')});
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.move-animation-piece')).toHaveCount(2);
  await expect(page.locator('[data-square="g1"] > .piece')).toBeHidden();
  await expect(page.locator('[data-square="f1"] > .piece')).toBeHidden();
  await page.locator('#pgnFile').setInputFiles({name:'promotion.pgn',mimeType:'text/plain',buffer:Buffer.from('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ *')});
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  const pawn=await page.locator('[data-square="a7"] > .piece').getAttribute('src');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.move-animation-piece')).toHaveAttribute('src',pawn);
  await expect(page.locator('[data-square="a8"] > .piece')).toBeHidden();
  await page.evaluate(()=>window.pieceAnimations.at(-1).finish());
  await expect(page.locator('[data-square="a8"] > .piece')).toHaveAttribute('alt','White q');
  await expect(page.locator('[data-square="a8"] > .piece')).toBeVisible();
});

test('a dropped piece stays at the pointer destination while click moves animate',async({page})=>{
  const from=await page.locator('[data-square="e2"]').boundingBox();
  const to=await page.locator('[data-square="e4"]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
  await page.mouse.down();
  await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});
  await page.mouse.up();
  await expect(page.locator('#moveCounter')).toHaveText('1. e4');
  await expect(page.locator('.move-animation-piece')).toHaveCount(0);
  await expect(page.locator('[data-square="e4"] > .piece')).toBeVisible();
  await page.locator('[data-square="e7"]').click();
  await page.locator('[data-square="e5"]').click();
  await expect(page.locator('.move-animation-piece')).toHaveCount(1);
  await expect(page.locator('[data-square="e5"] > .piece')).toBeHidden();
});
