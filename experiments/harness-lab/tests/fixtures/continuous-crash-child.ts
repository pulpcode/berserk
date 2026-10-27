import { randomUUID } from 'node:crypto';
import { AccessStore } from '../../src/access/store.js';
import { openDatabase } from '../../src/access/database.js';
import { parseBackgroundConfig } from '../../src/background/config.js';
import { BackgroundService } from '../../src/background/service.js';
import { ContextService } from '../../src/context/service.js';
import { parseContextConfig } from '../../src/context/config.js';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

export const crashCatalog = () => parseBackgroundConfig({enabled:true,concurrency:1,modelConcurrency:1,
  sources:[{sourceId:'crash-source',name:'隔离故障来源',credentialRef:'UNUSED_TEST_TOKEN',allowedProfileIds:['readonly'],allowedRecipientSeatIds:['crash-seat']}],
  profiles:[{id:'readonly',name:'只读故障验证',goal:'核对输入，不执行写入。',tools:['source_list'],contextScopeId:'crash-scope'}]});
export const crashConfig = (dataDir:string) => testConfig(dataDir,{seatId:'crash-seat',auth:{secret:'isolated-crash-test-signing-key-123456',sessionMs:3600000}});
export const crashContext = () => new ContextService(parseContextConfig({systems:[{id:'mock',name:'隔离只读资料',adapter:'mock-information-http',baseUrl:'http://127.0.0.1:9',tokenEnv:'CRASH_QUERY_TOKEN'}],scopes:[{id:'crash-scope',name:'故障验证范围',systemIds:['mock'],seatIds:['crash-seat']}]}),{CRASH_QUERY_TOKEN:'unused-isolated-query-token'});

async function run() {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error('Missing isolated directory');
  const db = await openDatabase(dataDir), access = new AccessStore(db);
  await access.saveAccount({username:'crash-seat',displayName:'故障测试',seatId:'crash-seat',seatName:'故障测试',password:'test-password-123',createPublicTask:true,manageModelSettings:true}); db.close();
  let blocked = false;
  const config = crashConfig(dataDir);
  const fake = await fakeRuntime(config,(context) => {
    if (blocked) return {waitForAbort:true};
    if (context.messages.at(-1)?.role==='user') return {tools:[{name:'information_record_analysis_update',arguments:{taskUpdates:[],unassigned:{significant:true,reason:'需要提醒的独立输入'},uncertainties:[]}}]};
    return {text:'SIGKILL 前已发布的固定结论'};
  });
  const lab = await PiLab.create(config,fake.runtime);lab.context=crashContext();const service = new BackgroundService(lab,crashCatalog());
  await service.initialize(); await service.start();
  const actor = lab.access!.identityForSeat('crash-seat')!; service.store.grant('seat',actor.seatId,'crash-source','manage');
  const stream = await service.continuous.configure(actor,{name:'SIGKILL 独立验证',sourceIds:['crash-source'],profileId:'readonly',recipientSeatIds:['crash-seat'],enabled:true,quietMs:0,maxWaitMs:1},{clientActionId:randomUUID()});
  await service.accept('crash-source',{sourceMessageId:'first',title:'第一条',text:'首次来源事实'});
  const deadline=Date.now()+10000;
  while (!service.store.listJobs().some(job=>service.continuous.store.publication(job.id).status==='published')) {
    if(Date.now()>deadline)throw new Error('Initial publication timed out');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const first = service.store.listJobs()[0]; blocked=true;
  await service.accept('crash-source',{sourceMessageId:'second',title:'第二条',text:'中断前已受理但未发布的来源事实'});
  while(fake.calls.length<3){if(Date.now()>deadline)throw new Error('Blocked provider did not start');await new Promise(resolve=>setTimeout(resolve,20));}
  const second=service.store.listJobs().find(job=>job.id!==first.id)!;
  process.send?.({ready:true,stream,first,second,pendingIds:service.continuous.store.pending(stream.epochId).map(input=>input.id)});
  // The test kills this process while the real native request remains active.
  await new Promise(()=>{});
}
if(process.env.CONTINUOUS_CRASH_CHILD==='1')void run().catch(error=>{process.send?.({error:error instanceof Error?error.message:String(error)});process.exitCode=1;process.disconnect?.();});
