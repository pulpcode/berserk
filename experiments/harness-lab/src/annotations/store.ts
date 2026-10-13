import type { DatabaseSync } from 'node:sqlite';
import { stateError } from '../resources/files.js';

export const annotationTables = ['annotation_session_bindings','annotation_sets','annotation_revisions','annotation_publications','task_annotation_selections','annotation_actions'];
export function checkAnnotationTables(db: DatabaseSync) {
  const actual=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
  if(annotationTables.some(name=>!actual.has(name))) throw stateError();
  if(db.prepare('PRAGMA foreign_key_check').all().length) throw stateError();
}
/** Host-only metadata. Native conversation history is never stored here. */
export class AnnotationStore {
  constructor(readonly db: DatabaseSync) {
    const version=Number(db.prepare('PRAGMA user_version').get()?.user_version);
    const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'annotation_%' OR name='task_annotation_selections')").all();
    if(existing.length || [9,10].includes(version)) {checkAnnotationTables(db); if(![1,9,10].includes(version)) throw stateError(); return;}
    if(![1,7,8].includes(version)) throw stateError();
    this.transaction(()=>{
      db.exec(`CREATE TABLE annotation_session_bindings(session_id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE annotation_sets(id TEXT PRIMARY KEY, owner_session_id TEXT UNIQUE NOT NULL, task_id TEXT NOT NULL, owner_seat_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE annotation_revisions(set_id TEXT NOT NULL REFERENCES annotation_sets(id), revision INTEGER NOT NULL CHECK(revision>0), data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(set_id,revision));
        CREATE TABLE annotation_publications(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, set_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), FOREIGN KEY(set_id,revision) REFERENCES annotation_revisions(set_id,revision));
        CREATE TABLE task_annotation_selections(task_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0), publication_id TEXT NOT NULL REFERENCES annotation_publications(id), data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(task_id,sequence));
        CREATE TABLE annotation_actions(user_id TEXT NOT NULL, action_id TEXT NOT NULL, task_id TEXT NOT NULL, session_id TEXT, digest TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(user_id,action_id));
        CREATE INDEX annotation_sets_task_seat ON annotation_sets(task_id,owner_seat_id);
        CREATE INDEX annotation_publications_task ON annotation_publications(task_id);`);
      if(version!==1) db.exec(`PRAGMA user_version=${version===8 ? 10 : 9}`);
    });
  }
  transaction<T>(operation: ()=>T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=operation(); this.db.exec('COMMIT'); return result;}
    catch(error) {this.db.exec('ROLLBACK'); throw error;}
  }
}
