import { test, expect } from '@playwright/test';

test('Feedback hides its panel, divider and AI options and persists across reloads', async ({page}) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/review.html');
  await page.locator('#pgnFile').setInputFiles({name:'game.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 d5 2. exd5 Qxd5 *')});
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#feedbackContainer')).toBeVisible();
  const movesHeight = (await page.locator('#moveListWrapper').boundingBox()).height;
  await page.locator('#topbarMenuBtn').click();
  await page.locator('label:has(#toggleFeedback)').click();
  await expect(page.locator('#feedbackContainer')).toBeHidden();
  await expect(page.locator('#feedbackSplitter')).toBeHidden();
  await expect(page.locator('#aiCoachToggleRow')).toBeHidden();
  await expect(page.locator('#aiCoachSettings')).toBeHidden();
  await expect(page.locator('#moveList')).toBeVisible();
  expect((await page.locator('#moveListWrapper').boundingBox()).height).toBeGreaterThan(movesHeight);
  await page.reload();
  await page.locator('#topbarMenuBtn').click();
  await expect(page.locator('#toggleFeedback')).not.toBeChecked();
  await expect(page.locator('#aiCoachToggleRow')).toBeHidden();
  await page.locator('label:has(#toggleFeedback)').click();
  await expect(page.locator('#aiCoachToggleRow')).toBeVisible();
  await expect(page.locator('#toggleAiCoach')).toBeChecked();
  await expect(page.locator('#aiCoachSettings')).toBeVisible();
  expect(errors).toEqual([]);
});

test('material advantage follows captures, navigation, flipping and promotion', async ({page}) => {
  await page.goto('/review.html');
  const load=async pgn=>page.locator('#pgnFile').setInputFiles({name:'material.pgn',mimeType:'text/plain',buffer:Buffer.from(pgn)});
  await load('1. e4 d5 2. exd5 Qxd5 *');
  await expect(page.locator('#bottomPlayerMaterial')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#bottomPlayerMaterial')).toHaveText('+1');
  await expect(page.locator('#bottomPlayerMaterial')).toBeVisible();
  await expect(page.locator('#bottomPlayerMaterial img[alt="Captured black pawn"]')).toHaveCount(1);
  await page.keyboard.press('f');
  await expect(page.locator('#topPlayerMaterial')).toHaveText('+1');
  await expect(page.locator('#topPlayerMaterial img[alt="Captured black pawn"]')).toHaveCount(1);
  await expect(page.locator('#bottomPlayerMaterial')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#topPlayerMaterial')).toBeVisible();
  await expect(page.locator('#topPlayerMaterial .material-score')).toHaveCount(0);
  await expect(page.locator('#bottomPlayerMaterial img[alt="Captured white pawn"]')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#topPlayerMaterial')).toBeVisible();
  await load('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ *');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#topPlayerMaterial')).toHaveText('+9');
  await expect(page.locator('.captured-pieces img')).toHaveCount(0);
});

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
  await page.locator('label:has(#toggleMoveClassification)').click();
  await expect(page.locator('#toggleMoveClassification')).not.toBeChecked();
  await page.locator('label:has(#toggleMoveClassification)').click();
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
  await page.locator('.move-chip[title="1. f3"]').click();
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

test('classification badges stay above diagonal arrows and their visibility preference persists',async({page})=>{
  await page.goto('/review.html');
  await page.locator('#pgnFile').setInputFiles({name:'badges.pgn',mimeType:'text/plain',buffer:Buffer.from('1. f3 e5 2. g4 Qh4# 0-1')});
  await page.locator('#summaryReviewBtn').click();
  await expect(page.locator('#summaryStartBtn')).toBeVisible({timeout:30000});
  await page.locator('#summaryStartBtn').click();
  await page.locator('.move-chip[title="2. g4"]').click();
  const badge=page.locator('[data-square="g4"] .square-badge');
  await expect(badge).toBeVisible();
  const a=await page.locator('[data-square="h5"]').boundingBox();
  const b=await page.locator('[data-square="f3"]').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
  await page.mouse.down({button:'right'});
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});
  await page.mouse.up({button:'right'});
  await expect(page.locator('#boardArrows [data-layer="planning"] .chesscom-arrow')).toHaveCount(1);
  const onTop=await badge.evaluate(el=>{
    const svg=document.getElementById('boardArrows');
    const paths=[svg,...svg.querySelectorAll('path, polygon, line')];
    const previous=paths.map(p=>p.style.pointerEvents);
    paths.forEach(p=>p.style.pointerEvents='all');
    try {
      const r=el.getBoundingClientRect();
      return document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2)[0]===el &&
        Number(getComputedStyle(el).zIndex)>Number(getComputedStyle(svg).zIndex);
    } finally {paths.forEach((p,i)=>p.style.pointerEvents=previous[i]);}
  });
  expect(onTop).toBe(true);
  await page.locator('#topbarMenuBtn').click();
  await page.locator('label:has(#toggleMoveClassification)').click();
  await expect(badge).toHaveCount(0);
  await expect(page.locator('.move-chip[title="2. g4"] .move-sign')).toBeVisible();
  await page.locator('label:has(#toggleMoveClassification)').click();
  await expect(badge).toBeVisible();
  await page.locator('label:has(#toggleMoveClassification)').click();
  await page.reload();
  await page.locator('#topbarMenuBtn').click();
  await expect(page.locator('#toggleMoveClassification')).not.toBeChecked();
});

test('Paste PGN opens beside the button with centered Load and no readiness messages',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/review.html');
  await page.locator('#topbarMenuBtn').click();
  await page.locator('#togglePastePgn').click();
  const panel=page.locator('#pasteDrawer');
  await expect(panel).toBeVisible();
  const box=await panel.boundingBox(), anchor=await page.locator('#togglePastePgn').boundingBox();
  expect(box.x+box.width).toBeLessThan(anchor.x);
  const button=await page.locator('#drawerLoadBtn').boundingBox();
  expect(Math.abs(button.x+button.width/2-(box.x+box.width/2))).toBeLessThan(2);
  await expect(page.locator('#importStatus')).toBeHidden();
  await page.locator('#pgnText').fill('not a valid PGN');
  await page.locator('#drawerLoadBtn').click();
  await expect(panel).toBeVisible();
  await expect(page.locator('#importStatus')).toContainText('Could not read PGN');
  await page.locator('#pgnText').fill('1. e4 e5 2. Nf3 *');
  await page.locator('#drawerLoadBtn').click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#moveList .move-chip')).toHaveCount(3);
  await page.locator('#topbarMenuBtn').click();
  await page.locator('#togglePastePgn').click();
  await expect(page.locator('#importStatus')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.locator('#menuAnalysisBoard').click();
  await expect(page.getByText('Analysis board ready.',{exact:false})).toHaveCount(0);
  expect(errors).toEqual([]);
});
