import { evaluatePosition, positionHistory } from '../position-analysis.js';
export async function prepareAnalysis(result, node, engine, signal) {
  if (!node?.parent || !engine) return result;
  const check = () => { if(signal.aborted) throw new DOMException('Cancelled','AbortError'); };
  check();
  // Reuse compatible reviewed evidence. Searches are required only for missing
  // continuations, and run at the selected node without changing its review label.
  const next = {...result,engineEvidence:{...result.engineEvidence}};
  let remaining = 1800;
  for(const [phase,root] of [['before',node.parent],['after',node]]) {
    const old = next.engineEvidence[phase];
    const identity = JSON.stringify(positionHistory(root));
    if(old?.pv && old.provenance?.root === identity) continue;
    check();
    const started = performance.now();
    next.engineEvidence[phase] = await evaluatePosition(root,engine,{moveTime:Math.min(600,remaining),priority:2,signal,retry:false});
    remaining -= performance.now()-started;
    if(remaining <= 0) break;
  }
  const playedUci=`${node.move.from}${node.move.to}${node.move.promotion || ''}`;
  if(remaining>100 && !next.engineEvidence.played?.pv && !node.analysis?.terminal) {
    check();
    next.engineEvidence.played=await evaluatePosition(node.parent,engine,{moveTime:Math.min(600,remaining),priority:2,signal,searchMoves:[playedUci],retry:false});
  }
  check();
  return next;
}
