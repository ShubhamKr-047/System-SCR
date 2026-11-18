function closed(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    keys.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>keys.includes(k));
}
export function validateCoaching(parsed, report) {
  const fail = () => { throw new Error('Groq returned an incomplete or invalid explanation. You can retry.'); };
  if(!closed(parsed,['summary','comparison','claims'])) fail();
  const lines = new Map(report.supportingLines.map(l=>[l.id,l]));
  const facts = new Map(report.facts.map(f=>[f.id,f]));
  const ids = new Set([...lines.keys(),...facts.keys()]);
  const sections = [parsed.summary,parsed.comparison].filter(s=>s!==null);
  if(!parsed.summary || sections.some(s=>!closed(s,['text','evidenceIds']) || typeof s.text !== 'string' ||
    !s.text.trim() || !Array.isArray(s.evidenceIds) || !s.evidenceIds.length || s.evidenceIds.some(id=>!ids.has(id)))) fail();
  if(!Array.isArray(parsed.claims)) fail();
  const text = sections.map(s=>s.text).join(' ');
  if(text.length>4000 || text.split(/\s+/).length>220 || /[<>]|https?:|\b(?:ignore previous|system prompt)\b/i.test(text)) fail();
  const allowedSan = new Set([report.played.san,...report.supportingLines.flatMap(l=>l.moves.map(m=>m.san))]);
  for(const match of text.matchAll(/\b(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?(?!\w)/g)) {
    if(!allowedSan.has(match[0])) fail();
  }
  for(const match of text.matchAll(/\b[a-h](?:x[a-h])?[1-8](?:=[QRBN])?[+#]?(?!\w)/g)) {
    const before=text.slice(0,match.index);
    // Square references describe geometry rather than proposing a pawn move.
    if(/\b(?:on|from|to|square|at|file)\s+$/i.test(before)) continue;
    if(!allowedSan.has(match[0]) && /[x=+#]/.test(match[0])) fail();
    if(!allowedSan.has(match[0]) && /\b(?:play|plays|played|after|with|if|then)\s+$/i.test(before)) fail();
  }
  if(/\b(?:forks?|double attack)\b/i.test(text) && !report.facts.some(f=>f.type==='double-attack' || f.type==='fork')) fail();
  if(/\bpin(?:s|ned)?\b/i.test(text) && !report.facts.some(f=>f.type==='pin')) fail();
  if(/\bskewer(?:s|ed)?\b/i.test(text) && !report.facts.some(f=>f.type==='skewer')) fail();
  if(/\b(forced (?:mate|win)|every (?:defense|alternative) loses|only (?:winning |good )?move)\b/i.test(text) &&
    !facts.has('mate-proof') && report.category !== 'forced') fail();
  for(const section of sections) {
    const gain=section.text.match(/\b(?:(White|Black)\s+(?:can\s+)?)?(?:wins?|winning|gains?) (?:a |the )?(?:material|queen|rook|bishop|knight|pawn)\b/i);
    if(gain) {
      const mover=report.played.side==='w'?'white':'black';
      const winner=gain[1]?.toLowerCase() || (report.category==='complex-error' ? (mover==='white'?'black':'white') : mover);
      if(!report.comparisons?.some(c=>c.materialDelta*(winner===mover?1:-1)>0 &&
        (section.evidenceIds.includes(c.lineId) || section.evidenceIds.includes(`material-${c.lineId}`)))) fail();
    }
  }
  for(const claim of parsed.claims) {
    if(!closed(claim,['kind','evidenceId','lineId']) || !facts.has(claim.evidenceId) ||
      !['board_fact','material_change','engine_comparison','conditional_mate','forced_mate'].includes(claim.kind) ||
      (claim.lineId!==null && !lines.has(claim.lineId))) fail();
    const fact=facts.get(claim.evidenceId), line=lines.get(claim.lineId);
    if(claim.kind==='material_change' && (fact.type!=='material_change' || fact.lineId!==claim.lineId)) fail();
    if(claim.kind==='forced_mate' && claim.evidenceId!=='mate-proof') fail();
    if(claim.kind==='conditional_mate' && (!line?.moves.at(-1)?.checkmate || !/\bif\b/i.test(text))) fail();
    if(claim.kind==='conditional_mate' && fact.id.startsWith('payoff-') && claim.lineId!==fact.id.replace('payoff-','acceptance-')) fail();
    if(claim.kind==='engine_comparison' && fact.certainty!=='engine-supported') fail();
  }
  if(/\b(?:checkmate|mates?)\b/i.test(text) && !report.facts.some(f=>['mate','allows-mate','mate-proof'].includes(f.id) || f.id.startsWith('payoff-')) &&
    !report.supportingLines.some(l=>l.moves.at(-1)?.checkmate)) fail();
  return {...parsed,explanation:parsed.summary.text};
}
