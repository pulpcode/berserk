/** Local deterministic provider smoke; none of these replies are real-model evidence. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareFixture,preparationState,prompts,type CaseId} from './fixtures.js';
import {Observer} from './run.js';
import {startMapTrial} from '../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {ask,mapState} from '../../../experiments/harness-lab/scripts/probe-source-annotations.js';

test('native HTTP → composer → Pi → deterministic provider preserves discovery and fixed-reference boundaries',async()=>{
  const evidence=await mkdtemp(join(tmpdir(),'native-map-smoke-'));
  const original=globalThis.fetch,prepared:Array<{trial:Awaited<ReturnType<typeof startMapTrial>>;fixture:Awaited<ReturnType<typeof prepareFixture>>;directory:string}>=[];
  const payloads:Array<{messages:Array<{role:string;content:unknown}>;tools:unknown[]}> = [];
  let kind:CaseId='F1',phase='query',turn=0;
  const synthetic:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!=='https://api.deepseek.com')return original(input,init);
    const payload=JSON.parse(String(init?.body));payloads.push(payload);turn++;
    const call=kind==='F2'&&phase==='preparation'?(turn===1?{name:'annotation_read',arguments:{mode:'draft',objectIds:['point-b'],fields:['note']}}:turn===2?{name:'annotation_action',arguments:{action:'apply',operations:[{op:'update_object',objectId:'point-b',changes:{note:'B 保障讨论'}}]}}:null):null;
    const delta=call?{role:'assistant',tool_calls:[{index:0,id:`smoke-${turn}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{role:'assistant',content:'确定性编排检查完成（不是模型语义评分）'};
    const common={id:'smoke',object:'chat.completion.chunk',created:1,model:'deepseek-flash'};
    const chunks=[{...common,choices:[{index:0,delta,finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:5,total_tokens:35}}];
    return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const observer=new Observer(synthetic,evidence,'https://api.deepseek.com');globalThis.fetch=observer.fetch;
  try {
    for(const [index,id] of (['F1','F2','F3'] as const).entries()) {
      const trial=await startMapTrial(4490+index,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:'deepseek-flash',LLM_API_KEY:'deterministic-test-only',LLM_BASE_URL:'https://api.deepseek.com',LLM_MAX_OUTPUT_TOKENS:'2048',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined},false);
      const holder={trial,fixture:undefined as unknown as Awaited<ReturnType<typeof prepareFixture>>,directory:join(evidence,id)};prepared.push(holder);await mkdir(holder.directory);
      holder.fixture=await prepareFixture(trial.manifest,id);
    }
    assert.equal(observer.attempts.length,0);assert.equal(new Set(prepared.map(p=>p.trial.manifest.dataDir)).size,3);assert.equal(new Set(prepared.map(p=>p.fixture.before.binding.draft!.setId)).size,3);
    observer.mode='run';
    for(const p of prepared) {
      kind=p.fixture.kind;turn=0;observer.budget.begin();phase=kind==='F2'?'preparation':'query';
      observer.active={id:kind,trial:p.trial,fixture:p.fixture,directory:p.directory,phase:kind==='F2'?'prepare':'readonly'};
      const firstIndex=payloads.length;
      if(kind==='F2') {
        const prep=await ask(p.trial.manifest,p.directory,'preparation',p.fixture.sessionId,prompts.prep);
        assert.equal(prep.snapshot.lastResult?.status,'succeeded');assert.equal(preparationState(p.fixture.before,prep.after),'correct');assert.deepEqual(await mapState(p.trial.manifest,p.fixture.otherSessionId!),p.fixture.otherBefore);
        phase='query';observer.active.phase='readonly';observer.active.requestId=undefined;turn=0;
      }
      const queryIndex=payloads.length,before=await mapState(p.trial.manifest,p.fixture.sessionId);
      const record=await ask(p.trial.manifest,p.directory,'query',p.fixture.sessionId,prompts[kind],p.fixture.annotationRefs);
      assert.equal(record.snapshot.lastResult?.status,'succeeded');assert.deepEqual(record.after,before);assert.equal(observer.budget.fatal,undefined);assert.equal(observer.active.cancelled,undefined);
      const first=payloads[firstIndex],firstMessages=JSON.stringify(first.messages);
      assert.ok(!first.messages.some(m=>m.role==='assistant'||m.role==='tool'),'first native request must have no synthetic assistant/tool history');
      assert.ok(!firstMessages.includes('semanticReview'));assert.ok(!firstMessages.includes('setupReceipts'));assert.ok(!firstMessages.includes('layerTotal'));assert.ok(!firstMessages.includes('readSummary'));
      if(kind==='F1'){assert.ok(!firstMessages.includes('"storage"'));assert.ok(!firstMessages.includes('东仓'));}
      if(kind==='F3'){assert.ok(!firstMessages.includes('lyr-k72'));assert.ok(!firstMessages.includes('松林补给点'));}
      if(kind==='F2') {
        const compare=JSON.stringify(payloads[queryIndex].messages),ref=p.fixture.annotationRefs![0];
        assert.ok('setId' in ref);assert.ok(compare.includes(ref.setId));assert.ok(compare.includes('point-a'));
        assert.ok(compare.includes('B 保障讨论'),'real preceding B conversation remains in native context');
        assert.ok(payloads[queryIndex].messages.some(m=>m.role==='tool'),'preceding tool results are real native history');
        const user=record.snapshot.messages.filter(m=>m.role==='user').at(-1);assert.ok(JSON.stringify(user).includes(ref.setId));
      }
    }
    assert.equal(observer.attempts.length,6);assert.ok(observer.attempts.every(a=>a.completed));assert.equal(observer.budget.input,180);
  } finally {await observer.settle();globalThis.fetch=original;for(const p of prepared)await p.trial.stop();}
});

test('native read-only observer cancels an unauthorized write and still records actual after-state',async()=>{
  const evidence=await mkdtemp(join(tmpdir(),'native-map-cancel-')),original=globalThis.fetch;
  let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
  const synthetic:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!=='https://api.deepseek.com')return original(input,init);
    const common={id:'cancel-smoke',object:'chat.completion.chunk',created:1,model:'deepseek-flash'};
    const delta={role:'assistant',tool_calls:[{index:0,id:'unauthorized-write',type:'function',function:{name:'annotation_action',arguments:JSON.stringify({action:'apply',operations:[{op:'update_object',objectId:'storage-1',changes:{note:'禁止的改动'}}]})}}]};
    return new Response([{...common,choices:[{index:0,delta,finish_reason:null}]},{...common,choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:5,completion_tokens:5,total_tokens:10}}].map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const observer=new Observer(synthetic,evidence,'https://api.deepseek.com');globalThis.fetch=observer.fetch;
  try {
    trial=await startMapTrial(4493,{...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:'deepseek-flash',LLM_API_KEY:'deterministic-test-only',LLM_BASE_URL:'https://api.deepseek.com',LLM_MAX_OUTPUT_TOKENS:'2048',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined},false);
    const fixture=await prepareFixture(trial.manifest,'F1');observer.mode='run';observer.budget.begin();observer.active={id:'cancel',trial,fixture,directory:evidence,phase:'readonly'};
    const record=await ask(trial.manifest,evidence,'query',fixture.sessionId,prompts.F1);await observer.settle();
    assert.match(observer.budget.fatal!,/unauthorized_tool/);assert.match(observer.active.cancelled!,/unauthorized_tool/);assert.equal(observer.budget.total,1);
    assert.deepEqual(record.after,await mapState(trial.manifest,fixture.sessionId),'the actual post-cancel state is retained even if a write raced cancellation');
  } finally {await observer.settle();globalThis.fetch=original;await trial?.stop();}
});
