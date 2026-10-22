/** Explicit-body audit and the two permitted business schema changes; frozen recorder retained. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveProvider as FrozenProvider} from '../r3-20261022/live-provider.js';
import {auditPayload,type Payload} from '../r3-20261022/audit.js';
import {digest} from './runtime.js';
export type {Attempt,ProviderSlot} from '../r3-20261022/live-provider.js';
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
    const group=this.active.id.split('-').at(-1)!;assert.ok(['E0','E1','E2'].includes(group));
    const {catalog,selection}=JSON.parse(readFileSync(join(this.active.directory,'resources.json'),'utf8')) as {catalog:{skills:Array<{id:string;description:string;hash:string}>};selection:{id:string;hash:string}|null};
    assert.ok(selection,'An explicit Skill selection is required');
    const skill=this.active.runtime.skills[selection.id];assert.ok(skill);assert.equal(selection.hash,skill.hash);
    const exposure=auditPayload(payload,this.active.runtime.skills,this.options.totals.requests+1,this.active.turn);
    const turnKey=`${this.active.id}:${this.active.turn}`;
    if(!this.firstParentTurns.has(turnKey))assert.ok(exposure.skills[selection.id]?.bodyPresent,'Selected Skill body absent from first parent input of user turn');
    for(const [id,item] of Object.entries(this.active.runtime.skills)){
     assert.ok(exposure.skills[id]?.catalogPresent,'Original catalog description absent');
     assert.equal(catalog.skills.find(s=>s.id===id)?.description,item.description);
     assert.equal(catalog.skills.find(s=>s.id===id)?.hash,item.hash);
    }
    const read=tools.find(tool=>tool.function.name==='skill_read');assert.ok(read);
    assert.deepEqual(read.function.parameters.properties?.id,{type:'string'},'Discovery schema must stay at R4 baseline');
    const names=tools.map(tool=>tool.function.name);assert.equal(new Set(names).size,names.length);
    for(const name of ['annotation_read','spatial_analyze'])assert.equal(names.filter(n=>n===name).length,1);
    const common=digest(JSON.stringify(tools.map(tool=>['annotation_read','spatial_analyze'].includes(tool.function.name)?{name:tool.function.name}:tool)));
    if(this.commonSchema)assert.equal(common,this.commonSchema,'Unapproved schema difference');else this.commonSchema=common;
    const all=digest(JSON.stringify(tools));
    if(group!=='E2'){if(this.baselineSchema)assert.equal(all,this.baselineSchema,'E0/E1 tool schema must match');else this.baselineSchema=all;}
    else{
     assert.ok(JSON.stringify(tools.find(t=>t.function.name==='annotation_read')).includes('objectNames'),'E2 must expose exact name selection');
     assert.ok(JSON.stringify(tools.find(t=>t.function.name==='spatial_analyze')).includes('classify_points'),'E2 must expose point classification');
    }
    this.schemaHash=this.groupSchemas.get(group);
    const response=await super.provider(input,init);assert.ok(this.schemaHash);this.groupSchemas.set(group,this.schemaHash);this.firstParentTurns.add(turnKey);return response;
   }
   return await super.provider(input,init);
  }catch(error){this.fatal??='provider_input_protocol_failure';if(this.active)this.active.stop??=this.fatal;await this.options.cancel(this.fatal);throw error;}
 }
}
