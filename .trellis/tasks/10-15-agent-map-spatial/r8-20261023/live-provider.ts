/** Native initial context contains catalog only; reading is observed, never required. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Recorder as FrozenProvider} from '../r7-20261023/recorder.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {digest} from './runtime.js';
export type {Attempt,ProviderSlot} from '../r7-20261023/recorder.js';
interface Tool {function:{name:string;parameters:{properties?:{id?:unknown}}}}
export class LiveProvider extends FrozenProvider {
 private groupSchemas=new Map<string,string>();
 private commonSchema?:string;
 private baselineSchema?:string;
 private firstParentTurns=new Set<string>();
 override async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  try{
   assert.ok(this.active);
   const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
   const payload=JSON.parse(raw) as Payload,tools=payload.tools as Tool[]|undefined;
   if(tools?.some(tool=>tool.function.name==='spatial_analyze')){
    const group=this.active.id.split('-').at(-1)!;assert.ok(['A','B'].includes(group));
    const {catalog,selection}=JSON.parse(readFileSync(join(this.active.directory,'resources.json'),'utf8')) as {catalog:{skills:Array<{id:string;description:string;hash:string}>};selection:{id:string;hash:string}|null};
    assert.equal(selection,null,'Native request must not select a Skill');
    const exposure=auditPayload(payload,this.active.runtime.skills,this.options.totals.requests+1,this.active.turn);
    const turnKey=`${this.active.id}:${this.active.turn}`;
    if(this.active.turn===0&&!this.firstParentTurns.has(turnKey))for(const item of Object.values(exposure.skills))assert.equal(item.bodyPresent,false,'Native initial input must not preload any Skill body');
    for(const [id,item] of Object.entries(this.active.runtime.skills)){
     assert.ok(exposure.skills[id]?.catalogPresent,'Original catalog description absent');
     assert.equal(catalog.skills.find(s=>s.id===id)?.description,item.description);
     assert.equal(catalog.skills.find(s=>s.id===id)?.hash,item.hash);
    }
    const names=tools.map(tool=>tool.function.name);assert.equal(new Set(names).size,names.length);
    for(const name of ['annotation_read','spatial_analyze'])assert.equal(names.filter(n=>n===name).length,1);
    const common=digest(JSON.stringify(tools.map(tool=>['annotation_read','spatial_analyze'].includes(tool.function.name)?{name:tool.function.name}:tool)));
    if(this.commonSchema)assert.equal(common,this.commonSchema,'Unapproved schema difference');else this.commonSchema=common;
    const all=digest(JSON.stringify(tools));
    if(this.baselineSchema)assert.equal(all,this.baselineSchema,'A/B tool schemas must match');else this.baselineSchema=all;
    this.schemaHash=this.groupSchemas.get(group);
    const response=await super.provider(input,init);assert.ok(this.schemaHash);this.groupSchemas.set(group,this.schemaHash);this.firstParentTurns.add(turnKey);return response;
   }
   return await super.provider(input,init);
  }catch(error){this.fatal??='provider_input_protocol_failure';if(this.active)this.active.stop??=this.fatal;await this.options.cancel(this.fatal);throw error;}
 }
}
