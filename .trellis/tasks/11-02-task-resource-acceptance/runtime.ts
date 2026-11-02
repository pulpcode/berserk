import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {chmodSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {PiLab} from '../../../experiments/harness-lab/src/pi/lab.js';
import type {ComposerSelection,SessionSnapshot} from '../../../experiments/harness-lab/src/contracts/index.js';
import type {AnnotationRef} from '../../../experiments/harness-lab/src/contracts/annotations.js';
import type {ContextRef,SituationObject} from '../../../experiments/harness-lab/src/contracts/context.js';
import type {AuthSession} from '../../../experiments/harness-lab/src/contracts/access.js';
import {buildFixture,businessTime,layerId,type AcceptanceFixture} from './fixtures.js';
import {acceptanceCase,type AcceptanceTurn,type CaseId} from './cases.js';
import {profile} from './budget.js';
import {digest} from './provider.js';
export const taskRoot=fileURLToPath(new URL('./',import.meta.url));
export const repo=resolve(taskRoot,'../../..');
export const packageRoot=join(repo,'experiments/harness-lab');
export const revision='12e1cc9';
export function save(path:string,value:unknown){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});}
export function hashes(directory:string):Record<string,string>{const result:Record<string,string>={};const walk=(relative:string)=>{for(const entry of readdirSync(join(directory,relative),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const name=join(relative,entry.name);if(entry.isDirectory())walk(name);else result[name]=digest(readFileSync(join(directory,name)));}};walk('');return result;}
export interface Runtime {root:string;integrity:Record<string,string>;dependencies:Record<string,Record<string,string>>;verify:()=>Promise<void>}
export function dependencyHashes(){return Object.fromEntries(['@earendil-works/pi-ai','@earendil-works/pi-coding-agent'].map(name=>[name,hashes(realpathSync(join(packageRoot,'node_modules',name)))]));}
export async function buildRuntime(directory:string,web=false):Promise<Runtime>{
 const root=join(directory,'product');assert.ok(!existsSync(root),'Runtime already exists');await mkdir(root,{recursive:true,mode:0o700});
 const archive=execFileSync('git',['archive','--format=tar',revision,...['src','scripts','fixtures','public','package.json','package-lock.json','tsconfig.json','index.html','vite.config.ts'].map(n=>'experiments/harness-lab/'+n)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',root],{input:archive});
 assert.equal(readFileSync(join(root,'package-lock.json'),'utf8'),readFileSync(join(packageRoot,'package-lock.json'),'utf8'),'Dependency lock drift');
 await symlink(join(packageRoot,'node_modules'),join(root,'node_modules'),'dir');
 const frozen=JSON.parse(readFileSync(join(taskRoot,'product-freeze.json'),'utf8')) as {files:Record<string,string>};
 for(const [name,hash] of Object.entries(frozen.files))assert.equal(digest(readFileSync(join(root,name.replace('experiments/harness-lab/','')))),hash,name);
 if(web){execFileSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--configLoader','runner'],{cwd:root,stdio:'pipe'});assert.ok(existsSync(join(root,'dist/index.html')));}
 const integrity=hashes(root),dependencies=dependencyHashes();save(join(directory,'runtime-integrity.json'),{revision,archiveHash:digest(archive),files:integrity,dependencies,webBuiltFromFrozenSource:web});
 const verify=async()=>{assert.deepEqual(hashes(root),integrity,'frozen_product_drift');assert.deepEqual(dependencyHashes(),dependencies,'installed_sdk_drift');};
 return {root,integrity,dependencies,verify};
}
const refKey=(ref:ContextRef)=>JSON.stringify([ref.systemId,ref.objectType,ref.objectId]);
/** Fixture HTTP service; response serialization is consumed by the real ContextService. */
export async function startSource(fixture:AcceptanceFixture,directory:string){
 let objects=structuredClone(fixture.objects),version=1;const token=randomBytes(32).toString('hex');const unavailable=new Set<string>();
 const server=createServer((request,response)=>{
  const url=new URL(request.url??'/', 'http://127.0.0.1');const [systemId,route]=url.pathname.split('/').filter(Boolean);
  const finish=(status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(value));};
  if(request.headers.authorization!==`Bearer ${token}`){finish(401,{error:{code:'UNAUTHORIZED'}});return;}
  const system=fixture.systems.find(s=>s.id===systemId);if(!system||route!=='objects'){finish(404,{error:{code:'NOT_FOUND'}});return;}
  if(unavailable.has(systemId)){finish(503,{error:{code:'UNAVAILABLE'}});return;}
  try{
   const list=(key:string):string[]=>url.searchParams.has(key)?JSON.parse(url.searchParams.get(key)!):[];
   const refs:ContextRef[]=url.searchParams.has('objectRefs')?JSON.parse(url.searchParams.get('objectRefs')!):[];
   const types=list('objectTypes'),areas=list('areaIds'),query=url.searchParams.get('query'),taskId=url.searchParams.get('taskId'),relation=url.searchParams.get('relation'),category=url.searchParams.get('category');
   const all=objects.filter(o=>o.ref.systemId===systemId);
   let matches=all.filter(o=>(!refs.length||refs.some(r=>refKey(r)===refKey(o.ref)))&&(!types.length||types.includes(o.ref.objectType))&&(!areas.length||areas.some(a=>o.areaIds.includes(a)))&&(!query||o.name.includes(query))&&(!category||o.resourceData?.resource.category===category)&&(!taskId||o.resourceData?.resource.taskRelations?.some(r=>r.taskId===taskId))&&(!relation||o.resourceData?.resource.taskRelations?.some(r=>r.relation===relation&&(!taskId||r.taskId===taskId))));
   const limit=Number(url.searchParams.get('limit')??20),cursor=url.searchParams.get('cursor');let offset=0;
   if(cursor){const [v,n]=cursor.split(':').map(Number);if(v!==version||!Number.isSafeInteger(n)||n<0){finish(409,{error:{code:'CURSOR_STALE'}});return;}offset=n;}
   const count=matches.length;matches=matches.slice(offset,offset+limit);
   const result={systemId,asOf:businessTime,items:matches,limit,nextCursor:offset+limit<count?`${version}:${offset+limit}`:null,hasMore:offset+limit<count,timeUnknownCount:0,unknownRefs:refs.filter(r=>!all.some(o=>refKey(r)===refKey(o.ref))),changeCursor:`fixture:${version}`,resourceCoverage:system.coverage};
   const log=join(directory,'source-requests.jsonl');writeFileSync(log,JSON.stringify({at:new Date().toISOString(),url:url.pathname+url.search,result})+'\n',{flag:'a',mode:0o600});finish(200,result);
  }catch{finish(400,{error:{code:'INVALID_ARGUMENT'}});}
 });
 await new Promise<void>(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));const address=server.address();assert.ok(address&&typeof address==='object');
 return {url:`http://127.0.0.1:${address.port}`,token,unavailable,update(next:SituationObject[]){objects=structuredClone(next);version++;save(join(directory,'controller-source-update.json'),{at:new Date().toISOString(),version,objects});},close:()=>new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()))};
}
export interface Trial {
 id:string;caseId:CaseId;directory:string;runtime:Runtime;lab:PiLab;sessionId:string;taskId:string;url:string;fixture:AcceptanceFixture;
 draftRef?:AnnotationRef;publishedRef?:AnnotationRef;source:Awaited<ReturnType<typeof startSource>>;
 request:<T>(path:string,method?:string,body?:unknown)=>Promise<T>;headers:Record<string,string>;
 close:()=>Promise<void>;state:()=>unknown;
}
export async function startTrial(runtime:Runtime,directory:string,id:string,caseId:CaseId,secret:string,port=4335,web=false):Promise<Trial>{
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);await runtime.verify();
 const module=<T>(path:string)=>import(pathToFileURL(join(runtime.root,path)).href) as Promise<T>;
 const [{openDatabase},{AccessStore},{loadConfig},{PiLab},{createApp}]=await Promise.all([
  module<typeof import('../../../experiments/harness-lab/src/access/database.js')>('src/access/database.ts'),module<typeof import('../../../experiments/harness-lab/src/access/store.js')>('src/access/store.ts'),module<typeof import('../../../experiments/harness-lab/src/server/config.js')>('src/server/config.ts'),module<typeof import('../../../experiments/harness-lab/src/pi/lab.js')>('src/pi/lab.ts'),module<typeof import('../../../experiments/harness-lab/src/server/app.js')>('src/server/app.ts'),
 ]);
 const dataDir=join(directory,'data');await mkdir(dataDir,{mode:0o700});const db=await openDatabase(dataDir);const access=new AccessStore(db),password=randomBytes(18).toString('hex');
 await access.saveAccount({username:'reviewer',password,displayName:'验收席',seatId:'acceptance',seatName:'验收席',createPublicTask:true,manageModelSettings:true,viewWorkOverview:true});
 const actor=access.identityForSeat('acceptance')!,scenario=acceptanceCase(caseId);
 const task=access.create(actor,{clientActionId:randomUUID(),title:scenario.taskTitle,goal:scenario.taskGoal,visibility:'public'});
 const fixture=buildFixture(caseId,task.id);access.update(actor,task.id,task.revision,{context:{businessRefs:fixture.businessRefs,focus:{areaIds:[],topics:[]}}});db.close();
 save(join(directory,'fixture.json'),fixture);save(join(directory,'credentials.json'),{username:'reviewer',password});
 const source=await startSource(fixture,directory);
 const config=loadConfig({LLM_PROVIDER:profile.provider,LLM_MODEL:profile.model,LLM_BASE_URL:profile.baseUrl,LLM_API_KEY:secret,LLM_CONTEXT_WINDOW:String(profile.contextWindow),LLM_MAX_OUTPUT_TOKENS:String(profile.maxOutputTokens),LLM_THINKING_MODE:profile.thinkingMode,LAB_AUTH_MODE:'login',LAB_SESSION_SECRET:randomBytes(40).toString('hex'),LAB_DATA_DIR:dataDir,LAB_SEAT_ID:'acceptance',LAB_EXECUTION_ENABLED:'false',PORT:String(port)});
 const lab=await PiLab.create(config);const oldCwd=process.cwd();process.chdir(runtime.root);
 let app:Awaited<ReturnType<typeof createApp>>;
 try{app=await createApp(lab,web,undefined,{config:{systems:fixture.systems.map(s=>({id:s.id,name:s.name,resourceCapability:s.resourceCapability,adapter:'mock-situation-http',baseUrl:source.url+'/'+s.id,tokenEnv:'ACCEPTANCE_SOURCE_TOKEN',areas:fixture.contextAreas})),scopes:[{id:'acceptance',name:'本题授权资料',systemIds:fixture.systems.map(s=>s.id),seatIds:['acceptance']}]},env:{ACCEPTANCE_SOURCE_TOKEN:source.token}});}catch(error){process.chdir(oldCwd);await lab.close();await source.close();throw error;}
 try {
 await app.listen({host:'127.0.0.1',port});const url=`http://127.0.0.1:${port}`;
 const initial=await fetch(url+'/api/auth/session');const auth=await initial.json() as AuthSession;
 const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:url,'x-csrf-token':auth.csrf!,cookie:initial.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')},body:JSON.stringify({username:'reviewer',password})});assert.equal(login.status,200);const logged=await login.json() as AuthSession;
 const headers={origin:url,'x-csrf-token':logged.csrf!,'x-axon-view':logged.viewId!,cookie:login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ')};
 const request=async<T>(path:string,method='GET',body?:unknown):Promise<T>=>{const response=await fetch(url+path,{method,headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,`${method} ${path}: ${response.status} ${await (response.ok?Promise.resolve(''):response.text())}`);return response.json() as Promise<T>;};
 const workspace=await request<{id:string}>(`/api/tasks/${task.id}/workspace`,'POST',{});const session=await request<SessionSnapshot>('/api/sessions','POST',{workspaceId:workspace.id});
 const annotation=lab.annotations!,annotationActor=annotation.actorForSeat('acceptance',actor.userId);let publishedRef:AnnotationRef|undefined,draftRef:AnnotationRef|undefined;
 const createDraft=(sessionId:string,features:AcceptanceFixture['draftFeatures'])=>annotation.action(annotationActor,sessionId,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,operations:[{op:'add_layer',layer:{layerId,name:'业务图层',order:0,defaultVisible:true,features}}]});
 if(fixture.publishedFeatures.length){const publisher=await lab.createSession(workspace.id,'acceptance');const draft=createDraft(publisher.id,fixture.publishedFeatures);const publication=annotation.action(annotationActor,publisher.id,{action:'publish',clientActionId:randomUUID(),revision:('revision' in draft.ref!?draft.ref.revision:1),title:'任务采用图层'});publishedRef=publication.ref!;assert.ok('publicationId' in publishedRef);annotation.setCurrent(annotationActor,task.id,{clientActionId:randomUUID(),publicationId:publishedRef.publicationId,expectedCurrentSequence:0});}
 if(fixture.draftFeatures.length||fixture.controlledImports.length){draftRef=createDraft(session.id,fixture.draftFeatures).ref!;for(const item of fixture.controlledImports){const revision=annotation.binding(annotationActor,session.id).draft!.headRevision;const sourceObject=fixture.objects.find(o=>refKey(o.ref)===refKey(item.sourceRef))!;draftRef=(await annotation.fromSource(annotationActor,session.id,{clientActionId:randomUUID(),mode:'add',sourceRef:item.sourceRef,expectedSourceRevision:sourceObject.revision,expectedRevision:revision,layerId,objectId:item.objectId})).ref!;if(item.resourceOverride)draftRef=annotation.action(annotationActor,session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:annotation.binding(annotationActor,session.id).draft!.headRevision,operations:[{op:'update_object',objectId:item.objectId,changes:{resource:item.resourceOverride}}]}).ref!;}}
 const state=()=>({task:lab.access!.get(task.id,'acceptance'),binding:annotation.binding(annotationActor,session.id),listing:annotation.list(annotationActor,task.id),current:annotation.current(annotationActor,task.id),draftDocument:(()=>{const draft=annotation.binding(annotationActor,session.id).draft;return draft?annotation.version(annotationActor,task.id,{setId:draft.setId,revision:draft.headRevision}):null;})(),workspaceFiles:hashes(join(dataDir,'workspaces'))});
 const trial:Trial={id,caseId,directory,runtime,lab,sessionId:session.id,taskId:task.id,url,fixture,draftRef,publishedRef,source,headers,request,state,close:async()=>{try{await app.close();}finally{process.chdir(oldCwd);await source.close();}}};
 save(join(directory,'manifest.json'),{id,caseId,sessionId:session.id,taskId:task.id,url,dataDir,profile,businessTime,actualClock:true,draftRef,publishedRef});save(join(directory,'state-before.json'),state());return trial;
 }catch(error){try{await app.close();}finally{process.chdir(oldCwd);await source.close();}throw error;}
}
export function selection(trial:Trial,turn:AcceptanceTurn):ComposerSelection {
 const result:ComposerSelection={};
 if(turn.annotationSelection){const ref=turn.annotationSelection==='draft-layer'?trial.draftRef:trial.publishedRef;assert.ok(ref);result.annotationRefs=[{...ref,layerIds:[layerId]}];}
 if(turn.areaObjectId){const object=trial.fixture.objects.find(o=>o.ref.objectId===turn.areaObjectId);assert.ok(object);result.contextRefs=[object.ref];}
 return result;
}
