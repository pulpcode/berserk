/** Keep the frozen provider recorder; allow exactly the reviewed id-schema difference. */
import assert from 'node:assert/strict';
import {LiveProvider as FrozenProvider} from '../r3-20261022/live-provider.js';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './runtime.js';
import type {Payload} from '../r3-20261022/audit.js';
export type {Attempt,ProviderSlot} from '../r3-20261022/live-provider.js';
interface Tool {function:{name:string;parameters:{properties?:{id?:unknown}}}}
export class LiveProvider extends FrozenProvider {
 private groupSchemas=new Map<string,string>();
 private commonSchema?:string;
 override async provider(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1]){
  try{
   assert.ok(this.active);
   const raw=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
   const payload=JSON.parse(raw) as Payload,tools=payload.tools as Tool[]|undefined;
   if(tools?.some(tool=>tool.function.name==='spatial_analyze')){
    const label=this.active.id.endsWith('-L1')?'L1':'L0',definition=tools.find(tool=>tool.function.name==='skill_read');assert.ok(definition);
    const actual=definition.function.parameters.properties?.id;
    if(label==='L0')assert.deepEqual(actual,{type:'string'});
    else{
     assert.ok(actual&&typeof actual==='object'&&'anyOf' in actual&&Array.isArray(actual.anyOf));
     const {catalog}=JSON.parse(readFileSync(join(this.active.directory,'resources.json'),'utf8')) as {catalog:{skills:Array<{id:string;name:string;description:string}>}};
     assert.deepEqual(actual,{anyOf:catalog.skills.map(s=>({type:'string',const:s.id,description:`${s.name}：${s.description}`}))});
    }
    const normalized=structuredClone(tools);normalized.find(tool=>tool.function.name==='skill_read')!.function.parameters.properties!.id={type:'string'};
    const stable=digest(JSON.stringify(normalized));if(this.commonSchema)assert.equal(stable,this.commonSchema,'Non-candidate schema drift');else this.commonSchema=stable;
    this.schemaHash=this.groupSchemas.get(label);
    const response=await super.provider(input,init);assert.ok(this.schemaHash);this.groupSchemas.set(label,this.schemaHash);return response;
   }
   return await super.provider(input,init);
  }catch(error){this.fatal??='provider_input_protocol_failure';if(this.active)this.active.stop??=this.fatal;await this.options.cancel(this.fatal);throw error;}
 }
}
