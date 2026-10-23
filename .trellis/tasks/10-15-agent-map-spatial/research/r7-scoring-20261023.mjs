/** Offline aggregation of evidence-reviewed judgments, never a model/text classifier. */
import assert from 'node:assert/strict';
export function scoreReview(r) {
 for (const key of ['core','process','final','effects','boundary']) {
  assert.ok(['pass','fail','pending'].includes(r[key]?.verdict), `${key}: explicit verdict required`);
  assert.ok(r[key].reason && r[key].evidence?.length, `${key}: evidence and reason required`);
 }
 assert.ok(r.entryId && r.transcriptHash && r.reviewMode, 'review provenance required');
 const judgments=['core','process','final','effects','boundary'].map(k=>r[k].verdict);
 const strict=r.technical!=='complete'?'incomplete':judgments.includes('fail')?'fail':judgments.includes('pending')?'pending':'pass';
 return {entryId:r.entryId,group:r.group,technical:r.technical,core:r.core.verdict,process:r.process.verdict,final:r.final.verdict,effects:r.effects.verdict,boundary:r.boundary.verdict,strict};
}
export function summarize(schedule,reviews) {
 assert.equal(new Set(reviews.map(r=>r.entryId)).size,reviews.length,'duplicate review');
 for(const r of reviews)assert.ok(schedule.some(e=>e.id===r.entryId&&e.group===r.group),'unknown entry/group');
 const rows=reviews.map(scoreReview);
 return Object.fromEntries([...new Set(schedule.map(e=>e.group))].map(group=>{
  const planned=schedule.filter(e=>e.group===group).length,rs=rows.filter(r=>r.group===group);
  const count=(field,value)=>rs.filter(r=>r[field]===value).length;
  return [group,{planned,reviewed:rs.length,notReviewed:planned-rs.length,corePass:count('core','pass'),processFail:count('process','fail'),finalFail:count('final','fail'),strictPass:count('strict','pass'),strictFail:count('strict','fail'),pending:count('strict','pending'),incomplete:count('strict','incomplete'),strictRate:count('strict','pass')/planned}];
 }));
}
