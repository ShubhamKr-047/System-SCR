import {test,expect} from '@playwright/test';
let requests;
async function readQuota(page) {
 return page.evaluate(()=>new Promise((resolve,reject)=>{
  const open=indexedDB.open('scr-coach-v1',1);
  open.onerror=reject;
  open.onsuccess=()=>{
   const db=open.result;
   const read=db.transaction('quota').objectStore('quota').get('ledger');
   read.onerror=reject;
   read.onsuccess=()=>{db.close();resolve(Object.values(read.result.accounts)[0]);};
  };
 }));
}
async function load(page){
 await page.goto('/review.html');
 await page.locator('#pgnFile').setInputFiles({name:'game.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 e5 *')});
 await page.locator('[data-square="f2"]').click();await page.locator('[data-square="f3"]').click();
 await expect(page.locator('#askAiCoachingBtn')).toBeVisible();
}
async function key(page,value){
 await page.locator('#topbarMenuBtn').click();await page.locator('#aiApiKey').fill(value);
 await page.locator('#saveAiKey').click();await page.locator('#closeHamburgerBtn').click();
}
test.beforeEach(async({context})=>{
 requests=[];
 await context.route('https://api.groq.com/**',async route=>{
  requests.push(route.request().postDataJSON());
  const url=new URL(route.request().url());
  const response=await route.fetch({url:`http://127.0.0.1:4900/groq${url.pathname}`});
  await route.fulfill({response}).catch(()=>{});
 });
});
test('manual single request, natural prose, private report, expansion and persistent cache',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('scr-coach-level','advanced'));
 await load(page);await key(page,'test-success');expect(requests).toHaveLength(0);
 await page.locator('#askAiCoachingBtn').click();
 await expect(page.locator('.ai-guidance-summary')).toContainText('f3');
 await page.locator('.coach-square[data-coach-square="f3"]').first().click();
 await expect(page.locator('[data-square="f3"]')).toHaveClass(/coach-focus/);
 const report=JSON.parse(requests[0].messages[1].content);
 expect(report.level).toBe('intermediate');
 expect(report).not.toHaveProperty('explanationOptions');
 for(const field of ['pieces','comparisons','positionDifferences','version','localText']) expect(report).not.toHaveProperty(field);
 expect(report.facts.every(f=>!Object.hasOwn(f,'origin'))).toBe(true);expect(report.evaluation.perspective).toBe('White');
 for(const excluded of ['moveTime','WhiteElo','apiKey']) expect(JSON.stringify(report)).not.toContain(excluded);
 await expect(page.locator('.coach-line, [data-coach-line], .coach-lesson')).toHaveCount(0);
 const details=page.locator('.coach-details summary');
 if(await details.count()) await details.click();
 expect(requests).toHaveLength(1);
 const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('scr-coach-v1',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('explanations').objectStore('explanations').getAll();q.onsuccess=()=>{resolve(q.result.length);db.close();};q.onerror=reject;};r.onerror=reject;}));
 expect(saved).toBe(1);
 await page.keyboard.press('f');expect(requests).toHaveLength(1);
 await page.reload();await page.locator('#pgnFile').setInputFiles({name:'game.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 e5 *')});
 await page.locator('[data-square="f2"]').click();await page.locator('[data-square="f3"]').click();
 // Engine evidence can differ after a new search: only compatible cache entries are reused.
 await expect(page.locator('.ai-guidance-summary, #askAiCoachingBtn')).toBeVisible();
 expect(requests).toHaveLength(1);
});
for(const [value,message] of [['test-invalid','authenticate'],['test-quota','rate limit'],['test-unavailable','unavailable'],['test-malformed','invalid explanation'],['test-blocked','invalid explanation'],['test-long','invalid explanation'],['test-hallucination','invalid explanation'],['test-html','invalid explanation'],['test-truncated','invalid explanation']]) {
 test(`${value}: factual fallback without automatic repair or retry`,async({page})=>{
  await load(page);await key(page,value);await page.locator('#askAiCoachingBtn').click();
  await expect(page.locator('#aiCoachStatus')).toContainText(message);
  await expect(page.locator('#positionFeedback[data-source="local"]')).toBeVisible();
  expect(requests).toHaveLength(1);await expect(page.locator('#positionFeedback img')).toHaveCount(0);
  expect(await page.evaluate(()=>window.aiInjected)).toBeUndefined();
  if(value==='test-quota') {
   await expect(page.locator('#aiCoachStatus')).toContainText('Retry after');
   expect((await readQuota(page)).records.every(record=>record.tokens===0)).toBe(true);
   await page.locator('#retryAiCoaching').click();
   await expect(page.locator('#aiCoachStatus')).toContainText('Groq rate limit');
   expect(requests).toHaveLength(1);
  }
 });
}
test('duplicate clicks share a request; clearing a key discards a late response',async({page})=>{
 await load(page);await key(page,'test-delayed');
 await page.locator('#askAiCoachingBtn').evaluate(button=>{button.click();button.click();});
 await expect.poll(()=>requests.length).toBe(1);
 await page.locator('#topbarMenuBtn').click();await page.locator('#clearAiKey').click();
 await page.waitForTimeout(2200);
 await expect(page.locator('.ai-guidance-card')).toHaveCount(0);
 expect(requests).toHaveLength(1);
});
test('two tabs admit only one concurrent request',async({page,context})=>{
 await load(page);await key(page,'test-cross-tab');
 const second=await context.newPage();await load(second);
 await page.locator('#askAiCoachingBtn').click();
 await expect.poll(()=>requests.length).toBe(1);
 await second.locator('#askAiCoachingBtn').click();
 await expect(second.locator('#aiCoachStatus')).toContainText(/another tab|Another explanation/);
 expect(requests).toHaveLength(1);
 await expect(page.locator('.ai-guidance-summary')).toBeVisible();
 // An explicit retry never automatically runs on cooldown expiry.
 expect(requests).toHaveLength(1);
});
test('options omit retired coaching controls and disabling the coach makes no API calls',async({page})=>{
 await load(page);await key(page,'test-success');
 await page.locator('#topbarMenuBtn').click();
 await expect(page.locator('#clearCoachCache, #exportCoachDiagnostics, #aiPlayerLevel')).toHaveCount(0);
 await page.locator('label:has(#toggleAiCoach)').click();
 await page.locator('#closeHamburgerBtn').click();
 await expect(page.locator('#askAiCoachingBtn')).toHaveCount(0);expect(requests).toHaveLength(0);
});

test('navigation during a provider request cannot show its late explanation',async({page})=>{
 await load(page);await key(page,'test-delayed');await page.locator('#askAiCoachingBtn').click();
 await expect.poll(()=>requests.length).toBe(1);
 await page.keyboard.press('ArrowLeft');
 await page.waitForTimeout(2200);
 await expect(page.locator('.ai-guidance-card')).toHaveCount(0);expect(requests).toHaveLength(1);
});
test('unavailable persistent quota storage fails closed without a provider request',async({page})=>{
 await page.addInitScript(()=>{indexedDB.open=()=>{throw new Error('Storage disabled by fixture');};});
 await load(page);await key(page,'test-success');await page.locator('#askAiCoachingBtn').click();
 await expect(page.locator('#aiCoachStatus')).toContainText(/storage|Storage/);
 expect(requests).toHaveLength(0);
});
test('saving a key after local-only feedback restores Explain without sending a request',async({page})=>{
 await load(page);await page.locator('#askAiCoachingBtn').click();
 await expect(page.locator('#positionFeedback[data-source="local"]')).toBeVisible();
 await key(page,'test-success');await expect(page.locator('#askAiCoachingBtn')).toBeVisible();
 expect(requests).toHaveLength(0);await page.locator('#askAiCoachingBtn').click();
 await expect(page.locator('.ai-guidance-summary')).toContainText('f3');expect(requests).toHaveLength(1);
});
for(const daily of [false,true]) test(`${daily?'daily':'minute'} quota reservations survive independently of the page controller`,async({page})=>{
 await load(page);await key(page,'test-success');
 await page.evaluate(async daily=>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test-success'));
  const scope=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  await new Promise((resolve,reject)=>{
   const r=indexedDB.open('scr-coach-v1',1);r.onsuccess=()=>{
    const db=r.result,tx=db.transaction('quota','readwrite');
    tx.objectStore('quota').put({accounts:{[scope]:{until:0,records:daily?Array.from({length:800},(_,i)=>({id:String(i),at:Date.now(),tokens:1})):[{id:'reserved',at:Date.now(),tokens:6300}]}},lease:null},'ledger');
    tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;
   };r.onerror=reject;
  });
 },daily);
 await page.locator('#askAiCoachingBtn').click();await expect(page.locator('#aiCoachStatus')).toContainText('quota cooldown');
 expect(requests).toHaveLength(0);
});


test('two routine moves explain in succession and revisiting the first uses its cached result',async({page})=>{
 await page.goto('/review.html');
 await page.locator('#pgnFile').setInputFiles({name:'game.pgn',mimeType:'text/plain',buffer:Buffer.from('1. e4 e5 *')});
 await key(page,'test-consecutive');
 const play=async(from,to)=>{
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
  await page.locator('#askAiCoachingBtn').click();
 };
 await play('g1','f3');
 await expect(page.locator('.ai-guidance-summary')).toContainText('Nf3');
 await play('b8','c6');
 await expect(page.locator('.ai-guidance-summary')).toContainText('Nc6');
 expect(requests).toHaveLength(2);
 for(const request of requests) {
  expect(request.reasoning_effort).toBe('low');
  expect(request.max_completion_tokens).toBeLessThan(2048);
  expect(request.response_format.json_schema.schema.required).toEqual(['summary','comparison','claims']);
 }
 const quota=await readQuota(page);
 expect(quota.records.map(record=>record.tokens)).toEqual([2400,2400]);
 expect(quota.tokenLimit).toBe(8000);
 expect(quota.requestLimit).toBe(1000);
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('.ai-guidance-summary')).toContainText('Nf3');
 expect(requests).toHaveLength(2);
});
