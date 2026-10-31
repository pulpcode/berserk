import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {composerInputTextV5,recordedComposerText} from '../../../../experiments/harness-lab/src/pi/composer-input.js';
import type {LoadedComposerSelection} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Payload} from '../../10-15-agent-map-spatial/r12-20261025/reasoning-prepare.js';
import {digest} from './runtime.js';
import type {Group} from './budget.js';
interface Provenance {file:string;entryId:string;before:string;after:string;removed:string}
export async function provenance(dataDir:string):Promise<Provenance[]>{
 const out:Provenance[]=[];
 async function walk(path:string,child:boolean){
  let files;try{files=await readdir(path,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
  for(const f of files){const full=join(path,f.name);if(f.isDirectory()){await walk(full,child);continue;}if(!f.name.endsWith('.jsonl'))continue;
   for(const line of (await readFile(full,'utf8')).split('\n').filter(Boolean)){
    const r=JSON.parse(line);assert.notEqual(r.type,'compaction','Context compaction requires provenance review');
    if(r.type!=='custom_message'||!String(r.customType).startsWith('berserk.composer-input.'))continue;
    const input=r.details as LoadedComposerSelection;assert.equal(r.content,recordedComposerText(input,r.customType),'Native composer integrity');
    if(!input.annotationContext)continue;
    assert.ok(!child,'Unexpected child automatic context requires provenance review');
    assert.equal(r.customType,'berserk.composer-input.v5','Composer format drift');
    const clean={...input};delete clean.annotationContext;const after=composerInputTextV5(clean);
    const before=String(r.content),lines=before.split('\n'),removed=lines.filter(l=>!after.split('\n').includes(l));assert.equal(removed.length,1,'Expected one automatic paragraph');
    assert.ok(removed[0].startsWith('自动会话草稿上下文（'));assert.equal(lines.filter(l=>l!==removed[0]).join('\n'),after);
    out.push({file:full,entryId:String(r.id),before,after,removed:removed[0]});
   }
  }
 }
 await walk(join(dataDir,'sessions'),false);await walk(join(dataDir,'subagents'),true);return out;
}
/** Only exact, native-record-proven user composer blocks are transformed. Tool/assistant content stays intact. */
export function transform(native:Payload,group:Group,records:Provenance[],parent:boolean){
 const payload=structuredClone(native),edits:Array<{message:number;block:number|null;entryId:string;file:string;removed:string;beforeHash:string;afterHash:string}>=[];
 // Frozen product children have only readonly resource tools and no automatic context.
 // A quoted parent block in their task is task evidence, not a native child composer.
 if(!parent)assert.ok(native.messages.some(m=>m.role==='system'&&typeof m.content==='string'&&m.content.includes('你是子 Agent ')),'Unknown non-parent request; possible compaction');
 const counts=new Map<string,number>();
 for(const [i,m] of payload.messages.entries()){
  if(!parent||m.role!=='user')continue;
  const apply=(text:string,block:number|null)=>{
   const matches=records.filter(r=>r.before===text);
   if(!matches.length){assert.ok(!text.startsWith('以下是宿主核实的本请求地图上下文和用户选择')||!text.includes('自动会话草稿上下文（'),'Unproven composer block');return text;}
   const n=(counts.get(text)??0)+1;counts.set(text,n);assert.ok(n<=matches.length,'Ambiguous duplicate user/composer text');
   const r=matches[n-1];edits.push({message:i,block,entryId:r.entryId,file:r.file,removed:r.removed,beforeHash:digest(text),afterHash:digest(group==='B'?r.after:text)});return group==='B'?r.after:text;
  };
  if(typeof m.content==='string')m.content=apply(m.content,null);
  else if(Array.isArray(m.content))for(const [j,b] of m.content.entries())if(b.type==='text'&&typeof b.text==='string')b.text=apply(b.text,j);
 }
 if(parent)assert.ok(edits.length,'Parent request missing proven automatic composer');
 return {payload,audit:{group,nativeHash:digest(JSON.stringify(native)),adaptedHash:digest(JSON.stringify(payload)),removedCount:group==='B'?edits.length:0,matchedComposerCount:edits.length,edits}};
}
export async function adaptDraftContext(native:Payload,group:Group,dataDir:string,parent:boolean){return transform(native,group,await provenance(dataDir),parent);}
