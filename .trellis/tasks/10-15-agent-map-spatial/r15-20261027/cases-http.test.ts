/** Real local HTTP fixture validation; no model provider request is permitted. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cases,groups,prepareCase,canonicalFixtureHash,criticalEffect,type Prepared} from './cases.js';
import {buildRuntime,offlineEnvironment,groupEnvironment,loopbackOnly} from './runtime.js';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {ContextQueryResult} from '../../../../experiments/harness-lab/src/contracts/context.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
test('12 real HTTP fixtures canonical-equivalent across all four groups; catalogues and source remain consistent',{timeout:1_200_000},async(t)=>{
 const original=globalThis.fetch;globalThis.fetch=loopbackOnly(original);const directory=await mkdtemp(join(tmpdir(),'r15-case-http-'));
 try{
 const runtimes:Awaited<ReturnType<typeof buildRuntime>>[]=[];for(const group of groups)runtimes.push(await buildRuntime(directory,group));
 for(const c of cases.filter(c=>!process.env.R15_CASE_FILTER||c.id===process.env.R15_CASE_FILTER))await t.test(c.id,async()=>{
 const trials:Awaited<ReturnType<typeof runtimes[0]['start']>>[]=[],prepared:Prepared[]=[];
 try{
 for(let i=0;i<4;i++){const trial=await runtimes[i].start(5141+i,groupEnvironment({...offlineEnvironment(),R15_CASE_ID:c.id,R15_SYNTHETIC_DAY:'2026-10-27'},groups[i]),false,{background:'neutral'});trials.push(trial);prepared.push(await prepareCase(trial.manifest,c.id));}
 const first=prepared[0];for(const other of prepared.slice(1)){assert.equal(canonicalFixtureHash(first),canonicalFixtureHash(other),`${c.id} group fixture drift`);assert.notEqual(first.fixture.sessionId,other.fixture.sessionId);}
 assert.equal(criticalEffect(first,{messages:[]} as unknown as SessionSnapshot,first.fixture.before,0,[],first.fixture.before),undefined);
 if(c.id==='P04'){assert.deepEqual(first.fixture.before.version!.document.layers,[]);assert.ok(first.fixture.before.binding.draft);}
 const changed=structuredClone(prepared[1]);changed.fixture.before.version!.document.title+='changed';assert.notEqual(canonicalFixtureHash(first),canonicalFixtureHash(changed));
 if(['P01','P02','P03'].includes(c.id)){
 const page=await mapTrialRequest<ContextQueryResult>(trials[0].manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',limit:100});assert.deepEqual((page.data as {items:unknown[]}).items,[...first.sourceBefore.objects].sort((a,b)=>a.ref.objectType.localeCompare(b.ref.objectType)||a.ref.objectId.localeCompare(b.ref.objectId)));
 const config=first.contextConfig as {systems:Array<{areas:Array<{id:string;name:string}>}>};for(const system of config.systems)assert.equal(system.areas.find(a=>a.id.endsWith('-west'))!.name,c.id==='P03'?'西区':'港区');
 }
 }finally{for(const trial of trials)await trial.stop();}
 });
 }finally{globalThis.fetch=original;}
});
