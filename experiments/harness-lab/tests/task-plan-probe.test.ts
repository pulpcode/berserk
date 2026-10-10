import {afterEach, expect, test} from 'vitest';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {capture, control, sendEvent, startTrial} from '../scripts/probe-task-plan.js';

const cleanups: Array<()=>Promise<void>> = [];
afterEach(async()=>{for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length=0;});
async function freePort() {
  const server=createServer(); await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address(); if (!address || typeof address==='string') throw new Error('port');
  await new Promise<void>(resolve=>server.close(()=>resolve())); return address.port;
}
test('fresh manual trial preserves external data, uploads draft, caches login and refuses early recovery without model work', async()=>{
  const external=await mkdtemp(join(tmpdir(),'plan-external-'));
  cleanups.push(()=>rm(external,{recursive:true,force:true}));
  await writeFile(join(external,'sentinel'),'unchanged');
  const trial=await startTrial(await freePort(),{...process.env,LAB_DATA_DIR:external,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  expect(trial.manifest.dataDir).not.toBe(external);
  expect(await readdir(external)).toEqual(['sentinel']);
  expect(await readFile(join(external,'sentinel'),'utf8')).toBe('unchanged');
  const credentialsPath=join(trial.manifest.dataDir,'credentials.json');
  expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
  const credentials=JSON.parse(await readFile(credentialsPath,'utf8'));
  const manifestText=await readFile(join(trial.manifest.dataDir,'manifest.json'),'utf8');
  for (const account of Object.values(credentials.accounts) as Array<{password:string}>) expect(manifestText).not.toContain(account.password);
  await expect(sendEvent(trial.manifest,'E4')).rejects.toThrow('实际提交第一稿');
  const evidence=JSON.parse(await readFile(await capture(trial.manifest),'utf8'));
  expect(evidence.overall['/api/work-items']).toEqual([]);
  expect(evidence.overall['/api/activity']).toMatchObject({sessions:[]});
  expect(evidence.overall['/api/information/jobs?limit=100']).toMatchObject({items:[]});
  expect(trial.manifest.metadata.initialUpload).toMatchObject({status:'completed'});
  const cached=await readFile(credentialsPath,'utf8');
  await capture(trial.manifest); expect(await readFile(credentialsPath,'utf8')).toBe(cached);
  expect(await control(trial.manifest.socket,['requests'])).toEqual([]);
},60000);

test('sending uses real ingress receipts and freezes the original E2 cursor on retry',async()=>{
  const trial=await startTrial(await freePort(),{...process.env,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false'},false);
  cleanups.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
  const first=await sendEvent(trial.manifest,'E2');
  const path=join(trial.manifest.dataDir,'E2-payload.json');
  const original=await readFile(path,'utf8');
  await control(trial.manifest.socket,['advance','intel']);
  const repeated=await sendEvent(trial.manifest,'E2');
  expect(repeated).toEqual(first);
  expect(await readFile(path,'utf8')).toBe(original);
  expect(JSON.parse(original).sourceMessageId).toBe(`${trial.manifest.trialId}-E2`);
},60000);
