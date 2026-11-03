/** Resume a private full copy through the frozen product's normal session loader. */
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cp,mkdir,chmod,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {PiLab} from '../../../../experiments/harness-lab/src/pi/lab.js';
import type {createApp} from '../../../../experiments/harness-lab/src/server/app.js';
import type {loadConfig} from '../../../../experiments/harness-lab/src/server/config.js';
import type {parseContextConfig} from '../../../../experiments/harness-lab/src/context/config.js';
import type {parseBackgroundConfig} from '../../../../experiments/harness-lab/src/background/config.js';
import {control} from '../../../../experiments/harness-lab/scripts/probe-task-plan.js';
import {hashes,save,type Runtime} from './runtime.js';
const read=<T>(p:string)=>JSON.parse(readFileSync(p,'utf8')) as T;
async function checkPlainTree(root:string){for(const name of await readdir(root)){const p=join(root,name),s=await lstat(p);assert.ok(!s.isSymbolicLink(),'No state symlink may escape copied data');if(s.isDirectory())await checkPlainTree(p);else assert.ok(s.isFile(),'Unsupported state entry');}}
async function requireFreePort(port:number){const server=createServer();await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>server.close(error=>error?no(error):yes()));});}
export async function restoreTrial(runtime:Runtime,original:MapTrialManifest,directory:string,env:NodeJS.ProcessEnv){
 await checkPlainTree(original.dataDir);const originalHashes=await hashes(original.dataDir);await mkdir(directory,{mode:0o700});const dataDir=join(directory,'data');await cp(original.dataDir,dataDir,{recursive:true,errorOnExist:true,force:false});await chmod(dataDir,0o700);assert.deepEqual(await hashes(dataDir),originalHashes,'Copy must preserve all initial bytes');
 const manifest={...original,dataDir,socket:join('/tmp',`r13-closeout-${randomUUID()}.sock`)};
 // The original local ports are preserved, so no source URLs, auth headers, or history need rewriting.
 const configRaw=read<{systems:Array<{baseUrl:string}>}>(join(dataDir,'context-config.json')),sourcePort=Number(new URL(configRaw.systems[0].baseUrl).port),port=Number(new URL(manifest.url).port);
 await requireFreePort(sourcePort);await requireFreePort(port);
 const secrets=read<NodeJS.ProcessEnv>(join(dataDir,'service-secrets.json'));
 const mock=spawn(process.execPath,['--import','tsx',join(runtime.root,'scripts/mock-context/main.ts')],{cwd:runtime.root,env:{...env,...secrets,MOCK_CONTEXT_PORT:String(sourcePort),MOCK_CONTEXT_CONTROL_SOCKET:manifest.socket,MOCK_CONTEXT_INSTANCE_ID:manifest.trialId,MOCK_CONTEXT_DAY:manifest.day,MOCK_CONTEXT_DATA_DIR:join(dataDir,'mock'),MOCK_CONTEXT_NOTIFICATION_CONFIG:join(dataDir,'notifications.json')},stdio:'ignore'});
 let app:Awaited<ReturnType<typeof createApp>>|undefined,stopped=false;
 const verifyOriginal=async()=>assert.deepEqual(await hashes(original.dataDir),originalHashes,'Original state was modified');
 const stop=async()=>{if(stopped)return;stopped=true;try{await app?.close();}finally{if(mock.exitCode===null&&mock.signalCode===null){const ended=new Promise<void>(r=>mock.once('exit',()=>r()));mock.kill('SIGTERM');await ended;}await verifyOriginal();}};
 try{
  let ready=false;for(let n=0;n<100;n++){assert.equal(mock.exitCode,null,'Copied source service exited');try{const status=await control(manifest.socket,['status']) as {url:string};assert.equal(Number(new URL(status.url).port),sourcePort);ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}assert.ok(ready,'Copied source service did not start');
  const module=async(p:string)=>import(pathToFileURL(join(runtime.root,p)).href);
  const {loadConfig:load}=await module('src/server/config.ts') as {loadConfig:typeof loadConfig};
  const {PiLab:Lab}=await module('src/pi/lab.ts') as {PiLab:typeof PiLab};
  const {createApp:create}=await module('src/server/app.ts') as {createApp:typeof createApp};
  const {parseContextConfig:context}=await module('src/context/config.ts') as {parseContextConfig:typeof parseContextConfig};
  const {parseBackgroundConfig:background}=await module('src/background/config.ts') as {parseBackgroundConfig:typeof parseBackgroundConfig};
  const config=load({...env,PORT:String(port),LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_SESSION_SECRET:secrets.LAB_SESSION_SECRET,LAB_SEAT_ID:'seat-overall',LAB_TEST_SEATS:undefined});
  const lab=await Lab.create(config);app=await create(lab,false,{config:background(read(join(dataDir,'background-config.json'))),env:secrets},{config:context(configRaw),env:secrets});await app.listen({host:'127.0.0.1',port});
  save(join(directory,'restore-manifest.json'),{originalDataDir:original.dataDir,copiedDataDir:dataDir,unchangedHistory:true,originalHashes,pathChanges:['effective LAB_DATA_DIR','effective mock data/socket paths'],sessionHeaderCwdPreserved:true,modelCallsDuringRestore:0});
  await verifyOriginal();return {manifest,lab,stop,verifyOriginal,originalHashes};
 }catch(e){await stop();throw e;}
}
