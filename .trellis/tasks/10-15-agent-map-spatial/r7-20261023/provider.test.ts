import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Recorder} from './recorder.js';import type {Runtime} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
const url='https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions';
for(const mode of ['ok','http','missing-usage','wrong-model','network'] as const)test(`recorder ${mode}: wire evidence, secret hygiene and no retry`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r7-recorder-'));let calls=0;
 const observer=new Recorder({directory,secret:'test-secret',totals:{requests:0,input:0,output:0,unknownUsage:0},attempts:[],verify:async()=>{},beforeProvider:async()=>{},cancel:async()=>{},original:async(_input,init)=>{
  calls++;assert.equal(init?.redirect,'error');const body=JSON.parse(String(init?.body));assert.equal(body.thinking.type,'disabled');
  if(mode==='network')throw new Error('transport');
  if(mode==='http')return new Response('unavailable',{status:503});
  if(mode==='missing-usage')return new Response('data: {"model":"deepseek-v4.1-flash","choices":[]}\n\ndata: [DONE]\n\n');
  return fakeResponse(mode==='wrong-model'?'deepseek-v4-pro':body.model);
 }});
 observer.active={id:'D23-A',directory,turn:0,runtime:{skills:{}} as Runtime,requests:0};
 const input={method:'POST',headers:{Authorization:'Bearer test-secret'},body:JSON.stringify({model:'deepseek-v4.1-flash',max_tokens:8192,messages:[]})};
 if(mode==='network')await assert.rejects(observer.fetch(url,input));else await (await observer.fetch(url,input)).text();
 if(mode==='ok')assert.equal(observer.fatal,undefined);else{assert.ok(observer.fatal);await assert.rejects(observer.fetch(url,input));assert.equal(calls,1);}
 await assert.rejects(observer.fetch('https://api.deepseek.com/chat/completions',input));assert.equal(calls,1);
 for(const file of await readdir(directory))assert.ok(!(await readFile(join(directory,file),'utf8')).includes('test-secret'));
 const original=JSON.parse(await readFile(join(directory,'provider-0001-input.json'),'utf8'));const wire=JSON.parse(await readFile(join(directory,'provider-0001-wire-input.json'),'utf8'));assert.deepEqual(wire,{...original,thinking:{type:'disabled'}});
});
