/** Opt-in synthetic S01–S07 acceptance. Every run uses a fresh formal trial; never deploys. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {appendFile, chmod, mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AnnotationBinding, AnnotationCurrent, AnnotationListing, AnnotationVersion} from '../src/contracts/annotations.js';
import type {InformationReport} from '../src/contracts/context.js';
import type {SimulationState} from '../src/contracts/simulation.js';
import type {ConfirmationInteraction, HandoffImportResult, SessionSnapshot, StreamEvent, Upload, WorkAction, WorkActionInput, WorkDetail, WorkItem, WorkReceipt} from '../src/contracts/index.js';
import {loadConfig} from '../src/server/config.js';
import {mapTrialAuth, mapTrialRequest, startMapTrial, type MapTrialManifest} from './probe-situation-map.js';

type Seat = 'overall' | 'planning';
type Expectation = {kind:'assign'; file:Upload} | {kind:'submit'; workId:string; filename:string}
  | {kind:'review'; workId:string; submissionId:string; decision:'accept'|'return'};
interface Step {id:string; status:'running'|'recorded'|'failed'; startedAt:string; elapsedMs?:number; failure?:string; evidence?:string}
interface RunReport {
  run:number; status:'running'|'prepared'|'protocol_completed'|'incomplete'; dataDir?:string; trialId?:string;
  semanticReview:'pending_review'; steps:Step[]; structuralChecks:string[]; failure?:string;
}
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = (text:string|Buffer) => createHash('sha256').update(text).digest('hex');
const errorText = (error:unknown) => error instanceof Error ? error.message : String(error);
async function save(path:string, value:unknown) {await writeFile(path, JSON.stringify(value,null,2)+'\n', {mode:0o600});}
function revision() {
  if(process.env.AGENT_FRAMEWORK_REVISION)return {value:process.env.AGENT_FRAMEWORK_REVISION,source:'operator_env'};
  try {return {value:execFileSync('git',['rev-parse','HEAD'],{cwd:packageRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(),source:'git'};}
  catch {return {value:'unknown',source:'no_git_metadata'};}
}

async function bytes(manifest:MapTrialManifest, path:string, seat:Seat) {
  const response=await fetch(`${manifest.url}${path}`, {headers:await mapTrialAuth(manifest,seat),signal:AbortSignal.timeout(30_000)});
  assert.ok(response.ok, `${path.split('?')[0]}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function upload(manifest:MapTrialManifest, workspaceId:string) {
  const body=await readFile(join(packageRoot,'fixtures/agent-framework/初稿.md'));
  const upload=await mapTrialRequest<Upload>(manifest,`/api/workspaces/${workspaceId}/uploads`,'overall','POST',{name:'补给说明_初稿.md',size:body.length});
  const response=await fetch(`${manifest.url}/api/workspaces/${workspaceId}/uploads/${upload.uploadId}/content`,{
    method:'PUT',headers:{...await mapTrialAuth(manifest,'overall'),'content-type':'application/octet-stream'},body,signal:AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok,`初稿上传 HTTP ${response.status}`);
  const result=await response.json() as Upload;
  assert.equal(result.status,'completed'); assert.equal(result.hash,hash(body));
  return result;
}

/** Facts are changed through the real simulation API. No impact conclusions enter fixtures. */
async function facts(manifest:MapTrialManifest, recovery:boolean) {
  const state=await mapTrialRequest<SimulationState>(manifest,'/api/simulation');
  const road=state.objects.find(item=>item.ref.objectId===manifest.objects.road.objectId)!;
  const resource=state.objects.find(item=>item.ref.objectId===manifest.objects.resource.objectId)!;
  const report=state.reports.find(item=>item.objectRefs.some(ref=>ref.objectId===road.ref.objectId))!;
  assert.ok(road && resource && report,'独立模拟来源缺少所需事实');
  const at=(time:string)=>`${manifest.day}T${time}:00+08:00`;
  const from=recovery?'09:35':'09:20',to=recovery?'11:00':'09:50';
  const actions:unknown[]=[];
  actions.push(await mapTrialRequest(manifest,'/api/simulation/object-updates','overall','POST',{
    clientActionId:randomUUID(),ref:road.ref,expectedRevision:road.revision,
    properties:{passability:recovery?'open':'closed',restrictionNote:recovery?'09:35 观测已恢复通行':'09:20—09:50 不可通行'},
    effectiveAt:at(from),validTime:{from:at(from),to:at(to)},
  }));
  if(!recovery) actions.push(await mapTrialRequest(manifest,'/api/simulation/object-updates','overall','POST',{
    clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:2,unit:'辆'},
    effectiveAt:at('09:30'),validTime:{from:at('09:30'),to:at('11:00')},
  }));
  const updated:Omit<InformationReport,'reportId'|'revision'>={
    subjectId:report.subjectId,title:recovery?'西区通道恢复观测':'西区通道不可通行通知',
    summary:recovery?'09:35 观测确认西区通道已恢复通行。':'西区通道预计 09:20—09:50 不可通行。',
    content:recovery?'09:35 新观测确认西区通道已恢复通行，早于上一份报告预计的 09:50。此报告修正 09:35 之后的通行预期，保留此前已发生的限制记录。':'09:20 新观测确认西区通道不可通行，预计持续至 09:50。此前未报告限制的记录已由此次观测更新。',
    objectRefs:report.objectRefs,areaIds:report.areaIds,observedAt:at(from),publishedAt:at(from),validTime:{from:at(from),to:at(to)},
  };
  actions.push(await mapTrialRequest(manifest,'/api/simulation/report-updates','overall','POST',{
    clientActionId:randomUUID(),reportId:report.reportId,expectedRevision:report.revision,report:updated,
  }));
  return {actions,state:await mapTrialRequest<SimulationState>(manifest,'/api/simulation'),
    notification:'No source notifications sent: foreground users query the authorized source APIs directly.'};
}

export async function verifyConfirmation(manifest:MapTrialManifest, seat:Seat, item:ConfirmationInteraction, expected:Expectation) {
  assert.equal(item.toolName,'work_item_action','非预定业务确认，需要人工检查');
  const action=await mapTrialRequest<WorkAction>(manifest,`/api/work-actions/${item.action.handoff!.operationId}`,seat);
  const input=item.action.parameters.action as WorkActionInput;
  assert.equal(action.source,'agent'); assert.equal(action.status,'prepared');
  assert.equal(action.taskSpaceId,manifest.tasks.supply); assert.equal(action.creatorSeatId,'seat-overall');
  assert.equal(action.assigneeSeatId,'seat-planning'); assert.equal(action.seatId,`seat-${seat}`);
  assert.equal(action.kind,expected.kind); assert.equal(input.kind,expected.kind);
  if(expected.kind==='assign') {
    assert.equal(action.files.length,1); assert.equal(action.files[0].hash,expected.file.hash);
    assert.equal(action.files[0].name,expected.file.name);
    assert.equal((await mapTrialRequest<WorkItem[]>(manifest,'/api/work-items',seat)).length,0,'不得重复分派');
  } else {
    assert.equal(action.workItemId,expected.workId);
    const work=await mapTrialRequest<WorkDetail>(manifest,`/api/work-items/${expected.workId}`,seat);
    assert.equal(action.expectedRevision,work.revision);
    if(expected.kind==='submit') {
      assert.equal(action.files.length,1); assert.equal(action.files[0].name,expected.filename);
      assert.ok(action.files[0].size>0);
    } else {
      assert.equal(input.kind,'review');
      if(input.kind!=='review')throw new Error('预期复核操作');
      assert.equal(input.payload.decision,expected.decision); assert.equal(input.payload.submissionId,expected.submissionId);
      assert.equal(work.latestSubmissionId,expected.submissionId);
      const submission=work.submissions.find(item=>item.id===expected.submissionId)!;
      assert.equal(action.files.length,1);assert.deepEqual(action.files[0],submission.file);
    }
  }
  return action;
}

async function ask(manifest:MapTrialManifest, evidence:string, label:string, sessionId:string, seat:Seat, prompt:string, expected?:Expectation) {
  const start=Date.now(), streamPath=join(evidence,`${label}.sse`);
  await writeFile(streamPath,'',{mode:0o600});
  await save(join(evidence,`${label}-input.json`),{sessionId,seat,prompt,expectedBusinessConfirmation:expected??null});
  const confirmations:unknown[]=[],seen=new Set<string>(); let failure:string|undefined, requestId:string|undefined;
  try {
    const response=await fetch(`${manifest.url}/api/sessions/${sessionId}/messages`,{
      method:'POST',headers:{...await mapTrialAuth(manifest,seat),'content-type':'application/json'},body:JSON.stringify({text:prompt}),signal:AbortSignal.timeout(900_000),
    });
    assert.ok(response.ok,`模型请求 HTTP ${response.status}`);
    const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
    for(;;) {
      const part=await reader.read(); if(part.done)break;
      const chunk=decoder.decode(part.value,{stream:true}); await appendFile(streamPath,chunk); buffer+=chunk;
      const lines=buffer.split('\n');buffer=lines.pop()!;
      for(const line of lines) if(line.startsWith('data: ')) {
        const event=JSON.parse(line.slice(6)) as StreamEvent; requestId=event.requestId;
        if(event.type!=='interaction.updated'||event.interaction.status!=='pending'||seen.has(event.interaction.interactionId))continue;
        const item=event.interaction;seen.add(item.interactionId);
        try {
          assert.ok(expected && confirmations.length===0,'未预定或重复交互，需要人工处理');
          assert.equal(item.kind,'confirmation','Agent 提问需人工处理，不自动选择答案');
          if(item.kind!=='confirmation')throw new Error('非业务确认');
          const action=await verifyConfirmation(manifest,seat,item,expected);
          // Record the exact synthetic business action BEFORE granting it, never approve arbitrary Bash.
          confirmations.push({kind:'scripted_human_business_confirmation',interaction:item,prepared:action});
          await save(join(evidence,`${label}-confirmations.json`),confirmations);
          await mapTrialRequest(manifest,`/api/sessions/${sessionId}/interactions/${item.interactionId}/response`,seat,'POST',{
            requestId:item.requestId,kind:'confirmation',decision:'approve',
          });
        } catch(error) {
          failure=errorText(error);
          await save(join(evidence,`${label}-unexpected-interaction.json`),{interaction:item,failure});
          await mapTrialRequest(manifest,`/api/sessions/${sessionId}/cancel`,seat,'POST',{requestId:item.requestId});
        }
      }
    }
  } catch(error) {
    failure??=errorText(error);
    if(requestId) await mapTrialRequest(manifest,`/api/sessions/${sessionId}/cancel`,seat,'POST',{requestId}).catch(()=>undefined);
  }
  const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${sessionId}`,seat);
  const actualId=requestId??snapshot.lastResult?.requestId;
  const messages=snapshot.messages.filter(message=>message.requestId===actualId);
  const queries=messages.filter(message=>message.role==='tool'&&['situation_query','information_search','information_read','task_search','task_read','task_information_list','task_information_read'].includes(message.toolName??''));
  const record={label,sessionId,seat,prompt,elapsedMs:Date.now()-start,requestId:actualId,snapshot,confirmations,failure,
    queryResultBytes:queries.reduce((sum,item)=>sum+Buffer.byteLength(item.text),0),queries,
    toolResultBytes:messages.filter(item=>item.role==='tool').reduce((sum,item)=>sum+Buffer.byteLength(item.text),0),
    usage:snapshot.lastResult?.usageSummary??null,semanticReview:'pending_review'};
  await save(join(evidence,`${label}.json`),record);
  console.info(JSON.stringify({label,requestId:actualId,status:snapshot.lastResult?.status,elapsedMs:record.elapsedMs,failure}));
  assert.equal(failure,undefined,failure); assert.equal(snapshot.lastResult?.status,'succeeded',snapshot.lastResult?.message);
  assert.equal(confirmations.length,expected?1:0,'业务确认次数不符');
  return snapshot;
}

async function annotationState(manifest:MapTrialManifest, sessionId:string) {
  const binding=await mapTrialRequest<AnnotationBinding>(manifest,`/api/sessions/${sessionId}/annotation`,'planning');
  const version=binding.draft?await mapTrialRequest<AnnotationVersion>(manifest,`/api/annotations/${binding.draft.setId}/revisions/${binding.draft.headRevision}`,'planning'):null;
  const listing=await mapTrialRequest<AnnotationListing>(manifest,`/api/tasks/${manifest.tasks.supply}/annotations`,'planning');
  const current=await mapTrialRequest<AnnotationCurrent>(manifest,`/api/tasks/${manifest.tasks.supply}/annotations/current`,'overall');
  const publications=[];
  for(const item of listing.publications.items)publications.push({metadata:item,version:await mapTrialRequest<AnnotationVersion>(manifest,`/api/annotation-publications/${item.publicationId}`,'overall')});
  return {binding,version,listing,current,publications};
}

async function runScenario(run:number, port:number, prepareOnly:boolean, summary:RunReport[], collection:string) {
  const report:RunReport={run,status:'running',semanticReview:'pending_review',steps:[],structuralChecks:[]}; summary.push(report);
  const flush=()=>save(join(collection,'runs.json'),summary);
  await flush();
  let trial:Awaited<ReturnType<typeof startMapTrial>>|undefined;
  const originalFetch=globalThis.fetch;
  try {
    trial=await startMapTrial(port,process.env,false);
    const manifest=trial.manifest;report.dataDir=manifest.dataDir;report.trialId=manifest.trialId;
    const evidence=join(manifest.dataDir,'agent-framework-evidence');await mkdir(evidence,{mode:0o700});
    console.info(JSON.stringify({run,dataDir:manifest.dataDir,evidence,url:manifest.url})); await flush();
    let turnLabel='preparation',inputIndex=0;
    const config=loadConfig({...process.env,LAB_AUTH_MODE:'test',LAB_TEST_SEATS:undefined});
    // Capture only the final JSON body for this configured provider; never record headers or credentials.
    globalThis.fetch=async(input,init)=>{
      const url=input instanceof Request?input.url:String(input);
      if(new URL(url).origin===new URL(config.baseUrl).origin) {
        const body=typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'';
        if(body) {
          assert.ok(!config.apiKey||!body.includes(config.apiKey),'模型请求正文意外包含凭证，拒绝保存');
          const payload=JSON.parse(body) as Record<string,unknown>;
          await appendFile(join(evidence,'model-inputs.jsonl'),JSON.stringify({index:++inputIndex,label:turnLabel,at:new Date().toISOString(),bytes:Buffer.byteLength(body),payload})+'\n',{mode:0o600});
        }
      }
      return originalFetch(input,init);
    };
    const step=async<T>(id:string,operation:()=>Promise<T>)=>{
      turnLabel=id;const item:Step={id,status:'running',startedAt:new Date().toISOString()};report.steps.push(item);await flush();const at=Date.now();
      try {const result=await operation();await save(join(evidence,`${id}-state.json`),result);item.status='recorded';item.evidence=`${id}-state.json`;return result;}
      catch(error){item.status='failed';item.failure=errorText(error);throw error;}
      finally {item.elapsedMs=Date.now()-at;await flush();}
    };
    const prepared=await step('P00',async()=>{
      const info=await mapTrialRequest<{files?:{executionAvailable?:boolean}}>(manifest,'/api/info');
      if(!prepareOnly)assert.equal(info.files?.executionAvailable,true,'真实 Docker 文件执行不可用，主流程未启动');
      const initial=await facts(manifest,false);
      const overall=await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'overall','POST',{});
      const planning=await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'planning','POST',{});
      const file=await upload(manifest,overall.id);
      const sender=await mapTrialRequest<SessionSnapshot>(manifest,'/api/sessions','overall','POST',{workspaceId:overall.id});
      return {info,initial,overall,planning,file,sender};
    });
    await save(join(evidence,'baseline.json'),{git:revision(),scriptHash:hash(await readFile(fileURLToPath(import.meta.url))),
      model:config.model,provider:config.provider,node:process.version,image:config.execution?.image,manifest,
      fixturesHash:hash(await readFile(join(packageRoot,'fixtures/agent-framework/初稿.md'))),
      note:'独立正式账号环境；仅总体/筹划两席办理工作。预置情报/态势席不办理；西区转移任务是可查询候选，是否被读取以实际工具记录为准。无来源通知或后台模型调用。页面操作和脚本业务确认单独留痕。',
      prepareOnly,semanticReview:'pending_review'});
    if(prepareOnly){report.status='prepared';return;}
    const {overall,planning,file,sender}=prepared;
    const work=await step('S01',async()=>{
      await ask(manifest,evidence,'S01-assign',sender.id,'overall',
        '请将“完善西区补给说明”分派给筹划席，结合当前任务要求和来源资料形成供审阅的说明及地图标注，附上当前工作区的补给说明_初稿.md。',{kind:'assign',file});
      const items=await mapTrialRequest<WorkItem[]>(manifest,'/api/work-items','overall');assert.equal(items.length,1);
      const work=await mapTrialRequest<WorkDetail>(manifest,`/api/work-items/${items[0].id}`,'planning');
      assert.equal(work.taskSpaceId,manifest.tasks.supply);assert.equal(work.state,'assigned');assert.equal(work.inputFiles[0].hash,file.hash);
      const action=await mapTrialRequest<WorkAction>(manifest,'/api/work-items/prepare','planning','POST',{
        clientActionId:randomUUID(),kind:'claim',workItemId:work.id,expectedRevision:work.revision,payload:{},
      });
      const receipt=await mapTrialRequest<WorkReceipt>(manifest,`/api/work-actions/${action.operationId}/commit`,'planning','POST',{confirm:true});
      await save(join(evidence,'S01-scripted-page-claim.json'),{kind:'scripted_human_business_action',action,receipt});
      const receiver=await mapTrialRequest<SessionSnapshot>(manifest,'/api/sessions','planning','POST',{workspaceId:planning.id});
      await mapTrialRequest(manifest,`/api/sessions/${receiver.id}/work-item`,'planning','POST',{workItemId:work.id});
      await mapTrialRequest(manifest,`/api/sessions/${sender.id}/work-item`,'overall','POST',{workItemId:work.id});
      // Binding already imports inputs. The idempotent page API returns the actual path;
      // do not require the model to redundantly call handoff_import_file to prove receipt.
      const imported=await mapTrialRequest<HandoffImportResult>(manifest,`/api/handoff-files/${work.inputFiles[0].fileId}/import`,'planning','POST',{workspaceId:planning.id});
      assert.equal(imported.hash,file.hash);
      await save(join(evidence,'S01-page-import-receipt.json'),{kind:'scripted_preparation_idempotent_import',imported});
      return {work,receiver,imported};
    });
    const workId=work.work.id,receiver=work.receiver;
    const readWork=()=>mapTrialRequest<WorkDetail>(manifest,`/api/work-items/${workId}`,'overall');
    const readFileAt=(name:string)=>bytes(manifest,`/api/workspaces/${planning.id}/files/content?path=${encodeURIComponent(name)}`,'planning');
    await step('S02',()=>ask(manifest,evidence,'S02-analyze',receiver.id,'planning','结合任务要求、交接初稿和当前资料，分析有哪些执行障碍。请说明依据、建议及待确认事项。'));
    await step('S03',async()=>{
      await ask(manifest,evidence,'S03-create',receiver.id,'planning','把需要关注的位置标到本会话地图上，并整理为补给说明_v1.md，保留初稿。先保存草稿，不发布。');
      const state=await annotationState(manifest,receiver.id);assert.ok(state.version?.document.layers.some(layer=>layer.features.length>0),'未形成地图标注');
      assert.equal(state.publications.length,0);assert.equal(state.current.publication,null);
      const content=await readFileAt('补给说明_v1.md');assert.ok(content.length>0);
      const original=await bytes(manifest,`/api/workspaces/${overall.id}/files/content?path=${encodeURIComponent(file.path!)}`,'overall');assert.equal(hash(original),file.hash);
      const imported=work.imported;
      const planningOriginalHash=hash(await readFileAt(imported.path));
      assert.equal(planningOriginalHash,file.hash,'筹划席导入初稿被改写');
      await save(join(evidence,'S03-original-files.json'),{overall:{path:file.path,hash:hash(original)},planning:{path:imported.path,hash:planningOriginalHash},expectedHash:file.hash});
      await writeFile(join(evidence,'S03-v1.md'),content,{mode:0o600}); return state;
    });
    const first=await step('S04',async()=>{
      await ask(manifest,evidence,'S04-publish-submit',receiver.id,'planning',
        '请将本会话已保存的标注发布为“西区补给标注第一版”，把该固定发布版的编号和引用说明补充到补给说明_v1.md，然后向总体席提交这份说明。暂不设为任务当前。',
        {kind:'submit',workId,filename:'补给说明_v1.md'});
      const state=await annotationState(manifest,receiver.id);assert.equal(state.publications.length,1);assert.equal(state.current.publication,null);
      const detail=await readWork();assert.equal(detail.state,'submitted');assert.equal(detail.submissions.length,1);
      const submission=detail.submissions[0],content=await bytes(manifest,`/api/handoff-files/${submission.file.fileId}`,'overall');
      assert.equal(hash(content),submission.file.hash);assert.equal(hash(await readFileAt('补给说明_v1.md')),submission.file.hash);
      const publicationId=state.publications[0].metadata.publicationId;assert.ok(content.toString().includes(publicationId),'交接文件缺少真实固定发布编号');
      await writeFile(join(evidence,'S04-submitted-v1.md'),content,{mode:0o600});return {state,detail,publicationId};
    });
    await step('S05',async()=>{
      const update=await facts(manifest,true);await save(join(evidence,'S05-source-update.json'),update);
      await ask(manifest,evidence,'S05-reassess',receiver.id,'planning','来源资料有更新，请重新查询并与此前判断比较，说明当前执行条件发生了什么变化。先分析，不修改成果。');return update;
    });
    await step('S07-return',async()=>{
      await ask(manifest,evidence,'S07-review-return',sender.id,'overall','请查看当前提交的说明及其发布版引用。来源资料已有更新，请退回给筹划席，要求核对最新情况并修订，保留前版，说明变化依据。',
        {kind:'review',workId,submissionId:first.detail.latestSubmissionId!,decision:'return'});
      const detail=await readWork();assert.equal(detail.state,'returned');return detail;
    });
    const second=await step('S06',async()=>{
      await ask(manifest,evidence,'S06-revise-submit',receiver.id,'planning',
        '根据刚才查询到的变化和总体席退回意见，修订本会话标注及说明，保留上一版。说明另存为补给说明_v2.md；发布“西区补给标注第二版”，在新说明中写入该固定发布版编号及引用说明，再次提交新说明给总体席。不要设为任务当前。',
        {kind:'submit',workId,filename:'补给说明_v2.md'});
      const state=await annotationState(manifest,receiver.id);assert.equal(state.publications.length,2);assert.equal(state.current.publication,null);
      const old=state.publications.find(item=>item.metadata.publicationId===first.publicationId)!;assert.deepEqual(old,first.state.publications[0]);
      assert.equal(hash(await readFileAt('补给说明_v1.md')),first.detail.submissions[0].file.hash,'旧工作区文件被改写');
      assert.equal(hash(await readFileAt(work.imported.path)),file.hash,'修订后筹划席初稿被改写');
      const detail=await readWork();assert.equal(detail.state,'submitted');assert.equal(detail.submissions.length,2);
      const second=detail.submissions[1],content=await bytes(manifest,`/api/handoff-files/${second.file.fileId}`,'overall');assert.equal(hash(content),second.file.hash);
      assert.equal(hash(await readFileAt('补给说明_v2.md')),second.file.hash,'第二版工作区文件与提交副本不一致');
      const publicationId=state.publications.find(item=>item.metadata.publicationId!==first.publicationId)!.metadata.publicationId;
      assert.ok(content.toString().includes(publicationId),'第二次提交缺少真实新发布编号');
      assert.equal(hash(await bytes(manifest,`/api/handoff-files/${detail.submissions[0].file.fileId}`,'overall')),first.detail.submissions[0].file.hash);
      await writeFile(join(evidence,'S06-submitted-v2.md'),content,{mode:0o600});return {state,detail,publicationId};
    });
    await step('S07-accept',async()=>{
      await ask(manifest,evidence,'S07-accept-adopt',sender.id,'overall',
        '请读取第二次提交的说明及其中固定发布版，简述相对前版的变化。随后按本次合成流程验证要求验收通过当前提交，并将第二次提交引用的发布版明确设为任务当前标注。',
        {kind:'review',workId,submissionId:second.detail.latestSubmissionId!,decision:'accept'});
      const detail=await readWork(),state=await annotationState(manifest,receiver.id);assert.equal(detail.state,'completed');assert.equal(state.current.publication?.publicationId,second.publicationId);
      return {detail,state,overallWorkbench:await mapTrialRequest(manifest,'/api/workbench/items?bucket=all','overall'),planningWorkbench:await mapTrialRequest(manifest,'/api/workbench/items?bucket=all','planning')};
    });
    report.structuralChecks.push('正式隔离账号完成分派、签收、提交、退回、重提及验收回执',
      '本会话保存并发布两版，发布未自动采用，显式采用第二版',
      '前版工作文件、固定发布版及首次交接副本保持不变，固定引用可由总体席读取');
    report.status='protocol_completed';
  } catch(error) {report.status='incomplete';report.failure=errorText(error);console.error(JSON.stringify({run,failure:report.failure}));}
  finally {
    globalThis.fetch=originalFetch;
    if(trial) {
      // Preserve native Pi files in their original data directory, including failed/interrupted requests.
      const sessions=await readdir(join(trial.manifest.dataDir,'sessions')).catch(()=>[]);
      await save(join(trial.manifest.dataDir,'agent-framework-result.json'),{...report,nativeSessionFiles:sessions});
      await trial.stop();
    }
    await flush();
  }
}

export async function main(args=process.argv.slice(2)) {
  if(args.includes('--help')) {console.info('probe:agent-framework -- [--runs 1|2|3] [--port 4331] [--prepare-only]\n默认一轮；三轮互相独立，失败不重试。--prepare-only 无模型，仅准备合成材料并取证，不能证明 Docker/模型通过。证据含待审阅语义，自动结构检查不能替代人工业务审阅。');return;}
  let runs=1,port=Number(process.env.AGENT_FRAMEWORK_PORT??'4331'),prepareOnly=false;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--runs')runs=Number(args[++i]);
    else if(args[i]==='--port')port=Number(args[++i]);
    else if(args[i]==='--prepare-only')prepareOnly=true;
    else throw new Error(`未知参数 ${args[i]}`);
  }
  assert.ok(Number.isInteger(runs)&&runs>=1&&runs<=3,'--runs 必须为 1～3');
  assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535,'端口无效');
  if(!prepareOnly)assert.ok(process.env.LLM_API_KEY?.trim(),'未配置模型凭证，不发起真实模型请求');
  const collection=await mkdtemp(join(tmpdir(),'axon-agent-framework-'));await chmod(collection,0o700);
  console.info(JSON.stringify({collection,prepareOnly,runs}));const summary:RunReport[]=[];
  for(let run=1;run<=runs;run++)await runScenario(run,port,prepareOnly,summary,collection);
  console.info(JSON.stringify({collection,results:summary.map(item=>({run:item.run,status:item.status,failure:item.failure,semanticReview:item.semanticReview}))}));
  if(summary.some(item=>item.status==='incomplete'))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(errorText(error));process.exitCode=1;});
