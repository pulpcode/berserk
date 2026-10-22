import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveProvider,type Attempt} from './live-provider.js';
import {save,type Runtime} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Totals} from './live-budget.js';
for(const mutation of ['other-tool','candidate'] as const)test(`paid transport is never invoked for ${mutation} schema drift`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'r5-provider-'));let paid=0,cancelled=0;
 const total:Totals={requests:0,input:0,output:0,unknownUsage:0},attempts:Attempt[]=[];
 const observer=new LiveProvider({directory,totals:total,attempts,secret:'offline-secret',verify:async()=>{},beforeProvider:async()=>{},cancel:async()=>{cancelled++;},original:async()=>{paid++;return fakeResponse('deepseek-v4-pro');}});
 const skill={id:'spatial-analysis',name:'空间分析',description:'原有简介',content:'原有正文',hash:'hash'};
 const runtime:Runtime={root:directory,hashes:{},start:undefined as never,skills:{[skill.id]:skill}};
 const make=(label:string)=>({model:'deepseek-v4-pro',max_tokens:4096,thinking:{type:'disabled'},messages:[{role:'user',content:'只分析'}],tools:[
  {type:'function',function:{name:'spatial_analyze',description:'原有计算接口',parameters:{type:'object',properties:{}}}},
  {type:'function',function:{name:'skill_read',description:'原有读取接口',parameters:{type:'object',properties:{id:label==='L0'?{type:'string'}:{anyOf:[{type:'string',const:skill.id,description:`${skill.name}：${skill.description}`}]}},required:['id'],additionalProperties:false}}},
 ]});
 for(const label of ['L0','L1']){
  const slot=join(directory,label);await mkdir(slot);save(join(slot,'resources.json'),{catalog:{skills:[skill]}});
  observer.active={id:`D02-${label}`,directory:slot,turn:0,runtime,requests:0};
  const response=await observer.provider('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(make(label))});await response.text();
 }
 assert.equal(paid,2);assert.equal(total.requests,2);
 const changed=make('L1');if(mutation==='other-tool')changed.tools[0].function.description='不应变化';else changed.tools[1].function.parameters.properties.id={anyOf:[{type:'string',const:skill.id,description:'另一个简介'}]};
 await assert.rejects(()=>observer.provider('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(changed)}));
 assert.equal(paid,2);assert.equal(total.requests,2);assert.equal(cancelled,1);assert.equal(observer.fatal,'provider_input_protocol_failure');
});
