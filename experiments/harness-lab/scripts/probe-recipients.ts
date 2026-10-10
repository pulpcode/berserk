/** Real-provider probe over synthetic, isolated data. No production reads, forced tool calls or model-output repair. */
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/access/database.js';
import {AccessStore} from '../src/access/store.js';
import {BackgroundStore} from '../src/background/store.js';
import {parseBackgroundConfig} from '../src/background/config.js';
import type {AuthSession} from '../src/contracts/access.js';
import type {BackgroundJob, DeliveryReviewDetail, InformationJobDetail, RecipientSuggestion} from '../src/contracts/background.js';
import {PiLab} from '../src/pi/lab.js';
import {createApp} from '../src/server/app.js';
import {loadConfig} from '../src/server/config.js';

const definitions = [
  {id:'seat-overall',name:'总体席',responsibility:'统筹公共任务和跨席位协调，审阅补充投递建议，决定是否扩大信息接收范围。'},
  {id:'seat-intelligence',name:'情报席',responsibility:'核实信息来源、事实、可信性、矛盾及缺失信息，跟踪特情变化。'},
  {id:'seat-planning',name:'筹划席',responsibility:'结合任务目标与情报态势，编制和修订方案，提出处置建议。'},
  {id:'seat-situation',name:'态势席',responsibility:'维护区域、对象、资源及行动的当前状态，核对变化与约束。'},
];
const inputs = [
  {id:'road-change',title:'西区通道临时封闭',text:'2026-10-10 09:35，道路巡查单位报告：西区河桥通道因边坡落石完全封闭，预计持续至11:00。此前08:30报告为通行正常。请结合现有任务和资料分析变化、影响与待核实问题。'},
  {id:'fact-correction',title:'通报记录的文字更正',text:'资料校核：09:00例行通报中来源联系人姓名“林清”应为“林青”。经复核只是录入错别字，通道状态、封闭时段、车辆数量、任务条件均无变化，不产生新的业务处置要求。请判断这条更正的影响。'},
  {id:'uncertain-report',title:'位置不明的通行异常线索',text:'09:45收到未经核实的转述：“一座桥可能有情况，或许影响下午运输”。未提供桥梁名称、位置、异常类型、原始报告人和发生时间。请依据已有资料说明能确认什么、不能确认什么，以及应核实哪些问题。'},
];
const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined,LAB_EXECUTION_ENABLED:'false'});
assert.ok(config.apiKey,'需要可用的本地模型 API 配置。');
config.dataDir=await mkdtemp(join(tmpdir(),'axon-recipient-live-'));
config.testSeats=undefined;config.seatId='seat-overall';config.agentRunTimeoutMs=300_000;
config.auth={secret:randomBytes(40).toString('hex'),sessionMs:3600000};
const password=randomBytes(24).toString('hex'), token=randomBytes(32).toString('hex');
const evidence: {dataDir:string;model:string;inputs:typeof inputs;cases:Array<Record<string,unknown>>;mechanismChecksPassed:boolean;approvalPathObserved:boolean;semanticReviewRequired:boolean;failure?:string}={dataDir:config.dataDir,model:config.model,inputs,cases:[],mechanismChecksPassed:false,approvalPathObserved:false,semanticReviewRequired:true};
const persist=() => writeFile(join(config.dataDir,'validation.json'),JSON.stringify(evidence,null,2),{mode:0o600});
const db=await openDatabase(config.dataDir),access=new AccessStore(db);
for(const seat of definitions){
  await access.saveAccount({username:seat.id,displayName:seat.name,seatId:seat.id,seatName:seat.name,password,createPublicTask:seat.id==='seat-overall',manageModelSettings:seat.id==='seat-overall'});
  access.updateSeat(seat.id,{responsibility:seat.responsibility});
}
const overall=access.identityForSeat('seat-overall')!;
const tasks=[
  access.create(overall,{clientActionId:randomUUID(),visibility:'public',title:'西区上午补给运输',goal:'2026-10-10 10:00至10:40，通过西区河桥通道运送补给，尚未确定备用路线。'}),
  access.create(overall,{clientActionId:randomUUID(),visibility:'public',title:'西区午后设备转移',goal:'2026-10-10 14:00至15:00，通过西区河桥通道转移设备；是否恢复通行需在出发前核实。'}),
  access.create(overall,{clientActionId:randomUUID(),visibility:'public',title:'东区资料整理',goal:'在东区办公场所整理资料，不涉及运输和西区道路。'}),
];
db.close();
const lab=await PiLab.create(config),store=new BackgroundStore(lab.access!.db);
store.grant('seat','seat-overall','probe-intel','manage');
const background=parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,deliveryReviewSeatId:'seat-overall',sources:[{
  sourceId:'probe-intel',name:'合成情报来源',credentialRef:'PROBE_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:definitions.map(seat=>seat.id),
}],profiles:[{id:'analysis',name:'综合分析',goal:'分析来报事实与变化，结合获准资料判断相关任务影响和不确定事项，形成简明结论。结合各席位职责判断有无需要补充知悉的席位；固定名单由系统执行。',
  tools:['source_list','source_read','information_suggest_recipients'],instructions:'这是合成资料的能力验证。业务依据来自收到的信息和可读取资料，不查询外部互联网；区分事实与推断，不为缺失信息编造结论。',resources:[
    {id:'active-tasks',title:'当前公共任务说明',content:JSON.stringify(tasks.map(task=>({id:task.id,title:task.title,goal:task.goal})),null,2)},
    {id:'road-record',title:'道路既有通报',content:'2026-10-10 08:30：西区河桥通道正常通行。东区与西区是不同区域；本资料未提供道路拓扑和备用路线。'},
  ]}]});
const app=await createApp(lab,false,{config:background,env:{PROBE_TOKEN:token}});
async function login(username:string){
  const initial=await app.inject('/api/auth/session');
  const response=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:initial.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:`http://localhost:${config.port}`,'x-csrf-token':initial.json<AuthSession>().csrf!},payload:{username,password}});
  assert.equal(response.statusCode,200,response.body);const auth=response.json<AuthSession>();
  return {cookie:response.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:`http://localhost:${config.port}`,'x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
}
async function waitForJob(id:string):Promise<BackgroundJob>{
  const deadline=Date.now()+330_000;
  while(Date.now()<deadline){const job=store.getJob(id);if(!['queued','running'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,250));}
  throw new Error('独立验收达到观察时限；不会自动重跑。');
}
async function waitDeliveries(jobId:string){
  const deadline=Date.now()+10_000;
  while(Date.now()<deadline){const deliveries=store.listDeliveries(jobId);if(deliveries.length&&deliveries.every(item=>item.status!=='pending'))return deliveries;await new Promise(resolve=>setTimeout(resolve,100));}
  return store.listDeliveries(jobId);
}
try{
  await app.ready();const headers=await login('seat-overall');
  const rule=await app.inject({method:'POST',url:'/api/information/rules',headers,payload:{clientActionId:randomUUID(),name:'固定情报席与候选补充席位',sourceId:'probe-intel',profileId:'analysis',recipientSeatIds:['seat-intelligence'],supplementaryDelivery:{candidateSeatIds:['seat-planning','seat-situation']},enabled:true}});
  assert.equal(rule.statusCode,200,rule.body);
  for(const input of inputs){
    const record:Record<string,unknown>={caseId:input.id,startedAt:new Date().toISOString(),technicalPassed:false};evidence.cases.push(record);await persist();
    try{
      const accepted=await app.inject({method:'POST',url:'/api/integrations/probe-intel/events',headers:{authorization:`Bearer ${token}`},payload:{sourceMessageId:input.id,title:input.title,text:input.text}});
      assert.equal(accepted.statusCode,202,accepted.body);
      const event=store.getEvent(accepted.json<{eventId:string}>().eventId),job=await waitForJob(event.initialJobId!);record.job=job;
      const native=await lab.readPreprocess({jobId:job.id,sessionId:job.sessionId!,directory:join(config.dataDir,'background','jobs',job.id)});record.snapshot=native;
      assert.equal(job.status,'succeeded',JSON.stringify(job.error));
      const detail=await app.inject({url:`/api/information/jobs/${job.id}`,headers});assert.equal(detail.statusCode,200,detail.body);record.jobDetail=detail.json<InformationJobDetail>();
      const before=await waitDeliveries(job.id);record.beforeApproval=before;
      assert.deepEqual(before.map(d=>[d.recipientSeatId,d.status]),[['seat-intelligence','delivered']]);
      const review=store.reviewForJob(job.id);record.recordedSuggestion=job.recipientSuggestion??null;record.reviewBefore=review??null;
      if(review){
        const reviewResponse=await app.inject({url:`/api/information/delivery-reviews/${review.id}`,headers});assert.equal(reviewResponse.statusCode,200,reviewResponse.body);
        const reviewDetail=reviewResponse.json<DeliveryReviewDetail>();record.reviewDetail=reviewDetail;
        const jobsBefore=store.listJobs(),usageBefore=jobsBefore.map(item=>({id:item.id,usage:item.usage}));
        // Only approve the actual model suggestions for these synthetic seats; never add missing suggestions.
        const suggestion=job.recipientSuggestion as RecipientSuggestion;
        assert.ok(suggestion.recipients.every(recipient=>['seat-planning','seat-situation'].includes(recipient.seatId)));
        const decision={clientActionId:randomUUID(),revision:review.revision,decision:'approve',recipients:suggestion.recipients};
        const approved=await app.inject({method:'POST',url:`/api/information/delivery-reviews/${review.id}/decision`,headers,payload:decision});assert.equal(approved.statusCode,200,approved.body);record.approval=approved.json();
        const retry=await app.inject({method:'POST',url:`/api/information/delivery-reviews/${review.id}/decision`,headers,payload:decision});assert.equal(retry.statusCode,200,retry.body);
        const after=await waitDeliveries(job.id);record.afterApproval=after;
        assert.equal(after.length,1+suggestion.recipients.length);assert.ok(after.every(item=>item.status==='delivered'));
        assert.deepEqual(store.listJobs().map(item=>({id:item.id,usage:item.usage})),usageBefore,'批准不能新增作业或模型调用');
        const nativeAfter=await lab.readPreprocess({jobId:job.id,sessionId:job.sessionId!,directory:join(config.dataDir,'background','jobs',job.id)});
        assert.deepEqual(nativeAfter.messages,native.messages,'批准不得追加模型消息');
      }
      record.technicalPassed=true;
    }catch(error){record.failure=error instanceof Error?error.message:String(error);}
    record.endedAt=new Date().toISOString();await persist();
    console.info(JSON.stringify({caseId:input.id,technicalPassed:record.technicalPassed,jobId:(record.job as BackgroundJob|undefined)?.id,suggestion:record.recordedSuggestion??null,failure:record.failure}));
  }
  evidence.approvalPathObserved=evidence.cases.some(item=>item.approval!==undefined);
  evidence.mechanismChecksPassed=evidence.approvalPathObserved&&evidence.cases.length===inputs.length&&evidence.cases.every(item=>item.technicalPassed);
  console.info(JSON.stringify({mechanismChecksPassed:evidence.mechanismChecksPassed,approvalPathObserved:evidence.approvalPathObserved,semanticReviewRequired:true,dataDir:config.dataDir,model:config.model,cases:evidence.cases.length}));
  if(!evidence.mechanismChecksPassed)process.exitCode=1;
}catch(error){evidence.failure=error instanceof Error?error.message:String(error);process.exitCode=1;console.error(evidence.failure);}
finally{await persist();await app.close();}
