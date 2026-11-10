import { test, expect } from '@playwright/test';

test('top bar only has the menu action and evaluation bar preference persists', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/review.html');
  await expect(page.locator('.topbar-actions > button')).toHaveCount(1);
  await expect(page.locator('.engine-badge')).toHaveCount(0);
  await expect(page.locator('#evalBar')).toBeVisible();
  await page.locator('#topbarMenuBtn').click();
  await page.locator('label:has(#toggleEvaluationBar)').click();
  await expect(page.locator('#evalBar')).toBeHidden();
  await page.reload();
  await expect(page.locator('#evalBar')).toBeHidden();
  await page.locator('#topbarMenuBtn').click();
  await expect(page.locator('#toggleEvaluationBar')).not.toBeChecked();
  await page.locator('label:has(#toggleEvaluationBar)').click();
  await expect(page.locator('#evalBar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('AI Coach switch controls prompts, retains keys and persists without API calls',async({page})=>{
  const requests=[];
  await page.addInitScript(()=>{
    if (!localStorage.getItem('zen-chess-gemini-key')) localStorage.setItem('zen-chess-gemini-key','test-key-not-a-real-credential');
  });
  await page.route(/generativelanguage\.googleapis\.com|api\.groq\.com/,route=>{
    requests.push(route.request().url());return route.abort();
  });
  await page.goto('/review.html');
  await page.locator('#pgnFile').setInputFiles({name:'coach.pgn',mimeType:'text/plain',buffer:Buffer.from('1. f3 e5 2. g4 Qh4# 0-1')});
  await page.locator('#summaryReviewBtn').click();
  await expect(page.locator('#summaryStartBtn')).toBeVisible({timeout:30000});
  await page.locator('#summaryStartBtn').click();
  await page.locator('.move-chip[title="2. g4"]').click();
  await expect(page.locator('#askAiCoachingBtn')).toBeVisible();
  await page.locator('#topbarMenuBtn').click();
  await page.locator('label:has(#toggleAiCoach)').click();
  await expect(page.locator('#aiCoachSettings')).toBeHidden();
  await expect(page.locator('#askAiCoachingBtn')).toHaveCount(0);
  await expect(page.locator('#positionFeedback[data-source="local"]')).toBeVisible();
  await page.locator('label:has(#toggleAiCoach)').click();
  await expect(page.locator('#aiCoachSettings')).toBeVisible();
  await expect(page.locator('#askAiCoachingBtn')).toBeVisible();
  await page.locator('label:has(#toggleAiCoach)').click();
  await page.reload();
  await page.locator('#topbarMenuBtn').click();
  await expect(page.locator('#toggleAiCoach')).not.toBeChecked();
  await expect(page.locator('#aiCoachSettings')).toBeHidden();
  expect(await page.evaluate(()=>Boolean(localStorage.getItem('zen-chess-gemini-key')))).toBe(true);
  expect(requests).toEqual([]);
});
