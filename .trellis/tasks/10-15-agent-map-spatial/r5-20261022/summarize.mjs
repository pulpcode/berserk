/** Reuse the frozen semantic scorer; human/agent review supplies facts, never tool success. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {cases,schedule,labels} from './cases.ts';
import {score,summarize} from '../r3-20261022/scoring.ts';
const [batch,reviewFile,output] = process.argv.slice(2);
assert.ok(batch&&reviewFile&&output,'summarize.mjs BATCH REVIEW_JSON OUTPUT');
const reviews=JSON.parse(readFileSync(reviewFile,'utf8'));
assert.equal(reviews.length,schedule.length);
const rows=reviews.map(review=>{
 const entry=schedule.find(e=>e.id===review.entryId);assert.ok(entry);
 const transcript=readFileSync(join(batch,entry.id,'review.json'));
 assert.equal(createHash('sha256').update(transcript).digest('hex'),review.transcriptHash);
 return score(cases.find(c=>c.id===entry.caseId),review,entry);
});
const result={overall:summarize(schedule,rows),byGroup:Object.fromEntries(['A','B'].map(group=>[labels[group],summarize(schedule.filter(e=>e.group===group),rows.filter(r=>r.group===group))])),rows};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({groups:result.byGroup}));
