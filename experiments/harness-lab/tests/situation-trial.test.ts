import {afterEach,expect,test} from 'vitest';
import {createServer} from 'node:net';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startMapTrial,mapTrialAuth,mapTrialRequest} from '../scripts/probe-situation-map.js';
import type {ContextQueryResult, SituationCurrent} from '../src/contracts/context.js';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.reverse())await cleanup();cleanups.length=0;});
async function freePort() {
  const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('port');
  await new Promise<void>(resolve=>server.close(()=>resolve()));return address.port;
}
test('fresh read-only map trial isolates three tasks and never enables director controls or models',async()=>{
  const external=await mkdtemp(join(tmpdir(),'map-external-'));cleanups.push(()=>rm(external,{recursive:true,force:true}));
  await writeFile(join(external,'sentinel'),'unchanged');
  const trial=await startMapTrial(await freePort(),{...process.env,LAB_DATA_DIR:external,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  expect(trial.manifest.dataDir).not.toBe(external);expect(await readdir(external)).toEqual(['sentinel']);
  expect(new Set(Object.values(trial.manifest.tasks)).size).toBe(3);
  const tasks=await mapTrialRequest<Array<{id:string;title:string}>>(trial.manifest,'/api/tasks');
  expect(tasks).toHaveLength(3);expect(tasks.every(task=>task.title.includes(trial.manifest.trialId))).toBe(true);
  expect(await mapTrialRequest(trial.manifest,'/api/activity')).toMatchObject({sessions:[]});
  expect(await mapTrialRequest(trial.manifest,'/api/information/jobs?limit=100')).toMatchObject({items:[]});
  expect(await mapTrialRequest(trial.manifest,'/api/context/map-config')).toMatchObject({simulationEnabled:false});
  expect(await mapTrialRequest(trial.manifest,'/api/context/map-config','planning')).toMatchObject({simulationEnabled:false});
  for(const seat of ['overall','planning'] as const){const denied=await fetch(`${trial.manifest.url}/api/simulation`,{headers:await mapTrialAuth(trial.manifest,seat)});expect(denied.status).toBe(403);}
  const selected=await mapTrialRequest<ContextQueryResult>(trial.manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',objectRefs:[trial.manifest.objects.road]});
  expect((selected.data as SituationCurrent).items).toHaveLength(1);expect((selected.data as SituationCurrent).items.every(object=>object.ref.objectId.startsWith(trial.manifest.trialId))).toBe(true);expect((selected.data as SituationCurrent).items[0]).toMatchObject({geometry:{type:'LineString'},properties:{passability:'open'}});
  const credentialsPath=join(trial.manifest.dataDir,'credentials.json');expect((await stat(credentialsPath)).mode&0o777).toBe(0o600);
  const manifestText=await readFile(join(trial.manifest.dataDir,'manifest.json'),'utf8');
  const credentials=JSON.parse(await readFile(credentialsPath,'utf8'));
  for(const account of Object.values(credentials.accounts) as Array<{password:string}>)expect(manifestText).not.toContain(account.password);
},60_000);

test('legacy source-manager writes and sending are denied without director authority and leave facts and queues unchanged',async()=>{
  const trial=await startMapTrial(await freePort(),{...process.env,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  const read=async()=> (await mapTrialRequest<ContextQueryResult>(trial.manifest,'/api/context/situation','planning','POST',{systemId:'situation',mode:'current',objectRefs:[trial.manifest.objects.resource]})).data as SituationCurrent;
  const before=await read(),resource=before.items[0];
  const update={clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:2,unit:'辆'},effectiveAt:`${trial.manifest.day}T09:20:00+08:00`,validTime:null};
  for(const seat of ['overall','planning'] as const)for(const [path,body] of [['/api/simulation/object-updates',update],[`/api/simulation/actions/${update.clientActionId}/send`,{}]] as const){
    const response=await fetch(`${trial.manifest.url}${path}`,{method:'POST',headers:{...await mapTrialAuth(trial.manifest,seat),'content-type':'application/json'},body:JSON.stringify(body)});
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:{code:'FORBIDDEN'}});
  }
  expect(await read()).toEqual(before);
  expect(await mapTrialRequest(trial.manifest,'/api/information/jobs?limit=100')).toMatchObject({items:[]});
  expect(await mapTrialRequest(trial.manifest,'/api/activity')).toMatchObject({sessions:[]});
},60_000);
