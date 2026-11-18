import { PROMPT_VERSION } from './schema.js';
import { MODEL } from './groq.js';
// Ignore execution metadata, retain all evidence that can change the explanation.
function stableEvidence(value) {
  if(Array.isArray(value)) return value.map(stableEvidence);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort()
    .filter(k=>!['moveTime','searchTime','elapsedMs','spentMs','nodes','nps','time','signature'].includes(k))
    .map(k=>[k,stableEvidence(value[k])]));
  return value;
}
export function coachingIdentity(input) {
  const r=input.result;
  return JSON.stringify(stableEvidence({prompt:PROMPT_VERSION,model:MODEL,level:input.level,
    beforeFen:r.beforeFen,afterFen:r.afterFen,move:r.san,key:r.key,before:r.beforeWhite,after:r.afterWhite,
    engineEvidence:r.engineEvidence,classification:r.classificationEvidence,
    verificationComplete:r.reviewQuality?.verificationComplete}));
}
