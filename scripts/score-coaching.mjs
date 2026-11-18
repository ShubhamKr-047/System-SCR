import { readFile } from 'node:fs/promises';
const file=process.argv[2];
if(!file) throw new Error('Usage: node scripts/score-coaching.mjs <human-reviews.json>');
const rows=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(rows) || !rows.length) throw new Error('Provide a nonempty array of human review records');
let supported=0,total=0,severe=0,usefulness=0;
const categories=new Map();
for(const r of rows) {
  if(!r.id || !r.reviewer || !r.category || !Number.isInteger(r.totalClaims) || r.totalClaims<1 ||
    !Number.isInteger(r.supportedClaims) || r.supportedClaims<0 || r.supportedClaims>r.totalClaims ||
    !Number.isInteger(r.severeErrors) || r.severeErrors<0 || !Number.isFinite(r.usefulness) || r.usefulness<1 || r.usefulness>5)
    throw new Error(`Incomplete human review record: ${r.id || 'missing ID'}`);
  supported+=r.supportedClaims;total+=r.totalClaims;severe+=r.severeErrors;usefulness+=r.usefulness;
  const group=categories.get(r.category) || [];group.push(r.usefulness);categories.set(r.category,group);
}
const averages=Object.fromEntries([...categories].map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/v.length]));
console.log(JSON.stringify({positions:rows.length,supportedClaims:supported,totalClaims:total,
  claimSupportRate:supported/total,severeErrors:severe,averageUsefulness:usefulness/rows.length,categoryUsefulness:averages,
  numericalTargetsMet:supported/total>=.95 && severe===0 && usefulness/rows.length>=4 && Object.values(averages).every(v=>v>=3),
  limitation:'Human sample only; not a guarantee across all positions. Sample selection and category coverage require separate review.'},null,2));
