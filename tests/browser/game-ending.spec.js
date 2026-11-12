import {test,expect} from '@playwright/test';
const load=async(page,pgn)=>{
  await page.goto('/review.html');
  await page.locator('#pgnFile').setInputFiles({name:'ending.pgn',mimeType:'text/plain',buffer:Buffer.from(pgn)});
  await page.keyboard.press('ArrowDown');
};
test('checkmate marker appears only over the losing king and follows navigation and flips',async({page})=>{
  await load(page,'1. f3 e5 2. g4 Qh4# 0-1');
  const marker=page.locator('[data-square="e1"] .game-ending-marker.checkmate');
  await expect(marker).toBeVisible();
  await expect(page.locator('.game-ending-marker')).toHaveCount(1);
  await page.keyboard.press('f');
  await expect(marker).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.game-ending-marker')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(marker).toBeVisible();
  await page.locator('#topbarMenuBtn').click();
  await page.locator('label:has(#toggleMoveClassification)').click();
  await expect(marker).toBeVisible();
});
for(const [termination,result,square,kind] of [['Black resigned','1-0','e8','resignation'],['White lost on time','0-1','e1','timeout']]) {
  test(`${kind} is shown on the losing king only at the original ending`,async({page})=>{
    await load(page,`[Result "${result}"]\n[Termination "${termination}"]\n\n1. e4 e5 ${result}`);
    await expect(page.locator(`[data-square="${square}"] .game-ending-marker.${kind}`)).toBeVisible();
    await expect(page.locator('.game-ending-marker')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.game-ending-marker')).toHaveCount(0);
    await page.locator('[data-square="c7"]').click();
    await page.locator('[data-square="c5"]').click();
    await expect(page.locator('.game-ending-marker')).toHaveCount(0);
  });
}
test('draws and wins without a documented reason have no losing-king marker',async({page})=>{
  for(const result of ['1/2-1/2','1-0','*']) {
    await load(page,`[Result "${result}"]\n\n1. e4 e5 ${result}`);
    await expect(page.locator('.game-ending-marker')).toHaveCount(0);
  }
});
