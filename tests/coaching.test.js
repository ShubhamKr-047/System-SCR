import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {buildCoachingContext,isCoachingEligible,getProvider,setProvider,getMoveQuestion} from '../src/coaching.js';
import {buildExplanationEvidence,replayLine} from '../src/coaching/evidence.js';
import {conciseLocalFeedback} from '../src/coaching/local-feedback.js';
import {validateCoaching} from '../src/coaching/validation.js';
import {requestGroq,estimateTokens,compactReport,requestBody} from '../src/coaching/groq.js';
import {boardFeatures,material} from '../src/coaching/features.js';
import {coachingIdentity} from '../src/coaching/identity.js';
import { readFile } from 'node:fs/promises';
import {result,queenFixture,rookSacrificeFixture,reportedPosition} from './coaching-fixtures.js';
function prose(text,ids=['played'],extra={}){return {summary:{text,evidenceIds:ids},comparison:null,claims:[],...extra};}

test('report carries readable positions and explicit score perspective, never sentence options',()=>{
 const context=buildCoachingContext(result());
 assert.equal(context.played.san,'e3');assert.ok(context.pieces.before.includes('w:k:e1'));
 assert.equal(context.evaluation.perspective,'White');assert.ok(!('explanationOptions' in context));
 assert.ok(!JSON.stringify(context).includes('moveTime'));
 assert.ok(context.supportingLines.some(l=>l.id==='alternative-line'));
});
test('illegal engine suffixes stop at the last legal move',()=>{
 assert.deepEqual(replayLine(new Chess().fen(),'e2e4 e7e5 e4e8 g1f3').map(m=>m.san),['e4','e5']);
});
test('mismatched endpoints and stale provenance reject coaching',()=>{
 assert.throws(()=>buildCoachingContext({...result(),afterFen:new Chess().fen()}));
 assert.throws(()=>buildCoachingContext({...result(),engineEvidence:{before:{provenance:{root:JSON.stringify({fen:new Chess().fen(),moves:['d2d4']})}}}}));
});
test('fresh natural paraphrases are accepted, unsupported moves/IDs/HTML are rejected',()=>{
 const c=buildCoachingContext(result());
 assert.equal(validateCoaching(prose('White plays e3, moving the pawn from e2 to e3.'),c).explanation,'White plays e3, moving the pawn from e2 to e3.');
 for(const text of ['Play Qh8# next.','<img src=x>','word '.repeat(230),'This forces a forced mate.']) assert.throws(()=>validateCoaching(prose(text),c));
 assert.throws(()=>validateCoaching(prose('White played e3.',['unknown']),c));
 assert.throws(()=>validateCoaching({...prose('White played e3.'),extra:true},c));
});
test('all reviewed move types are eligible and Groq is the sole provider',()=>{
 for(const key of ['book','forced','best','excellent','good','inaccuracy','mistake','miss','blunder','great','brilliant']) assert.equal(isCoachingEligible({key}),true);
 assert.equal(getProvider(),'groq');assert.throws(()=>setProvider('gemini'));assert.equal(isCoachingEligible(null),false);
 assert.match(getMoveQuestion({san:'e4'}),/e4/);
});
test('terminal states use the exact board and local explanations',()=>{
 const ch=new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 19'),beforeFen=ch.fen();ch.move('Qg7#');
 const e=buildExplanationEvidence({...result(),beforeFen,afterFen:ch.fen(),san:'Qg7#'});
 assert.equal(e.localText,'The move delivers checkmate.');
});
test('simple piece losses exclude recaptures, sacrifices, and short evidence',()=>{
 const r=queenFixture();assert.equal(conciseLocalFeedback(r),'The move loses the queen on d4.');
 assert.equal(buildExplanationEvidence({...r,isSacrifice:true}).localText,null);
 const b=new Chess(r.beforeFen);b.put({type:'r',color:'w'},'a4');const beforeFen=b.fen();b.move('Qd4');
 assert.equal(buildExplanationEvidence({...r,beforeFen,afterFen:b.fen()}).localText,null);
 assert.equal(buildExplanationEvidence({...r,engineEvidence:{after:{pv:'g7d4'}}}).localText,null);
});
test('Black losses use the same rules and ordinary defense remains a board fact',()=>{
 const b=new Chess('3q2k1/8/8/8/8/8/6B1/6K1 b - - 0 1'),beforeFen=b.fen();b.move('Qd5');
 assert.equal(conciseLocalFeedback({beforeFen,afterFen:b.fen(),san:'Qd5',moveColor:'b',key:'blunder',engineEvidence:{after:{pv:'g2d5 g8h7 g1f1'}}}),'The move loses the queen on d5.');
 const c=new Chess(),start=c.fen();c.move('Nf3');
 assert.ok(buildCoachingContext({...result(),beforeFen:start,afterFen:c.fen(),san:'Nf3'}).facts.some(f=>f.id==='relation-h2'));
});
test('conditional sacrifice mate is accepted; invented forced mate is rejected',()=>{
 const c=buildCoachingContext(rookSacrificeFixture());
 const good=prose('After Rxh6+, if Kxh6, Rh4# delivers checkmate in the supplied continuation.',['payoff-0','acceptance-0'],{claims:[{kind:'conditional_mate',evidenceId:'payoff-0',lineId:'acceptance-0'}]});
 assert.match(validateCoaching(good,c).explanation,/Rh4#/);
 assert.throws(()=>validateCoaching(prose('Rxh6+ forces a forced mate with Rh4#.',['payoff-0']),c));
 assert.throws(()=>validateCoaching({...good,claims:[{kind:'forced_mate',evidenceId:'payoff-0',lineId:'acceptance-0'}]},c));
});
test('Nxb3 equal exchange does not become a material win',()=>{
 const c=buildCoachingContext(reportedPosition());
 assert.match(c.facts.find(f=>f.id==='equal-exchange').text,/unchanged/);
 assert.match(c.facts.find(f=>f.id==='rook-pressure').text,/b-file/);
 assert.throws(()=>validateCoaching(prose('White wins material by capturing the knight.',['equal-exchange']),c));
});
test('opponent material gains use the correct side and the entire exchange baseline',()=>{
 const c=buildCoachingContext(queenFixture());
 assert.equal(c.comparisons.find(l=>l.lineId==='reply-line').materialDelta,-9);
 assert.match(validateCoaching(prose('Black wins a queen in the supplied continuation.',['reply-line']),c).explanation,/Black/);
 assert.throws(()=>validateCoaching(prose('White wins a queen in the supplied continuation.',['reply-line']),c));
});
test('Rbxb3 comparison distinguishes placement from captured material',()=>{
 const c=buildCoachingContext(reportedPosition(true));
 assert.match(c.facts.find(f=>f.id==='capture-comparison').text,/same knight/);
 assert.match(conciseLocalFeedback(reportedPosition(true)),/prefers Raxb3 over Rbxb3/);
 assert.throws(()=>validateCoaching(prose('The knight forks the queen and bishop.',['invented-fork']),c));
});
test('missing reply evidence remains explicit',()=>{
 assert.match(conciseLocalFeedback({...reportedPosition(true),engineEvidence:{}}),/No verified reply line/);
});
test('material tracing counts equal exchanges and promotions from legal replay',()=>{
 const c=buildCoachingContext(reportedPosition());assert.equal(c.comparisons.find(l=>l.lineId==='reply-line').materialDelta,0);
 const fen='7k/P7/8/8/8/8/8/7K w - - 0 1',b=new Chess(fen);b.move('a8=Q+');
 assert.equal(material(b.fen(),'w')-material(fen,'w'),8);
});
test('positional features are facts with limitations',()=>{
 const f=boardFeatures('7k/8/8/4P3/8/8/8/R6K w - - 0 1','w');
 assert.ok(f.some(f=>f.type==='passed'));assert.ok(f.some(f=>f.type==='file'));
});
test('adapter is single attempt, supports paraphrases, preserves 429 metadata',async()=>{
 const fetch=globalThis.fetch;let calls=0;
 try {
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(prose('White played e3.'))},finish_reason:'stop'}],usage:{total_tokens:100}}));};
 const report=buildCoachingContext(result()),response=await requestGroq(report,'fixture',new AbortController().signal);
 assert.equal(validateCoaching(response.result,report).explanation,'White played e3.');assert.equal(calls,1);
 globalThis.fetch=async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'2'}});};
 assert.equal((await requestGroq(report,'fixture',new AbortController().signal)).retryAfterMs,2000);assert.equal(calls,2);
 assert.ok(estimateTokens(report)>requestBody(report).max_completion_tokens);
 } finally {globalThis.fetch=fetch;}
});

test('cache identity preserves evidence/history but ignores elapsed search metadata',()=>{
 const r=result(),a=coachingIdentity({result:r,level:'beginner'});
 r.engineEvidence.before.moveTime=999;
 assert.equal(coachingIdentity({result:r,level:'beginner'}),a);
 r.engineEvidence.before.provenance={root:'history-a'};
 const b=coachingIdentity({result:r,level:'beginner'});assert.notEqual(a,b);
 r.engineEvidence.before.provenance.root='history-b';assert.notEqual(b,coachingIdentity({result:r,level:'beginner'}));
 assert.notEqual(coachingIdentity({result:r,level:'beginner'}),coachingIdentity({result:r,level:'advanced'}));
});
test('240 evaluation candidates reconstruct exact history and legal endpoints',async()=>{
 const rows=JSON.parse(await readFile(new URL('./fixtures/coaching-corpus.json',import.meta.url),'utf8'));
 assert.ok(rows.length>=200 && rows.length<=300);
 for(const row of rows) {
  const board=new Chess(row.history.fen);
  for(const uci of row.history.moves) board.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
  assert.equal(board.fen(),row.beforeFen,row.id);
  const move=board.move(row.move);assert.equal(board.fen(),row.afterFen,row.id);
  const c=buildCoachingContext({beforeFen:row.beforeFen,afterFen:row.afterFen,san:row.move,moveColor:move.color,key:'good',label:'Evaluation candidate'});
  assert.equal(c.played.san,row.move);assert.ok(Object.hasOwn(row,'review'));
 }
});
test('repetition explanations use verified history rather than FEN alone',()=>{
 const board=new Chess(),start=board.fen(),uci=[];
 for(const san of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1']) {const m=board.move(san);uci.push(m.from+m.to);}
 const beforeFen=board.fen(),beforeRoot=JSON.stringify({fen:start,moves:[...uci]});
 const move=board.move('Ng8');uci.push(move.from+move.to);
 const r={beforeFen,afterFen:board.fen(),san:move.san,moveColor:'b',key:'good',engineEvidence:{before:{provenance:{root:beforeRoot}},after:{provenance:{root:JSON.stringify({fen:start,moves:uci})}}}};
 assert.match(conciseLocalFeedback(r),/threefold repetition/);
 assert.ok(!conciseLocalFeedback({...r,engineEvidence:{}}).includes('threefold repetition'));
});


test('compact requests preserve evidence, line roles and outcomes without mutating the local report',()=>{
 for(const fixture of [result(),queenFixture(),rookSacrificeFixture(),reportedPosition(true)]) {
  const report=buildCoachingContext(fixture), original=JSON.stringify(report);
  // An identical sequence may have a different role; never merge distinct roots.
  const first=report.supportingLines[0];
  report.supportingLines.push({...first,id:'duplicate-role'});
  report.supportingLines.push({...first,id:'different-root',start:first.start==='before'?'after':'before'});
  const wire=compactReport(report), byId=new Map(wire.supportingLines.map(l=>[l.id,l]));
  assert.equal(byId.get('duplicate-role').movesRef,first.id);
  assert.ok(!byId.get('different-root').movesRef);
  for(const line of report.supportingLines) {
   const sent=byId.get(line.id), moves=sent.moves || byId.get(sent.movesRef).moves;
   assert.equal(sent.start,line.start);
   assert.deepEqual(moves.map(m=>[m.san,m.captured||null,!!m.checkmate]),line.moves.map(m=>[m.san,m.captured||null,!!m.checkmate]));
  }
  assert.deepEqual(wire.facts.map(f=>f.id),report.facts.map(f=>f.id));
  for(const fact of wire.facts) {
   const local=report.facts.find(f=>f.id===fact.id);
   assert.equal(fact.certainty,local.certainty);assert.equal(fact.delta,local.delta);assert.equal(fact.lineId,local.lineId);
   assert.ok(!Object.hasOwn(fact,'origin'));
  }
  for(const key of ['pieces','comparisons','positionDifferences','version','localText']) assert.ok(!Object.hasOwn(wire,key));
  report.supportingLines.splice(-2);
  assert.equal(JSON.stringify(report),original);
  assert.ok(JSON.stringify(wire).length<original.length);
 }
});

test('compact requests preserve every corpus fact and reduce serialized report size',async()=>{
 const rows=JSON.parse(await readFile(new URL('./fixtures/coaching-corpus.json',import.meta.url),'utf8'));
 let oldBytes=0,newBytes=0;
 for(const row of rows) {
  const b=new Chess(row.beforeFen),m=b.move(row.move);
  const report=buildCoachingContext({beforeFen:row.beforeFen,afterFen:row.afterFen,san:row.move,moveColor:m.color,key:'good',label:'Evaluation candidate'});
  const old={...report,supportingLines:report.supportingLines.map(l=>({...l,moves:l.moves.map(({san,captured,checkmate})=>({san,captured,checkmate}))})),comparisons:report.comparisons.map(({lineId,materialDelta})=>({lineId,materialDelta})),facts:report.facts.map(f=>({...f,scope:f.scope===report.positions.after?'after':f.scope===report.positions.before?'before':f.scope}))};
  const wire=compactReport(report);
  assert.deepEqual(wire.facts.map(f=>f.id),report.facts.map(f=>f.id));
  assert.deepEqual(wire.positions,report.positions);
  assert.deepEqual(wire.evaluation,report.evaluation);
  oldBytes+=Buffer.byteLength(JSON.stringify(old));newBytes+=Buffer.byteLength(JSON.stringify(wire));
  assert.deepEqual(JSON.parse(requestBody(report).messages[1].content),wire);
 }
 console.log(`Corpus report bytes: ${oldBytes} -> ${newBytes} (${(100*(1-newBytes/oldBytes)).toFixed(1)}% smaller; excludes shared instructions/schema).`);
 assert.ok(newBytes<oldBytes);
});
