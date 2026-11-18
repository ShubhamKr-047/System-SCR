import { COACHING_SCHEMA, INSTRUCTION } from './schema.js';
import { retryAfterMilliseconds } from './quota.js';
export const MODEL = 'openai/gpt-oss-120b';
const ROUTINE_COMPLETION_TOKENS = 896;
const COMPLEX_COMPLETION_TOKENS = 1600;
const encoder = new TextEncoder();
// These qualifications are stated once in INSTRUCTION. All position-specific
// qualifications and substantive chess observations remain in the payload.
const SHARED_CAVEATS = [
  ' This is a board relationship, not proof of a forced win.',
  ' This does not prove a material gain; pinned attackers may not legally capture.',
  ' Legal mobility may be restricted by pins.',
  ' Legal defenses still determine the payoff.',
  ' This geometry alone does not establish a mating attack.',
  ' Multiple defensive duties alone do not prove an overload.',
  ' This does not prove it can promote.',
  ' This does not prove the pinned piece can be won.',
  ' Legal defenses determine whether the alignment wins material.',
  ' This measures geometry, not legal mobility or a forced gain.',
  ' This alone does not prove either piece must be lost.',
  ' This is a line outcome, not proof all defenses have that outcome.'
];
export function compactReport(report) {
  const sequences = new Map();
  return {
    level:report.level, positions:report.positions, played:report.played,
    classification:report.classification, category:report.category,
    evaluation:report.evaluation, limitations:report.limitations,
    supportingLines:report.supportingLines.map(({id,start,moves})=>{
      const compact=moves.map(({san,captured,checkmate})=>({san,...(captured?{captured}:{}),...(checkmate?{checkmate:true}:{})}));
      const key=JSON.stringify([start,compact]), reference=sequences.get(key);
      if(reference) return {id,start,movesRef:reference};
      sequences.set(key,id);
      return {id,start,moves:compact};
    }),
    facts:report.facts.map(({origin,...fact})=>{
      let text=fact.text;
      for(const caveat of SHARED_CAVEATS) text=text.replaceAll(caveat,'');
      return {...fact,text,scope:fact.scope===report.positions.after?'after':fact.scope===report.positions.before?'before':fact.scope};
    })
  };
}
export function requestBody(report) {
  const routine = report.category === 'ordinary';
  return {model:MODEL,messages:[{role:'system',content:INSTRUCTION},{role:'user',content:JSON.stringify(compactReport(report))}],
    temperature:0.2, reasoning_effort:routine?'low':'medium',
    max_completion_tokens:routine?ROUTINE_COMPLETION_TOKENS:COMPLEX_COMPLETION_TOKENS,
    response_format:{type:'json_schema',json_schema:{name:'chess_coaching',strict:true,schema:COACHING_SCHEMA}}};
}
export function estimateTokens(report) {
  const body = requestBody(report);
  // Estimate model input rather than counting the HTTP envelope and JSON escaping twice.
  const inputBytes = body.messages.reduce((sum, message) => sum + encoder.encode(message.content).length, 0)
    + encoder.encode(JSON.stringify(body.response_format)).length;
  return Math.ceil(inputBytes / 3) + 64 + body.max_completion_tokens;
}
export async function requestGroq(report, key, signal) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',credentials:'omit',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    body:JSON.stringify(requestBody(report))});
  const retryAfterMs=res.status===429 ? retryAfterMilliseconds(res.headers.get('retry-after')) : undefined;
  const count = name => {
    const value = res.headers.get(name);
    return value && /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  };
  const metadata={status:res.status,retryAfterMs,
    tokenLimit:count('x-ratelimit-limit-tokens'), requestLimit:count('x-ratelimit-limit-requests'),remainingTokens:count('x-ratelimit-remaining-tokens'),
    remainingRequests:count('x-ratelimit-remaining-requests'),
    resetTokens:res.headers.get('x-ratelimit-reset-tokens'),resetRequests:res.headers.get('x-ratelimit-reset-requests')};
  if(!res.ok) {
    const errors={400:'Groq rejected the request. Check model access in Settings.',401:'Groq could not authenticate your API key.',
      403:'Groq access was denied.',404:'The configured Groq model is unavailable.',429:'Groq quota or rate limit reached. Wait before retrying.'};
    return {...metadata,outcome:res.status===429?'provider-rate-limit':'provider-error',error:errors[res.status] || 'Groq is temporarily unavailable. Try again later.'};
  }
  const data=await res.json().catch(()=>null), choice=data?.choices?.[0];
  let result;
  try {
    if(choice?.finish_reason!=='stop' || choice.message?.refusal) throw new Error();
    result=JSON.parse(choice.message.content);
  } catch { return {...metadata,usage:data?.usage,outcome:choice?.finish_reason==='length'?'truncated':'invalid-response',error:'Groq returned an incomplete or invalid explanation. You can retry.'}; }
  return {...metadata,result,usage:data.usage};
}
