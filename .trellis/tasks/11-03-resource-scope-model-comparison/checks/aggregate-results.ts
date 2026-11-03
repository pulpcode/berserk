// Offline reporting only. No provider calls, scoring changes, or task reruns.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {comparisonSummary,type GroupScore} from '../comparison-summary.js';
import {schedule} from '../cases.js';

const task=resolve('.trellis/tasks/11-03-resource-scope-model-comparison');
const batch=resolve('.local/resource-scope-model-comparison/20261103-live-01');
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const scores:GroupScore[]=schedule.map(slot=>read(join(task,'checks/scores',`${slot.id}.json`)));
assert.equal(scores.length,28);
assert.ok(scores.every(score=>score.status==='reviewed'),'unresolved_review');
const executions=read(join(task,'records/live-01/execution-summary.json')) as Array<{entry:{id:string;group:string;phase:string};status:string;usage:{requests:number;input:number;output:number;unknown:number};providerElapsedSeconds:number;nonProviderElapsedSeconds:number}>;
assert.equal(executions.length,28);
assert.ok(executions.every(row=>row.status==='trajectory_recorded'&&row.usage.unknown===0));
const rows=scores.map(score=>{
 const slot=schedule.find(item=>item.id===score.entryId)!;
 const execution=executions.find(item=>item.entry.id===slot.id)!;
 const skills=read(join(batch,slot.id,'skill-read-evidence.json')) as Array<{bodyReceived:boolean;skillId:string;messageId:string}>;
 const calls=new Map<string,{name:string;arguments:string}>();
 for(const file of readdirSync(join(batch,slot.id)).filter(name=>/^provider-\d+-native-request\.json$/.test(name))){
  for(const message of read(join(batch,slot.id,file)).messages){
   for(const call of message.tool_calls??[]) calls.set(call.id,call.function);
  }
 }
 const snapshot=read(join(batch,slot.id,'final-snapshot.json'));
 const succeeded=new Set(snapshot.messages.filter((m:{role:string;isError?:boolean})=>m.role==='tool'&&!m.isError).map((m:{toolCallId:string})=>m.toolCallId));
 const referenceCalls=[...calls].filter(([,call])=>call.name==='annotation_read'&&JSON.parse(call.arguments).mode==='reference');
 const {review,...compact}=score;
 void review;
 return {...compact,skillBodyReceived:skills.some(item=>item.bodyReceived),skills:skills.map(item=>({id:item.skillId,messageId:item.messageId,received:item.bodyReceived})),referenceCallAttempts:referenceCalls.length,referenceCallSuccesses:referenceCalls.filter(([id])=>succeeded.has(id)).length,usage:execution.usage,providerElapsedSeconds:execution.providerElapsedSeconds,nonProviderElapsedSeconds:execution.nonProviderElapsedSeconds};
});
const groups=comparisonSummary(scores).map(group=>{
 const {publicRows,...aggregate}=group;
 void publicRows;
 const formal=rows.filter(row=>row.group===group.group&&row.cohort==='formal');
 const total=rows.filter(row=>row.group===group.group);
 const sum=(items:typeof rows)=>({requests:items.reduce((n,r)=>n+r.usage.requests,0),input:items.reduce((n,r)=>n+r.usage.input,0),output:items.reduce((n,r)=>n+r.usage.output,0),providerElapsedSeconds:items.reduce((n,r)=>n+r.providerElapsedSeconds,0),nonProviderElapsedSeconds:items.reduce((n,r)=>n+r.nonProviderElapsedSeconds,0)});
 return {...aggregate,skillReadTasks:formal.filter(row=>row.skillBodyReceived).length,referenceEntryTasks:formal.filter(row=>row.referenceCallSuccesses>0).length,referenceCallSuccesses:formal.reduce((n,row)=>n+row.referenceCallSuccesses,0),expressionIssueTasks:formal.filter(row=>row.expressionIssues.length>0).length,formalUsage:sum(formal),totalUsageIncludingPublic:sum(total),repeats:[1,2].map(repeat=>{const items=formal.filter(row=>row.repeat===repeat);return {repeat,count:items.length,main:items.filter(row=>row.mainTask).length,strict:items.filter(row=>row.strict).length};})};
});
const paired=['D01','D02','D03','D04','D05','D06'].map(caseId=>({caseId,rows:rows.filter(row=>row.caseId===caseId)}));
const result={kind:'development_diagnostic_not_independent_acceptance',plannedPublic:4,plannedFormal:24,completedPublic:4,completedFormal:24,groups,public:rows.filter(row=>row.cohort==='public'),paired,notes:['Strict thresholds are only model score thresholds; offline tool and public flow gates remain separate.','Skill receipt is diagnostic, not an automatic success requirement.','Provider time includes HTTP streaming; other time includes setup/hash/browser/review, not just model time.','Review disagreements and sensitivity alternatives remain in per-slot scores and adjudications.']};
writeFileSync(join(task,'checks/aggregate.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(groups,null,2));
