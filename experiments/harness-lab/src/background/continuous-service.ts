import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Identity, TaskSpace } from '../contracts/access.js';
import type { BackgroundJob, BackgroundPage, BackgroundAction, BackgroundAnalysisInput } from '../contracts/background.js';
import type { AnalysisUpdateInput, AnalysisUpdate, ContinuousStream, ContinuousStreamInput, ContinuousRound, ContinuousRoundDetail, ContinuousCurrentQuery, ContinuousCurrentResult, ContinuousInputEvidence } from '../contracts/continuous.js';
import type { SessionSnapshot, FileRef, ComposerSelection } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import type { TaskAssessmentEvidence, BackgroundExecutor } from './executor.js';
import { snapshotBackgroundProfile } from '../pi/background-runner.js';
import { Mutex } from '../resources/files.js';
import { queryEvidence } from './context-evidence.js';
import { ContinuousStore } from './continuous-store.js';
import { type BackgroundService } from './service.js';

const missing=()=>new RequestError('CONTINUOUS_NOT_FOUND','研判不存在或无权访问。',404);
function finalText(snapshot:SessionSnapshot|null,requestId:string){const id=snapshot?.turns?.find(t=>t.requestId===requestId)?.finalMessageId;return snapshot?.messages.find(m=>m.id===id&&m.requestId===requestId&&m.role==='assistant'&&!m.isError)?.text??'';}
function processingStatements(snapshot:SessionSnapshot|null,requestId:string){const id=snapshot?.turns?.find(t=>t.requestId===requestId)?.finalMessageId;const end=snapshot?.messages.findIndex(m=>m.id===id)??-1;return snapshot?.messages.slice(0,end).filter(m=>m.role==='assistant'&&m.requestId===requestId&&!m.isError).map(m=>m.text).filter(Boolean).join('\n\n');}
const invalid=(text:string)=>new RequestError('INVALID_INPUT',text);
const readonlyTools=new Set(['read','ls','find','source_list','source_read','skill_read','information_search','information_read','situation_query','task_search','task_read','analysis_current_read','information_record_analysis_update']);
export class ContinuousService {
  readonly store:ContinuousStore;
  private readonly preparations=new Mutex();
  constructor(readonly host:BackgroundService,readonly executor:BackgroundExecutor){this.store=new ContinuousStore(host.store);}
  manage(actor:Identity,stream:ContinuousStream){for(const id of stream.sourceIds)this.host.permission(actor,id,true);}
  assertStream(stream:ContinuousStream){
    const {host}=this;host.assertContext(undefined,stream.profile.contextScope);
    const profile=host.config.profiles.find(p=>p.id===stream.profileId);if(!profile||stream.profile.skillIds.some(id=>!profile.skillIds.includes(id))||stream.profile.tools.some(t=>!['task_search','task_read','analysis_current_read','information_record_analysis_update'].includes(t)&&!profile.tools.includes(t)))throw missing();
    for(const sourceId of stream.sourceIds){const source=host.source(sourceId);if(!source.allowedProfileIds.includes(stream.profileId))throw missing();for(const seatId of stream.recipientSeatIds){if(!source.allowedRecipientSeatIds.includes(seatId)||!host.lab.access!.identityForSeat(seatId))throw missing();host.assertContext(seatId,stream.profile.contextScope);}}
  }
  canRead(actor:Identity,stream:ContinuousStream){
    try {const current=this.host.lab.access!.identity(actor.userId);if(!current||current.seatId!==actor.seatId||stream.sourceIds.some(id=>!this.host.config.sources.some(s=>s.sourceId===id)))return false;this.host.assertContext(actor.seatId,stream.profile.contextScope);
      const recipient=stream.recipientSeatIds.includes(actor.seatId)&&stream.sourceIds.every(id=>this.host.source(id).allowedRecipientSeatIds.includes(actor.seatId));
      return recipient||stream.sourceIds.every(id=>!!this.host.store.effectivePermission(current,id));
    }catch{return false;}
  }
  access(actor:Identity){return {enabled:true,canRead:this.store.streams().some(s=>this.canRead(actor,s)),canManage:this.host.config.sources.some(s=>this.host.store.effectivePermission(actor,s.sourceId)==='manage')};}
  publicStream(stream:ContinuousStream):ContinuousStream{return {...stream,profile:{...stream.profile,instructions:'',resources:[],skills:undefined,agents:undefined}};}
  streams(actor:Identity){return {items:this.store.streams().filter(s=>{try{this.manage(actor,s);return true;}catch{return false;}}).map(s=>this.publicStream(s))};}
  async configure(actor:Identity,input:ContinuousStreamInput,options:{id?:string;revision?:number;clientActionId?:string}){
    if(!input || typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!Array.isArray(input.sourceIds)||!input.sourceIds.length||input.sourceIds.length>100||new Set(input.sourceIds).size!==input.sourceIds.length||!Array.isArray(input.recipientSeatIds)||!input.recipientSeatIds.length||new Set(input.recipientSeatIds).size!==input.recipientSeatIds.length||typeof input.enabled!=='boolean')throw invalid('请填写配置名称、来源集合和共同接收席位。');
    if((input.quietMs!==undefined&&(!Number.isSafeInteger(input.quietMs)||input.quietMs<0||input.quietMs>60000))||(input.maxWaitMs!==undefined&&(!Number.isSafeInteger(input.maxWaitMs)||input.maxWaitMs<1||input.maxWaitMs>300000))||(input.quietMs??5000)>(input.maxWaitMs??30000))throw invalid('合并等待时间无效。');
    for(const id of input.sourceIds)this.host.permission(actor,id,true);
    const previous=options.id?this.store.current(options.id):undefined;if(previous){this.manage(actor,previous);if(previous.revision!==options.revision)throw new RequestError('CONTINUOUS_CONFLICT','配置已变化。',409);}
    const configured=this.host.config.profiles.find(p=>p.id===input.profileId);if(!configured)throw invalid('处理方案不存在。');
    // The continuous capability is a strictly read-only subset, independent of legacy profile execution.
    const profile=await snapshotBackgroundProfile(this.host.lab,{...configured,tools:[...new Set([...configured.tools.filter(t=>readonlyTools.has(t)),'task_search','task_read','analysis_current_read','information_record_analysis_update'])],agentIds:[]});
    const scope=this.host.configuredProfileScope(configured);if(!scope)throw invalid('持续研判需要明确的共同资料范围。');profile.contextScope=scope;
    const time=new Date().toISOString();const stream:ContinuousStream={...input,name:input.name.trim(),id:previous?.id??randomUUID(),epochId:randomUUID(),revision:previous?previous.revision+1:1,profile,sessionId:randomUUID(),state:input.enabled?'active':'paused',createdAt:time,updatedAt:time,createdByUserId:actor.userId,pendingInputs:0};this.assertStream(stream);
    for(const id of input.sourceIds)this.host.permission(actor,id,true);
    return options.clientActionId?this.store.receipt(actor.userId,options.clientActionId,input,()=>this.store.create(stream,previous)):this.store.create(stream,previous);
  }
  control(actor:Identity,id:string,input:{revision:number;action:'pause'|'resume';clientActionId:string}){
    const stream=this.store.streams().find(s=>s.epochId===id)??this.store.current(id);this.manage(actor,stream);
    return this.store.receipt(actor.userId,input.clientActionId,{id,...input},()=>{const latest=this.store.stream(stream.epochId);if(latest.revision!==input.revision)throw new RequestError('CONTINUOUS_CONFLICT','配置已变化。',409);
      if(input.action==='resume'){this.assertStream(latest);if(this.host.store.listJobs().some(j=>j.streamEpochId===latest.epochId&&j.status==='running'))throw new RequestError('CONTINUOUS_CONFLICT','请先等待当前轮次结束。',409);}
      const retired=!this.store.streams(true).some(s=>s.epochId===latest.epochId);
      const next=this.store.save({...latest,state:input.action==='pause'?'paused':retired?'retired':'active',pauseReason:input.action==='pause'?'人员暂停':undefined,sessionId:input.action==='resume'&&!this.host.store.listJobs().some(j=>j.streamEpochId===latest.epochId&&j.status==='queued')?randomUUID():latest.sessionId,revision:latest.revision+1,updatedAt:new Date().toISOString()});void this.host.pump();return next;});
  }
  private round(job:BackgroundJob):ContinuousRound {
    if(job.kind!=='continuous_analysis')throw missing();const stream=this.store.stream(job.streamEpochId),publication=this.store.publication(job.id);
    return {jobId:job.id,streamId:stream.id,epochId:stream.epochId,streamName:stream.name,sourceIds:stream.sourceIds,batch:this.store.batch(job.batchId),status:job.status,publication:publication.status,createdAt:job.createdAt,publishedAt:publication.publishedAt,archivedTaskIds:publication.archivedTaskIds,resultRef:job.result,update:publication.update,error:job.error??(publication.reason?{code:'UNPUBLISHED',message:publication.reason}:undefined),pendingInputs:stream.pendingInputs,streamState:stream.state,pauseReason:stream.pauseReason,latestJobId:stream.latestJobId};
  }
  rounds(actor:Identity,query:{taskId?:string;epochId?:string;offset?:number;limit?:number}={}):BackgroundPage<ContinuousRound>{
    if(query.taskId)this.host.lab.access!.get(query.taskId,actor.seatId);
    const offset=query.offset??0,limit=query.limit??25;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200)throw invalid('分页参数无效。');
    const items=this.host.store.listJobs().filter(j=>j.kind==='continuous_analysis'&&(!query.epochId||j.streamEpochId===query.epochId)&&this.canRead(actor,this.store.stream(j.streamEpochId))).map(j=>this.round(j)).filter(r=>(r.publication==='published'||r.sourceIds.every(id=>this.host.store.effectivePermission(actor,id)==='manage'))&&(!query.taskId||r.update?.taskUpdates.some(t=>t.taskId===query.taskId)||r.batch.requiredTaskIds.includes(query.taskId)));
    return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};
  }
  current(actor:Identity,taskId:string){this.host.lab.access!.get(taskId,actor.seatId);return {items:this.store.streams().flatMap(stream=>{if(!this.canRead(actor,stream))return [];const jobId=this.store.baseline(stream.epochId,taskId);return jobId?[this.round(this.host.store.getJob(jobId))]:[];})};}
  private async inputEvidence(job:BackgroundJob):Promise<ContinuousInputEvidence[]>{if(job.kind!=='continuous_analysis')throw missing();return Promise.all(this.store.inputs(this.store.batch(job.batchId)).map(async input=>input.kind==='task_revision'?input:{...input,event:await (async()=>{const event=this.host.store.getEvent(input.eventId);return {id:event.id,sourceId:event.sourceId,sourceMessageId:event.sourceMessageId,title:event.title,text:await this.host.eventText(event),occurredAt:event.occurredAt,receivedAt:event.receivedAt,files:event.files};})()}));}
  private evidence(snapshot:SessionSnapshot|null,requestId:string){const queries=queryEvidence(snapshot,requestId),ids=new Set(queries.map(m=>m.id));return [...queries,...(snapshot?.messages??[]).filter(m=>m.requestId===requestId&&m.role==='tool'&&!m.isError&&!m.resultMissing&&['source_read','source_list','source.read','source.list','read','ls','find'].includes(m.toolName??'')&&!ids.has(m.id))];}
  private assertPublishedSnapshot(job:BackgroundJob,snapshot:SessionSnapshot|null):asserts snapshot is SessionSnapshot {
    const publication=this.store.publication(job.id),result=job.result;
    if(!snapshot||job.status!=='succeeded'||publication.status!=='published'||!result?.finalMessageId||snapshot.id!==result.sessionId||result.sessionId!==job.sessionId||result.requestId!==job.requestId||!snapshot.turns?.some(t=>t.requestId===job.requestId&&t.status==='succeeded'&&t.finalMessageId===result.finalMessageId)||!snapshot.messages.some(m=>m.id===result.finalMessageId&&m.requestId===job.requestId&&m.role==='assistant'&&!m.isError)||!publication.update||!this.verified(job,snapshot,publication.update))throw new RequestError('CONTINUOUS_EVIDENCE_MISSING','固定研判的原生正文或变化记录无法核验。',409);
  }
  async detail(actor:Identity,jobId:string):Promise<ContinuousRoundDetail>{const job=this.host.store.getJob(jobId);if(job.kind!=='continuous_analysis'||this.store.publication(jobId).status!=='published'||!this.canRead(actor,this.store.stream(job.streamEpochId)))throw missing();const snapshot=await this.executor.read(job);this.assertPublishedSnapshot(job,snapshot);const inputs=await this.inputEvidence(job);if(!this.canRead(actor,this.store.stream(job.streamEpochId)))throw missing();return {...this.round(job),text:finalText(snapshot,job.requestId),processingText:processingStatements(snapshot,job.requestId),queryMessages:this.evidence(snapshot,job.requestId),inputs};}
  async readCurrent(epochId:string,query:ContinuousCurrentQuery):Promise<ContinuousCurrentResult>{
    const stream=this.store.stream(epochId);this.assertStream(stream);
    const offset=query.offset??0,limit=query.limit??20,textOffset=query.textOffset??0,textLimit=query.textLimit??16000;
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(textOffset)||textOffset<0||!Number.isSafeInteger(textLimit)||textLimit<1||textLimit>32000)throw invalid('分页参数无效。');
    const items=this.host.store.listJobs().filter(j=>j.streamEpochId===epochId&&this.store.publication(j.id).status==='published').map(j=>this.round(j)).filter(r=>!query.taskId||r.update?.taskUpdates.some(t=>t.taskId===query.taskId));
    const result:ContinuousCurrentResult={items:items.slice(offset,offset+limit).map(r=>({...r,update:undefined})),total:items.length};
    const jobId=query.jobId??(query.taskId?this.store.baseline(epochId,query.taskId):undefined);
    if(query.evidenceId&&!jobId)throw invalid('分段读取须指定固定 jobId 或任务基线。');
    if(jobId){
      const round=items.find(r=>r.jobId===jobId);if(!round)throw missing();
      const job=this.host.store.getJob(jobId),snapshot=await this.executor.read(job);this.assertPublishedSnapshot(job,snapshot);
      const inputs=await this.inputEvidence(job),queryMessages=this.evidence(snapshot,job.requestId),text=finalText(snapshot,job.requestId),processingText=processingStatements(snapshot,job.requestId);
      const evidence=[{id:'result',kind:'result' as const,text},{id:'processing',kind:'processing' as const,text:processingText??''},...inputs.map(input=>({id:`input:${input.id}`,kind:'input' as const,text:JSON.stringify(input)})),...queryMessages.map(message=>({id:`tool:${message.id}`,kind:'tool' as const,text:JSON.stringify(message)}))];
      this.assertStream(this.store.stream(epochId));
      if(query.section==='evidence'||query.evidenceId){
        result.evidenceIndex=evidence.slice(offset,offset+limit).map(({id,kind,text})=>({id,kind,length:text.length}));result.evidenceTotal=evidence.length;
      }
      if(query.evidenceId){const selected=evidence.find(e=>e.id===query.evidenceId);if(!selected)throw missing();if(textOffset>selected.text.length)throw invalid('读取位置超出固定证据长度。');const end=Math.min(selected.text.length,textOffset+textLimit);result.evidence={id:selected.id,text:selected.text.slice(textOffset,end),offset:textOffset,total:selected.text.length,...(end<selected.text.length?{nextOffset:end}:{})};}
      else {
        result.detail={...round,text,processingText,queryMessages:query.section==='evidence'?queryMessages:[],inputs:query.section==='evidence'?inputs:undefined};
        if(Buffer.byteLength(JSON.stringify(result))>256*1024){delete result.detail;result.evidenceIndex=evidence.slice(offset,offset+limit).map(({id,kind,text})=>({id,kind,length:text.length}));result.evidenceTotal=evidence.length;}
      }
    }
    if(Buffer.byteLength(JSON.stringify(result))>256*1024)throw invalid('结果过大，请缩小分页范围。');return result;
  }
  record(job:BackgroundJob,input:AnalysisUpdateInput,evidence:TaskAssessmentEvidence,toolCallId:string,signal?:AbortSignal){
    signal?.throwIfAborted();if(job.kind!=='continuous_analysis')throw missing();const current=this.host.store.getJob(job.id);if(current.status!=='running'||current.cancelRequestedAt)throw missing();this.assertStream(this.store.stream(job.streamEpochId));
    const reason=(v:unknown)=>typeof v==='string'&&!!v.trim()&&v.length<=3000;
    if(!input||!Array.isArray(input.taskUpdates)||input.taskUpdates.length>100||new Set(input.taskUpdates.map(t=>t.taskId)).size!==input.taskUpdates.length||!input.unassigned||typeof input.unassigned.significant!=='boolean'||!reason(input.unassigned.reason)||!Array.isArray(input.uncertainties)||input.uncertainties.length>100||input.uncertainties.some(v=>!reason(v)))throw invalid('请完整记录任务变化、未归属变化及资料缺口。');
    const batch=this.store.batch(job.batchId);
    const taskUpdates=input.taskUpdates.map(item=>{
      if(!item||!Array.isArray(item.inputIds)||!item.inputIds.length||new Set(item.inputIds).size!==item.inputIds.length||item.inputIds.some(id=>!batch.inputIds.includes(id)&&!this.store.db.prepare('SELECT 1 FROM continuous_inputs WHERE id=? AND epoch_id=? AND consumed=1').get(id,job.streamEpochId))||!['initial','changed','unchanged','retracted','uncertain'].includes(item.change)||!reason(item.reason)||typeof item.significant!=='boolean')throw invalid('任务变化或输入引用无效。');
      const row=this.store.db.prepare('SELECT data FROM task_spaces WHERE id=?').get(item.taskId),task=row?JSON.parse(String(row.data)) as TaskSpace:undefined;
      if(task&&evidence.tasks.has(task.id)&&evidence.tasks.get(task.id)!==task.revision){this.store.savePublication(job,{...this.store.publication(job.id),status:'pending',revisionConflict:true});throw new RequestError('TASK_REVISION_CHANGED','任务说明已改变，请重新查询当前版本后记录。',409);}
      if(!task||task.visibility!=='public'||task.state!=='active'||evidence.tasks.get(task.id)!==task.revision)throw new RequestError('TASK_NOT_QUERIED','请先成功查询当前活动公共任务版本。',409);
      return {...item,taskRevision:task.revision,taskTitle:task.title,previousJobId:this.store.baseline(job.streamEpochId,item.taskId)};
    });
    const update:AnalysisUpdate={...input,taskUpdates,toolCallId,recordedAt:new Date().toISOString()};this.store.savePublication(job,{status:'pending',update});return {update,published:false as const};
  }
  private verified(job:BackgroundJob,snapshot:SessionSnapshot,update:AnalysisUpdate){if(snapshot.recoveryWarning)return false;const end=snapshot.messages.findIndex(m=>m.id===snapshot.turns?.find(t=>t.requestId===job.requestId)?.finalMessageId);if(end<0)return false;return snapshot.messages.slice(0,end).some(m=>{if(m.role!=='tool'||m.isError||m.resultMissing||m.requestId!==job.requestId||m.toolName!=='information_record_analysis_update'||m.toolCallId!==update.toolCallId)return false;try{const parsed=JSON.parse(m.text);return parsed.published===false&&isDeepStrictEqual(parsed.update,update);}catch{return false;}});}
  async execute(job:BackgroundJob,stopped:()=>boolean){
    if(job.kind!=='continuous_analysis')throw missing();const stream=this.store.stream(job.streamEpochId),batch=this.store.batch(job.batchId),inputs=this.store.inputs(batch);
    try {
      this.assertStream(stream);const directory=join(this.host.files.root,'streams',stream.epochId,stream.sessionId);await mkdir(join(directory,'files'),{recursive:true,mode:0o700});
      const files:FileRef[]=[],parts:string[]=[];
      for(const input of inputs){if(input.kind==='task_revision'){parts.push(`任务说明修订（人员维护条件，不是模型推断）：inputId=${input.id}\n${JSON.stringify(input.task)}`);continue;}const event=this.host.store.getEvent(input.eventId);parts.push(`来源资料 inputId=${input.id} eventId=${event.id} sourceId=${event.sourceId} occurredAt=${event.occurredAt??'未知'} receivedAt=${event.receivedAt}\n${event.title}\n${await this.host.eventText(event)}`);
        for(const file of event.files){const path=`${file.id}-${file.name}`;await this.host.files.copies.import({fileId:file.id,name:file.name,size:file.size,hash:file.hash,createdAt:''},join(directory,'files'),path);files.push({path,name:basename(path),size:file.size,hash:file.hash});}}
      if(stopped()||this.host.store.getJob(job.id).cancelRequestedAt)throw missing();
      const result=await this.executor.execute(job,{text:`${stream.profile.goal}\n\n本轮批次 ${batch.id}，输入截止 ${batch.inputCutoff}。必要重评任务：${JSON.stringify(batch.requiredTaskIds)}。上一发布轮次：${batch.previousJobId??'无'}。以 analysis_current_read 获取各任务上一已发布判断；旧判断是待复核观点，不能冒充事实。逐任务比较事实、推断和人员条件变化；遗漏任务不代表无风险。结论只覆盖已核验的条件；局部约束解除不等于整体可执行或全部风险解除。已识别且影响建议成立的资料缺口须直接限定主结论和建议；必要条件未核验时给出条件性建议，不得仅在末尾列出缺口。未发布历史不作为基线。业务新旧依据来源时间／版本，不能按接收顺序覆盖。完成后记录完整变化元数据，再给出最终答复。\n\n${parts.join('\n\n')}`,directory,files,profile:stream.profile,continuous:{stream,batch,inputs,requiredTaskIds:batch.requiredTaskIds},recordAnalysisUpdate:(input,evidence,id,signal)=>this.record(job,input,evidence,id,signal),readAnalysisCurrent:(query,signal)=>{signal?.throwIfAborted();return this.readCurrent(stream.epochId,query);},onEvent:event=>{if(event.type==='text.delta')this.host.store.setPhase(job.id,'generating');else if(event.type==='tool.started')this.host.store.setPhase(job.id,'tool');},publish:async()=>{throw invalid('持续研判不允许写入文件。');}});
      const snapshot=result.snapshot,terminal=snapshot.lastResult,final=snapshot.turns?.find(t=>t.requestId===job.requestId)?.finalMessageId;if(!terminal||terminal.requestId!==job.requestId||terminal.status!=='succeeded'||!final||snapshot.recoveryWarning)throw new RequestError('CONTINUOUS_FAILED','本轮未正常完成，保留输入等待恢复。',409);
      this.assertStream(this.store.stream(job.streamEpochId));
      this.host.store.transaction(()=>{
        const latest=this.host.store.getJob(job.id);if(latest.cancelRequestedAt||stopped())throw missing();
        const update=this.store.publication(job.id).update;
        const finished=this.host.store.finishJob(job.id,latest.revision,{status:'succeeded',result:{sessionId:job.sessionId!,requestId:job.requestId,finalMessageId:final,files:[]},usage:terminal.usageSummary});
        if((!update||!this.verified(job,snapshot,update))&&this.store.publication(job.id).revisionConflict){this.store.savePublication(job,{status:'superseded',reason:'任务版本已改变，输入保留待重新评估。'});return;}
        if(!update||!this.verified(job,snapshot,update)){this.store.savePublication(job,{status:'unpublished',reason:'缺少完整变化记录或对应原生证据。'});this.store.pause(stream.epochId,'缺少完整变化记录，需要核对后恢复。');return;}
        try {this.store.publish(finished,update);}catch(error){if(!(error instanceof RequestError))throw error;this.store.savePublication(job,{status:'unpublished',update,reason:error.message});this.store.pause(stream.epochId,error.message);}
      });
    }catch(error){const latest=this.host.store.getJob(job.id);if(latest.status==='running')this.host.store.finishJob(job.id,latest.revision,{status:latest.cancelRequestedAt?'cancelled':stopped()?'interrupted':'failed',error:{code:error instanceof RequestError?error.code:'CONTINUOUS_FAILED',message:error instanceof RequestError?error.message:'持续研判执行失败。'}});this.store.savePublication(job,{...this.store.publication(job.id),status:'unpublished',reason:'执行未完成，需显式恢复。'});this.store.pause(job.streamEpochId,'执行未完成，保留输入等待恢复。');}
  }
  async openFile(actor:Identity,jobId:string,fileId:string){const detail=await this.detail(actor,jobId),file=detail.inputs?.flatMap(i=>i.event?.files??[]).find(f=>f.id===fileId);if(!file)throw missing();const content=await this.host.files.copies.open({fileId:file.id,name:file.name,size:file.size,hash:file.hash,createdAt:''});try{const job=this.host.store.getJob(jobId);if(job.kind!=='continuous_analysis'||!this.canRead(actor,this.store.stream(job.streamEpochId)))throw missing();return content;}catch(error){content.stream.destroy();throw error;}}
  async analysisOptions(actor:Identity,jobId:string,taskId:string){await this.detail(actor,jobId);return this.host.taskOptions(actor,taskId);}
  async findAnalysis(actor:Identity,jobId:string,clientActionId:string){await this.detail(actor,jobId);const action=this.host.store.findAction(actor.userId,clientActionId);if(!action||action.continuousJobId!==jobId||action.seatId!==actor.seatId)return null;this.host.lab.access!.get(action.taskSpaceId!,actor.seatId);return action;}
  async analyse(actor:Identity,jobId:string,input:BackgroundAnalysisInput):Promise<BackgroundAction>{return this.preparations.run(async()=>{
    const detail=await this.detail(actor,jobId),task=this.host.lab.access!.get(input.taskSpaceId,actor.seatId,true);
    if(input.mode!=='conversation'||!input.goal?.trim()||input.goal.length>16000||input.fileIds?.length||(input.skillIds?.length??0)>1||(input.agentIds?.length??0)>1)throw invalid('请选择私有对话接续，填写目标；持续结果不含可导入输出文件。');
    const digest=createHash('sha256').update(JSON.stringify([jobId,input])).digest('hex');let action=this.host.store.findAction(actor.userId,input.clientActionId);
    if(action){if(action.continuousJobId!==jobId||action.inputHash!==digest)throw invalid('操作标识已用于其他内容。');if(action.status==='completed')return action;}
    const workspace=await this.host.lab.workspaces.ensureWorkspace(task.id,actor.seatId,task.title),selection:ComposerSelection={};
    if(input.skillIds?.[0]){const skill=await this.host.lab.resources.readSkill(workspace.id,input.skillIds[0],actor.seatId);selection.skill={id:skill.id,hash:skill.hash};}
    if(input.agentIds?.[0]){const agents=await this.host.lab.agents(workspace.id,actor.seatId),agent=agents.find(a=>a.name===input.agentIds![0]);if(!agent)throw invalid('Agent 不存在。');selection.agent={name:agent.name,hash:agent.hash};}
    const draft=`${input.goal.trim()}\n\n固定研判引用：${detail.streamName}\njobId=${jobId} requestId=${detail.resultRef!.requestId} finalMessageId=${detail.resultRef!.finalMessageId}\n输入截止：${detail.batch.inputCutoff}。这是先前模型判断，讨论中的假设不会自动成为共享事实。${input.includeResult?`\n\n${detail.text}`:''}`;
    if(draft.length>16000)throw invalid('研判较长，请取消直接带入结果。');
    await this.detail(actor,jobId);this.host.lab.access!.get(task.id,actor.seatId,true);
    action??=this.host.store.beginAction({userId:actor.userId,seatId:actor.seatId,clientActionId:input.clientActionId,kind:'analysis',inputHash:digest,continuousJobId:jobId,taskSpaceId:task.id,workspaceId:workspace.id,sessionId:randomUUID(),analysis:input,draft,selection,fileRefs:[]});
    await this.host.lab.createSession(workspace.id,actor.seatId,undefined,action.sessionId);
    await this.detail(actor,jobId);return this.host.store.updateAction(action.id,action.revision,{status:'completed'});
  });}
  async deliver(id:string){const delivery=this.host.store.getDelivery(id),job=this.host.store.getJob(delivery.jobId);if(job.kind!=='continuous_analysis')throw missing();try{const stream=this.store.stream(job.streamEpochId);this.assertStream(stream);if(this.store.publication(job.id).status!=='published'||!this.canRead(this.host.lab.access!.identityForSeat(delivery.recipientSeatId)!,stream))throw missing();const snapshot=await this.executor.read(job),update=this.store.publication(job.id).update;if(!snapshot||!update||!this.verified(job,snapshot,update))throw missing();this.assertPublishedSnapshot(job,snapshot);this.assertStream(this.store.stream(job.streamEpochId));this.host.store.updateDelivery(id,delivery.revision,'delivered');}catch{this.host.store.updateDelivery(id,delivery.revision,'failed',{code:'CONTINUOUS_DELIVERY_FAILED',message:'通知暂未完成，请核对权限后重试。'});}}
}
