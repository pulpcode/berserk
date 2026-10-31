import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {composerInputTextV5,recordedComposerText} from '../../../../experiments/harness-lab/src/pi/composer-input.js';
import type {LoadedComposerSelection} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Payload} from '../../10-15-agent-map-spatial/r12-20261025/reasoning-prepare.js';
import {provenance,transform} from './context-adapter.js';
const selection:LoadedComposerSelection={annotationRefs:[{ref:{setId:'explicit-user-reference',revision:2},hash:'fixed',title:'显式引用',layers:[],objects:[]}],annotationContext:{sessionId:'session',draft:{setId:'draft',revision:1},baseRef:null,writable:true}};
test('proven record only, A identical, B exact paragraph on every request, tool facts preserved',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'draft-context-proof-'));await mkdir(join(directory,'sessions'));
 const text=composerInputTextV5(selection),file=join(directory,'sessions','session.jsonl');
 await writeFile(file,JSON.stringify({type:'custom_message',customType:'berserk.composer-input.v5',id:'composer',details:selection,content:text})+'\n');
 const records=await provenance(directory);
 const native:Payload={model:'test',messages:[{role:'user',content:[{type:'text',text}]},{role:'user',content:'draft is an explicit user reference'},{role:'tool',content:text,tool_call_id:'legitimate'},{role:'assistant',content:'I read draft',reasoning_content:text}]};
 assert.deepEqual(transform(native,'A',records,true).payload,native);
 const b=transform(native,'B',records,true);assert.equal(b.audit.removedCount,1);assert.deepEqual(b.payload.messages.slice(1),native.messages.slice(1));assert.equal((b.payload.messages[0].content as Array<{text:string}>)[0].text,composerInputTextV5({annotationRefs:selection.annotationRefs}));assert.ok(JSON.stringify(native.messages[0]).includes('自动会话草稿上下文'));
 assert.deepEqual(transform(native,'B',records,true).payload,b.payload);
 assert.throws(()=>transform({...native,messages:[native.messages[0],structuredClone(native.messages[0])]},'B',records,true),/Ambiguous/);
 assert.throws(()=>transform(native,'B',[],true),/Unproven/);
 await writeFile(file,JSON.stringify({type:'compaction'})+'\n');await assert.rejects(provenance(directory),/compaction/);
});


test('child v1 selection and parent task quotations remain intact; unexpected child context stops',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'draft-context-child-'));await mkdir(join(directory,'sessions'));await mkdir(join(directory,'subagents'));
 const parentText=composerInputTextV5(selection);
 await writeFile(join(directory,'sessions','parent.jsonl'),JSON.stringify({type:'custom_message',customType:'berserk.composer-input.v5',id:'parent-composer',details:selection,content:parentText})+'\n');
 const method:LoadedComposerSelection={skill:{id:'spatial-analysis',name:'空间分析',description:'离线选择正文',version:'1',hash:'0'.repeat(64),content:'离线方法'}};
 const childFile=join(directory,'subagents','child.jsonl'),childText=recordedComposerText(method);
 await writeFile(childFile,JSON.stringify({type:'custom_message',customType:'berserk.composer-input.v1',id:'child-composer',details:method,content:childText})+'\n');
 const records=await provenance(directory);assert.equal(records.length,1);
 const native:Payload={model:'test',messages:[{role:'system',content:'你是子 Agent analyst，仅处理显式任务。'},{role:'user',content:childText},{role:'user',content:parentText}]};
 const adapted=transform(native,'B',records,false);assert.deepEqual(adapted.payload,native);assert.equal(adapted.audit.removedCount,0);
 assert.throws(()=>transform({...native,messages:[{role:'user',content:parentText}]},'B',records,false),/possible compaction/);
 await writeFile(childFile,JSON.stringify({type:'custom_message',customType:'berserk.composer-input.v5',id:'unexpected',details:selection,content:parentText})+'\n');
 await assert.rejects(provenance(directory),/Unexpected child automatic context/);
});
