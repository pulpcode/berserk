/** Explicitly authorized 1 retry + 4 untouched slots; frozen R5 implementation remains unchanged. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runLive,sourceFreeze} from './r5-20261022/live.ts';
import {schedule} from './r5-20261022/cases.ts';
import {planBudget,canStartSlot} from './r5-20261022/live-budget.ts';
import {repo,hashes,save,digest} from './r5-20261022/runtime.ts';
const mode=process.argv[2]; assert.ok(['check','run'].includes(mode),'Use check or run');
const original=join(repo,'.local/spatial-r5/r5-20261022-01');
const destination=join(repo,'.local/spatial-r5/r5-20261022-supplement-01');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const protocol=read(join(original,'protocol.json')),oldRows=read(join(original,'runs.json')),oldBudget=read(join(original,'budget.json'));
assert.deepEqual(await sourceFreeze(),protocol.source,'Original frozen code changed');
assert.deepEqual(oldBudget,{requests:15,input:231065,output:2166,unknownUsage:1});
assert.equal(oldRows.find(e=>e.id==='D05-L0').status,'incomplete');
assert.equal(oldRows.find(e=>e.id==='D05-L0').stop,'provider_http_402');
assert.ok(readFileSync(join(original,'D05-L0/provider-0015-error.txt'),'utf8').includes('Insufficient Balance'));
const ids=['D05-L0','D16-L0','D16-L1','N01-L1','N01-L0'];
for(const id of ids.slice(1))assert.equal(oldRows.find(e=>e.id===id).status,'not_executed');
const entries=schedule.filter(e=>ids.includes(e.id));assert.deepEqual(entries.map(e=>e.id),ids);
assert.equal(oldRows.filter(e=>e.status==='recorded').length,3);
assert.equal(existsSync(destination),false,'Never overwrite a supplement batch');
const unchanged=await hashes(original),priorLimit={...planBudget};
// A newly declared supplement ceiling, not a claim that prior unknown billing is zero.
const ceiling={requests:105,input:1_768_935,output:37_834};
assert.deepEqual(ceiling,Object.fromEntries(Object.keys(priorLimit).map(k=>[k,priorLimit[k]-oldBudget[k]])));
Object.assign(planBudget,ceiling);
assert.equal(canStartSlot({requests:0,input:0,output:0,unknownUsage:0}),true);
const record={authorization:'User recharged and authorized exactly D05-L0 retry plus four untouched entries; no later 12 trials',original,destination,entries:ids,retry:['D05-L0'],firstAttempts:ids.slice(1),originalBudget:oldBudget,supplementCeiling:ceiling,accounting:'Independent supplement ledger. Prior HTTP402 unknownUsage=1 is retained; combined tokens are known lower bounds, not an exact total bill or exact remaining balance.',frozenSource:protocol.source,originalHashes:unchanged,launcherHash:digest(readFileSync(fileURLToPath(import.meta.url))),automaticRetries:false};
if(mode==='check'){console.log(JSON.stringify({preflight:'passed',entries:ids,ceiling,originalUnknownUsage:1}));}
else{
 let result;
 try{result=await runLive({directory:destination,entries,port:4550});}
 finally{assert.deepEqual(await hashes(original),unchanged,'Original interruption evidence changed');if(existsSync(destination))save(join(destination,'supplement-link.json'),record);Object.assign(planBudget,priorLimit);}
 console.log(JSON.stringify({supplementComplete:!result.stop,statuses:result.rows.map(r=>({id:r.id,status:r.status})),totals:result.total,stop:result.stop??null}));
 if(result.stop)process.exitCode=1;
}
