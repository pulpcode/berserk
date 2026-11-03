/** D04 approved revision: real draft reads with a missing optional quantity, no provider traffic. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AnnotationReadResult} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {ContextQueryResult} from '../../../../experiments/harness-lab/src/contracts/context.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {mapFixtures} from '../../../../experiments/harness-lab/scripts/mock-context/map-fixtures.js';
import {groups,prepareCase,canonicalFixtureHash,criticalEffect,cases} from './cases.js';
import {buildRuntime,offlineEnvironment,groupEnvironment,loopbackOnly,digest} from './runtime.js';
const read=<T>(name:string)=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8')) as T;
function pythonCanonical(value:unknown):string {return Array.isArray(value)?'['+value.map(pythonCanonical).join(', ')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+': '+pythonCanonical((value as Record<string,unknown>)[k])).join(', ')+'}':JSON.stringify(value);}
test('D04 approved revision leaves the other 23 frozen tasks, schedule and old failure evidence unchanged',()=>{
 const before=read<{other23:Record<string,string>;scheduleHash:string;oldFailureLogs:Record<string,string>}>('./d04-revision-baseline.json');
 const current=read<{cases:Array<{id:string}>}>('./cases.json');
 for(const c of current.cases.filter(c=>c.id!=='D04'))assert.equal(digest(pythonCanonical(c)),before.other23[c.id],`${c.id} must not change`);
 assert.equal(digest(readFileSync(new URL('./schedule.json',import.meta.url))),before.scheduleHash);
 for(const [name,hash] of Object.entries(before.oldFailureLogs))assert.equal(digest(readFileSync(new URL(name,import.meta.url))),hash);
 const d04=cases.find(c=>c.id==='D04')!;assert.ok(d04.prompts[0].includes('本会话草稿 vehicle-points'));assert.ok(d04.prompts[0].includes('不使用来源系统'));assert.equal(current.cases.length,24);
});
test('D04 A/B/C read all three draft points and missing attribute through real APIs; source stays normal',{timeout:180000},async()=>{
 const original=globalThis.fetch;globalThis.fetch=loopbackOnly(original);const directory=await mkdtemp(join(tmpdir(),'r14-d04-')),evidence:unknown[]=[];
 try{
  const runtimes=await Promise.all(groups.map(g=>buildRuntime(directory,g)));let canonical:string|undefined;
  for(let i=0;i<groups.length;i++){
   const group=groups[i],env=groupEnvironment({...offlineEnvironment(),R14_CASE_ID:'D04',R14_SYNTHETIC_DAY:'2026-10-26'},group),trial=await runtimes[i].start(4991+i,env,false,{background:'neutral'});
   try{
    const p=await prepareCase(trial.manifest,'D04'),hash=canonicalFixtureHash(p);if(canonical)assert.equal(hash,canonical);else canonical=hash;
    const draft=await mapTrialRequest<AnnotationReadResult>(trial.manifest,`/api/tasks/${p.task.id}/annotations/read`,'planning','POST',{ref:p.fixture.before.version!.ref,layerIds:['vehicle-points'],fields:['attributes','geometry'],offset:0,limit:50});
    assert.equal(draft.objects.total,3);assert.equal(draft.objects.hasMore,false);assert.deepEqual(draft.objects.items.map(o=>o.name),['车场甲','车场乙','车场丙']);
    assert.deepEqual(draft.objects.items.map(o=>o.attributes),[{availableCount:4,unit:'辆'},{unit:'辆'},{availableCount:2,unit:'辆'}]);
    assert.deepEqual(draft.objects.items.map(o=>o.geometry),[{type:'Point',coordinates:[114.004,22.504]},{type:'Point',coordinates:[114.008,22.508]},{type:'Point',coordinates:[114.012,22.512]}]);
    const missing=draft.objects.items.filter(o=>typeof o.attributes?.availableCount!=='number').map(o=>o.name),knownTotal=draft.objects.items.reduce((sum,o)=>sum+(typeof o.attributes?.availableCount==='number'?o.attributes.availableCount:0),0);
    assert.deepEqual(missing,['车场乙']);assert.equal(knownTotal,6);assert.equal((p.truth.expected as {completeTotal:unknown}).completeTotal,null);assert.equal((p.truth.expected as {draftOnly:boolean}).draftOnly,true);
    assert.deepEqual(p.sourceBefore.objects,mapFixtures(trial.manifest.trialId,trial.manifest.day).objects);
    const source=await mapTrialRequest<ContextQueryResult>(trial.manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',limit:100});
    const items=(source.data as {items:Array<{ref:{objectType:string}}>}).items;assert.equal(items.filter(o=>o.ref.objectType==='resource').length,2);
    assert.deepEqual(items,[...p.sourceBefore.objects].sort((a,b)=>a.ref.objectType.localeCompare(b.ref.objectType)||a.ref.objectId.localeCompare(b.ref.objectId)));
    const after=await mapState(trial.manifest,p.fixture.sessionId);assert.deepEqual(after,p.fixture.before);assert.equal(criticalEffect(p,{messages:[]} as unknown as SessionSnapshot,after,0),undefined);
    evidence.push({group,canonicalHash:hash,prompt:p.prompts[0],draft,expected:p.truth.expected,sourceQueryStatus:'normal',sourceObjectCount:items.length,actualCount:3,knownTotal,missing,completeTotal:'unknown',draftUnchanged:true,providerRequests:0});
   }finally{await trial.stop();}
  }
  const path=process.env.D04_EVIDENCE_PATH??join(directory,'api-evidence.json');writeFileSync(path,JSON.stringify({kind:'offline_real_business_api',providerRequests:0,groups:evidence},null,2)+'\n',{flag:'wx',mode:0o600});console.info(JSON.stringify({d04Evidence:path,groups:3,providerRequests:0}));
 }finally{globalThis.fetch=original;}
});
