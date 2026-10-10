import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {openDatabase} from '../src/access/database.js';
import {AccessStore} from '../src/access/store.js';
import {BackgroundService} from '../src/background/service.js';
import {parseBackgroundConfig} from '../src/background/config.js';
import {PiLab} from '../src/pi/lab.js';
import {fakeRuntime,testConfig} from './pi/fake-runtime.js';

const cleanups:Array<() => Promise<unknown>>=[];
afterEach(async () => {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();});
const toolName='information_suggest_recipients';
const recipients=[{seatId:'planning',reason:'任务方案需要调整'}];

describe('recipient suggestion model-visible parameter feedback',() => {
  it.each([
    {name:'nonempty recipients with a contradictory empty-case explanation',input:{recipients,noAdditionalReason:'其他席位不需要通知'},error:'recipients 非空时必须省略 noAdditionalReason',corrected:{recipients}},
    {name:'empty recipients without an explanation',input:{recipients:[]},error:'recipients 为空数组时必须填写 noAdditionalReason',corrected:{recipients:[],noAdditionalReason:'固定接收者可以处理本次信息'}},
  ])('lets the native Pi loop correct $name from the actual tool error',async ({input,error,corrected}) => {
    const dataDir=await mkdtemp(join(tmpdir(),'axon-recipient-feedback-'));cleanups.push(() => rm(dataDir,{recursive:true,force:true}));
    const db=await openDatabase(dataDir),access=new AccessStore(db);
    for (const seatId of ['overall','intelligence','planning']) {
      await access.saveAccount({username:seatId,displayName:seatId,seatId,seatName:seatId,password:'test-password-123',createPublicTask:true,manageModelSettings:false});
      access.updateSeat(seatId,{responsibility:`${seatId} 的职责`});
    }
    db.close();
    const config=testConfig(dataDir,{auth:{secret:'test-signing-secret-at-least-32-characters',sessionMs:28800000}});
    const fake=await fakeRuntime(config,(context,index) => {
      if (index === 0) {
        const schema=context.tools?.find(tool => tool.name === toolName)?.parameters as {properties?:Record<string,{description?:string}>};
        expect(schema.properties?.recipients.description).toContain('省略 noAdditionalReason');
        expect(schema.properties?.noAdditionalReason.description).toContain('仅当 recipients 为空数组时必填');
        return {tools:[{name:toolName,arguments:input}]};
      }
      if (index === 1) {
        const result=context.messages.findLast(message => message.role === 'toolResult');
        expect(result?.role).toBe('toolResult');
        if (result?.role !== 'toolResult') throw new Error('Pi 未将工具结果送回模型');
        expect(result.isError).toBe(true);
        const feedback=result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        expect(feedback).toContain(error);
        // The provider chooses the corrective call in response to feedback; the host never retries it.
        return {tools:[{name:toolName,arguments:corrected}]};
      }
      const result=context.messages.findLast(message => message.role === 'toolResult');
      expect(result?.role === 'toolResult' && result.isError).toBe(false);
      return {text:'分析完成。'};
    });
    const lab=await PiLab.create(config,fake.runtime);cleanups.push(() => lab.close());
    const background=parseBackgroundConfig({enabled:true,deliveryReviewSeatId:'overall',sources:[{sourceId:'source',name:'测试来源',credentialRef:'SOURCE_TOKEN',allowedProfileIds:['analysis'],allowedRecipientSeatIds:['intelligence','planning']}],profiles:[{id:'analysis',goal:'分析资料',instructions:'',resources:[],tools:[toolName]}]});
    const service=new BackgroundService(lab,background);await service.initialize();cleanups.push(() => service.close());
    service.store.grant('seat','overall','source','manage');
    await service.saveRule(lab.access!.identityForSeat('overall')!,{name:'测试规则',sourceId:'source',profileId:'analysis',recipientSeatIds:['intelligence'],supplementaryDelivery:{candidateSeatIds:['planning']},enabled:true},{clientActionId:randomUUID()});
    const receipt=await service.accept('source',{sourceMessageId:randomUUID(),title:'信息',text:'请检查工作方案。'});
    const id=service.store.getEvent(receipt.eventId).initialJobId!;
    await service.pump();
    await vi.waitFor(() => expect(service.store.getJob(id).status).toBe('succeeded'),{timeout:10000});
    const job=service.store.getJob(id);
    expect(job.recipientSuggestion).toMatchObject(corrected);
    expect(job.recipientSuggestionError).toBeUndefined();
    expect(fake.calls).toHaveLength(3);
    expect(service.store.reviewForJob(id)?.status).toBe(corrected.recipients.length ? 'pending' : undefined);
    await vi.waitFor(() => expect(service.store.listDeliveries(id).filter(delivery => delivery.status === 'delivered')).toHaveLength(1));
  });
});
