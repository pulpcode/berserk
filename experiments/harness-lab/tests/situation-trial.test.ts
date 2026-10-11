import {afterEach,expect,test} from 'vitest';
import {createServer} from 'node:net';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startMapTrial,mapTrialAuth,mapTrialRequest} from '../scripts/probe-situation-map.js';
import type {SimulationState,SimulationAction} from '../src/contracts/simulation.js';
import type {ContextQueryResult, SituationCurrent} from '../src/contracts/context.js';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.reverse())await cleanup();cleanups.length=0;});
async function freePort() {
  const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('port');
  await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;
}
test('fresh map trial isolates three tasks, does not start models, exposes control only to overall seat',async()=>{
  const external=await mkdtemp(join(tmpdir(),'map-external-'));cleanups.push(()=>rm(external,{recursive:true,force:true}));
  await writeFile(join(external,'sentinel'),'unchanged');
  const trial=await startMapTrial(await freePort(),{...process.env,LAB_DATA_DIR:external,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  expect(trial.manifest.dataDir).not.toBe(external);expect(await readdir(external)).toEqual(['sentinel']);
  expect(new Set(Object.values(trial.manifest.tasks)).size).toBe(3);
  const tasks=await mapTrialRequest<Array<{id:string;title:string}>>(trial.manifest,'/api/tasks');
  expect(tasks).toHaveLength(3);expect(tasks.every(task=>task.title.includes(trial.manifest.trialId))).toBe(true);
  const state=await mapTrialRequest<SimulationState>(trial.manifest,'/api/simulation');
  expect(state.instanceId).toBe(trial.manifest.trialId);expect(state.actions).toEqual([]);
  expect(state.objects.every(object=>object.ref.objectId.startsWith(trial.manifest.trialId))).toBe(true);
  expect(await mapTrialRequest(trial.manifest,'/api/activity')).toMatchObject({sessions:[]});
  expect(await mapTrialRequest(trial.manifest,'/api/information/jobs?limit=100')).toMatchObject({items:[]});
  expect(await mapTrialRequest(trial.manifest,'/api/context/map-config')).toMatchObject({simulationEnabled:true});
  expect(await mapTrialRequest(trial.manifest,'/api/context/map-config','planning')).toMatchObject({simulationEnabled:false});
  const denied=await fetch(`${trial.manifest.url}/api/simulation`,{headers:await mapTrialAuth(trial.manifest,'planning')});expect(denied.status).toBe(404);
  const selected=await mapTrialRequest<ContextQueryResult>(trial.manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',objectRefs:[trial.manifest.objects.road]});
  expect((selected.data as SituationCurrent).items).toHaveLength(1);expect((selected.data as SituationCurrent).items[0]).toMatchObject({geometry:{type:'LineString'},properties:{passability:'open'}});
  const credentialsPath=join(trial.manifest.dataDir,'credentials.json');expect((await stat(credentialsPath)).mode&0o777).toBe(0o600);
  const manifestText=await readFile(join(trial.manifest.dataDir,'manifest.json'),'utf8');
  const credentials=JSON.parse(await readFile(credentialsPath,'utf8'));
  for(const account of Object.values(credentials.accounts) as Array<{password:string}>)expect(manifestText).not.toContain(account.password);
},60_000);

test('saving a source change does not dispatch; sending and retrying uses one actual ingress receipt',async()=>{
  const trial=await startMapTrial(await freePort(),{...process.env,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  const state=await mapTrialRequest<SimulationState>(trial.manifest,'/api/simulation');
  const resource=state.objects.find(object=>object.ref.objectId===trial.manifest.objects.resource.objectId)!;
  const update={clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:2,unit:'辆'},effectiveAt:`${trial.manifest.day}T09:20:00+08:00`,validTime:null};
  const saved=await mapTrialRequest<SimulationAction>(trial.manifest,'/api/simulation/object-updates','overall','POST',update);
  expect(saved.sendState).toBe('unsent');
  expect(await mapTrialRequest(trial.manifest,'/api/information/jobs?limit=100')).toMatchObject({items:[]});
  const current=await mapTrialRequest<ContextQueryResult>(trial.manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',objectRefs:[resource.ref]});
  expect((current.data as SituationCurrent).items[0]).toMatchObject({revision:resource.revision+1,properties:{availableCount:2}});
  expect(await mapTrialRequest(trial.manifest,'/api/simulation/object-updates','overall','POST',update)).toEqual(saved);
  const sent=await mapTrialRequest<SimulationAction>(trial.manifest,`/api/simulation/actions/${saved.id}/send`,'overall','POST',{});
  expect(sent.sendState).toBe('accepted');expect(sent.receipt?.status).toBe('accepted');
  const retry=await mapTrialRequest<SimulationAction>(trial.manifest,`/api/simulation/actions/${saved.id}/send`,'overall','POST',{});
  expect(retry.receipt).toEqual(sent.receipt);
  const jobs=await mapTrialRequest<{items:unknown[]}>(trial.manifest,'/api/information/jobs?limit=100');expect(jobs.items).toHaveLength(1);
},60_000);
