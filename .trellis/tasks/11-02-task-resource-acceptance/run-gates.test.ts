import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepare,execute} from './run.js';
import {save} from './runtime.js';
import {profile} from './budget.js';
test('real scheduler enforces readiness and order, records terminal review/history, and refuses whole-task retry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'acceptance-scheduler-'));const original=globalThis.fetch;let timer:ReturnType<typeof setInterval>|undefined;
 try{
  await prepare(directory);
  const envPath=join(directory,'offline.env');writeFileSync(envPath,`LLM_MODEL=${profile.model}\nLLM_BASE_URL=${profile.baseUrl}\nLLM_API_KEY=offline-scheduler\n`,{mode:0o600});
  await assert.rejects(execute(directory,'P02-1',envPath,false,4336),/readiness/);
  save(join(directory,'readiness.json'),{reviewer:'offline deterministic reviewer',offlinePassed:true,materialsReviewed:true});
  await assert.rejects(execute(directory,'P02-1',envPath,false,4336),/P01-1/);
  // Isolated fixture for the predecessor gate; this is not a real public-pass record.
  mkdirSync(join(directory,'P01-1'));save(join(directory,'P01-1/result.json'),{status:'trajectory_recorded'});save(join(directory,'P01-1/continuation-review.json'),{reviewer:'offline',rationale:'synthetic gate fixture',continuationAllowed:true,trajectoryAuditable:true});
  let calls=0;globalThis.fetch=async(input,init)=>{
   if(String(input).startsWith(profile.baseUrl)){calls++;return new Response('data: '+JSON.stringify({id:'offline',model:'deepseek-offline-version',choices:[{index:0,delta:{role:'assistant',content:'离线运行器最终答复。'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'offline',model:'deepseek-offline-version',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}
   return original(input,init);
  };
  timer=setInterval(()=>{const trial=join(directory,'P02-1');if(!existsSync(trial))return;for(const name of readdirSync(trial).filter(n=>n.endsWith('-review.json'))){const path=join(trial,name),decision=path.replace(/-review\.json$/,'-decision.json');if(existsSync(decision))continue;const review=JSON.parse(readFileSync(path,'utf8'));save(decision,{evidenceHash:review.evidenceHash,kind:'final',reviewer:'offline',rationale:'Determininistic final response complete.'});}},100);
  await execute(directory,'P02-1',envPath,false,4336);clearInterval(timer);timer=undefined;
  const result=JSON.parse(readFileSync(join(directory,'P02-1/result.json'),'utf8'));assert.equal(result.status,'trajectory_recorded');assert.equal(calls,1);assert.ok(readdirSync(join(directory,'P02-1/native-history')).length);assert.ok(existsSync(join(directory,'P02-1/state-after.json')));
  await assert.rejects(execute(directory,'P02-1',envPath,false,4336),/task_retry_forbidden/);assert.equal(calls,1);
 }finally{if(timer)clearInterval(timer);globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
