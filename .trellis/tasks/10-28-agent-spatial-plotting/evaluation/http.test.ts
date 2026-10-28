import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startMapTrial,mapTrialAuth,mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {SessionSnapshot,StreamEvent} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {SSELines} from '../../10-17-map-query-native-evaluation/run.js';
import {prepareCase} from '../../10-26-agent-plotting-integration/evaluation-v2/cases.js';
import {offlineEnvironment,loopbackOnly} from '../../10-26-agent-plotting-integration/evaluation-v3/runtime.js';
import {runReviewedTurns,type Evidence} from './review-gate.js';
function stream(n:number,text:string,tool?:{name:string;arguments:unknown}) {
 return new Response(`data: ${JSON.stringify({id:'offline-'+n,model:'deepseek-v4-1-flash-261017',choices:[{index:0,delta:tool?{role:'assistant',tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.arguments)}}]}:{role:'assistant',content:text},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:1000,completion_tokens:100}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
}
test('real HTTP/Pi AskUser, reviewed optional ending and exact-result save retain one session', {timeout:180000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'integration-gate-http-')),original=globalThis.fetch;
 let calls=0,answers=0,posts=0,resultRef='';const wires:unknown[]=[];
 globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.origin!=='https://ark.cn-beijing.volces.com')return loopbackOnly(original)(input,init);
  const payload=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:unknown}>};wires.push(payload);const n=++calls;
  assert.ok(n<=8,'Unexpected provider loop');
  const tool=(name:string,args:unknown)=>stream(n,'',{name,arguments:args});
  const last=payload.messages.filter(m=>m.role==='tool').at(-1);
  const data=last?JSON.parse(String(last.content)).data:undefined;
  if(n===1)return tool('ask_user',{questions:[{id:'centre',prompt:'以哪个点为中心？'}]});
  if(n===2||n===5)return tool('annotation_read',{mode:'draft',objectIds:['origin'],fields:['geometry']});
  if(n===3)return tool('spatial_analyze',{operation:'buffer',input:{kind:'annotation',ref:data.ref,objectIds:['origin']},distanceM:500});
  if(n===4){resultRef=data.resultRef;assert.ok(resultRef);return stream(n,'已生成500米范围，仅预览。是否需要在这个范围内继续做点筛选？如果要做，我会沿用这个结果引用。');}
  if(n===6)return tool('annotation_from_analysis',{resultRef,layerId:'derived',objectId:'saved-range',name:'临时范围'});
  if(n===7)return tool('annotation_action',{action:'apply',operations:[{op:'update_object',objectId:'saved-range',changes:{informationRole:'plan'}}]});
  return stream(n,'已保存原固定范围，并设为方案；未发布、未采用。');
 };
 let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
 try {
  trial=await startMapTrial(5397,offlineEnvironment(),false,{background:'neutral'});const manifest=trial.manifest,p=await prepareCase(manifest,'C10');
  const inspect=async():Promise<Evidence>=>{
   const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${p.sessionId}`,'planning');
   return {sessionId:p.sessionId,requestId:snapshot.messages.findLast(m=>m.role==='user')!.requestId!,status:snapshot.lastResult?.status==='succeeded'?'succeeded':'failed',snapshot,mapState:await mapState(manifest,p.sessionId),pendingInteraction:(snapshot.interactions??[]).some(i=>i.status==='pending')};
  };
  const result=await runReviewedTurns({directory:join(directory,'gate'),prompts:['生成500米范围，仅预览；缺少中心时先问我。',p.prompts[1]],replies:[],ports:{inspect,send:async text=>{
   posts++;const auth=await mapTrialAuth(manifest,'planning'),response=await fetch(`${manifest.url}/api/sessions/${p.sessionId}/messages`,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({text})});assert.ok(response.ok&&response.body);
   const jobs:Promise<unknown>[]=[],seen=new Set<string>();const parser=new SSELines(value=>{
    const event=value as unknown as StreamEvent;
    if(event.type==='interaction.updated'&&event.interaction.status==='pending'&&!seen.has(event.interaction.interactionId)){
     const item=event.interaction;seen.add(item.interactionId);assert.equal(answers,0);assert.equal(item.kind,'question');
     if(item.kind!=='question')throw new Error('Unexpected interaction');assert.deepEqual(item.questions.map(q=>({id:q.id,prompt:q.prompt})),[{id:'centre',prompt:'以哪个点为中心？'}]);answers++;
     jobs.push(mapTrialRequest(manifest,`/api/sessions/${p.sessionId}/interactions/${item.interactionId}/response`,'planning','POST',{requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:'centre',text:'以当前草稿origin为中心。'}]}));
    }
   });
   const reader=response.body.getReader();for(;;){const chunk=await reader.read();if(chunk.done)break;parser.push(chunk.value);}await Promise.all(jobs);return inspect();
  },review:async checkpoint=>{
   const before=posts;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(posts,before,'No next original prompt while review pending');
   assert.deepEqual(await inspect(),checkpoint.evidence,'Same native session survives review');
   return {checkpointHash:checkpoint.hash,reviewer:'offline-scripted-review',reason:'Controlled provider completed current request; optional offer requires no answer',action:'advance'};
  }}});
  const after=await mapState(manifest,p.sessionId),saved=after.version!.document.layers.flatMap(l=>l.features).filter(f=>f.objectId==='saved-range');
  assert.equal(result.accepted,2);assert.equal(posts,2);assert.equal(answers,1);assert.equal(calls,8);assert.equal(saved.length,1);assert.equal(saved[0].informationRole,'plan');
  const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${p.sessionId}`,'planning');
  const spatial=snapshot.messages.find(m=>m.toolName==='spatial_analyze')!.spatialResult!;
  assert.deepEqual(saved[0].geometry,spatial.geometry);assert.equal(snapshot.messages.filter(m=>m.role==='user').length,2);
  await writeFile(join(directory,'evidence.json'),JSON.stringify({result,posts,answers,controlledProviderCalls:calls,realModelRequests:0,wires,before:p.before,after,snapshot},null,2));
  console.info(JSON.stringify({evidence:directory,realModelRequests:0,controlledProviderCalls:calls}));
 }finally{await trial?.stop();globalThis.fetch=original;}
});
