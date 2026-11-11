import { Chess } from 'chess.js';

const names = {p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
const values = {p:1,n:3,b:3,r:5,q:9,k:0};
export function replayLine(fen, pv) {
  const chess = new Chess(fen), moves = [];
  for (const uci of (pv || '').trim().split(/\s+/).slice(0, 12)) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break;
    try {
      const move = chess.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
      moves.push({san:move.san,from:move.from,to:move.to,piece:names[move.piece],
        promotion:move.promotion,captured:names[move.captured] || null,checkmate:chess.isCheckmate()});
    } catch { break; }
  }
  return moves;
}

export function buildExplanationEvidence(result, fen) {
  const beforeFen = fen || result.beforeFen;
  for (const [phase, expected] of [['before',beforeFen],['after',result.afterFen]]) {
    const root = result.engineEvidence?.[phase]?.provenance?.root;
    if (!root) continue;
    const history = JSON.parse(root), position = new Chess(history.fen);
    for (const uci of history.moves) position.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
    if (position.fen() !== expected) throw new Error('Stale coaching evidence');
  }
  const before = new Chess(beforeFen), after = new Chess(result.afterFen);
  const played = before.move(result.playedUci
    ? {from:result.playedUci.slice(0,2),to:result.playedUci.slice(2,4),promotion:result.playedUci[4]}
    : result.san);
  if (before.fen() !== after.fen() || played.color !== result.moveColor) throw new Error('Incompatible coaching position');
  const facts = [{id:'played',text:`${played.color === 'w' ? 'White' : 'Black'} played ${played.san}, moving the ${names[played.piece]} from ${played.from} to ${played.to}${played.captured ? ` and capturing a ${names[played.captured]}` : ''}.`}];
  const original = new Chess(beforeFen);
  for (const row of after.board()) for (const piece of row) {
    if (!piece || piece.square === played.to) continue;
    if (after.attackers(piece.square, played.color).includes(played.to) &&
        !original.attackers(piece.square, played.color).includes(played.from)) {
      facts.push({id:`relation-${piece.square}`,text:`The ${names[played.piece]} on ${played.to} now ${piece.color === played.color ? 'defends' : 'attacks'} the ${names[piece.type]} on ${piece.square}. This is a board relationship, not proof of a forced win.`});
    }
  }
  let localText = null, category = 'ordinary';
  const limitation = 'Engine continuations are examples of best play, not proof that every alternative is forced. No positional purpose is established unless explicitly listed.';
  const supportingLines = [];
  const reply = replayLine(result.afterFen, result.engineEvidence?.after?.pv);
  if (after.isCheckmate()) {
    facts.push({id:'mate',text:'The played move delivers checkmate.'});
    localText = 'You delivered checkmate.';
  } else if (after.isStalemate()) {
    facts.push({id:'stalemate',text:'The played move leaves a stalemate.'});
    localText = 'This move ends the game in stalemate.';
  }
  if (['blunder','mistake','miss','inaccuracy'].includes(result.key)) {
    category = 'complex-error';
    if (reply.length) {
      supportingLines.push({id:'reply-line',start:'after',moves:reply});
      facts.push({id:'reply',text:`The engine's best-reply line starts with ${reply[0].san}${reply[0].captured ? `, capturing the ${reply[0].captured} on ${reply[0].to}` : ''}.`});
      const next = after.move({from:reply[0].from,to:reply[0].to,promotion:reply[0].promotion});
      const targets = after.board().flat().filter(p=>p && p.color === played.color &&
        ['q','r','k'].includes(p.type) && after.attackers(p.square,next.color).includes(next.to));
      if(targets.length >= 2) facts.push({id:'double-attack',text:`After ${next.san}, the ${names[next.piece]} on ${next.to} simultaneously attacks ${targets.map(p=>`the ${names[p.type]} on ${p.square}`).join(' and ')}. This alone does not prove either piece must be lost.`});
      const canRecapture = after.moves({verbose:true}).some(m => m.captured && m.to === next.to);
      const originalSquare = next.to === played.to ? played.from : next.to;
      // Conservative local shortcut: a high-value piece lost immediately, with no
      // capture in return, promotion, legal recapture or established sacrifice.
      if (reply.length >= 3 && !reply.slice(1).some(m=>m.captured || m.checkmate) && result.key === 'blunder' && next.captured && values[next.captured] >= 3 && !played.captured &&
          !played.promotion && !next.promotion && !canRecapture && !original.isAttacked(originalSquare,next.color) && !result.isSacrifice && !localText) {
        category = 'simple-loss';
        localText = `You blundered your ${names[next.captured]} on ${next.to}.`;
        facts.push({id:'piece-loss',text:localText});
      }
      if (next.san.endsWith('#')) {
        localText = `This allows checkmate with ${next.san}.`;
        facts.push({id:'allows-mate',text:localText});
      }
    }
    const alternative = replayLine(beforeFen, result.engineEvidence?.before?.pv || result.bestUci);
    if (alternative.length) supportingLines.push({id:'alternative-line',start:'before',moves:alternative});
  }
  const sacrifice = result.classificationEvidence?.sacrifice;
  if (result.key === 'great' && result.classificationEvidence?.confirmed) {
    category = 'critical-idea';
    facts.push({id:'critical-comparison',text:'Verified engine comparison found that the strongest alternative substantially worsens the outcome. This does not establish that every alternative loses.'});
    for (const [i,candidate] of (result.classificationEvidence.alternatives || []).slice(0,2).entries()) {
      const line = replayLine(beforeFen,candidate.pv);
      if(line.length) supportingLines.push({id:`comparison-${i}`,start:'before',moves:line});
    }
  }
  if (result.key === 'brilliant' && sacrifice?.verified) {
    category = 'brilliant-idea';
    for (const [i, acceptance] of (sacrifice.acceptances || []).slice(0,2).entries()) {
      const line = replayLine(result.afterFen, `${acceptance.capture} ${acceptance.search?.pv || ''}`);
      if (line.length < 2) continue;
      supportingLines.push({id:`acceptance-${i}`,start:'after',moves:line});
      if (line.at(-1).checkmate && line.length % 2 === 0) {
        facts.push({id:`payoff-${i}`,text:`If the opponent accepts with ${line[0].san}, the supplied continuation ends in ${line.at(-1).san}, checkmate by the sacrificing side. This claim is conditional on that acceptance, not a proof that all defenses lose.`});
      }
      facts.push({id:`compensation-${i}`,text:`Engine verification supports compensation after ${line[0].san} accepts the offered ${names[acceptance.piece] || 'piece'}. The line illustrates the continuation; do not invent the type of compensation.`});
    }
    if (sacrifice.mateProof?.proven) facts.push({id:'mate-proof',text:'A local legal search proved a forced mating continuation after the sacrifice.'});
  }
  if (result.reviewQuality?.verificationComplete === false) facts.push({id:'incomplete',text:'Additional verification is incomplete; avoid claims of forced wins or unique moves.'});
  return {positions:{before:beforeFen,after:result.afterFen},played:{san:played.san,side:played.color,piece:names[played.piece],from:played.from,to:played.to},
    classification:result.label,category,facts,supportingLines,limitations:[limitation],maxWords:category === 'ordinary' || category === 'simple-loss' ? 20 : 45,
    localText};
}

export function conciseLocalFeedback(result) {
  try {
    const evidence = buildExplanationEvidence(result);
    if (evidence.localText) return evidence.localText;
    if (result.key === 'forced') return 'This was the only legal move.';
    if (result.key === 'book') return 'This move follows a known opening line.';
    const payoff = evidence.facts.find(f=>f.id.startsWith('payoff-'));
    if (payoff) {
      const line = evidence.supportingLines.find(l=>l.id === payoff.id.replace('payoff-','acceptance-'));
      return `You sacrifice the ${evidence.played.piece}: if ${line.moves[0].san}, ${line.moves.at(-1).san} delivers checkmate in the supplied line.`;
    }
    const relationship = evidence.facts.find(f=>f.id.startsWith('relation-'));
    if (evidence.category === 'ordinary' && relationship) return relationship.text.split('. ')[0] + '.';
    return 'The engine assessed this move, but a specific reason has not been established by the available evidence.';
  } catch { return 'There is not enough verified evidence to explain this move.'; }
}
