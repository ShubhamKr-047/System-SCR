import {test,expect} from '@playwright/test';
for(const provider of ['gemini','groq']) {
  test.describe(provider,()=>{
    let requests;
    test.beforeEach(async({page})=>{
      requests=[];
      await page.route(/^https:\/\/(generativelanguage\.googleapis\.com|api\.groq\.com)\//,async route=>{
        const request=route.request(),url=new URL(request.url());
        requests.push(request.postDataJSON());
        const member=url.hostname==='api.groq.com'?'groq':'gemini';
        const response=await route.fetch({url:`http://127.0.0.1:4900/${member}${url.pathname}`});
        await route.fulfill({response}).catch(()=>{});
      });
      await page.goto('/review.html');
      await page.locator('#pgnFile').setInputFiles({name:'game.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 e5 *')});
      await page.locator('[data-square="f2"]').click();await page.locator('[data-square="f3"]').click();
      await expect(page.locator('#askAiCoachingBtn')).toBeVisible();
    });
    async function key(page,value){
      await page.locator('#topbarMenuBtn').click();
      await page.locator('#aiProvider').selectOption(provider);
      await page.locator('#aiApiKey').fill(value);await page.locator('#saveAiKey').click();
      await page.locator('#closeHamburgerBtn').click();
    }
    test('concise card, private payload, manual request and cached response',async({page})=>{
      await key(page,'test-success');expect(requests).toHaveLength(0);
      await page.locator('#askAiCoachingBtn').click();
      await expect(page.locator('.ai-guidance-summary')).toContainText('Explanation for f3');
      await expect(page.locator('.ai-guidance-tip')).toHaveCount(0);
      await expect(page.locator('.ai-guidance-card h3')).toHaveCount(0);
      const body=requests[0];
      const context=JSON.parse(provider==='groq'?body.messages[1].content:body.contents[0].parts[0].text);
      expect(context.played.san).toBe('f3');expect(context.facts.length).toBeGreaterThan(0);
      expect(context.positions.before).toContain(' w ');
      expect(context).not.toHaveProperty('stockfish');
      for(const excluded of ['beforeWhite','material','legalMoves','moveTime','WhiteElo'])expect(JSON.stringify(context)).not.toContain(excluded);
      await page.keyboard.press('f');
      await expect(page.locator('.ai-guidance-summary')).toBeVisible();expect(requests).toHaveLength(1);
    });
    for(const [value,message] of [['test-invalid',provider==='groq'?'authenticate':'denied'],['test-quota','quota'],['test-unavailable','unavailable'],['test-malformed','invalid explanation'],['test-blocked','invalid explanation'],['test-long','invalid explanation'],['test-html','invalid explanation']]){
      test(`${value} keeps factual fallback and allows retry`,async({page})=>{
        await key(page,value);await page.locator('#askAiCoachingBtn').click();
        await expect(page.locator('#aiCoachStatus')).toContainText(message);
        await expect(page.locator('#positionFeedback[data-source="local"]')).toBeVisible();
        await expect(page.locator('#positionFeedback img')).toHaveCount(0);
        expect(await page.evaluate(()=>window.aiInjected)).toBeUndefined();
        await page.locator('#retryAiCoaching').click();
        await expect.poll(()=>requests.length).toBe(2);
        await expect(page.locator('#aiCoachStatus')).toContainText(message);
      });
    }
    test('removing key cancels a late response',async({page})=>{
      await key(page,'test-delayed');await page.locator('#askAiCoachingBtn').click();
      await expect.poll(()=>requests.length).toBe(1);
      await page.locator('#topbarMenuBtn').click();await page.locator('#clearAiKey').click();
      await page.waitForTimeout(2200);
      await expect(page.locator('.ai-guidance-card')).toHaveCount(0);
      await expect(page.locator('#aiCoachStatus')).toHaveCount(0);
      await page.unrouteAll({behavior:'wait'});
    });
  });
}
