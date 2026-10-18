/** R2 evaluator: isolated byte-verified runtimes; reused frozen observer and effects. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {cp,mkdir,readdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {SessionSnapshot,WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest,type startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {uniqueSpatialResults} from '../../../../experiments/harness-lab/scripts/probe-spatial-evaluation.js';
import {Observer,ask,digest,effectCheck,hashes as originalHashes,limits,modelConfig} from '../round1-20261017/run.js';
import {schedule,cases,groups,promptsFor,prepareFixture,type Group,type Entry} from './cases.js';
export const taskDir=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(taskDir,'../../../..'),packageRoot=join(repo,'experiments/harness-lab');
export const fixedDay='2026-10-18';
// Evaluation budget override in this process only; the historical source and records remain frozen.
limits.input=6000000;
export const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export async function treeHashes(dir:string,prefix=''):Promise<Record<string,string>>{
 const out:Record<string,string>={};for(const e of await readdir(join(dir,prefix),{withFileTypes:true})){
  const p=join(prefix,e.name);if(e.isSymbolicLink())continue;
  if(e.isDirectory())Object.assign(out,await treeHashes(dir,p));else out[p]=digest(readFileSync(join(dir,p)));
 }return out;
}
export async function sourceHashes(){return {'r2-execution-plan-20261018.md':digest(readFileSync(join(taskDir,'../r2-execution-plan-20261018.md'))),...await originalHashes(),...Object.fromEntries(Object.entries(await treeHashes(taskDir)).map(([p,h])=>[join(taskDir,p).slice(repo.length+1),h]))};}
export interface Runtime {root:string;hashes:Record<string,string>;start:typeof startMapTrial;skills:Record<string,{content:string;hash:string}>}
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 const root=join(directory,'runtimes',group);await mkdir(root,{recursive:true,mode:0o700});
 for(const name of ['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'])await cp(join(packageRoot,name),join(root,name),{recursive:true});
 await symlink(join(packageRoot,'node_modules'),join(root,'node_modules'),'dir');
 const before=await treeHashes(root),skills:Runtime['skills']={};
 const changed=group==='map-only'?'map-annotations':group==='spatial-only'?'spatial-analysis':undefined;
 for(const id of ['map-annotations','spatial-analysis']){const candidate=join(taskDir,'skills',group,id,'SKILL.md');assert.ok(existsSync(candidate),`Missing candidate ${candidate}`);await cp(candidate,join(root,'fixtures/skills',id,'SKILL.md'));}
 const after=await treeHashes(root),diff=Object.keys(before).filter(p=>before[p]!==after[p]);assert.deepEqual(diff,changed?[`fixtures/skills/${changed}/SKILL.md`]:[],'Runtime differs outside one declared Skill body');
 for(const id of ['map-annotations','spatial-analysis']){const content=readFileSync(join(root,'fixtures/skills',id,'SKILL.md'),'utf8');skills[id]={content,hash:digest(content)};}
 save(join(root,'runtime-integrity.json'),{group,allowedDiff:diff,before,after});
 const start=(await import(pathToFileURL(join(root,'scripts/probe-situation-map.ts')).href) as {startMapTrial:typeof startMapTrial}).startMapTrial;
 return {root,hashes:await treeHashes(root),start,skills};
}
export function selectionFor(entry:Entry,catalog:WorkspaceResources){const skill=catalog.skills.find(s=>s.id===entry.selectedSkill);assert.ok(skill);return {id:skill.id,hash:skill.hash};}
function messageText(payload:{messages?:Array<{content:unknown}>}){return (payload.messages??[]).map(m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map((block:{text?:string})=>block.text??'').join('\n'):JSON.stringify(m.content)).join('\n');}
export class R2Observer extends Observer {
 runtime?:Runtime;entry?:Entry;private first=true;
 constructor(original:typeof fetch,directory:string,originalFrozen:Record<string,string>,readonly frozen:Record<string,string>){super(original,directory,originalFrozen);}
 begin(runtime:Runtime,entry:Entry){this.runtime=runtime;this.entry=entry;this.first=true;this.budget.begin();}
 override async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  try {
  assert.equal(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),fixedDay,'Synthetic day changed before provider call');
  assert.deepEqual(await sourceHashes(),this.frozen,'R2 source drift');assert.ok(this.runtime&&this.entry);
  assert.deepEqual(await treeHashes(this.runtime.root),this.runtime.hashes,'Isolated runtime drift');
  const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';const payload=JSON.parse(raw);
  const text=messageText(payload),visibility=Object.fromEntries(Object.entries(this.runtime.skills).map(([id,s])=>[id,{hash:s.hash,bodyPresent:text.includes(s.content)||text.includes(JSON.stringify(s.content).slice(1,-1))}]));
  save(join(this.active!.directory,`provider-${String(this.budget.total+1).padStart(4,'0')}-skill-evidence.json`),{selected:this.entry.selectedSkill,visibility});
  if(this.first){assert.ok(visibility[this.entry.selectedSkill].bodyPresent,'Explicit selected body absent from first provider request');save(join(this.active!.directory,'first-provider-skill-evidence.json'),{selected:this.entry.selectedSkill,visibility});this.first=false;}
  return await super.provider(input,init);
  }catch(error){this.cancel(`r2_guard:${String(error)}`,true);throw error;}
 }
}
export async function main(args=process.argv.slice(2)){
 const [mode,batch,portText]=args;assert.ok(['preflight','run'].includes(mode)&&batch&&/^[a-zA-Z0-9_-]+$/.test(batch)&&args.length<=3,'run.ts preflight|run UNIQUE_BATCH [PORT]');
 const port=Number(portText??4490);assert.ok(Number.isInteger(port)&&port>=1024&&port<65000);
 const directory=join(repo,'.local/spatial-r2',batch);mkdirSync(join(repo,'.local/spatial-r2'),{recursive:true,mode:0o700});mkdirSync(directory,{recursive:false,mode:0o700});
 const frozen=await sourceHashes(),originalFrozen=await originalHashes(),original=globalThis.fetch;
 const observer=new R2Observer(original,directory,originalFrozen,frozen),runtimes=new Map<Group,Runtime>();globalThis.fetch=observer.fetch;
 const rows:Array<Record<string,unknown>>=schedule.map(e=>({...e,status:'not_executed',semanticReview:'pending_review'}));
 save(join(directory,'protocol.json'),{version:2,mode,schedule,prompts:Object.fromEntries(cases.map(c=>[c,promptsFor(schedule.find(e=>e.caseId===c)!)])),limits,modelConfig,fixedDay,hashes:frozen,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),node:process.version,secondRound:false,semanticRetries:false,fixtureDifference:'Fresh UUIDs and timestamps; same frozen synthetic day, geometry and identity relations within each case',grading:'Offline independent full-visible-transcript and actual-effect review, never tool-called scoring'});
 observer.live=mode==='run';
 try{
  for(const group of groups)runtimes.set(group,await buildRuntime(directory,group));
  for(const entry of schedule){
   if(observer.budget.fatal)break;
   const row=rows.find(r=>r.id===entry.id)!,dir=join(directory,entry.id);mkdirSync(dir,{mode:0o700});row.status='started';save(join(directory,'runs.json'),rows);
   let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
   try{
    const runtime=runtimes.get(entry.group)!;
    trial=await runtime.start(port,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:entry.model,LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'4096',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined},false);
    assert.equal(trial.manifest.day,fixedDay,'Synthetic date changed: stop before model call');
    const fixture=await prepareFixture(trial.manifest,entry);save(join(dir,'manifest.json'),trial.manifest);save(join(dir,'fixture.json'),fixture);
    const session=await mapTrialRequest<SessionSnapshot>(trial.manifest,`/api/sessions/${fixture.sessionId}`,'planning');
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${session.workspaceId}/resources`,'planning');
    for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(x=>x.id===id)?.hash,s.hash);
    const selection=selectionFor(entry,catalog);save(join(dir,'resources.json'),{catalog,selection,runtimeSkillHashes:Object.fromEntries(Object.entries(runtime.skills).map(([id,s])=>[id,s.hash]))});
    if(mode==='preflight'){row.status='prepared';continue;}
    if(!existsSync(join(directory,'first-paid-freeze.json')))save(join(directory,'first-paid-freeze.json'),{at:new Date().toISOString(),hashes:frozen,entry:entry.id,scheduleHash:digest(JSON.stringify(schedule))});
    observer.begin(runtime,entry);observer.active={entry,fixture,trial,directory:dir,turn:0,interaction:false,toolCount:0,knownResultRefs:new Set()};const a=observer.active;
    const timer=setTimeout(()=>observer.cancel('wall_budget'),limits.trialMs);let final:Awaited<ReturnType<typeof ask>>|undefined;
    try{
     for(const [turn,text] of promptsFor(entry).entries()){
      a.turn=turn;const before=await mapState(trial.manifest,fixture.sessionId);save(join(dir,`turn-${turn+1}-before.json`),before);
      final=await ask(observer,selection,text,(entry.kind==='J03'&&turn===1)||entry.kind==='J10'?fixture.annotationRefs:undefined);
      const checks=effectCheck(fixture,final.after,turn,final.snapshot);save(join(dir,`turn-${turn+1}-effects.json`),checks);const expected=Object.values(checks).every(Boolean);
      if(!expected&&JSON.stringify(before)!==JSON.stringify(final.after))observer.cancel('unexpected_state_mutation',true);
      if(fixture.otherSessionId){const other=await mapState(trial.manifest,fixture.otherSessionId);save(join(dir,`turn-${turn+1}-other.json`),other);if(JSON.stringify(other)!==JSON.stringify(fixture.otherBefore))observer.cancel('foreign_state_mutation',true);}
      if(a.stop||final.snapshot.lastResult?.status!=='succeeded'||!expected){row.status='dependency_or_protocol_incomplete';break;}
     }
     if(final){const ids=[...new Set(final.snapshot.messages.flatMap(m=>m.requestId?[m.requestId]:[]))];const resources=await Promise.all(ids.map(async requestId=>({...await mapTrialRequest<Record<string,unknown>>(trial!.manifest,`/api/sessions/${fixture.sessionId}/requests/${requestId}/resources`,'planning'),requestId})));save(join(dir,'final-state.json'),{...final,resources,results:uniqueSpatialResults(final.snapshot.messages)});}
     if(row.status==='started')row.status='recorded';if(a.interaction){row.status=['J09','J11'].includes(entry.kind)?'boundary_interaction_recorded':'interaction_recorded';row.interaction=true;}
     Object.assign(row,{stop:a.stop??null,toolCalls:a.toolCount,providerRequests:observer.budget.trial,elapsedMs:Date.now()-observer.budget.started});
    }finally{clearTimeout(timer);await observer.settle();observer.active=undefined;}
   }catch(error){row.status='technical_failure';row.error=String(error);observer.budget.fatal??='evidence_or_execution_failure';save(join(dir,'failure.json'),{error:String(error)});}
   finally{if(trial){await cp(join(trial.manifest.dataDir,'sessions'),join(dir,'native-sessions'),{recursive:true});await trial.stop();}save(join(dir,'result.json'),row);save(join(directory,'runs.json'),rows);save(join(directory,'budget.json'),observer.budget);save(join(directory,'attempts.json'),observer.attempts);console.info(JSON.stringify({entry:entry.id,status:row.status,requests:observer.budget.total,fatal:observer.budget.fatal??null}));}
  }
  assert.deepEqual(await sourceHashes(),frozen);
 }finally{globalThis.fetch=original;save(join(directory,'runs.json'),rows);save(join(directory,'budget.json'),observer.budget);save(join(directory,'attempts.json'),observer.attempts);}
 if(observer.budget.fatal)process.exitCode=1;console.info(JSON.stringify({directory,mode,providerAttempts:observer.budget.total}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(String(error));process.exitCode=1;});
