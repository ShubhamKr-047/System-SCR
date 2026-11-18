import { Chess } from 'chess.js';
import { buildExplanationEvidence, replayLine } from './evidence.js';
import { boardFeatures, material, pieceMap } from './features.js';
import { compareSearches } from './comparisons.js';
export const REPORT_VERSION = 1;
export function buildReport(result, fen, level = 'intermediate') {
  const {localText, maxWords, ...report} = buildExplanationEvidence(result, fen);
  report.version = REPORT_VERSION;
  report.level = level;
  if(result.key==='forced' && new Chess(report.positions.before).moves().length===1) {report.category='forced';report.facts.push({id:'forced',type:'forced',text:'The reviewed position had only one legal move.',certainty:'direct',origin:'legal-moves'});}
  if(result.key==='book') report.facts.push({id:'opening',type:'opening',text:'The local opening index recognizes this move; its purpose must still be established from the position.',certainty:'engine-supported',origin:'opening-index'});
  report.pieces = {before:pieceMap(report.positions.before), after:pieceMap(report.positions.after)};
  report.evaluation = {perspective:'White', before:result.beforeWhite ?? null, after:result.afterWhite ?? null,
    beforeScoreType:result.engineEvidence?.before?.scoreType || 'unknown',afterScoreType:result.engineEvidence?.after?.scoreType || 'unknown',
    verificationComplete:result.reviewQuality?.verificationComplete !== false};
  const beforeFeatures = boardFeatures(report.positions.before,result.moveColor);
  const afterFeatures = boardFeatures(report.positions.after,result.moveColor);
  const beforeFacts = new Map(beforeFeatures.map(f=>[f.id,f.text]));
  report.facts.push(...afterFeatures.filter(f=>beforeFacts.get(f.id)!==f.text).slice(0,8));
  const beforeBoard=new Chess(report.positions.before),afterBoard=new Chess(report.positions.after);
  const startingRank=result.moveColor==='w'?'1':'8';
  if(['knight','bishop'].includes(report.played.piece) && report.played.from[1]===startingRank && report.played.to[1]!==startingRank)
    report.facts.push({id:'development',type:'development',text:`${report.played.san} brings the ${report.played.piece} off the back rank. Whether it improves the position depends on its new activity and the reply.`,certainty:'direct',origin:'board-comparison',scope:'selected-move'});
  if(report.played.san.startsWith('O-O')) report.facts.push({id:'castling',type:'castling',text:'Castling moves the king and rook together. The position must establish whether the new king position is safer.',certainty:'direct',origin:'legal-move',scope:'selected-move'});
  for(const target of afterBoard.board().flat().filter(p=>p && p.color!==result.moveColor)) {
    for(const square of afterBoard.attackers(target.square,result.moveColor)) {
      const attacker=afterBoard.get(square),old=beforeBoard.get(square);
      if(square===report.played.to || !old || old.color!==result.moveColor || old.type!==attacker.type ||
        beforeBoard.attackers(target.square,result.moveColor).includes(square)) continue;
      report.facts.push({id:`opened-${square}-${target.square}`,type:'discovered_attack',text:`Moving ${report.played.san} opens a geometric attack from ${square} on the ${{p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'}[target.type]} on ${target.square}. Legal defenses still determine the payoff.`,certainty:'direct',origin:'board-comparison',scope:'selected-move'});
    }
  }
  report.comparisons = [];
  for(const [i,candidate] of (result.engineEvidence?.before?.candidates || []).slice(0,2).entries()) {
    if(candidate.pv && candidate.pv !== result.engineEvidence?.before?.pv) {
      const moves=replayLine(report.positions.before,candidate.pv);
      if(moves.length) report.supportingLines.push({id:`candidate-${i}`,start:'before',moves});
    }
  }
  const playedLine=result.engineEvidence?.played?.pv;
  if(playedLine) {
    const moves=replayLine(report.positions.before,playedLine);
    if(moves[0]?.san===report.played.san) report.supportingLines.push({id:'played-line',start:'before',moves});
  }
  for (const line of report.supportingLines) {
    const start = report.positions[line.start], chess = new Chess(start);
    const baseline = material(report.positions.before,result.moveColor);
    for(const move of line.moves) chess.move({from:move.from,to:move.to,promotion:move.promotion});
    const delta = material(chess.fen(),result.moveColor)-baseline;
    const id = `material-${line.id}`;
    report.facts.push({id,type:'material_change',text:`Relative to before the played move, the supplied ${line.id} continuation changes material balance by ${delta} pawn units for ${result.moveColor === 'w' ? 'White' : 'Black'}. This is a line outcome, not proof all defenses have that outcome.`,
      delta, lineId:line.id, certainty:'direct',origin:'legal-replay',scope:line.id});
    report.comparisons.push({lineId:line.id,materialDelta:delta,finalFen:chess.fen()});
  }
  report.limitations.push('A classification is context, not proof of a causal explanation. Geometric attacks are not necessarily legal captures. Explain uncertainty instead of inventing a plan.');
  compareSearches(result,report);
  return {...report, localText};
}
