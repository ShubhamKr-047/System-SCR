const events=[];
export function recordCoachingEvent(status,metadata={}) {
  // Intentionally exclude credentials, position strings, prompts and model prose.
  events.push({at:new Date().toISOString(),status,...Object.fromEntries(Object.entries(metadata)
    .filter(([key,value])=>['elapsedMs','tokens','source','estimatedTokens','httpStatus','promptTokens','completionTokens','cachedTokens','retryAt','outcome'].includes(key) && ['number','string'].includes(typeof value)))});
  if(events.length>100) events.shift();
}
export function coachingDiagnostics(){return {version:2,events:[...events]};}
