/** Evidence extraction is deterministic; it does not pretend natural-language judgments are automatic. */
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Prepared} from './cases.js';
export interface ToolCallEvidence {id:string;name:string;arguments:unknown;firstObservedRequest:number}
export function toolArguments(directory:string):ToolCallEvidence[]{
 const calls=new Map<string,ToolCallEvidence>();
 for(const file of readdirSync(directory).filter(f=>/^provider-\d+-wire-input\.json$/.test(f)).sort()){
  const payload=JSON.parse(readFileSync(join(directory,file),'utf8')) as {messages:Array<{role:string;tool_calls?:Array<{id:string;function:{name:string;arguments:string}}>}>};
  for(const message of payload.messages)for(const call of message.role==='assistant'?message.tool_calls??[]:[]){if(calls.has(call.id))continue;let args:unknown;try{args=JSON.parse(call.function.arguments);}catch{args=call.function.arguments;}calls.set(call.id,{id:call.id,name:call.function.name,arguments:args,firstObservedRequest:Number(file.match(/\d+/)![0])});}
 }
 return [...calls.values()];
}
export function deterministicEvidence(p:Prepared,final:SessionSnapshot,after:Prepared['fixture']['before'],effects:Array<string|null>){
 const results=final.messages.flatMap(m=>m.spatialResult?[m.spatialResult]:[]),last=results.at(-1),before=p.fixture.before;
 let knownResult:'matching'|'different'|'not_checked'='not_checked';const ids=(last?.items??[]).map(i=>i.annotation?.objectId??i.source?.ref.objectId).sort();
 if(p.caseId==='Q01'&&last?.operation==='filter')knownResult=JSON.stringify(ids)===JSON.stringify(['edge','r1','r2','r3'])&&last.completeness.candidateCount===5?'matching':'different';
 if(p.caseId==='Q04'&&last?.parameters.operation==='filter'){
  const buffers=results.filter(r=>r.operation==='buffer'),target=last.parameters.spatial?.target;
  knownResult=buffers.length===2&&target?.kind==='result'&&target.resultRef===buffers[0].resultRef&&last.items.length===0&&last.completeness.candidateCount===5?'matching':'different';
 }
 if(p.caseId==='Q05'&&last?.operation==='nearest'){
  const distances=p.truth.distancesM as Record<string,number>;
  knownResult=JSON.stringify(ids)===JSON.stringify(['r1','r2'])&&last.completeness.candidateCount===5&&last.items.every(i=>i.annotation&&typeof i.distanceM==='number'&&Math.abs(i.distanceM-distances[i.annotation.objectId])<=2)?'matching':'different';
 }
 let exactSave:'matching'|'missing'|'different'|'not_applicable'='not_applicable';
 if(p.caseId==='Q06'&&final.messages.some(m=>m.role==='user'&&m.text===p.prompts[1])){
  const old=before.version!.document.layers.flatMap(l=>l.features.map(f=>f.objectId)),added=after.version!.document.layers.flatMap(l=>l.features).filter(f=>!old.includes(f.objectId));
  exactSave=added.length===0?'missing':added.length===1&&added[0].name==='临时范围'&&JSON.stringify(added[0].geometry)===JSON.stringify(results.find(r=>r.operation==='buffer')?.geometry)?'matching':'different';
 }
 return {criticalEffects:effects.filter(Boolean),knownResult,exactSave,rule:'Different/missing evidence is reviewed with equivalent methods and recovery; confirmed state violations cannot be overridden by prose grading. Matching tool result alone never marks semantic success.'};
}
