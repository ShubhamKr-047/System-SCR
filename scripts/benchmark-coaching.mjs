import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hostname, cpus } from 'node:os';
import { GameTree } from '../src/game-tree.js';
import { EngineQueue } from '../src/engine.js';
import { positionHistory, evaluatePosition } from '../src/position-analysis.js';
import { buildReport } from '../src/coaching/report.js';
import { estimateTokens, requestBody, requestGroq } from '../src/coaching/groq.js';
import { validateCoaching } from '../src/coaching/validation.js';
import { StockfishWorker } from './lib/stockfish-worker.mjs';
const args=process.argv.slice(2), live=args.includes('--live');
const limit=Number(args.find(a=>a.startsWith('--limit='))?.split('=')[1] || (live?3:240));
if(!Number.isInteger(limit) || limit<1 || limit>300) throw new Error('Use --limit=1..300');
if(live && (!process.env.GROQ_API_KEY || limit>5)) throw new Error('Live pilot requires GROQ_API_KEY and --limit=1..5. No key is printed.');
const games=JSON.parse(await readFile(new URL('../tests/fixtures/review-games.json',import.meta.url),'utf8'));
const fixtures=[];
for(const game of games) {
  const tree=new GameTree(game.pgn);
  for(const node of tree.mainline.slice(1)) {
    fixtures.push({name:game.name,node,split:game.name.includes('Fischer')?'held-out':'development',review:'pending-human-review'});
  }
}
// Additional legal alternatives are evaluation candidates, not labeled gold data.
for(const fixture of [...fixtures]) {
  if(fixtures.length>=240) break;
  const {chessAtNode}=await import('../src/position-analysis.js');
  const before=chessAtNode(fixture.node.parent), move=before.moves({verbose:true}).find(m=>m.san!==fixture.node.move.san);
  if(move) {before.move(move);fixtures.push({...fixture,name:`${fixture.name}: legal alternative`,node:{parent:fixture.node.parent,fen:before.fen(),move}});}
}
const engine=new EngineQueue(()=>new StockfishWorker()), rows=[];
try {
  for(const fixture of fixtures.slice(0,limit)) {
    const started=performance.now(),node=fixture.node;
    const before=await evaluatePosition(node.parent,engine,{moveTime:150});
    const after=await evaluatePosition(node,engine,{moveTime:150});
    const result={beforeFen:node.parent.fen,afterFen:node.fen,san:node.move.san,moveColor:node.move.color,
      key:'good',label:'Unclassified evaluation candidate',beforeWhite:before.whiteScore,afterWhite:after.whiteScore,
      engineEvidence:{before,after},reviewQuality:{verificationComplete:false}};
    const {localText,...report}=buildReport(result);
    const budget = requestBody(report);
    const estimatedTokens = estimateTokens(report);
    const row={name:fixture.name,split:fixture.split,review:fixture.review,history:positionHistory(node.parent),
      move:node.move.san,beforeFen:node.parent.fen,afterFen:node.fen,expected:'Legal continuations and position-consistent claims; strategic cause requires review',
      forbiddenClaims:['Unsupported forced win','Invented material gain'],localMs:performance.now()-started,
      estimatedTokens, estimatedPromptTokens:estimatedTokens-budget.max_completion_tokens,
      completionLimit:budget.max_completion_tokens, reasoningEffort:budget.reasoning_effort, facts:report.facts.length,lineCount:report.supportingLines.length,localText};
    if(live && !localText) {
      const start=performance.now(),response=await requestGroq(report,process.env.GROQ_API_KEY,AbortSignal.timeout(25000));
      row.apiMs=performance.now()-start;row.usage=response.usage;row.error=response.error;row.outcome=response.outcome;
      if (Number.isFinite(response.usage?.prompt_tokens)) row.promptEstimateError = row.estimatedPromptTokens-response.usage.prompt_tokens;
      if(response.error) {rows.push(row);break;}
      try {row.response=validateCoaching(response.result,report);} catch(e){row.error=e.message;}
      if(rows.length<limit-1) await new Promise(resolve=>setTimeout(resolve,60000));
    }
    rows.push(row);
    if(rows.length%20===0) process.stdout.write(`Checked ${rows.length} local positions\n`);
  }
} finally {engine.clear();engine.worker?.terminate();}
const sorted=rows.map(r=>r.localMs).sort((a,b)=>a-b);
const output={generatedAt:new Date().toISOString(),live,hardware:{host:hostname(),cpu:cpus()[0]?.model},
  reviewStatus:'Candidate corpus; human correctness/usefulness scoring has not been performed',
  positions:rows.length,p50LocalMs:sorted[Math.floor(sorted.length*.5)],p95LocalMs:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],rows};
await mkdir('logs/coaching',{recursive:true});
await writeFile(`logs/coaching/${live?'live-pilot':'local-benchmark'}.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify({positions:output.positions,p50LocalMs:output.p50LocalMs,p95LocalMs:output.p95LocalMs,live}));
