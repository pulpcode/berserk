import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveProvider,type Attempt} from './live-provider.js';
import {save,type Runtime} from './runtime.js';
import {fakeResponse} from '../r3-20261022/http-probe.js';
import type {Totals} from './live-budget.js';
interface Tool {type:string;function:{name:string;description:string;parameters:{type:string;properties:Record<string,unknown>}}}
async function setup(){
 const directory=await mkdtemp(join(tmpdir(),'r6-provider-'));let calls=0,cancelled=0;
 const totals:Totals={requests:0,input:0,output:0,unknownUsage:0},attempts:Attempt[]=[];
 const observer=new LiveProvider({directory,totals,attempts,secret:'offline-secret',verify:async()=>{},beforeProvider:async()=>{},cancel:async()=>{cancelled++;},original:async()=>{calls++;return fakeResponse('deepseek-v4-pro');}});
 const make=(group:string,body=true)=>({model:'deepseek-v4-pro',max_tokens:4096,thinking:{type:'disabled'},messages:[{role:'system',content:'可用 Skill：spatial-analysis（原有简介）'},{role:'user',content:body?`explicit-method-body-${group}`:'compaction summary'}],tools:[
  {type:'function',function:{name:'spatial_analyze',description:'原有计算接口',parameters:{type:'object',properties:group==='E2'?{operation:{const:'classify_points'}}:{}}}},
  {type:'function',function:{name:'annotation_read',description:'原有读取接口',parameters:{type:'object',properties:group==='E2'?{objectNames:{type:'array'}}:{}}}},
  {type:'function',function:{name:'skill_read',description:'原有方法读取接口',parameters:{type:'object',properties:{id:{type:'string'}}}}},
 ] as Tool[]});
 const select=async(group:string)=>{
  const slot=join(directory,group);await mkdir(slot);
  const skill={id:'spatial-analysis',name:'空间分析',description:'原有简介',content:`explicit-method-body-${group}`,hash:`hash-${group}`};
  save(join(slot,'resources.json'),{catalog:{skills:[skill]},selection:{id:skill.id,hash:skill.hash}});
  const runtime:Runtime={root:directory,hashes:{},start:undefined as never,skills:{[skill.id]:skill}};
  observer.active={id:`D02-${group}`,directory:slot,turn:0,runtime,requests:0};
 };
 const send=async(payload:ReturnType<typeof make>)=>{const response=await observer.provider('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(payload)});await response.text();};
 return {observer,make,select,send,totals,counts:()=>({calls,cancelled})};
}
for(const mutation of ['other-tool','E1-business','missing-first-body','catalog','discovery'] as const)test(`provider refuses ${mutation} before any additional transport`,async()=>{
 const f=await setup();
 await f.select('E0');await f.send(f.make('E0'));
 await f.select('E1');const changed=f.make('E1');
 if(mutation==='other-tool')changed.tools[2].function.description='unapproved';
 if(mutation==='E1-business')changed.tools[0].function.description='unapproved';
 if(mutation==='missing-first-body')changed.messages[1].content='absent';
 if(mutation==='catalog')changed.messages[0].content='可用 Skill：spatial-analysis（改过简介）';
 if(mutation==='discovery')changed.tools[2].function.parameters.properties.id={anyOf:[{const:'spatial-analysis'}]};
 await assert.rejects(()=>f.send(changed));assert.deepEqual(f.counts(),{calls:1,cancelled:1});assert.equal(f.totals.requests,1);
});
test('E0/E1 same tools, E2 only declared tools differ; subsequent missing full body is recorded, new turn still requires explicit full body',async()=>{
 const f=await setup();
 for(const group of ['E0','E1','E2']){await f.select(group);await f.send(f.make(group));}
 await f.send(f.make('E2',false));assert.equal(f.counts().calls,4);
 f.observer.active!.turn=1;await assert.rejects(()=>f.send(f.make('E2',false)));
 assert.equal(f.counts().calls,4);assert.equal(f.totals.requests,4);
});
