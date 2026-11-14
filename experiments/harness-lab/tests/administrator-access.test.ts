import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { migrateAdministratorAccess } from '../src/access/administrator-migration.js';
import { isBusinessIdentity } from '../src/contracts/access.js';
import { BackgroundStore } from '../src/background/store.js';
import { AnnotationStore } from '../src/annotations/store.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const business={username:'overall',displayName:'总体业务人员',seatId:'overall',seatName:'总体席',password:'test-password-123',createPublicTask:true,manageModelSettings:true};
async function setup() {
  const root=await mkdtemp(join(tmpdir(),'axon-administrators-'));roots.push(root);
  const dataDir=join(root,'data'),backupDir=join(root,'backup'),db=await openDatabase(dataDir),access=new AccessStore(db);
  await access.saveAccount(business);return{root,dataDir,backupDir,db,access};
}
async function tree(path:string,prefix=''):Promise<Record<string,string>> {
  const result:Record<string,string>={};
  for(const entry of(await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=prefix?`${prefix}/${entry.name}`:entry.name;if(entry.isDirectory())Object.assign(result,await tree(join(path,entry.name),name));else result[name]=await readFile(join(path,entry.name),'base64');}
  return result;
}

describe('independent system administrator accounts',()=>{
  it('preserves existing business accounts, grants, foreign keys and sessions during explicit schema migration',async()=>{
    const {db,access}=await setup();
    try {
      const user=access.identityForSeat('overall')!;
      db.exec(`CREATE TABLE capability_account_roles(user_id TEXT NOT NULL REFERENCES accounts(id),role TEXT NOT NULL CHECK(role='administrator'),granted_at TEXT NOT NULL,PRIMARY KEY(user_id,role));
        CREATE TABLE test_account_history(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id));`);
      db.prepare("INSERT INTO capability_account_roles VALUES(?,'administrator','2026-11-14T00:00:00Z')").run(user.userId);
      db.prepare("INSERT INTO test_account_history VALUES('retained',?)").run(user.userId);
      db.prepare("INSERT INTO auth_sessions VALUES('retained',?,9999999999999,'{}')").run(user.userId);
      const before={accounts:db.prepare('SELECT * FROM accounts').all(),seats:db.prepare('SELECT * FROM seats').all(),sessions:db.prepare('SELECT * FROM auth_sessions').all()};
      migrateAdministratorAccounts(db);migrateAdministratorAccounts(db);
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(19);
      expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect({accounts:db.prepare('SELECT * FROM accounts').all(),seats:db.prepare('SELECT * FROM seats').all(),sessions:db.prepare('SELECT * FROM auth_sessions').all()}).toEqual(before);
      expect(db.prepare('PRAGMA foreign_key_list(test_account_history)').get()?.table).toBe('accounts');
      expect(db.prepare('SELECT * FROM test_account_history').get()).toMatchObject({user_id:user.userId});
      expect(new SystemRoles(db).list()).toEqual([{userId:user.userId,username:'overall',displayName:'总体业务人员',enabled:true,grantedAt:'2026-11-14T00:00:00Z'}]);
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='capability_account_roles'").get()).toBeUndefined();
      expect(await access.authenticate('overall',business.password)).toEqual(user);
      expect(()=>db.prepare("INSERT INTO test_account_history VALUES('missing','unknown')").run()).toThrow();
    } finally {db.close();}
  });
  it('authenticates a seatless administrator without creating a seat or granting business capabilities',async()=>{
    const {db,access}=await setup();
    try {
      await expect(access.saveAdministratorAccount({username:'admin',displayName:'系统管理员',password:business.password})).rejects.toMatchObject({code:'ACCESS_MIGRATION_REQUIRED'});
      migrateAdministratorAccounts(db);
      const id=await access.saveAdministratorAccount({username:'admin',displayName:'系统管理员',password:business.password});
      await access.saveAdministratorAccount({username:'another-admin',displayName:'第二管理员',password:business.password});
      expect(db.prepare('SELECT seat_id FROM accounts WHERE id=?').get(id)?.seat_id).toBeNull();
      expect(access.allSeatIds()).toEqual(['overall']);expect(access.businessSeats().map(seat=>seat.id)).toEqual(['overall']);
      expect(access.identity(id)).toBeUndefined();
      const identity=await access.authenticate('admin',business.password);
      expect(identity).toEqual({userId:id,username:'admin',displayName:'系统管理员',role:'administrator',personalScopeId:`account-${id}`,canCollaborate:false,createPublicTask:false,manageModelSettings:false});
      expect(identity&&isBusinessIdentity(identity)).toBe(false);
      expect(await access.authenticate('admin','wrong-password')).toBeUndefined();
      expect(new SystemRoles(db).has(access.identityForSeat('overall')!.userId)).toBe(false);
      await expect(access.saveAdministratorAccount({username:'overall',displayName:'管理员',password:business.password})).rejects.toThrow('独立');
      await expect(access.saveAccount({...business,username:'admin',seatId:'new-seat'})).rejects.toThrow('换岗');
      expect(access.allSeatIds()).toEqual(['overall']);
      access.disable('admin');expect(access.accountIdentity(id)).toBeUndefined();expect(await access.authenticate('admin',business.password)).toBeUndefined();
    } finally {db.close();}
  },20000);
  it('revokes a seatless account immediately and deletes its authenticated sessions',async()=>{
    const {db,access}=await setup();
    try {
      migrateAdministratorAccounts(db);
      const id=await access.saveAdministratorAccount({username:'admin',displayName:'管理员',password:business.password});
      db.prepare("INSERT INTO auth_sessions VALUES('admin-session',?,9999999999999,'{}')").run(id);
      new SystemRoles(db).revoke('admin');
      expect(access.accountIdentity(id)).toBeUndefined();expect(await access.authenticate('admin',business.password)).toBeUndefined();
      expect(db.prepare('SELECT 1 FROM auth_sessions WHERE user_id=?').get(id)).toBeUndefined();
      expect(access.identityForSeat('overall')).toMatchObject({createPublicTask:true,manageModelSettings:true});
    } finally {db.close();}
  });
  it('retains the independent-account schema generation when optional modules are enabled and reopened',async()=>{
    const {db,access}=await setup();
    try {
      migrateAdministratorAccounts(db);await access.saveAdministratorAccount({username:'admin',displayName:'管理员',password:business.password});
      new BackgroundStore(db);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(23);
      new AnnotationStore(db);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(24);
      const reopened=new AccessStore(db);new BackgroundStore(db);new AnnotationStore(db);
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(24);
      expect(reopened.accountIdentity(String(db.prepare("SELECT id FROM accounts WHERE username='admin'").get()?.id))?.role).toBe('administrator');
    } finally {db.close();}
  });
  it.each(['afterPrepared','afterSchema']as const)('blocks startup after %s, preserves full backup and resumes without grants or replay',async(stage)=>{
    const {dataDir,backupDir,db}=await setup();db.close();
    await writeFile(join(dataDir,'history-evidence.txt'),'旧历史字节不变\n');const before=await tree(dataDir);
    const options={dataDir,backupDir,apply:true,serviceStopped:true};
    await expect(migrateAdministratorAccess({...options,apply:false,serviceStopped:false})).resolves.toMatchObject({fromVersion:13,toVersion:19,stage:'dry-run',accounts:1,seats:1,createsAccounts:false,grantsRoles:false});
    expect(await tree(dataDir)).toEqual(before);
    await expect(migrateAdministratorAccess({...options,serviceStopped:false})).rejects.toThrow('停止服务');
    await expect(migrateAdministratorAccess({...options,hooks:{[stage]:async()=>{throw Error('injected stop');}}})).rejects.toThrow('injected stop');
    await expect(openDatabase(dataDir)).rejects.toMatchObject({code:'ACCESS_MIGRATION_INCOMPLETE'});
    expect(await tree(backupDir)).toEqual(before);
    await expect(migrateAdministratorAccess(options)).resolves.toMatchObject({stage:'completed',resumed:true,grantsRoles:false});
    expect(await readFile(join(dataDir,'history-evidence.txt'),'utf8')).toBe('旧历史字节不变\n');
    const reopened=await openDatabase(dataDir);
    try {const access=new AccessStore(reopened);expect(await access.authenticate('overall',business.password)).toMatchObject({seatId:'overall'});expect(new SystemRoles(reopened).list()).toEqual([]);}
    finally{reopened.close();}
    await expect(migrateAdministratorAccess(options)).resolves.toMatchObject({stage:'completed',resumed:true});
    expect(await tree(backupDir)).toEqual(before);
  },20000);
  it('rejects corrupt foreign-key data and a missing administrator schema',async()=>{
    const {db}=await setup();
    try {
      db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE bad_history(user_id TEXT REFERENCES accounts(id)); INSERT INTO bad_history VALUES(\'missing\'); PRAGMA foreign_keys=ON');
      expect(()=>migrateAdministratorAccounts(db)).toThrow();
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(13);
      expect(db.prepare('PRAGMA table_info(accounts)').all().find(column=>column.name==='seat_id')?.notnull).toBe(1);
      db.exec('DROP TABLE bad_history');migrateAdministratorAccounts(db);db.exec('DROP TABLE account_roles');
      expect(()=>new AccessStore(db)).toThrow();
    } finally{db.close();}
  });
  it.each(['afterPrepared','afterSchema']as const)('rejects account database changes after %s rather than upgrading data outside the original backup',async(stage)=>{
    const {dataDir,backupDir,db}=await setup();db.close();
    const before=await tree(dataDir),options={dataDir,backupDir,apply:true,serviceStopped:true};
    await expect(migrateAdministratorAccess({...options,hooks:{[stage]:async()=>{throw Error('injected stop');}}})).rejects.toThrow('injected stop');
    const changed=new DatabaseSync(join(dataDir,'collaboration','collaboration.sqlite'));
    try{changed.prepare("UPDATE accounts SET display_name='changed without backup' WHERE username='overall'").run();}finally{changed.close();}
    await expect(migrateAdministratorAccess(options)).rejects.toThrow(stage==='afterPrepared'?'认证数据库已变化':'超出既定变更');
    await expect(openDatabase(dataDir)).rejects.toMatchObject({code:'ACCESS_MIGRATION_INCOMPLETE'});
    expect(await tree(backupDir)).toEqual(before);
  },20000);
  it('rejects extra files introduced after preparation and does not overwrite the original backup',async()=>{
    const {dataDir,backupDir,db}=await setup();db.close();
    const before=await tree(dataDir),options={dataDir,backupDir,apply:true,serviceStopped:true};
    await expect(migrateAdministratorAccess({...options,hooks:{afterPrepared:async()=>{throw Error('injected stop');}}})).rejects.toThrow('injected stop');
    await writeFile(join(dataDir,'unexpected-after-preparation.txt'),'new state');
    await expect(migrateAdministratorAccess(options)).rejects.toThrow('文件清单已变化');
    expect(await tree(backupDir)).toEqual(before);
  });
  it('rejects a completed marker paired with a restored legacy database',async()=>{
    const {dataDir,backupDir,db}=await setup();db.close();
    const options={dataDir,backupDir,apply:true,serviceStopped:true};
    await migrateAdministratorAccess(options);
    await copyFile(join(backupDir,'collaboration','collaboration.sqlite'),join(dataDir,'collaboration','collaboration.sqlite'));
    await expect(openDatabase(dataDir)).rejects.toMatchObject({code:'ACCESS_MIGRATION_REQUIRED'});
    await expect(migrateAdministratorAccess(options)).rejects.toMatchObject({code:'ACCESS_MIGRATION_REQUIRED'});
  });
});
