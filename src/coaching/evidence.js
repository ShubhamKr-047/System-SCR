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

// Geometry is computed locally; a model must never infer it from SAN or a label.
function rookPressure(chess, color) {
  const rooks = chess.board().flat().filter(p => p?.color === color && p.type === 'r');
  for (const front of rooks) for (const back of rooks) {
    if (front.square === back.square || front.square[0] !== back.square[0] ||
        !chess.attackers(front.square, color).includes(back.square)) continue;
    const target = chess.board().flat().find(p => p && p.color !== color &&
      p.square[0] === front.square[0] && chess.attackers(p.square, color).includes(front.square));
    if (target) return `${color === 'w' ? 'White' : 'Black'} has doubled rooks on the ${front.square[0]}-file, with the front rook attacking the ${names[target.type]} on ${target.square}`;
  }
  return null;
}

function moveOn(chess, move) {
  return chess.move({from:move.from,to:move.to,promotion:move.promotion});
}

export function buildExplanationEvidence(result, fen) {
  const beforeFen = fen || result.beforeFen;
  const restored={};
  for (const [phase, expected] of [['before',beforeFen],['after',result.afterFen]]) {
    const root = result.engineEvidence?.[phase]?.provenance?.root;
    if (!root) continue;
    const history = JSON.parse(root), position = new Chess(history.fen);
    for (const uci of history.moves) position.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
    if (position.fen() !== expected) throw new Error('Stale coaching evidence');
    restored[phase]=position;
  }
  const before = restored.before || new Chess(beforeFen), after = new Chess(result.afterFen);
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
  const playedPressure = rookPressure(new Chess(result.afterFen), played.color);
  const reply = replayLine(result.afterFen, result.engineEvidence?.after?.pv);
  if (after.isCheckmate()) {
    facts.push({id:'mate',text:'The played move delivers checkmate.'});
    localText = 'The move delivers checkmate.';
  } else if (after.isStalemate()) {
    facts.push({id:'stalemate',text:'The played move leaves a stalemate.'});
    localText = 'This move ends the game in stalemate.';
  } else if ((restored.after || before).isThreefoldRepetition()) {
    localText='The recorded history reaches threefold repetition; a draw can be claimed.';
    facts.push({id:'repetition',text:localText});
  } else if (after.isInsufficientMaterial()) {
    localText='The position has insufficient material for checkmate.';
    facts.push({id:'insufficient-material',text:localText});
  } else if (after.isDrawByFiftyMoves()) {
    localText='The position qualifies for a fifty-move draw claim.';
    facts.push({id:'fifty-move',text:localText});
  }
  if (!localText && ['blunder','mistake','miss','inaccuracy'].includes(result.key)) {
    category = 'complex-error';
    if (reply.length) {
      supportingLines.push({id:'reply-line',start:'after',moves:reply});
      facts.push({id:'reply',text:`The engine's best-reply line starts with ${reply[0].san}${reply[0].captured ? `, capturing the ${reply[0].captured} on ${reply[0].to}` : ''}.`});
      const next = after.move({from:reply[0].from,to:reply[0].to,promotion:reply[0].promotion});
      const targets = after.board().flat().filter(p=>p && p.color === played.color &&
        ['q','r','k'].includes(p.type) && after.attackers(p.square,next.color).includes(next.to));
      if(targets.length >= 2) facts.push({id:'double-attack',text:`After ${next.san}, the ${names[next.piece]} on ${next.to} simultaneously attacks ${targets.map(p=>`the ${names[p.type]} on ${p.square}`).join(' and ')}. This alone does not prove either piece must be lost.`});
      if (played.captured && next.captured === played.piece && next.to === played.to &&
          values[played.captured] === values[next.captured] && !played.promotion && !next.promotion) {
        facts.push({id:'equal-exchange',text:`${played.san} ${next.san} exchanges a ${names[played.captured]} for a ${names[next.captured]}, leaving the material balance unchanged`});
      }
      const pressure = rookPressure(after, next.color);
      if (pressure && pressure !== rookPressure(original, next.color)) facts.push({id:'rook-pressure',text:`After ${played.san} ${next.san}, ${pressure}`});
      const canRecapture = after.moves({verbose:true}).some(m => m.captured && m.to === next.to);
      const originalSquare = next.to === played.to ? played.from : next.to;
      // Conservative local shortcut: a high-value piece lost immediately, with no
      // capture in return, promotion, legal recapture or established sacrifice.
      if (reply.length >= 3 && !reply.slice(1).some(m=>m.captured || m.checkmate) && result.key === 'blunder' && next.captured && values[next.captured] >= 3 && !played.captured &&
          !played.promotion && !next.promotion && !canRecapture && !original.isAttacked(originalSquare,next.color) && !result.isSacrifice && !localText) {
        category = 'simple-loss';
        localText = `The move loses the ${names[next.captured]} on ${next.to}.`;
        facts.push({id:'piece-loss',text:localText});
      }
      if (next.san.endsWith('#')) {
        localText = `This allows checkmate with ${next.san}.`;
        facts.push({id:'allows-mate',text:localText});
      }
    }
    const alternative = replayLine(beforeFen, result.engineEvidence?.before?.pv || result.bestUci);
    if (alternative.length) {
      supportingLines.push({id:'alternative-line',start:'before',moves:alternative});
      const alternativeBoard = new Chess(beforeFen);
      const alt = moveOn(alternativeBoard, alternative[0]);
      const pressure = rookPressure(alternativeBoard, played.color);
      if (alt.san !== played.san && pressure && pressure !== playedPressure) {
        const earlierPressure = facts.findIndex(f=>f.id === 'rook-pressure');
        if (earlierPressure >= 0) facts.splice(earlierPressure, 1);
        facts.push({id:'rook-pressure',text:`The engine prefers ${alt.san} over ${played.san}: after ${alt.san}, ${pressure}`});
        if (alt.captured && alt.captured === played.captured && alt.to === played.to && alt.piece === played.piece) {
          facts.push({id:'capture-comparison',text:`Both moves capture the same ${names[alt.captured]}; the difference is piece placement, not the captured material`});
        }
      }
    }
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
  const context = {positions:{before:beforeFen,after:result.afterFen},played:{san:played.san,side:played.color,piece:names[played.piece],from:played.from,to:played.to},
    classification:result.label,category,facts,supportingLines,limitations:[limitation],maxWords:category === 'ordinary' || category === 'simple-loss' ? 20 : 45,
    localText};

  for (const [id, start, pv] of [['alternative-line', 'before', result.engineEvidence?.before?.pv || result.bestUci],
    ['reply-line', 'after', result.engineEvidence?.after?.pv]]) {
    if (!supportingLines.some(line => line.id === id)) {
      const moves = replayLine(start === 'before' ? beforeFen : result.afterFen, pv);
      if (moves.length) supportingLines.push({id, start, moves});
    }
  }
  context.facts = facts.map(f => ({...f, type: f.id, certainty: f.id.startsWith('compensation') || f.id === 'critical-comparison' ? 'engine-supported' : 'direct', origin:'local', scope:'selected-move'}));
  return context;
}
