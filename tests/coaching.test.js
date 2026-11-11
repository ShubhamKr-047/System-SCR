import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { buildCoachingContext, getProvider, getApiKey, hasApiKey, setProvider, setApiKey, isCoachingEligible, getMoveQuestion, validateCoaching } from "../src/coaching.js";

function result() {
  const chess = new Chess();
  const beforeFen = chess.fen();
  chess.move("e3");
  return { beforeFen, afterFen: chess.fen(), san: "e3", moveColor: "w", from: "e2", to: "e3", playedPiece: "p",
    beforeWhite: 0.3, afterWhite: 0.1, label: "Good", bestSan: "e4", bestUci: "e2e4", punishSan: "d5",
    engineEvidence: { before: { pv: "e2e4 e7e5 g1f3", moveTime: 250 }, after: { pv: "d7d5 d2d4", moveTime: 250 } } };
}

test("coaching context carries positions and replayed evidence without scores or board dumps", () => {
  const input=result(), context=buildCoachingContext(input);
  assert.equal(context.positions.before,input.beforeFen);
  assert.equal(context.played.san,'e3');
  assert.equal(context.maxWords,20);
  assert.ok(!JSON.stringify(context).includes('beforeEvaluation'));
  assert.ok(!JSON.stringify(context).includes('legalMoves'));
  assert.ok(!JSON.stringify(context).includes('moveTime'));
  assert.deepEqual(context.supportingLines,[]);
});

test("illegal engine suffixes do not enter explanation evidence",()=>{
  const input={...result(),key:'mistake'};
  input.engineEvidence.before.pv='e2e4 e7e5 e4e8 g1f3';
  const line=buildCoachingContext(input).supportingLines.find(l=>l.start==='before');
  assert.deepEqual(line.moves.map(m=>m.san),['e4','e5']);
});

test("terminal facts use the exact position",()=>{
  const chess=new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 19');
  const beforeFen=chess.fen();chess.move('Qg7#');
  const input={...result(),beforeFen,afterFen:chess.fen(),san:'Qg7#'};
  assert.ok(buildCoachingContext(input).facts.some(f=>f.id==='mate'));
});

test("coaching rejects verbosity, unknown evidence, numerical commentary and invented moves",()=>{
  const context=buildCoachingContext(result());
  assert.deepEqual(validateCoaching({explanation:'The reason is unclear from this analysis.',claimIds:['played']},context).claimIds,['played']);
  for(const explanation of ['word '.repeat(46),'You lost nine points.','Play Qh8 next.','<img src=x>']) {
    assert.throws(()=>validateCoaching({explanation,claimIds:['played']},context));
  }
  assert.throws(()=>validateCoaching({explanation:'A good move.',claimIds:['invented']},context));
  assert.throws(()=>buildCoachingContext({...result(),afterFen:new Chess().fen()}));
});

test("provider settings preserve legacy Gemini keys and clear only the selected provider", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([["zen-chess-gemini-key", "gemini-test"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  } });
  try {
    assert.equal(getProvider(), "gemini");
    assert.equal(getApiKey(), "gemini-test");
    setProvider("groq");
    assert.equal(hasApiKey(), false);
    setApiKey(" groq-test ");
    assert.equal(getApiKey(), "groq-test");
    assert.equal(getApiKey("gemini"), "gemini-test");
    setApiKey("");
    assert.equal(hasApiKey(), false);
    assert.equal(getProvider(), "groq");
    assert.equal(getApiKey("gemini"), "gemini-test");
    assert.throws(() => setProvider("constructor"), /Unknown AI provider/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});

test("isCoachingEligible excludes book and forced moves, but allows all other tactical/positional moves", () => {
  assert.equal(isCoachingEligible({ key: "book", label: "Book Move" }), false);
  assert.equal(isCoachingEligible({ key: "forced", label: "Forced" }), false);
  assert.equal(isCoachingEligible(null), false);
  assert.equal(isCoachingEligible({}), false);

  assert.equal(isCoachingEligible({ key: "blunder", label: "Blunder" }), true);
  assert.equal(isCoachingEligible({ key: "mistake", label: "Mistake" }), true);
  assert.equal(isCoachingEligible({ key: "inaccuracy", label: "Inaccuracy" }), true);
  assert.equal(isCoachingEligible({ key: "miss", label: "Miss" }), true);
  assert.equal(isCoachingEligible({ key: "brilliant", label: "Brilliant" }), true);
  assert.equal(isCoachingEligible({ key: "great", label: "Great Move" }), true);
  assert.equal(isCoachingEligible({ key: "best", label: "Best Move" }), true);
  assert.equal(isCoachingEligible({ key: "excellent", label: "Excellent" }), true);
  assert.equal(isCoachingEligible({ key: "good", label: "Good" }), true);
});

test("getMoveQuestion generates natural questions for every move classification", () => {
  assert.equal(getMoveQuestion({ key: "blunder", label: "Blunder" }), "Want to know why this move was a blunder?");
  assert.equal(getMoveQuestion({ key: "mistake", label: "Mistake" }), "Want to know why this move was a mistake?");
  assert.equal(getMoveQuestion({ key: "inaccuracy", label: "Inaccuracy" }), "Want to know why this move was an inaccuracy?");
  assert.equal(getMoveQuestion({ key: "miss", label: "Miss" }), "Want to know why this move was a miss?");
  assert.equal(getMoveQuestion({ key: "brilliant", label: "Brilliant" }), "Want to know why this move was brilliant?");
  assert.equal(getMoveQuestion({ key: "great", label: "Great Move" }), "Want to know why this move was a great move?");
  assert.equal(getMoveQuestion({ key: "best", label: "Best Move" }), "Want to know why this move was the best move?");
  assert.equal(getMoveQuestion({ key: "excellent", label: "Excellent" }), "Want to know why this move was an excellent move?");
  assert.equal(getMoveQuestion({ key: "good", label: "Good" }), "Want to know why this move was a good move?");
  assert.equal(getMoveQuestion({ key: "other", label: "Interesting" }), "Want to know why this move was interesting?");
});
import {buildExplanationEvidence,conciseLocalFeedback} from '../src/coaching-evidence.js';
function queenFixture(extra='') {
  const chess=new Chess(`6k1/6b1/8/8/8/8/${extra || '8'}/3Q2K1 w - - 0 1`);
  const beforeFen=chess.fen();const move=chess.move('Qd4');
  return {beforeFen,afterFen:chess.fen(),san:move.san,moveColor:'w',key:'blunder',label:'Blunder',
    engineEvidence:{after:{pv:'g7d4 g1h2 g8f8'}}};
}
test('simple queen loss is concise but a recapture or sacrifice is not called a free queen',()=>{
  const input=queenFixture();
  assert.equal(conciseLocalFeedback(input),'You blundered your queen on d4.');
  assert.equal(buildExplanationEvidence((()=>{const r=queenFixture();const c=new Chess(r.beforeFen);c.put({type:'r',color:'w'},'a4');r.beforeFen=c.fen();c.move('Qd4');r.afterFen=c.fen();return r;})()).localText,null);
  assert.equal(buildExplanationEvidence({...input,isSacrifice:true}).localText,null);
  assert.equal(buildExplanationEvidence({...input,key:'brilliant'}).localText,null);
  input.engineEvidence.after.pv='g7d4';
  assert.equal(buildExplanationEvidence(input).localText,null);
});
test('brilliant evidence includes replayed acceptance but excludes raw scores',()=>{
  const input={...queenFixture(),key:'brilliant',label:'Brilliant',classificationEvidence:{sacrifice:{verified:true,
    acceptances:[{capture:'g7d4',piece:'q',evaluation:{pawns:3},search:{pv:'g1h2 g8f8'}}]}}};
  const context=buildCoachingContext(input);
  assert.equal(context.category,'brilliant-idea');
  assert.equal(context.supportingLines[0].moves[0].san,'Bxd4+');
  assert.ok(context.facts.some(f=>f.id==='compensation-0'));
  assert.ok(!JSON.stringify(context).includes('pawns'));
});
import {generateCoaching} from '../src/coaching.js';
test('simple outcomes need no provider request even if generateCoaching is called directly',async()=>{
  const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>k==='zen-chess-ai-provider'?'groq':k==='zen-chess-groq-key'?'test-key':null}});
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Should not call provider');};
  try {
    const response=await generateCoaching(queenFixture());
    assert.equal(response.explanation,'You blundered your queen on d4.');
    assert.equal(calls,0);
  } finally {
    globalThis.fetch=oldFetch;
    if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
  }
});
test('Black piece losses and ordinary defense use the same factual rules',()=>{
  const chess=new Chess('3q2k1/8/8/8/8/8/6B1/6K1 b - - 0 1');
  const beforeFen=chess.fen(),move=chess.move('Qd5');
  assert.equal(conciseLocalFeedback({beforeFen,afterFen:chess.fen(),san:move.san,moveColor:'b',key:'blunder',engineEvidence:{after:{pv:'g2d5 g8h7 g1f1'}}}),'You blundered your queen on d5.');
  const board=new Chess(),start=board.fen();board.move('Nf3');
  const context=buildCoachingContext({...result(),beforeFen:start,afterFen:board.fen(),san:'Nf3'});
  assert.ok(context.facts.some(f=>f.id==='relation-h2' && f.text.includes('defends')));
});
test('deeper blunder includes the mechanism rather than a generic material claim',()=>{
  const chess=new Chess('6k1/8/8/8/1n6/8/7P/R3Q1K1 w - - 0 1');
  const beforeFen=chess.fen();chess.move('h3');
  const context=buildCoachingContext({beforeFen,afterFen:chess.fen(),san:'h3',moveColor:'w',key:'blunder',engineEvidence:{after:{pv:'b4c2 e1d1 g8f8'}}});
  assert.equal(context.category,'complex-error');
  assert.ok(context.facts.find(f=>f.id==='double-attack').text.includes('queen on e1'));
});
function rookSacrificeFixture(){
  const chess=new Chess('4r3/2q2prk/5Qpp/2p1P3/3p2R1/7R/1PP3PP/6K1 w - - 3 33');
  const beforeFen=chess.fen();chess.move('Rxh6+');
  return {beforeFen,afterFen:chess.fen(),san:'Rxh6+',moveColor:'w',key:'brilliant',label:'Brilliant',
    classificationEvidence:{sacrifice:{verified:true,acceptances:[{capture:'h7h6',piece:'r',search:{pv:'g4h4'}}]}}};
}
const reportedGroqContent={claimIds:['played','relation-h7','compensation-0','acceptance-0'],
  explanation:'Rxh6+ checks the king (played) and, if Kxh6, the forced mate Rh4# follows (acceptance-0), while the rook on h6 also attacks the king (relation-h7) and pawn g6, providing compensation (compensation-0).'};
test('reported Groq response accepts complete SAN checks and mates and removes inline IDs',()=>{
  const context=buildCoachingContext(rookSacrificeFixture());
  const response=validateCoaching(reportedGroqContent,context);
  assert.ok(response.explanation.includes('Rxh6+'));
  assert.ok(response.explanation.includes('Rh4#'));
  assert.ok(!response.explanation.includes('(played)'));
  assert.ok(!response.explanation.includes('(acceptance-0)'));
  assert.ok(context.facts.some(f=>f.id==='payoff-0' && f.text.includes('conditional')));
  assert.throws(()=>validateCoaching({claimIds:['acceptance-0'],explanation:'Rh4+ follows.'},context));
  assert.throws(()=>validateCoaching({claimIds:['acceptance-0'],explanation:'Qh8# follows.'},context));
});
test('SAN validation preserves castling and underpromotion suffixes',()=>{
  const context={facts:[{id:'line'}],supportingLines:[{moves:[{san:'O-O+'},{san:'exd8=N#'}]}],played:{san:'a8=Q+'},maxWords:45};
  assert.doesNotThrow(()=>validateCoaching({claimIds:['line'],explanation:'After O-O+, exd8=N# ends the game.'},context));
  assert.doesNotThrow(()=>validateCoaching({claimIds:['line'],explanation:'a8=Q+ gives check.'},context));
  assert.throws(()=>validateCoaching({claimIds:['line'],explanation:'After O-O#, exd8=N# ends the game.'},context));
});
test('Groq adapter accepts the reported response without using a live key',async()=>{
  const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>k==='zen-chess-ai-provider'?'groq':k==='zen-chess-groq-key'?'test-san-regression':null}});
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reportedGroqContent)},finish_reason:'stop'}]}));};
  try {
    const response=await generateCoaching(rookSacrificeFixture());
    assert.ok(response?.explanation.includes('Rh4#'));
    assert.equal(calls,1);
  } finally {
    globalThis.fetch=oldFetch;
    if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;
  }
});
