import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,cp,writeFile,rm} from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {restoreTrial} from '../../r13-20261025/closeout-runtime.js';
import {restoreWithFreshAuth} from './auth-restore.js';
import {verifyBootstrapFailure} from './bootstrap-recovery.js';
import {originalBootstrapFailure,bootstrapRecoveryClaim,firstDirectory,fourthDirectory,fifthDirectory,secondDirectory,inheritedBudget,runSupplement,pendingFreeze} from './runner.js';
import {buildRuntime,offlineEnvironment,loopbackOnly,hashes,save} from '../runtime.js';
import {modelConfiguration,type Data} from '../budget.js';
import {clarificationReplyForTurn,type Prepared} from '../cases.js';
import {mapTrialRequest,type MapTrialManifest} from '../../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {SessionSnapshot} from '../../../../../experiments/harness-lab/src/contracts/index.js';
import {fakeResponse} from '../../r3-20261022/http-probe.js';
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
const paths={original:firstDirectory,baseline:fourthDirectory,latest:fifthDirectory},entry=join(firstDirectory,'D06-1-A');
test('real expired copied cookies return 401; copied cache reset logs in without altering original history',{timeout:180000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r14-offline-auth-')),runtime=await buildRuntime(join(directory,'runtime'),'A'),env=offlineEnvironment(),manifest=read<MapTrialManifest>(join(entry,'manifest.json')),before=await hashes(manifest.dataDir),originalFetch=globalThis.fetch;
 globalThis.fetch=loopbackOnly(originalFetch);try{
  const stale=await restoreTrial(runtime,manifest,join(directory,'stale'),env);try{await assert.rejects(mapTrialRequest(stale.manifest,`/api/sessions/${read<Prepared>(join(entry,'fixture.json')).fixture.sessionId}`,'planning'),/HTTP 401/);}finally{await stale.stop();}
  const fresh=await restoreWithFreshAuth(runtime,manifest,join(directory,'fresh'),env);try{const p=read<Prepared>(join(entry,'fixture.json')),snapshot=await mapTrialRequest<SessionSnapshot>(fresh.manifest,`/api/sessions/${p.fixture.sessionId}`,'planning'),old=read<{final:SessionSnapshot}>(join(entry,'review.json'));assert.deepEqual(snapshot.messages,old.final.messages);assert.deepEqual(read<{accounts:unknown}>(join(fresh.manifest.dataDir,'credentials.json')).accounts,read<{accounts:unknown}>(join(manifest.dataDir,'credentials.json')).accounts);assert.deepEqual(await hashes(join(fresh.manifest.dataDir,'sessions')),await hashes(join(manifest.dataDir,'sessions')));}finally{await fresh.stop();}
 }finally{globalThis.fetch=originalFetch;}assert.deepEqual(await hashes(manifest.dataDir),before);
});
test('only the exact zero-request bootstrap can recover; attempts, user turns, ledger or history changes reject',async()=>{
 const proof=await verifyBootstrapFailure(originalBootstrapFailure,paths);assert.equal(proof.cumulative.requests,650);const root=await mkdtemp(join(tmpdir(),'r14-offline-bootstrap-proof-')),directory=join(root,'failed'),claim=join(root,'old-claim.json');await mkdir(directory);
 for(const name of ['protocol.json','result.json','failure.json','attempts.json','ledger.json','inherited-ledger.json'])await cp(join(originalBootstrapFailure.directory,name),join(directory,name));await mkdir(join(directory,'restored/data'),{recursive:true});await cp(join(originalBootstrapFailure.directory,'restored/data/sessions'),join(directory,'restored/data/sessions'),{recursive:true});save(claim,{...read<Record<string,unknown>>(originalBootstrapFailure.claim),directory});const failure={directory,claim};await verifyBootstrapFailure(failure,paths);
 const mutate=async(name:string,change:(value:Record<string,unknown>)=>void)=>{const path=join(directory,name),bytes=readFileSync(path),value=JSON.parse(bytes.toString()) as Record<string,unknown>;change(value);save(path,value);await assert.rejects(verifyBootstrapFailure(failure,paths));await writeFile(path,bytes);};
 await mutate('result.json',d=>{d.newUsage={requests:1,input:1,output:1,afp:1,unknown:0};});await writeFile(join(directory,'attempts.json'),'[{"id":651}]');await assert.rejects(verifyBootstrapFailure(failure,paths),/attempted model request/);await writeFile(join(directory,'attempts.json'),'[]');await writeFile(join(directory,'turn-1-input.json'),'{}');await assert.rejects(verifyBootstrapFailure(failure,paths),/sent user turn/);await rm(join(directory,'turn-1-input.json'));
 await mutate('ledger.json',d=>{(d.requests as Array<{trialId:string}>)[400].trialId='changed';});const file=Object.keys(proof.native)[0],native=join(directory,'restored/data/sessions',file),bytes=readFileSync(native);await writeFile(native,Buffer.concat([bytes,Buffer.from('\n')]));await assert.rejects(verifyBootstrapFailure(failure,paths),/native history/);await writeFile(native,bytes);
 await assert.rejects(pendingFreeze('D10-1-A',paths,true,failure),/Only D06/);assert.deepEqual(await hashes(originalBootstrapFailure.directory),proof.failedEvidence);
});
test('explicit bootstrap recovery preserves old claim and sends only the original choice once',{timeout:180000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'r14-offline-bootstrap-run-')),directory=join(root,'recovered'),claimPath=join(root,'recovery-claim.json'),oldClaim=readFileSync(originalBootstrapFailure.claim),oldEvidence=await hashes(originalBootstrapFailure.directory),realClaimExists=existsSync(bootstrapRecoveryClaim),originalFetch=globalThis.fetch,p=read<Prepared>(join(entry,'fixture.json'));let requests=0;
 const transport:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(originalFetch)(input,init);requests++;const payload=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string|Array<{text?:string}>}>},users=payload.messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:m.content.map(b=>b.text??'').join(''));assert.equal(users.filter(t=>t===p.prompts[0]).length,1);assert.equal(users.at(-1),clarificationReplyForTurn(p,0));return fakeResponse(modelConfiguration.A.responseModel,undefined,'已记录查询所用图层。');};
 const result=await runSupplement({slot:'D06-1-A',bootstrapRecovery:true,directory,offline:{paths,claimPath,transport}});assert.equal(result.batchStop,null,JSON.stringify(result));assert.equal(result.completedSupplementTurns,1);assert.equal(requests,1);assert.equal(result.newUsage.requests,1);assert.equal(result.cumulative.requests,651);assert.equal(read<{bootstrapRecoveryOf:string}>(claimPath).bootstrapRecoveryOf,originalBootstrapFailure.directory);assert.equal(inheritedBudget('D10-1-A',{original:secondDirectory,baseline:fourthDirectory,latest:directory,predecessorClaim:claimPath},true).seed.requests.length,651);assert.deepEqual(read<Data>(join(directory,'ledger.json')).requests.slice(0,650),read<Data>(join(fifthDirectory,'ledger.json')).requests);await assert.rejects(runSupplement({slot:'D06-1-A',bootstrapRecovery:true,directory:join(root,'again'),offline:{paths,claimPath,transport}}),/already claimed/);assert.equal(requests,1);assert.deepEqual(readFileSync(originalBootstrapFailure.claim),oldClaim);assert.deepEqual(await hashes(originalBootstrapFailure.directory),oldEvidence);assert.equal(existsSync(bootstrapRecoveryClaim),realClaimExists);
});
