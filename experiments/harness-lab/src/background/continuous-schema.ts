import type { DatabaseSync } from 'node:sqlite';
import type { ContinuousStream, ContinuousInput, ContinuousBatch, AnalysisUpdate } from '../contracts/continuous.js';
import type { BackgroundJob } from '../contracts/background.js';
import { UUID } from '../workspaces/store.js';
import { stateError, parseJsonStrict } from '../resources/files.js';

export const continuousTables = ['continuous_streams','continuous_inputs','continuous_batches','continuous_current','continuous_publications','continuous_actions'];
/** Existing queue and delivery rows retain their IDs and all foreign-key relations. */
export function migrateContinuous(db: DatabaseSync) {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version >= 11) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
    if (continuousTables.some(table => !tables.has(table)) || db.prepare('PRAGMA foreign_key_check').all().length) throw stateError();
    validateContinuousMetadata(db);return;
  }
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE continuous_streams(epoch_id TEXT PRIMARY KEY, stream_id TEXT NOT NULL, current INTEGER NOT NULL CHECK(current IN (0,1)), data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE UNIQUE INDEX continuous_stream_current ON continuous_streams(stream_id) WHERE current=1;
      CREATE TABLE continuous_inputs(id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES continuous_streams(epoch_id), event_id TEXT REFERENCES background_events(id), task_id TEXT REFERENCES task_spaces(id), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)), received_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), CHECK((event_id IS NULL)!=(task_id IS NULL)), UNIQUE(epoch_id,event_id));
      CREATE INDEX continuous_inputs_pending ON continuous_inputs(epoch_id,consumed,received_at);
      CREATE TABLE continuous_batches(id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL REFERENCES continuous_streams(epoch_id), job_id TEXT NOT NULL UNIQUE REFERENCES background_jobs(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE continuous_current(epoch_id TEXT NOT NULL REFERENCES continuous_streams(epoch_id), task_id TEXT NOT NULL REFERENCES task_spaces(id), job_id TEXT NOT NULL REFERENCES background_jobs(id), PRIMARY KEY(epoch_id,task_id));
      CREATE TABLE continuous_publications(job_id TEXT PRIMARY KEY REFERENCES background_jobs(id), epoch_id TEXT NOT NULL REFERENCES continuous_streams(epoch_id), status TEXT NOT NULL CHECK(status IN ('pending','published','unpublished','superseded')), data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE continuous_actions(user_id TEXT NOT NULL, action_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(user_id,action_id));
      CREATE TABLE background_jobs_next(id TEXT PRIMARY KEY, event_id TEXT REFERENCES background_events(id), source_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('preprocess','seat_analysis','continuous_analysis')), status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')), created_at TEXT NOT NULL, session_id TEXT, seat_id TEXT, task_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)), CHECK((kind='continuous_analysis' AND event_id IS NULL AND source_id IS NULL AND json_type(data,'$.batchId')='text' AND json_type(data,'$.streamEpochId')='text') OR (kind!='continuous_analysis' AND event_id IS NOT NULL AND source_id IS NOT NULL)));
      INSERT INTO background_jobs_next SELECT * FROM background_jobs;
      DROP TABLE background_jobs;
      ALTER TABLE background_jobs_next RENAME TO background_jobs;
      CREATE INDEX background_jobs_queue ON background_jobs(status,created_at);
      CREATE UNIQUE INDEX background_jobs_reserved_session ON background_jobs(session_id) WHERE session_id IS NOT NULL AND status IN ('queued','running');
      CREATE UNIQUE INDEX background_jobs_stream_active ON background_jobs(json_extract(data,'$.streamEpochId')) WHERE kind='continuous_analysis' AND status IN ('queued','running');
      CREATE TABLE background_deliveries_next(id TEXT PRIMARY KEY, event_id TEXT REFERENCES background_events(id), job_id TEXT NOT NULL REFERENCES background_jobs(id), source_id TEXT, seat_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','delivered','failed')), created_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(job_id,seat_id), CHECK((event_id IS NOT NULL AND source_id IS NOT NULL) OR (event_id IS NULL AND source_id IS NULL AND json_type(data,'$.streamEpochId')='text')));
      INSERT INTO background_deliveries_next SELECT * FROM background_deliveries;
      DROP TABLE background_deliveries;
      ALTER TABLE background_deliveries_next RENAME TO background_deliveries;
      CREATE INDEX background_deliveries_inbox ON background_deliveries(seat_id,status,created_at);
      PRAGMA user_version=${version === 10 ? 12 : 11};
    `);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw stateError();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}

/** The SQL query indexes and JSON snapshots must describe identical immutable identities. */
function validateContinuousMetadata(db:DatabaseSync){
  try{
    const indexes=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>String(r.name)));
    for(const name of ['continuous_stream_current','continuous_inputs_pending','background_jobs_stream_active'])if(!indexes.has(name))throw stateError();
    const decode=<T>(value:unknown)=>parseJsonStrict(String(value)) as T;
    const streams=new Map<string,ContinuousStream>();
    const currentSources=new Set<string>();
    for(const row of db.prepare('SELECT * FROM continuous_streams').all()){
      const stream=decode<ContinuousStream>(row.data);
      if(stream.epochId!==row.epoch_id||stream.id!==row.stream_id||!UUID.test(stream.id)||!UUID.test(stream.epochId)||!UUID.test(stream.sessionId)||!Number.isSafeInteger(stream.revision)||stream.revision<1||!['active','paused','retired'].includes(stream.state)||typeof stream.enabled!=='boolean'||!stream.sourceIds.length||new Set(stream.sourceIds).size!==stream.sourceIds.length||!stream.recipientSeatIds.length||new Set(stream.recipientSeatIds).size!==stream.recipientSeatIds.length||stream.profile.id!==stream.profileId)throw stateError();
      if(row.current===1&&stream.state==='retired')throw stateError();
      if(row.current===1&&stream.enabled)for(const sourceId of stream.sourceIds){if(currentSources.has(sourceId)||db.prepare('SELECT 1 FROM information_rules WHERE source_id=? AND enabled=1').get(sourceId))throw stateError();currentSources.add(sourceId);}
      streams.set(stream.epochId,stream);
    }
    const inputs=new Map<string,ContinuousInput>(),consumed=new Map<string,boolean>();
    for(const row of db.prepare('SELECT * FROM continuous_inputs').all()){
      const input=decode<ContinuousInput>(row.data),stream=streams.get(input.epochId);
      if(!stream||input.id!==row.id||input.epochId!==row.epoch_id||input.receivedAt!==row.received_at||!Number.isSafeInteger(input.bytes)||input.bytes<0||!UUID.test(input.id))throw stateError();
      if(input.kind==='event'){
        const event=db.prepare('SELECT source_id,data FROM background_events WHERE id=?').get(input.eventId);
        if(input.eventId!==row.event_id||row.task_id!==null||!event||!stream.sourceIds.includes(String(event.source_id))||decode<{continuousEpochId?:string}>(event.data).continuousEpochId!==input.epochId)throw stateError();
      }else if(input.kind!=='task_revision'||input.task.id!==row.task_id||row.event_id!==null||input.task.visibility!=='public'||!Number.isSafeInteger(input.task.revision))throw stateError();
      inputs.set(input.id,input);consumed.set(input.id,row.consumed===1);
    }
    for(const row of db.prepare("SELECT id,data FROM background_events WHERE json_extract(data,'$.continuousEpochId') IS NOT NULL").all()){const epochId=decode<{continuousEpochId:string}>(row.data).continuousEpochId;if(!streams.has(epochId)||![...inputs.values()].some(i=>i.kind==='event'&&i.eventId===row.id&&i.epochId===epochId))throw stateError();}
    const jobs=new Map(db.prepare("SELECT id,data FROM background_jobs WHERE kind='continuous_analysis'").all().map(row=>[String(row.id),decode<BackgroundJob>(row.data)]));
    const batches=new Map<string,ContinuousBatch>();
    for(const row of db.prepare('SELECT * FROM continuous_batches').all()){
      const batch=decode<ContinuousBatch>(row.data),job=jobs.get(batch.jobId);
      if(!job||job.batchId!==batch.id||job.streamEpochId!==batch.epochId||batch.id!==row.id||batch.epochId!==row.epoch_id||batch.jobId!==row.job_id||!batch.inputIds.length||new Set(batch.inputIds).size!==batch.inputIds.length||batch.inputIds.some(id=>inputs.get(id)?.epochId!==batch.epochId))throw stateError();
      if(batch.previousJobId&&!jobs.has(batch.previousJobId))throw stateError();
      batches.set(batch.id,batch);
    }
    for(const job of jobs.values())if(job.kind!=='continuous_analysis'||!batches.has(job.batchId)||!streams.has(job.streamEpochId)||job.eventId!==undefined||job.sourceId!==undefined)throw stateError();
    const publications=new Map<string,{status:string;update?:AnalysisUpdate}>();
    for(const row of db.prepare('SELECT * FROM continuous_publications').all()){
      const publication=decode<{status:string;update?:AnalysisUpdate}>(row.data),job=jobs.get(String(row.job_id));
      if(!job||job.streamEpochId!==row.epoch_id||publication.status!==row.status)throw stateError();
      if(publication.status==='published'&&(job.status!=='succeeded'||!job.result?.finalMessageId||!publication.update))throw stateError();
      if(publication.update){const u=publication.update;if(!Array.isArray(u.taskUpdates)||new Set(u.taskUpdates.map(t=>t.taskId)).size!==u.taskUpdates.length||typeof u.unassigned?.significant!=='boolean'||!u.unassigned.reason||!u.toolCallId||!Array.isArray(u.uncertainties))throw stateError();for(const item of u.taskUpdates)if(!UUID.test(item.taskId)||!Number.isSafeInteger(item.taskRevision)||item.taskRevision<1||!item.reason||typeof item.significant!=='boolean'||item.inputIds.some(id=>inputs.get(id)?.epochId!==job.streamEpochId))throw stateError();}
      publications.set(job.id,publication);
    }
    const publishedInputs=new Set<string>();
    for(const [jobId,pub] of publications)if(pub.status==='published'){const job=jobs.get(jobId)!;for(const id of batches.get(job.batchId!)!.inputIds){if(publishedInputs.has(id)||!consumed.get(id))throw stateError();publishedInputs.add(id);}}
    for(const [id,done] of consumed)if(done&&!publishedInputs.has(id))throw stateError();
    for(const row of db.prepare('SELECT * FROM continuous_current').all()){const job=jobs.get(String(row.job_id)),publication=publications.get(String(row.job_id));if(job?.streamEpochId!==row.epoch_id||publication?.status!=='published'||!publication.update?.taskUpdates.some(t=>t.taskId===row.task_id))throw stateError();}
    for(const stream of streams.values())if(stream.latestJobId&&(jobs.get(stream.latestJobId)?.streamEpochId!==stream.epochId||publications.get(stream.latestJobId)?.status!=='published'))throw stateError();
    for(const row of db.prepare('SELECT job_id,seat_id,data FROM background_deliveries WHERE event_id IS NULL').all()){const job=jobs.get(String(row.job_id)),publication=publications.get(String(row.job_id)),delivery=decode<{streamEpochId?:string}>(row.data);if(!job||delivery.streamEpochId!==job.streamEpochId||!streams.get(job.streamEpochId!)?.recipientSeatIds.includes(String(row.seat_id))||publication?.status!=='published'||(!publication.update?.unassigned.significant&&!publication.update?.taskUpdates.some(t=>t.significant)))throw stateError();}
  }catch{throw stateError();}
}
