import { boardFeatures } from './features.js';
export function compareSearches(result,report) {
  const best=result.engineEvidence?.before,played=result.engineEvidence?.played;
  const sameRoot=Boolean(best?.provenance?.root && best.provenance.root===played?.provenance?.root);
  const comparable=sameRoot && best.moveTime===played.moveTime && best.stable!==false && played.stable!==false;
  if(comparable && best.scoreType==='cp' && played.scoreType==='cp') {
    const playedWhite=played.whiteScore ?? played.score*(result.moveColor==='w'?1:-1);
    const loss=((best.whiteScore ?? best.score)-playedWhite)*(result.moveColor==='w'?1:-1);
    report.facts.push({id:'engine-comparison',type:'engine_comparison',certainty:'engine-supported',origin:'same-root-search',scope:'selected-move',
      text:loss<=0.15?'The compared searches assess the played move close to the leading choice; do not describe it as uniquely best.':'Comparable searches favor the leading alternative over the played move. The lines and board changes must establish the reason; the score difference alone does not.'});
    if(['blunder','mistake','miss'].includes(result.key) && loss<=0.15) {
      report.limitations.push('The fresh comparison does not support a large error. The old classification may need refinement. Explain neutrally.');
      report.evaluation.verificationComplete=false;
    }
  } else report.limitations.push('Searches are not confirmed comparable in budget and provenance; avoid precise causal or uniqueness claims from score differences.');
  const alternative=report.comparisons.find(l=>l.lineId==='alternative-line');
  if(alternative) {
    const alternativeFeatures=boardFeatures(alternative.finalFen,result.moveColor);
    const played=report.comparisons.find(l=>l.lineId==='played-line');
    if(played) {
      const playedIds=new Set(boardFeatures(played.finalFen,result.moveColor).map(f=>f.id));
      report.positionDifferences=alternativeFeatures.filter(f=>!playedIds.has(f.id)).slice(0,4)
        .map(f=>({...f,id:`alternative-${f.id}`,scope:'alternative-line',certainty:'direct'}));
      report.facts.push(...report.positionDifferences);
    }
  }
}
