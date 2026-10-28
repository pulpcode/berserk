import type { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import type { TaskSpace } from '../contracts/access.js';
import type { AnalysisUpdate, ContinuousBatch, ContinuousInput, ContinuousStream } from '../contracts/continuous.js';
import type { BackgroundJob } from '../contracts/background.js';
import { RequestError } from '../contracts/errors.js';
import type { BackgroundStore } from './store.js';

const conflict = (message = '持续研判状态已变化，请重新读取。') => new RequestError('CONTINUOUS_CONFLICT',message,409);
const now = () => new Date().toISOString();
export interface Publication {status:'pending'|'published'|'unpublished'|'superseded'; update?:AnalysisUpdate; publishedAt?:string; reason?:string; revisionConflict?:boolean; archivedTaskIds?:string[]}
export class ContinuousStore {
  constructor(readonly background:BackgroundStore) { this.validate(); }
  get db() { return this.background.db; }
  private decode<T>(value:unknown):T { return JSON.parse(String(value)) as T; }
  streams(current = false):ContinuousStream[] {
    return this.db.prepare(`SELECT * FROM continuous_streams${current ? ' WHERE current=1' : ''} ORDER BY rowid DESC`).all().map(row => {
      const stream = this.decode<ContinuousStream>(row.data);
      if (stream.epochId !== row.epoch_id || stream.id !== row.stream_id) throw conflict('配置索引损坏。');
      return {...stream,isCurrent:row.current===1,pendingInputs:this.pending(stream.epochId).length};
    });
  }
  stream(epochId:string) { const stream = this.streams().find(item => item.epochId === epochId); if (!stream) throw conflict('配置不存在。'); return stream; }
  current(id:string) { const stream = this.streams(true).find(item => item.id === id); if (!stream) throw conflict('配置不存在。'); return stream; }
  source(sourceId:string) { return this.streams(true).find(stream => stream.enabled && stream.sourceIds.includes(sourceId)); }
  save(stream:ContinuousStream) { this.db.prepare('UPDATE continuous_streams SET data=? WHERE epoch_id=?').run(JSON.stringify(stream),stream.epochId); return stream; }
  create(stream:ContinuousStream, previous?:ContinuousStream) {
    return this.background.transaction(() => {
      if (previous) {
        const current = this.current(previous.id); if (current.epochId !== previous.epochId || current.revision !== previous.revision) throw conflict();
        this.save({...current,state:current.state==='paused'?'paused':'retired',revision:current.revision+1,updatedAt:now()});
        this.db.prepare('UPDATE continuous_streams SET current=0 WHERE epoch_id=?').run(current.epochId);
      }
      for (const source of stream.sourceIds) {
        if (stream.enabled && this.source(source)) throw conflict('来源已启用其他持续配置。');
        const rule = this.background.enabledRule(source);
        if (stream.enabled && rule) this.background.updateRule(stream.createdByUserId,rule.id,rule.revision,{...rule,enabled:false});
      }
      this.db.prepare('INSERT INTO continuous_streams VALUES(?,?,1,?)').run(stream.epochId,stream.id,JSON.stringify(stream)); return stream;
    });
  }
  receipt<T>(userId:string,actionId:string,input:unknown,operation:()=>T):T {
    if (!/^[0-9a-f-]{36}$/i.test(actionId)) throw new RequestError('INVALID_INPUT','操作标识无效。');
    return this.background.transaction(() => {
      const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const prior=this.db.prepare('SELECT * FROM continuous_actions WHERE user_id=? AND action_id=?').get(userId,actionId);
      if(prior) {if(prior.digest!==digest)throw conflict('操作标识已用于其他请求。');return this.decode<T>(prior.data);}
      const result=operation();this.db.prepare('INSERT INTO continuous_actions VALUES(?,?,?,?)').run(userId,actionId,digest,JSON.stringify(result));return result;
    });
  }
  add(input:ContinuousInput) {
    this.db.prepare('INSERT INTO continuous_inputs VALUES(?,?,?,?,0,?,?)').run(input.id,input.epochId,input.kind==='event'?input.eventId:null,input.kind==='task_revision'?input.task.id:null,input.receivedAt,JSON.stringify(input));
  }
  taskChanged(task:TaskSpace) { enqueueContinuousTaskChange(this.db,task); }
  pending(epochId:string):ContinuousInput[] { return this.db.prepare('SELECT data FROM continuous_inputs WHERE epoch_id=? AND consumed=0 ORDER BY rowid').all(epochId).map(row=>this.decode<ContinuousInput>(row.data)); }
  inputs(batch:ContinuousBatch):ContinuousInput[] { return batch.inputIds.map(id=> {const row=this.db.prepare('SELECT data FROM continuous_inputs WHERE id=? AND epoch_id=?').get(id,batch.epochId);if(!row)throw conflict('批次输入缺失。');return this.decode<ContinuousInput>(row.data);}); }
  batch(id:string):ContinuousBatch { const row=this.db.prepare('SELECT data FROM continuous_batches WHERE id=?').get(id);if(!row)throw conflict('批次不存在。');return this.decode<ContinuousBatch>(row.data); }
  publication(jobId:string):Publication {const row=this.db.prepare('SELECT data FROM continuous_publications WHERE job_id=?').get(jobId);return row?this.decode<Publication>(row.data):{status:'pending'};}
  savePublication(job:BackgroundJob,publication:Publication) {
    if(job.kind!=='continuous_analysis')throw conflict();
    this.db.prepare('INSERT INTO continuous_publications VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,data=excluded.data').run(job.id,job.streamEpochId,publication.status,JSON.stringify(publication));
  }
  baseline(epochId:string,taskId:string):string|undefined {const row=this.db.prepare('SELECT job_id FROM continuous_current WHERE epoch_id=? AND task_id=?').get(epochId,taskId);return row?String(row.job_id):undefined;}
  enqueueDue(time=Date.now()) {
    for(const stream of this.streams()) {
      if(stream.state==='paused')continue;
      if(this.background.listJobs().some(job=>job.streamEpochId===stream.epochId && ['queued','running'].includes(job.status)))continue;
      const pending=this.pending(stream.epochId);if(!pending.length)continue;
      if(time-Date.parse(pending.at(-1)!.receivedAt)<(stream.quietMs??5000) && time-Date.parse(pending[0].receivedAt)<(stream.maxWaitMs??30000) && pending.length<32)continue;
      this.background.transaction(()=>{
        let bytes=0;const selected:ContinuousInput[]=[];
        for(const input of pending) {if(selected.length && (selected.length>=32 || bytes+input.bytes>128*1024))break;selected.push(input);bytes+=input.bytes;}
        const jobId=randomUUID(),batch:ContinuousBatch={id:randomUUID(),epochId:stream.epochId,jobId,inputIds:selected.map(i=>i.id),requiredTaskIds:[...new Set(selected.flatMap(i=>i.kind==='task_revision' && i.task.state==='active'?[i.task.id]:[]))],createdAt:now(),inputCutoff:selected.at(-1)!.receivedAt,previousJobId:stream.latestJobId};
        this.db.prepare('INSERT INTO continuous_batches VALUES(?,?,?,?)').run(batch.id,stream.epochId,jobId,JSON.stringify(batch));
        this.background.insertJob({id:jobId,kind:'continuous_analysis',batchId:batch.id,streamEpochId:stream.epochId,status:'queued',revision:1,createdAt:batch.createdAt,sessionId:stream.sessionId,requestId:randomUUID(),contextScope:stream.profile.contextScope});
      });
    }
  }
  pause(epochId:string,reason:string) {const stream=this.stream(epochId);this.save({...stream,state:'paused',pauseReason:reason,revision:stream.revision+1,updatedAt:now()});}
  recover() {for(const job of this.background.listJobs())if(job.kind==='continuous_analysis' && ['failed','cancelled','interrupted'].includes(job.status) && this.publication(job.id).status==='pending'){this.savePublication(job,{status:'unpublished',reason:job.error?.message??'执行未完成'});this.pause(job.streamEpochId,job.error?.message??'执行未完成，需要恢复分析。');}}
  publicationIssue(job:BackgroundJob,update:AnalysisUpdate):'stale'|'missing'|undefined {
    if(job.kind!=='continuous_analysis')throw conflict();
    if(update.taskCoverage){
      const current=this.db.prepare("SELECT data FROM task_spaces WHERE json_extract(data,'$.visibility')='public' AND json_extract(data,'$.state')='active'").all().map(row=>this.decode<TaskSpace>(row.data));
      if(current.length!==update.taskCoverage.length||current.some(task=>!update.taskCoverage!.some(item=>item.taskId===task.id&&item.taskRevision===task.revision)))return 'stale';
    }
    for(const item of update.taskUpdates) {
      const row=this.db.prepare('SELECT data FROM task_spaces WHERE id=?').get(item.taskId);
      const task=row?this.decode<TaskSpace>(row.data):undefined;
      if(!task || task.revision!==item.taskRevision || task.state!=='active' || this.baseline(job.streamEpochId,item.taskId)!==item.previousJobId)return 'stale';
    }
    if(this.requiredTaskInputIssues(job,update).length)return 'missing';
    return undefined;
  }
  /** The same required-input rule drives both publication and actionable record errors. */
  requiredTaskInputIssues(job:BackgroundJob,update:AnalysisUpdate) {
    if(job.kind!=='continuous_analysis')throw conflict();
    const batch=this.batch(job.batchId),inputs=this.inputs(batch);
    return batch.requiredTaskIds.flatMap(taskId=>{
      const row=this.db.prepare('SELECT data FROM task_spaces WHERE id=?').get(taskId);
      const task=row?this.decode<TaskSpace>(row.data):undefined;
      const currentTaskRevisionInputIds=inputs.filter(input=>input.kind==='task_revision'&&input.task.id===taskId).map(input=>input.id);
      const index=update.taskUpdates.findIndex(item=>item.taskId===taskId);
      if(task?.state!=='active'||index>=0&&update.taskUpdates[index].inputIds.some(id=>currentTaskRevisionInputIds.includes(id)))return [];
      return [{taskId,path:index>=0?`taskUpdates[${index}].inputIds`:'taskUpdates',currentTaskRevisionInputIds}];
    });
  }
  publish(job:BackgroundJob,update:AnalysisUpdate) {
    if(job.kind!=='continuous_analysis')throw conflict();
    const batch=this.batch(job.batchId),stream=this.stream(job.streamEpochId),issue=this.publicationIssue(job,update);
    if(issue==='stale'){this.savePublication(job,{status:'superseded',update,reason:'任务版本已更新，输入保留待重新评估。'});return false;}
    if(issue==='missing')throw conflict('本批要求重评的任务未完整记录。');
    const archivedTaskIds=batch.requiredTaskIds.filter(taskId=>{
      const row=this.db.prepare('SELECT data FROM task_spaces WHERE id=?').get(taskId);
      return row && this.decode<TaskSpace>(row.data).state==='archived';
    });
    const publishedAt=now();this.savePublication(job,{status:'published',update,publishedAt,...(archivedTaskIds.length?{archivedTaskIds}:{})});
    for(const item of update.taskUpdates)this.db.prepare('INSERT INTO continuous_current VALUES(?,?,?) ON CONFLICT(epoch_id,task_id) DO UPDATE SET job_id=excluded.job_id').run(stream.epochId,item.taskId,job.id);
    for(const id of batch.inputIds)this.db.prepare('UPDATE continuous_inputs SET consumed=1 WHERE id=?').run(id);
    this.save({...stream,latestJobId:job.id,updatedAt:publishedAt});
    if(update.unassigned.significant || update.taskUpdates.some(item=>item.significant))for(const seatId of stream.recipientSeatIds)this.background.insertDelivery(job,seatId,publishedAt);
    return true;
  }
  private validate() {
    for(const stream of this.streams())if(!stream.sourceIds.length || !stream.recipientSeatIds.length || !stream.sessionId)throw conflict('持续配置损坏。');
    for(const job of this.background.listJobs())if(job.kind==='continuous_analysis') {
      const batch=this.batch(job.batchId);if(batch.jobId!==job.id || batch.epochId!==job.streamEpochId)throw conflict('批次关系损坏。');this.stream(job.streamEpochId);this.inputs(batch);
    }
  }
}

/** Called inside the task mutation transaction; no baseline is required for first assessment. */
export function enqueueContinuousTaskChange(db:DatabaseSync,task:TaskSpace) {
  if(task.visibility!=='public'||task.state!=='active'||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='continuous_streams'").get())return;
  const refs=task.context?.businessRefs??[];
  for(const row of db.prepare('SELECT data FROM continuous_streams WHERE current=1').all()) {
    const stream=JSON.parse(String(row.data)) as ContinuousStream;
    if(!stream.enabled||!stream.profile.contextScope)continue;
    const baseline=db.prepare('SELECT 1 FROM continuous_current WHERE epoch_id=? AND task_id=?').get(stream.epochId,task.id);
    if(!baseline&&refs.length&&!refs.some(ref=>stream.profile.contextScope!.systemIds.includes(ref.systemId)))continue;
    if(db.prepare("SELECT 1 FROM continuous_inputs WHERE epoch_id=? AND task_id=? AND json_extract(data,'$.task.revision')=?").get(stream.epochId,task.id,task.revision))continue;
    const input:ContinuousInput={id:randomUUID(),epochId:stream.epochId,kind:'task_revision',task,receivedAt:task.updatedAt,bytes:Buffer.byteLength(JSON.stringify(task))};
    db.prepare('INSERT INTO continuous_inputs VALUES(?,?,NULL,?,0,?,?)').run(input.id,stream.epochId,task.id,input.receivedAt,JSON.stringify(input));
  }
}
