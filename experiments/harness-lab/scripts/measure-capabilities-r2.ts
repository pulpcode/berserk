/** Local deterministic storage measurement. No provider, business service or production data is used. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { arch, loadavg, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CapabilityService, type ControlledSkill } from '../src/capabilities/service.js';
import { CapabilityManagement } from '../src/capabilities/management.js';
import { loadControlledSkills } from '../src/resources/service.js';
import type { ExpertRef, ExpertRevision } from '../src/contracts/capabilities.js';

interface MeasuredStore {
  registerBuiltins(input:{skills:ControlledSkill[];roles:[]}):Promise<ExpertRevision[]>;
  resolve(ref:ExpertRef,expectedDigest?:string):Promise<ExpertRevision>;
  metrics():{hits:number;misses:number;loadMs:number[];cacheEntries:number;cacheBytes:number};
  close():void;
}
interface StoreFactory {open(path:string):Promise<MeasuredStore>}
const value=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const baselineRoot=value('--baseline-root');const output=value('--output');
assert(baselineRoot&&isAbsolute(baselineRoot),'--baseline-root ABS repository path is required');
assert(output&&isAbsolute(output),'--output ABS json path is required');
const git=(...args:string[])=>execFileSync('git',['-C',baselineRoot,...args],{encoding:'utf8'}).trim();
execFileSync('git',['-C',baselineRoot,'diff','--quiet','HEAD','--','experiments/harness-lab/src/capabilities/service.ts']);
const baselineSha=git('rev-parse','HEAD');
const baseline=await import(pathToFileURL(join(baselineRoot,'experiments/harness-lab/src/capabilities/service.ts')).href) as {CapabilityService:StoreFactory};
const root=await mkdtemp(join(tmpdir(),'axon-r2-storage-measurement-'));
const skills=await loadControlledSkills(['synthesis','review']);
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
const summary=(values:number[])=>({n:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),minMs:Math.min(...values),maxMs:Math.max(...values),samplesMs:values});
async function measure(factory:StoreFactory,dir:string,r2:boolean){
  const seeded=await factory.open(dir);
  if(r2)await CapabilityManagement.open(seeded as CapabilityService,{skills:()=>skills,tools:()=>[],seats:()=>[]});
  const experts=await seeded.registerBuiltins({skills,roles:[]});const expert=experts.find(item=>item.expertId==='synthesis-expert')!;seeded.close();
  const cold:number[]=[],open:number[]=[];
  for(let i=0;i<20;i++){
    const started=performance.now();const store=await factory.open(dir);open.push(performance.now()-started);
    try{const at=performance.now();const loaded=await store.resolve(expert,expert.digest);cold.push(performance.now()-at);assert.equal(loaded.digest,expert.digest);}finally{store.close();}
  }
  const store=await factory.open(dir);const hot:number[]=[];
  try{
    await store.resolve(expert,expert.digest);
    for(let i=0;i<100;i++){const at=performance.now();await store.resolve(expert,expert.digest);hot.push(performance.now()-at);}
    return {ref:{expertId:expert.expertId,revisionId:expert.revisionId,digest:expert.digest},coldResolve:summary(cold),storeOpen:summary(open),hotResolve:summary(hot),hotCache:store.metrics()};
  }finally{store.close();}
}
async function publication(){
  const store=await CapabilityService.open(join(root,'publication'));
  try{
    await store.registerBuiltins({skills,roles:[]});
    const actor={userId:'measurement-admin',seatId:'measurement-seat'};
    const management=await CapabilityManagement.open(store,{skills:()=>skills,tools:()=>[],seats:()=>[{id:actor.seatId,name:'合成测试席位'}],reauthorize:who=>assert.equal(who.userId,actor.userId)});
    const detail=await management.create(actor,{clientActionId:randomUUID()});const id=detail.expert.expertId;
    const draft=await management.save(actor,id,{expectedDraftRevision:1,content:{name:'存储计量专家',description:'仅计量本地存储提交',instructions:'只使用合成计量输入。',skillIds:[],allowedTools:[]}});
    const validation=await management.validate(actor,id,{expectedDraftRevision:draft.draftRevision});
    const prepared=await management.prepareTrial(actor,id,{expectedDraftRevision:draft.draftRevision,validationId:validation.validationId,input:'无模型存储计量夹具',clientActionId:randomUUID()});
    management.recordTrialResult(actor,prepared.trial.trialId,{status:'succeeded',evidence:{tools:[],model:'no-model-measurement-fixture',runtime:'trusted-local-measurement-fixture',fileEnvironmentVerified:false,success:true,summary:'仅为存储门禁计量注入的可信宿主夹具，不代表运行试用。',unverified:['model-execution','docker','business-integration']}});
    management.confirmTrial(actor,prepared.trial.trialId,{approved:true,reason:'仅测量发布事务存储开销，不用作产品验收证据。',clientActionId:randomUUID()});
    management.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:[actor.seatId],clientActionId:randomUUID()});
    const action=randomUUID();const input={expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,validationId:validation.validationId,trialId:prepared.trial.trialId,releaseNotes:'本地计量',acceptedRiskCodes:[],clientActionId:action};
    const began=performance.now();const results=await Promise.all(Array.from({length:8},async()=>{const at=performance.now();const item=await management.publish(actor,id,input);return {item,ms:performance.now()-at};}));const wallMs=performance.now()-began;
    const publications=(await management.get(id)).publications;const receiptCount=Number(store.db.prepare('SELECT COUNT(*) n FROM r2_actions WHERE actor_id=? AND action_id=?').get(actor.userId,action)?.n);
    assert.equal(new Set(results.map(r=>r.item.publicationId)).size,1);assert.equal(publications.length,1);assert.equal(receiptCount,1);
    return {concurrentCalls:8,latencyIncludingMutexWait:summary(results.map(r=>r.ms)),wallMs,committedPublications:publications.length,actionReceipts:receiptCount,releaseVersion:publications[0].releaseVersion,fixture:'trusted-local-no-model-evidence; not actual trial acceptance'};
  }finally{store.close();}
}
try{
  const environment={node:process.version,platform:platform(),arch:arch(),loadAverageAtStart:loadavg(),measuredAt:new Date().toISOString()};
  const r1=await measure(baseline.CapabilityService,join(root,'r1'),false);const r2=await measure(CapabilityService,join(root,'r2'),true);assert.deepEqual(r2.ref,r1.ref);
  const publicationResult=await publication();
  const report={environment,baseline:{commit:baselineSha,source:'clean tracked baseline capability service'},r1,r2,publication:publicationResult,limits:['Application-cache cold means a new store instance; OS filesystem cache is not flushed.','Both versions use identical skill bytes and isolated data roots, sequentially in this process.','Other test processes may load CPU and disk; no performance SLO or model latency is inferred.','Publication latency includes queueing and content persistence; no model or Docker call runs.','Only local deterministic storage overhead is measured; live-provider timing is separate.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  const note=join(dirname(output),'performance-r2-harness-note.md');
  await writeFile(note,`# R2 同机存储计量说明\n\n基线 ${baselineSha} 的已跟踪 service.ts 无本地修改。脚本通过本地源码模块载入该基线，与 R2 当前工作树使用同一组受控技能正文、新临时目录及相同 Node 进程，分别执行 20 次实例冷读及 100 次热读；两者专家修订摘要完全一致。\n\n冷读只重建应用缓存，未清操作系统缓存。顺序执行存在时间偏差，机器上其他测试进程会影响 CPU/IO，不据此承诺 SLO。并发发布计量为 8 次同动作调用，使用明确标识的可信宿主无模型证据夹具，只测事务和排队开销，不是专家隔离试用或真实模型验收。结果断言只产生 1 个发布与 1 份动作回执。\n\n原始毫秒样本及分位数保存在 performance-r2.json；临时测试数据运行后删除，不读取或复制任何模型凭据、业务数据或线上目录。\n`);
  console.log(JSON.stringify({output,cold:{r1:r1.coldResolve.p95Ms,r2:r2.coldResolve.p95Ms},hot:{r1:r1.hotResolve.p95Ms,r2:r2.hotResolve.p95Ms},publication:publicationResult.committedPublications}));
}finally{await rm(root,{recursive:true,force:true});}
