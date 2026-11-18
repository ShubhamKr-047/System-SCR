import { createCoachingController } from './coaching/controller.js';
import { buildReport } from './coaching/report.js';
import { conciseLocalFeedback } from './coaching/local-feedback.js';
import { prepareAnalysis } from './coaching/analysis.js';
import { explanationCache } from './coaching/cache.js';
import { createBrowserQuota } from './coaching/quota-browser.js';
import { requestGroq, estimateTokens, MODEL } from './coaching/groq.js';
import { coachingIdentity } from './coaching/identity.js';
import { validateCoaching as validate } from './coaching/validation.js';
import { getApiKey, setApiKey, initializeSettings, quotaScope, onCredentialsChanged } from './coaching/settings.js';
export { getApiKey, setApiKey };
export { COACHING_SCHEMA } from './coaching/schema.js';
export { validateCoaching } from './coaching/validation.js';
export const PROVIDERS={groq:{name:'Groq',recipient:'Groq',model:MODEL,storageKey:'zen-chess-groq-key',keyUrl:'https://console.groq.com/keys',consoleName:'Groq Console'}};
export const getProvider=()=> 'groq';
export function setProvider(provider){if(provider!=='groq') throw new Error('Unknown AI provider');}
export const hasApiKey=()=>Boolean(getApiKey());
let connection='saved';
export const getConnectionStatus=()=>hasApiKey()?connection:'off';
const states=new Map(), loading=new Set();
const EXPLANATION_LEVEL = 'intermediate';
let engine;
let activeKey=null;
export function configureCoaching(options){engine=options.engine;}
export async function initializeCoaching(){await initializeSettings();}
export function buildCoachingContext(result,fen){
  const {localText,...report}=buildReport(result,fen,EXPLANATION_LEVEL);return report;
}
const identity=coachingIdentity;
function inputFor(result,fen,node){return {result:fen?{...result,beforeFen:fen}:result,node,level:EXPLANATION_LEVEL};}
function notify(){globalThis.dispatchEvent?.(new Event('coachingchange'));}
const controller=createCoachingController({
  identity,cache:explanationCache,
  async prepare(input,{signal}){
    const initial=buildReport(input.result,undefined,input.level);
    if(initial.localText) return {localResult:{explanation:initial.localText,local:true}};
    const analyzed=await prepareAnalysis(input.result,input.node,engine,signal);
    const {localText,...report}=buildReport(analyzed,undefined,input.level);
    const fallback=conciseLocalFeedback(analyzed);
    if(localText || !hasApiKey()) return {localResult:{explanation:localText || fallback,local:true}};
    const quota=createBrowserQuota(await quotaScope());
    const jobKey=identity(input);
    return {report,fallback,jobKey,quota,estimatedTokens:estimateTokens(report)};
  },
  quota:{
    reserve:async evidence=>({...await evidence.quota.reserve(evidence),quota:evidence.quota}),
    reconcile:(reservation,response)=>reservation.quota.reconcile(reservation,response),
    release:reservation=>reservation.quota?.release(reservation),
    failed:reservation=>reservation.quota?.failed(reservation)
  },
  generate:(evidence,{signal})=>requestGroq(evidence.report,getApiKey(),signal),
  validate:(response,evidence)=>validate(response,evidence.report),
  onChange(state){
    if(!activeKey) return;
    const mapped={...state,status:['preparing','writing'].includes(state.status)?'pending':state.status,
      stage:state.status,coaching:state.result};
    if(state.status==='cooldown') {mapped.status='error';mapped.error=state.reason;}
    if(mapped.status==='error' && state.retryAt) mapped.error+=` Retry after ${new Date(state.retryAt).toLocaleTimeString()}.`;
    states.set(activeKey,mapped);
    if(states.size>120) {const first=states.keys().next().value;if(first!==activeKey) states.delete(first);}
    if(state.status==='ready' && state.source==='groq') connection='verified';
    if(state.status==='error') connection='error';
    queueMicrotask(notify);
  }
});
export function cancelPendingCoaching(){
  controller.cancel();activeKey=null;
  for(const [key,state] of states) if(state.status==='pending') states.delete(key);
}
export function getCoachingState(result,fen){
  if(!result) return null;
  const key=identity(inputFor(result,fen));
  if(!states.has(key) && !loading.has(key)) {
    loading.add(key);
    explanationCache.get(key).then(result=>{if(result && !states.has(key)){states.set(key,{status:'ready',coaching:result});notify();}}).finally(()=>loading.delete(key));
  }
  return states.get(key) || null;
}
export function generateCoaching(result,fen,{node}={}){
  const input=inputFor(result,fen,node),key=identity(input);
  activeKey=key;
  states.set(key,{status:'pending',stage:'preparing'});
  return controller.explain(input);
}
export const isCoachingEligible=result=>Boolean(result?.key);
export const getMoveQuestion=result=>result ? `Explain the idea behind ${result.san || 'this move'}?` : '';
onCredentialsChanged(()=>{connection='saved';controller.credentialsChanged();cancelPendingCoaching();states.clear();notify();});
globalThis.addEventListener?.('pagehide',cancelPendingCoaching);
