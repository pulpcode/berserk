import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {AccessStore} from '../src/access/store.js';
import {openDatabase} from '../src/access/database.js';
import {BackgroundStore} from '../src/background/store.js';
import {parseBackgroundConfig} from '../src/background/config.js';
import {createApp} from '../src/server/app.js';
import {PiLab} from '../src/pi/lab.js';
import {createBackgroundExecutor} from '../src/pi/background-runner.js';
import {HandoffFiles} from '../src/collaboration/files.js';
import {fakeRuntime,testConfig,type Reply} from './pi/fake-runtime.js';
import type {AuthSession} from '../src/contracts/access.js';
import type {BackgroundDeliveryReview,DeliveryReviewDetail,InformationRule,InboxDetail} from '../src/contracts/background.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();});
const tool = 'information_suggest_recipients';
const suggestion = {recipients:[{seatId:'planning',reason:'需要检查方案受到的影响'}]};
async function login(app:FastifyInstance,name:string) {
  const boot = await app.inject('/api/auth/session');
  const response = await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:boot.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':boot.json<AuthSession>().csrf!},payload:{username:name,password:'test-password-123'}});
  expect(response.statusCode,response.body).toBe(200);
  const auth=response.json<AuthSession>(),headers={cookie:response.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  return {auth,call:(url:string,payload?:object) => app.inject({url,headers,method:payload ? 'POST':'GET',...(payload ? {payload}: {})})};
}
async function setup(reply: (index:number) => Reply = index => index === 0 ? {tools:[{name:tool,arguments:suggestion}]} : {text:'分析完成。'}, scoped = false) {
  const dataDir=await mkdtemp(join(tmpdir(),'axon-recipient-')); cleanups.push(() => rm(dataDir,{recursive:true,force:true}));
  const db=await openDatabase(dataDir), access=new AccessStore(db);
  for (const name of ['overall','intelligence','planning','situation']) {
    await access.saveAccount({username:name,displayName:name,seatId:name,seatName:name,password:'test-password-123',createPublicTask:name === 'overall',manageModelSettings:name === 'overall'});
    access.updateSeat(name,{responsibility:`${name} 的业务职责`});
  }
  db.close();
  const config=testConfig(dataDir,{auth:{secret:'test-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,(_context,index) => reply(index));
  const lab=await PiLab.create(config,fake.runtime);
  const background=parseBackgroundConfig({enabled:true,deliveryReviewSeatId:'overall',sources:[{sourceId:'intel',name:'情报来源',credentialRef:'INTEL_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:['overall','intelligence','planning','situation']}],profiles:[{id:'analysis',goal:'分析道路变化',tools:['source_read',tool],instructions:'',resources:[],...(scoped ? {contextScopeId:'review-scope'} : {})}]});
  const executor = createBackgroundExecutor(lab);
  let beforeRead: (() => Promise<void>) | undefined;
  const app=await createApp(lab,false,{config:background,executor:{...executor,read:async job => {await beforeRead?.();return executor.read(job);}},env:{INTEL_TOKEN:'test-token-at-least-24-characters'}},scoped ? {
    config:{systems:[{id:'intel',name:'资料系统',adapter:'mock-information-http',baseUrl:'http://127.0.0.1:4401/intel',tokenEnv:'QUERY_TOKEN'}],scopes:[{id:'review-scope',name:'审批资料',systemIds:['intel'],seatIds:['overall','intelligence','planning','situation']}]},env:{QUERY_TOKEN:'test-read-only-context-token'},
  } : undefined);cleanups.push(() => app.close());
  function pauseRead(number = 1) {
    let reached!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => {reached = resolve;});
    const waiting = new Promise<void>(resolve => {release = resolve;});
    beforeRead = async () => {if (--number === 0) {beforeRead = undefined;reached();await waiting;}};
    cleanups.push(async () => {release();});
    return {entered,release};
  }
  const store=new BackgroundStore(lab.access!.db);store.grant('seat','overall','intel','manage');
  const overall=await login(app,'overall');
  const ruleInput={clientActionId:randomUUID(),name:'特情处理',sourceId:'intel',profileId:'analysis',recipientSeatIds:['intelligence'],supplementaryDelivery:{candidateSeatIds:['planning','situation']},enabled:true};
  async function run(input=ruleInput,uploadIds:string[] = []) {
    const rule=await overall.call('/api/information/rules',input);expect(rule.statusCode,rule.body).toBe(200);
    const response=await app.inject({method:'POST',url:'/api/integrations/intel/events',headers:{authorization:'Bearer test-token-at-least-24-characters'},payload:{sourceMessageId:randomUUID(),title:'道路变化',text:'道路通行状态变化，请研判。',uploadIds}});
    expect(response.statusCode,response.body).toBe(202);
    const jobId=store.getEvent(response.json<{eventId:string}>().eventId).initialJobId!;
    await vi.waitFor(() => expect(['queued','running']).not.toContain(store.getJob(jobId).status),{timeout:10000});
    expect(store.getJob(jobId).status,JSON.stringify(store.getJob(jobId).error)).toBe('succeeded');
    await vi.waitFor(() => expect(store.listDeliveries(jobId).filter(d => d.status === 'delivered')).toHaveLength(1));
    return {job:store.getJob(jobId),rule:rule.json<InformationRule>()};
  }
  return {app,lab,store,fake,overall,run,ruleInput,background,pauseRead};
}

describe('supplementary delivery through native Pi and authenticated routes',() => {
  it('delivers fixed result before review, then approves adjusted candidates exactly once without another model call',async () => {
    const context=await setup();const {job}=await context.run();
    const review=context.store.reviewForJob(job.id)!;expect(review.status).toBe('pending');
    expect(context.fake.calls).toHaveLength(2);
    expect(JSON.stringify(context.fake.calls[0].context)).toContain('planning 的业务职责');
    const planning=await login(context.app,'planning');expect((await planning.call('/api/inbox')).json().total).toBe(0);
    const detail=(await context.overall.call(`/api/information/delivery-reviews/${review.id}`)).json<DeliveryReviewDetail>();
    expect(detail.canDecide).toBe(true);expect(detail.jobDetail.status).toBe('succeeded');expect(detail.suggestion.recipients).toEqual(suggestion.recipients);
    const input={clientActionId:randomUUID(),revision:review.revision,decision:'approve',recipients:[...suggestion.recipients,{seatId:'situation',reason:'需要核实当前状态'}]};
    const url=`/api/information/delivery-reviews/${review.id}/decision`;
    expect((await planning.call(url,input)).statusCode).toBe(404);
    const result=await context.overall.call(url,input);expect(result.statusCode,result.body).toBe(200);expect(result.json<BackgroundDeliveryReview>().status).toBe('approved');
    expect((await context.overall.call(url,input)).statusCode).toBe(200);
    expect((await context.overall.call(url,{...input,clientActionId:randomUUID()})).statusCode).toBe(409);
    expect(context.store.listDeliveries(job.id)).toHaveLength(3);expect(context.fake.calls).toHaveLength(2);
    const inbox=(await planning.call('/api/inbox')).json<{items:Array<{delivery:{id:string}}>}>();
    const item=(await planning.call(`/api/inbox/${inbox.items[0].delivery.id}`)).json<InboxDetail>();
    expect(item.deliveryReason).toEqual({kind:'supplementary',reason:'需要检查方案受到的影响',approvedBySeatId:'overall'});
    expect(item.job).not.toHaveProperty('recipientSuggestion');expect(item.job).not.toHaveProperty('ruleSnapshot');
    expect(JSON.stringify(item)).not.toContain('situation 的业务职责');
    const taskResponse=await context.overall.call('/api/tasks',{clientActionId:randomUUID(),title:'道路处置',goal:'核对道路',visibility:'public'});
    expect(taskResponse.statusCode,taskResponse.body).toBe(200);const taskId=taskResponse.json<{id:string}>().id;
    const actor=context.lab.access!.identity(context.overall.auth.identity!.userId)!;
    // The task-information entry point is also recipient-visible and must use the same redaction.
    const {TaskLinkService}=await import('../src/background/task-links.js');
    const links=new TaskLinkService(context.lab.access!,context.store,{canRead:() => true,sourceName:() => '情报来源',readContent:async () => ({text:'原文',resultText:'结果',resultFiles:[]})});
    links.update(actor,job.eventId,taskId,{revision:0,mode:'include',jobId:job.id,reason:'任务相关'});
    const taskDetail=await links.detail(actor,taskId,job.eventId,job.id);
    expect(taskDetail.job).not.toHaveProperty('recipientSuggestion');

  });
  it('does not grant decision authority to another source manager and preserves pending review on invalid approval',async () => {
    const context=await setup();const {job}=await context.run();const review=context.store.reviewForJob(job.id)!;
    context.store.grant('seat','planning','intel','manage');const planning=await login(context.app,'planning');
    const detail=(await planning.call(`/api/information/delivery-reviews/${review.id}`)).json<DeliveryReviewDetail>();expect(detail.canDecide).toBe(false);
    const url=`/api/information/delivery-reviews/${review.id}/decision`,input={clientActionId:randomUUID(),revision:1,decision:'approve',recipients:suggestion.recipients};
    expect((await planning.call(url,input)).statusCode).toBe(403);
    const invalid=await context.overall.call(url,{...input,recipients:[{seatId:'intelligence',reason:'重复固定席位'}]});expect(invalid.statusCode,invalid.body).toBe(409);
    expect(context.store.getDeliveryReview(review.id).status).toBe('pending');
    context.background.sources[0].allowedRecipientSeatIds = ['overall','intelligence','situation'];
    expect((await context.overall.call(url,input)).statusCode).toBe(403);
    expect(context.store.getDeliveryReview(review.id).status).toBe('pending');
    const declined=await context.overall.call(url,{clientActionId:randomUUID(),revision:1,decision:'decline',reason:'本次无需扩大范围'});expect(declined.statusCode,declined.body).toBe(200);
    expect(context.store.listDeliveries(job.id)).toHaveLength(1);
  });
  it('keeps fixed delivery after invalid suggestions and permits native tool recovery without mandatory retry',async () => {
    const context=await setup(index => index === 0 ? {tools:[{name:tool,arguments:{recipients:[{seatId:'overall',reason:'不属于候选'}]}}]} : {text:'可用信息已分析完成'});
    const {job}=await context.run();expect(job.recipientSuggestion).toBeUndefined();expect(context.store.reviewForJob(job.id)).toBeUndefined();
    expect(context.fake.calls[1].context.messages.some(m => m.role === 'toolResult' && m.isError)).toBe(true);
  });
  it('explicit empty suggestion supersedes the earlier suggestion and creates no approval',async () => {
    const context=await setup(index => index === 0 ? {tools:[{name:tool,arguments:suggestion}]} : index === 1 ? {tools:[{name:tool,arguments:{recipients:[],noAdditionalReason:'固定席位足以处理'}}]} : {text:'无需补充通知'});
    const {job}=await context.run();expect(job.recipientSuggestion?.recipients).toEqual([]);expect(context.store.reviewForJob(job.id)).toBeUndefined();
  });
  it('withholds the tool for fixed-only rules even if the shared profile allows it',async () => {
    const context=await setup(() => ({text:'正常分析'}));
    const {supplementaryDelivery:_,...input}=context.ruleInput;void _;
    await context.run(input as typeof context.ruleInput);
    expect(context.fake.calls[0].context.tools?.map(t => t.name)).not.toContain(tool);
  });

  it.each(['reviewer-grant','reviewer-scope','candidate-scope'] as const)('rechecks %s after asynchronous approval evidence reads',async revoked => {
    const context=await setup(undefined,true);const {job}=await context.run();const review=context.store.reviewForJob(job.id)!;
    const gate=context.pauseRead();
    const response=context.overall.call(`/api/information/delivery-reviews/${review.id}/decision`,{clientActionId:randomUUID(),revision:1,decision:'approve',recipients:suggestion.recipients}).then(value=>value);
    await gate.entered;
    if(revoked==='reviewer-grant')context.store.revoke('seat','overall','intel');
    else context.lab.context!.config.scopes[0].seatIds=context.lab.context!.config.scopes[0].seatIds.filter(id=>id!==(revoked==='reviewer-scope'?'overall':'planning'));
    gate.release();
    expect([403,404]).toContain((await response).statusCode);
    expect(context.store.getDeliveryReview(review.id).status).toBe('pending');
    expect(context.store.listDeliveries(job.id).map(item=>item.recipientSeatId)).toEqual(['intelligence']);
    expect(context.fake.calls).toHaveLength(2);
  });

  it('serializes competing decisions and never creates two supplemental delivery batches',async () => {
    const context=await setup();const {job}=await context.run();const review=context.store.reviewForJob(job.id)!;
    const gate=context.pauseRead(),url=`/api/information/delivery-reviews/${review.id}/decision`;
    const approve=context.overall.call(url,{clientActionId:randomUUID(),revision:1,decision:'approve',recipients:suggestion.recipients}).then(value=>value);
    await gate.entered;
    const decline=context.overall.call(url,{clientActionId:randomUUID(),revision:1,decision:'decline',reason:'另一浏览器中的决定'}).then(value=>value);
    gate.release();
    expect((await approve).statusCode).toBe(200);expect((await decline).statusCode).toBe(409);
    expect(context.store.getDeliveryReview(review.id).status).toBe('approved');
    expect(context.store.listDeliveries(job.id).map(item=>item.recipientSeatId).sort()).toEqual(['intelligence','planning']);
    expect(context.fake.calls).toHaveLength(2);
  });

  it('keeps approval durable when scope changes during delivery and retries only the delivery',async () => {
    const context=await setup(undefined,true);const {job}=await context.run();const review=context.store.reviewForJob(job.id)!;
    const gate=context.pauseRead(2);
    const response=context.overall.call(`/api/information/delivery-reviews/${review.id}/decision`,{clientActionId:randomUUID(),revision:1,decision:'approve',recipients:suggestion.recipients}).then(value=>value);
    await gate.entered;
    expect(context.store.getDeliveryReview(review.id).status).toBe('approved');
    context.lab.context!.config.scopes[0].seatIds=context.lab.context!.config.scopes[0].seatIds.filter(id=>id!=='planning');
    gate.release();expect((await response).statusCode).toBe(200);
    const failed=context.store.listDeliveries(job.id).find(item=>item.recipientSeatId==='planning')!;
    expect(failed.status).toBe('failed');expect(context.store.getDeliveryReview(review.id).status).toBe('approved');
    context.lab.context!.config.scopes[0].seatIds.push('planning');
    const retry=await context.overall.call(`/api/information/deliveries/${failed.id}/retry`,{clientActionId:randomUUID()});
    expect(retry.statusCode,retry.body).toBe(200);expect(context.store.getDelivery(failed.id).status).toBe('delivered');
    expect(context.store.listDeliveries(job.id)).toHaveLength(2);expect(context.fake.calls).toHaveLength(2);
  });

  it.each(['event','inbox'] as const)('withholds %s content when permission changes during native history reads',async entry => {
    const context=await setup();const {job}=await context.run();
    const fixed=context.store.listDeliveries(job.id)[0];
    const actor=entry==='event'?context.overall:await login(context.app,'intelligence');
    const gate=context.pauseRead();
    const response=actor.call(entry==='event'?`/api/information/events/${job.eventId}`:`/api/inbox/${fixed.id}`).then(value=>value);
    await gate.entered;
    if(entry==='event')context.store.revoke('seat','overall','intel');
    else context.background.sources[0].allowedRecipientSeatIds=context.background.sources[0].allowedRecipientSeatIds.filter(id=>id!=='intelligence');
    gate.release();const result=await response;
    expect([403,404]).toContain(result.statusCode);expect(result.body).not.toContain('分析完成。');
  });

  it('rechecks the context scope when reading an active job without a published task assessment',async () => {
    const context=await setup(() => ({waitForAbort:true}),true);
    expect((await context.overall.call('/api/information/rules',context.ruleInput)).statusCode).toBe(200);
    const accepted=await context.app.inject({method:'POST',url:'/api/integrations/intel/events',headers:{authorization:'Bearer test-token-at-least-24-characters'},payload:{sourceMessageId:randomUUID(),title:'尚在分析的信息',text:'资料正文'}});
    const jobId=context.store.getEvent(accepted.json<{eventId:string}>().eventId).initialJobId!;
    await vi.waitFor(() => expect(context.fake.calls).toHaveLength(1));
    const gate=context.pauseRead(),response=context.overall.call(`/api/information/jobs/${jobId}`).then(value=>value);
    await gate.entered;
    context.lab.context!.config.scopes[0].seatIds=context.lab.context!.config.scopes[0].seatIds.filter(id=>id!=='overall');
    gate.release();const result=await response;
    expect([403,404]).toContain(result.statusCode);expect(result.body).not.toContain('资料正文');
  });

  it('closes an attachment stream if source access changes while its bytes are being verified',async () => {
    const context=await setup(),headers={authorization:'Bearer test-token-at-least-24-characters'};
    const created=await context.app.inject({method:'POST',url:'/api/integrations/intel/uploads',headers,payload:{name:'附件.txt',size:7}});
    expect(created.statusCode,created.body).toBe(201);const uploadId=created.json<{uploadId:string}>().uploadId;
    const uploaded=await context.app.inject({method:'PUT',url:`/api/integrations/intel/uploads/${uploadId}/content`,headers:{...headers,'content-type':'application/octet-stream'},payload:Buffer.from('payload')});
    expect(uploaded.statusCode,uploaded.body).toBe(200);
    const {job}=await context.run(context.ruleInput,[uploadId]);
    const original=HandoffFiles.prototype.open;
    let destroyed=false;
    const spy=vi.spyOn(HandoffFiles.prototype,'open').mockImplementation(async function (this:HandoffFiles,record) {
      const content=await original.call(this,record);
      content.stream.on('close',() => {destroyed=true;});
      context.store.revoke('seat','overall','intel');
      return content;
    });
    try {
      const file=context.store.getEvent(job.eventId).files[0];
      const response=await context.overall.call(`/api/information/events/${job.eventId}/files/${file.id}`);
      expect([403,404]).toContain(response.statusCode);expect(response.body).not.toContain('payload');
      await vi.waitFor(() => expect(destroyed).toBe(true));
    } finally {spy.mockRestore();}
  });
});
