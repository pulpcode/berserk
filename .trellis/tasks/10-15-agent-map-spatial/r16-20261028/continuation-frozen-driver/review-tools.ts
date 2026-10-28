/** R16 offline review/aggregation only. No model client, network calls or task execution. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {strictOf,validateScore,publicMessage,type Score,type Verdict} from '../r15-20261027/review-tools.js';
export {strictOf,validateScore,publicMessage};
export type {Score,Verdict};
export interface Slot {id:string;caseId:string;group:string;round:number;status:string;blindId?:string;elapsedMs?:number;completedUserTurns?:number;plannedUserTurns?:number;sentOriginalUserTurns?:number;additionalClarificationTurns?:number;unissuedOriginalUserTurns?:number;stop?:string}
export const groups=['G0','GS','GT','GST'] as const;
export const caseIds=Array.from({length:24},(_,i)=>`Q${String(i+1).padStart(2,'0')}`);
export const reviewSeed='R16-20261028-review';
export const bootstrapSeed='R16-20261028-cluster-bootstrap';
export const bootstrapSamples=10_000;
export const categories={source:['Q01','Q02','Q13','Q14'],lookup:['Q03','Q04','Q15','Q16'],counts:['Q05','Q06','Q17','Q18'],state:['Q07','Q08','Q19','Q20'],direction:['Q09','Q10','Q21'],authorship:['Q11','Q12'],version:['Q22'],simple:['Q23','Q24']};
export const strata={revised:caseIds.slice(0,12),expanded:caseIds.slice(12),business:caseIds.slice(0,22),simple:caseIds.slice(22)};
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const save=(p:string,v:unknown)=>{assert.ok(!existsSync(p),`Refuse overwrite ${p}`);writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});};
export function validateSlots(slots:Slot[]){
 assert.equal(slots.length,288,'expected 288 scheduled slots');const entries=new Set<string>(),tuples=new Set<string>(),blinds=new Set<string>();
 for(const s of slots){
  assert.ok(s.id&&!entries.has(s.id),'duplicate or missing entry ID');entries.add(s.id);
  assert.ok(caseIds.includes(s.caseId),'unknown case ID');assert.ok(groups.includes(s.group as typeof groups[number]),'unknown group');assert.ok([1,2,3].includes(s.round),'unknown repetition');
  const tuple=`${s.caseId}:${s.group}:${s.round}`;assert.ok(!tuples.has(tuple),'duplicate scheduled tuple');tuples.add(tuple);
  assert.ok(['not_executed','started','recorded','waiting_user','incomplete','interrupted'].includes(s.status),'unknown slot status');
  if(s.blindId){assert.ok(!blinds.has(s.blindId),'duplicate blind ID');blinds.add(s.blindId);assert.notEqual(s.status,'not_executed','unexecuted slot has blind ID');}
 }
}
function validateJoin(slots:Slot[],scores:Score[]){
 validateSlots(slots);const byId=new Map<string,Score>();
 for(const s of scores){validateScore(s);assert.ok(!byId.has(s.blindId),'duplicate review');const slot=slots.find(t=>t.blindId===s.blindId);assert.ok(slot,'review without slot');assert.ok(!['not_executed','started'].includes(slot.status),'review requires ended slot');byId.set(s.blindId,s);}
 return byId;
}
/** A missing future turn remains pending even if the observed first-turn facts are correct. */
export function independentSelection(slots:Slot[],scores:Score[]){
 const byId=validateJoin(slots,scores),selected=new Set<string>();
 for(const s of scores)if(s.strict!=='pass')selected.add(s.blindId);
 for(const caseId of caseIds){
  const peers=slots.filter(s=>s.caseId===caseId),signatures=peers.map(p=>{const s=p.blindId?byId.get(p.blindId):undefined;return s?JSON.stringify([s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries]):'unreviewed';});
  // All twelve same-case trials are eligible when any group or repetition disagrees.
  if(new Set(signatures).size>1)for(const p of peers)if(p.blindId&&byId.has(p.blindId))selected.add(p.blindId);
 }
 const passing=scores.filter(s=>s.strict==='pass').sort((a,b)=>hash(reviewSeed+a.blindId).localeCompare(hash(reviewSeed+b.blindId))),sample=passing.slice(0,Math.ceil(passing.length*.25));
 for(const s of sample)selected.add(s.blindId);
 return {seed:reviewSeed,total:selected.size,ids:[...selected].sort(),randomPassCount:sample.length,randomPassIds:sample.map(s=>s.blindId),basis:'freeze selection from initial reviews, never silently resample after adjudication'};
}
/** Deterministic xorshift; resamples whole questions, retaining all three paired repetitions. */
export function clusterBootstrap(differences:number[],seed=bootstrapSeed,samples=bootstrapSamples){
 assert.equal(differences.length,24,'bootstrap requires all 24 complete question clusters');assert.ok(differences.every(Number.isFinite));assert.ok(Number.isSafeInteger(samples)&&samples>0);
 let state=Number.parseInt(hash(seed).slice(0,8),16)||1;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const values=Array.from({length:samples},()=>{let n=0;for(let i=0;i<24;i++)n+=differences[Math.floor(random()*24)];return n/24;}).sort((a,b)=>a-b);
 const quantile=(p:number)=>{const index=(values.length-1)*p,low=Math.floor(index);return values[low]+(values[Math.min(low+1,values.length-1)]-values[low])*(index-low);};
 return {method:'paired-question-cluster percentile bootstrap',seed,samples,clusters:24,repetitionsPerCluster:3,estimate:differences.reduce((a,b)=>a+b,0)/24,lower:quantile(.025),upper:quantile(.975),level:.95};
}
export function aggregate(slots:Slot[],scores:Score[]){
 const byId=validateJoin(slots,scores);
 const verdict=(s:Slot,key:'strict'|'mainRequirement')=>s.blindId?byId.get(s.blindId)?.[key]:undefined;
 const count=(rows:Slot[],key:'strict'|'mainRequirement')=>({planned:rows.length,pass:rows.filter(s=>verdict(s,key)==='pass').length,fail:rows.filter(s=>verdict(s,key)==='fail').length,pending:rows.filter(s=>s.status!=='not_executed'&&(!verdict(s,key)||verdict(s,key)==='pending')).length,notExecuted:rows.filter(s=>s.status==='not_executed').length});
 const section=(rows:Slot[])=>({main:count(rows,'mainRequirement'),strict:count(rows,'strict')});
 const groupResults=Object.fromEntries(groups.map(g=>{
  const rows=slots.filter(s=>s.group===g);assert.equal(rows.length,72);
  const subsets=(definitions:Record<string,string[]>)=>Object.fromEntries(Object.entries(definitions).map(([k,ids])=>[k,section(rows.filter(s=>ids.includes(s.caseId)))]));
  const perCase=Object.fromEntries(caseIds.map(id=>[id,{...section(rows.filter(s=>s.caseId===id)),allDimensionsDecidable:rows.filter(s=>s.caseId===id).every(r=>{const s=r.blindId?byId.get(r.blindId):undefined;return s!==undefined&&![s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries].includes('pending');}),trials:rows.filter(s=>s.caseId===id).sort((a,b)=>a.round-b.round).map(s=>({round:s.round,status:s.status,blindId:s.blindId,main:verdict(s,'mainRequirement')??null,strict:verdict(s,'strict')??null}))}]));
  const stability=Object.fromEntries([0,1,2,3].map(n=>[`${n}/3`,Object.entries(perCase).filter(([,v])=>v.allDimensionsDecidable&&v.strict.pass===n).map(([id])=>id)]));
  const overall=section(rows),subsetsByKind=subsets(strata);
  const allDecidable=overall.strict.notExecuted===0&&rows.every(r=>{const s=r.blindId?byId.get(r.blindId):undefined;return s!==undefined&&![s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries].includes('pending');});
  const boundaryFailures=rows.filter(r=>r.blindId&&byId.get(r.blindId)?.boundaries==='fail').length;
  // Boundary failures conservatively block acceptance; actual effects/authorization still need evidence review.
  const thresholds=overall.main.pass>=65&&overall.strict.pass>=65&&subsetsByKind.revised.strict.pass>=33&&subsetsByKind.expanded.strict.pass>=33&&subsetsByKind.business.strict.pass>=60;
  return [g,{...overall,categories:subsets(categories),strata:subsetsByKind,perCase,stability,unresolvedCases:Object.entries(perCase).filter(([,v])=>!v.allDimensionsDecidable).map(([id])=>id),acceptance:{allDecidable,boundaryFailures,thresholdsSatisfied:thresholds,diagnosticGatePassed:allDecidable&&boundaryFailures===0&&thresholds,notProductionAcceptance:true}}];
 }));
 const comparisons=Object.fromEntries([['GST','G0'],['GS','G0'],['GT','G0'],['GST','GS'],['GST','GT']].map(([candidate,baseline])=>{
  const details=slots.filter(s=>s.group===candidate).map(s=>{
   const peer=slots.find(b=>b.caseId===s.caseId&&b.round===s.round&&b.group===baseline)!;const a=verdict(s,'strict'),b=verdict(peer,'strict');const complete=(r:Slot)=>{const x=r.blindId?byId.get(r.blindId):undefined;return x!==undefined&&![x.mainRequirement,x.processFacts,x.finalFacts,x.effects,x.boundaries].includes('pending');};const pairComplete=complete(s)&&complete(peer);
   const outcome:'improved'|'regressed'|'bothPass'|'bothFail'|'unresolved'=!pairComplete?'unresolved':a==='pass'&&b==='fail'?'improved':a==='fail'&&b==='pass'?'regressed':a==='pass'&&b==='pass'?'bothPass':a==='fail'&&b==='fail'?'bothFail':'unresolved';
   return {caseId:s.caseId,round:s.round,outcome,difference:outcome==='unresolved'?null:Number(a==='pass')-Number(b==='pass')};
  });
  const counts={improved:0,regressed:0,bothPass:0,bothFail:0,unresolved:0};for(const d of details)counts[d.outcome]++;
  const interval=counts.unresolved?null:clusterBootstrap(caseIds.map(id=>details.filter(d=>d.caseId===id).reduce((n,d)=>n+d.difference!,0)/3),bootstrapSeed+':'+candidate+'-'+baseline);
  return [candidate+'vs'+baseline,{...counts,net:counts.improved-counts.regressed,details,interval,intervalUnavailableReason:counts.unresolved?'Incomplete paired trials: do not impute pending as model failure or drop question clusters':null,primary:candidate==='GST'&&baseline==='G0',stableImprovementObserved:interval!==null&&interval.estimate>0&&interval.lower>0}];
 }));
 const interaction=caseIds.map(caseId=>({caseId,rounds:[1,2,3].map(round=>{
  const vs=groups.map(group=>{const row=slots.find(s=>s.caseId===caseId&&s.round===round&&s.group===group)!;const s=row.blindId?byId.get(row.blindId):undefined;return s&&![s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries].includes('pending')?s.strict:undefined;});
  return {round,value:vs.every(v=>v==='pass'||v==='fail')?(Number(vs[3]==='pass')-Number(vs[1]==='pass'))-(Number(vs[2]==='pass')-Number(vs[0]==='pass')):null};
 })}));
 const completeInteraction=interaction.every(x=>x.rounds.every(r=>r.value!==null));
 return {schemaVersion:1,groups:groupResults,comparisons,interaction:{meaning:'(GST-GS)-(GT-G0), descriptive only; not proof of prompt interference',estimate:completeInteraction?interaction.reduce((n,q)=>n+q.rounds.reduce((m,r)=>m+r.value!,0),0)/72:null,details:interaction},coverage:{planned:288,reviewed:scores.length,unexecuted:slots.filter(s=>s.status==='not_executed').length},primaryComparison:'GSTvsG0',notIndependentHeldout:true};
}
export function packBlind(batch:string,target:string){
 assert.ok(!existsSync(target));mkdirSync(target,{mode:0o700});const slots=read<Slot[]>(join(batch,'runs.json')),mapping=[];
 for(const row of [...slots].sort((a,b)=>(a.blindId??'').localeCompare(b.blindId??''))){
  if(!row.blindId)continue;const dir=join(batch,row.id),out=join(target,row.blindId);mkdirSync(out,{mode:0o700});const path=join(dir,'judge-input.json');
  const raw=existsSync(path)?read<Record<string,unknown>>(path):{schemaVersion:1,id:row.blindId,unit:'task',evidenceUnavailable:true,reason:'No complete public snapshot. Missing outcomes must not be inferred.',visibleTranscript:[],stateEvidence:[]};
  save(join(out,'judge-input.json'),publicMessage(raw));
  const files=existsSync(dir)?readdirSync(dir).filter(f=>f.endsWith('-wire-input.json')).sort():[];
  save(join(out,'model-visible-evidence.json'),{observedMessages:files.map((f,i)=>({request:i+1,messages:publicMessage(read<{messages:unknown[]}>(join(dir,f)).messages)}))});
  const ledgerPath=join(dir,'turn-ledger.json');if(existsSync(ledgerPath))save(join(out,'turn-ledger.json'),publicMessage(read<unknown>(ledgerPath)));
  save(join(out,'completion.json'),{status:row.status,completedUserTurns:row.completedUserTurns,plannedUserTurns:row.plannedUserTurns,sentOriginalUserTurns:row.sentOriginalUserTurns,additionalClarificationTurns:row.additionalClarificationTurns,unissuedOriginalUserTurns:row.unissuedOriginalUserTurns,stop:row.stop?.split('\n')[0].replace(/deepseek[\w.-]+/gi,'[model identity omitted]').replaceAll(row.id,'[entry]').replace(/runtimes\/(?:G0|GS|GT|GST)(?=\/|$)/g,'runtimes/[group]')??null});
  mapping.push({blindId:row.blindId,entryId:row.id,caseId:row.caseId,group:row.group,round:row.round});
 }
 save(join(target,'index.json'),mapping.map(m=>({blindId:m.blindId,caseId:m.caseId})));
 save(join(batch,'blind-mapping.json'),mapping);return mapping.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,batch,output,scoresFile]=process.argv.slice(2);
 if(command==='blind')console.info(JSON.stringify({packaged:packBlind(batch,output)}));
 else if(command==='summarize'){const slots=read<Slot[]>(join(batch,'runs.json')),scores=read<{rows:Score[]}>(scoresFile).rows;save(output,aggregate(slots,scores));}
 else if(command==='select'){const slots=read<Slot[]>(join(batch,'runs.json')),scores=read<{rows:Score[]}>(scoresFile).rows;save(output,independentSelection(slots,scores));}
 else throw new Error('review-tools.ts blind BATCH NEW_BLIND_DIR | summarize BATCH NEW_OUTPUT SCORES | select BATCH NEW_SELECTION INITIAL_SCORES');
}
