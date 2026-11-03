/** Offline evidence packaging and deterministic aggregation; never calls a model. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export type Verdict='pass'|'fail'|'pending';
export interface Score {blindId:string;mainRequirement:Verdict;processFacts:Verdict|'na';finalFacts:Verdict;effects:Verdict;boundaries:Verdict;strict:Verdict;quotes:string[];evidence:string[];reason:string;clarity:string;failureCategory?:string}
export interface Slot {id:string;caseId:string;group:string;round:number;status:string;blindId?:string;elapsedMs?:number;completedUserTurns?:number;plannedUserTurns?:number;stop?:string}
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const save=(p:string,v:unknown)=>{assert.ok(!existsSync(p),`Refuse overwrite ${p}`);writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});};
const seed='R15-20261027-review';
export function strictOf(s:Omit<Score,'strict'>|Score):Verdict{const values=[s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries];return values.includes('fail')?'fail':values.includes('pending')?'pending':'pass';}
export function validateScore(s:Score){assert.ok(s.blindId);for(const key of ['mainRequirement','finalFacts','effects','boundaries','strict'] as const)assert.ok(['pass','fail','pending'].includes(s[key]),key);assert.ok(['pass','fail','pending','na'].includes(s.processFacts));assert.equal(s.strict,strictOf(s),'strict must match component verdicts');assert.ok(s.evidence.length&&s.reason.trim(),'All verdicts need evidence and rationale');if(s.strict==='fail')assert.ok(s.quotes.length,'Failures must identify exact public claim or missing required content');}
/** Only wire public history, never SSE/private reasoning, establishes model-visible evidence. */
export function publicMessage(value:unknown):unknown{if(Array.isArray(value))return value.map(publicMessage);if(value&&typeof value==='object'){const result:Record<string,unknown>={};for(const [k,v]of Object.entries(value)){if(['reasoning_content','reasoning','thinking','thinkingSignature','reasoningSignature','model','provider','usage','cost'].includes(k))continue;if(k==='type'&&v==='thinking')return {type:'omitted_private_reasoning'};result[k]=publicMessage(v);}return result;}return value;}
export function packBlind(batch:string,target:string){assert.ok(!existsSync(target));mkdirSync(target,{mode:0o700});const slots=read<Slot[]>(join(batch,'runs.json')),mapping=[];
 for(const row of [...slots].sort((a,b)=>(a.blindId??'').localeCompare(b.blindId??''))){if(!row.blindId)continue;const dir=join(batch,row.id),path=join(dir,'judge-input.json');const out=join(target,row.blindId);mkdirSync(out,{mode:0o700});const raw=existsSync(path)?read<Record<string,unknown>>(path):{schemaVersion:1,id:row.blindId,unit:'task',evidenceUnavailable:true,reason:'Execution ended before a complete public task snapshot was captured. Only received public wire history and completion status are available; do not infer successful business output.',visibleTranscript:[],stateEvidence:[]};save(join(out,'judge-input.json'),publicMessage(raw));
 const files=readdirSync(dir).filter(f=>f.endsWith('-wire-input.json')).sort();const observedMessages=files.map((f,i)=>{const payload=read<{messages:unknown[]}>(join(dir,f));return {request:i+1,messages:publicMessage(payload.messages)};});save(join(out,'model-visible-evidence.json'),{observedMessages});
 save(join(out,'completion.json'),{status:row.status,completedUserTurns:row.completedUserTurns,plannedUserTurns:row.plannedUserTurns,stop:row.stop?.split('\n')[0].replace(/deepseek[\w.-]+/gi,'[model identity omitted]').replaceAll(row.id,'[entry]').replace(/runtimes\/(?:G0|GS|GT|GST)(?=\/|$)/g,'runtimes/[group]')??null});mapping.push({blindId:row.blindId,entryId:row.id,caseId:row.caseId,group:row.group,round:row.round});
 }
 save(join(target,'index.json'),mapping.map(m=>({blindId:m.blindId,caseId:m.caseId})));save(join(batch,'blind-mapping.json'),mapping);return mapping.length;
}
export function independentSelection(slots:Slot[],scores:Score[]){const byId=new Map(scores.map(s=>[s.blindId,s]));const selected=new Set<string>();for(const s of scores)if(s.strict!=='pass')selected.add(s.blindId);
 for(const row of slots){if(!row.blindId)continue;const peers=slots.filter(x=>x.caseId===row.caseId&&x.round===row.round);const signatures=peers.map(p=>{const s=p.blindId?byId.get(p.blindId):undefined;return s?JSON.stringify([s.mainRequirement,s.processFacts,s.finalFacts,s.effects,s.boundaries]):'missing';});if(new Set(signatures).size>1)for(const p of peers)if(p.blindId&&byId.has(p.blindId))selected.add(p.blindId);}
 const passing=scores.filter(s=>s.strict==='pass').sort((a,b)=>hash(seed+a.blindId).localeCompare(hash(seed+b.blindId)));for(const s of passing.slice(0,Math.ceil(passing.length*.25)))selected.add(s.blindId);return {seed,total:selected.size,ids:[...selected].sort(),randomPassCount:Math.ceil(passing.length*.25)};
}
/** Reject malformed slot/review joins before computing fixed-denominator rates. */
export function validateSlots(slots:Slot[]){
 assert.equal(slots.length,48,'expected 48 scheduled slots');const entryIds=new Set<string>(),tuples=new Set<string>(),blindIds=new Set<string>();
 for(const row of slots){
  assert.ok(row.id&&!entryIds.has(row.id),'duplicate or missing entry ID');entryIds.add(row.id);
  assert.ok(/^P(?:0[1-9]|1[0-2])$/.test(row.caseId),'unknown case ID');assert.ok(['G0','GS','GT','GST'].includes(row.group),'unknown group');assert.ok(row.round===1,'unknown repetition');
  const tuple=`${row.caseId}:${row.round}:${row.group}`;assert.ok(!tuples.has(tuple),'duplicate scheduled tuple');tuples.add(tuple);
  assert.ok(['not_executed','started','recorded','waiting_user','incomplete','interrupted'].includes(row.status),'unknown slot status');
  if(row.blindId){assert.ok(!blindIds.has(row.blindId),'duplicate blind ID');blindIds.add(row.blindId);assert.notEqual(row.status,'not_executed','unexecuted slot has blind ID');}
 }
}
export function aggregate(slots:Slot[],scores:Score[],_historicalIds:string[]=[]){void _historicalIds;validateSlots(slots);const ids=new Set<string>();for(const s of scores){validateScore(s);assert.ok(!ids.has(s.blindId),'duplicate review');ids.add(s.blindId);const slot=slots.find(r=>r.blindId===s.blindId);assert.ok(slot,'review without slot');assert.ok(slot.status!=='not_executed'&&slot.status!=='started','review requires ended slot');}const byId=new Map(scores.map(s=>[s.blindId,s]));
 const count=(rows:Slot[],key:'strict'|'mainRequirement')=>({planned:rows.length,pass:rows.filter(r=>r.blindId&&byId.get(r.blindId)?.[key]==='pass').length,fail:rows.filter(r=>r.blindId&&byId.get(r.blindId)?.[key]==='fail').length,pending:rows.filter(r=>r.status!=='not_executed'&&(!r.blindId||!byId.has(r.blindId)||byId.get(r.blindId)?.[key]==='pending')).length,notExecuted:rows.filter(r=>r.status==='not_executed').length});
 const categories={source:['P01','P02'],lookup:['P03','P04'],counts:['P05','P06'],state:['P07','P08'],direction:['P09','P10'],authorship:['P11','P12']};
 const groups=Object.fromEntries(['G0','GS','GT','GST'].map(g=>{const rows=slots.filter(r=>r.group===g);assert.equal(rows.length,12);return [g,{main:count(rows,'mainRequirement'),strict:count(rows,'strict'),categories:Object.fromEntries(Object.entries(categories).map(([k,ids])=>[k,{main:count(rows.filter(r=>ids.includes(r.caseId)),'mainRequirement'),strict:count(rows.filter(r=>ids.includes(r.caseId)),'strict')}]))}];}));
 const comparisons=Object.fromEntries([['GS','G0'],['GT','G0'],['GST','G0'],['GST','GS'],['GST','GT']].map(([candidate,baseline])=>{const counts={improved:0,regressed:0,bothPass:0,bothFail:0,unresolved:0};const details=[];for(const r of slots.filter(x=>x.group===candidate)){const b=slots.find(x=>x.caseId===r.caseId&&x.group===baseline)!;const aScore=r.blindId?byId.get(r.blindId):undefined,bScore=b.blindId?byId.get(b.blindId):undefined;const a=aScore?.strict,c=bScore?.strict;const key=a==='pass'&&c==='fail'?'improved':a==='fail'&&c==='pass'?'regressed':a==='pass'&&c==='pass'?'bothPass':a==='fail'&&c==='fail'?'bothFail':'unresolved';counts[key]++;details.push({caseId:r.caseId,outcome:key});}return [candidate+'vs'+baseline,{...counts,net:counts.improved-counts.regressed,details}];}));return {groups,comparisons,coverage:{planned:slots.length,reviewed:scores.length},notIndependentHeldout:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [command,batch,output,scoresFile]=process.argv.slice(2);if(command==='blind'){console.info(JSON.stringify({packaged:packBlind(batch,output)}));}else if(command==='summarize'){const slots=read<Slot[]>(join(batch,'runs.json')),scores=read<{rows:Score[]}>(scoresFile).rows;save(output,{...aggregate(slots,scores,[]),independentReview:independentSelection(slots,scores)});}else throw new Error('review-tools.ts blind BATCH NEW_BLIND_DIR | summarize BATCH NEW_OUTPUT SCORES');}
