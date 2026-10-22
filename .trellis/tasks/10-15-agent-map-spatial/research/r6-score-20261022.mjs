/** Apply preregistered rules to evidence-backed human-style judgments; no model calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {cases,schedule} from '../r6-20261022/cases.ts';
import {scoreExecution,summarize} from '../r6-20261022/scoring.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),reviews=JSON.parse(readFileSync(join(dir,'r6-review-20261022.json'),'utf8'));
const rows=reviews.map(review=>{const entry=schedule.find(e=>e.id===review.entryId);return {...scoreExecution(cases.find(c=>c.id===entry.caseId),review,entry),claims:review.claims.verdict,effects:review.effects.verdict};});
const summary={...summarize(schedule,rows),claimsFailures:rows.filter(r=>r.claims==='fail').map(r=>r.entryId),effectsFailures:rows.filter(r=>r.effects==='fail').map(r=>r.entryId),rows};
writeFileSync(join(dir,'r6-summary-20261022.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
