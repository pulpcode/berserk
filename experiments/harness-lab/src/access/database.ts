import { chmod, lstat, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RequestError } from '../contracts/errors.js';
import { atomicWrite, checkDirectory, readControlled, stateError } from '../resources/files.js';

export async function openDatabase(dataDir: string): Promise<DatabaseSync> {
    const directory = join(dataDir, 'collaboration'); await mkdir(directory, {recursive: true, mode: 0o700}); await checkDirectory(directory);
    const markerPath = join(directory, '.initialized'); const marker = await readControlled(markerPath, 1024, true);
    const dbPath = join(directory, 'collaboration.sqlite');
    const stat = await lstat(dbPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if ((!stat && (await readdir(directory)).length !== 0) || (marker === null) !== (stat === null) || (marker !== null && marker !== 'collaboration-v1\n') || (stat && (!stat.isFile() || stat.nlink !== 1))) throw stateError();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
      if (!stat) {
        db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE works(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
          CREATE TABLE actions(id TEXT PRIMARY KEY, dedup_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
          CREATE TABLE files(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
          CREATE TABLE submissions(id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), data TEXT NOT NULL CHECK(json_valid(data)));
          CREATE TABLE session_links(session_id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id));
          PRAGMA user_version=1; COMMIT;`);
        await chmod(dbPath, 0o600); await atomicWrite(markerPath, 'collaboration-v1\n');
      }
      if (![1,2,3].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version)) || db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw stateError();
      return db;
    } catch (error) { db.close(); throw error instanceof RequestError ? error : stateError(); }
}

/** Test identity routes must never open a formally provisioned account data root. */
export async function assertDataMode(dataDir: string, authenticated: boolean) {
  if(authenticated)return;
  const path=join(dataDir,'collaboration','collaboration.sqlite');
  const stat=await lstat(path).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(!stat)return;
  if(!stat.isFile() || stat.isSymbolicLink())throw stateError();
  const db=new DatabaseSync(path,{readOnly:true});
  try {if(Number(db.prepare('PRAGMA user_version').get()?.user_version)>=2)throw new RequestError('AUTH_MODE_CONFLICT','正式账号数据不能以测试身份模式打开，请使用登录入口或独立测试目录。',409);}
  finally{db.close();}
}
