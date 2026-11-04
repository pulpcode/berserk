import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
import { continuousTables } from '../src/background/continuous-schema.js';
import { AnnotationStore } from '../src/annotations/store.js';

const cleanup:Array<()=>Promise<unknown>|void>=[];
afterEach(async()=>{for(const run of cleanup.splice(0).reverse())await run();});
const account={username:'overall',displayName:'总体席操作员',seatId:'seat-overall',seatName:'总体席',password:'director-test-password',createPublicTask:true,manageModelSettings:true,viewWorkOverview:true};
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'axon-director-access-'));
  cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const db=await openDatabase(dir);let closed=false;
  const close=()=>{if(!closed){db.close();closed=true;}};
  cleanup.push(close);return {dir,db,close};
}

describe('explicit scenario control capability',()=>{
  it('defaults off independently of all existing administrative capabilities and preserves an explicit grant during account maintenance',async()=>{
    const {db}=await fixture();const store=new AccessStore(db);
    const overall=await store.saveAccount(account);
    expect(store.identity(overall)).toMatchObject({createPublicTask:true,manageModelSettings:true,viewWorkOverview:true,controlScenarios:false});
    const director={...account,username:'director',seatId:'seat-director',seatName:'导演席',createPublicTask:false,manageModelSettings:false,viewWorkOverview:false,controlScenarios:true};
    const userId=await store.saveAccount(director);
    expect(store.identity(userId)).toMatchObject({seatId:'seat-director',controlScenarios:true,createPublicTask:false,manageModelSettings:false,viewWorkOverview:false});
    await store.saveAccount({...director,controlScenarios:undefined,displayName:'导演操作员'});
    expect(store.identity(userId)?.controlScenarios).toBe(true);
    store.updateSeat(director.seatId,{responsibility:'控制合成场景的事件投放和时间推进。'});
    expect(store.identity(userId)?.controlScenarios).toBe(true);
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run('director-session',userId,Date.now()+60000,'{}');
    await store.saveAccount({...director,controlScenarios:false});
    expect(store.identity(userId)?.controlScenarios).toBe(false);
    expect(db.prepare('SELECT 1 FROM auth_sessions WHERE user_id=?').get(userId)).toBeUndefined();
    store.disable('director');expect(store.identity(userId)).toBeUndefined();
    expect(store.identity(overall)?.controlScenarios).toBe(false);
  });

  it('preserves an explicit grant while optional annotation and background modules advance the shared schema',async()=>{
    const {db}=await fixture();const store=new AccessStore(db);
    const userId=await store.saveAccount({...account,controlScenarios:true});
    new AnnotationStore(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(15);
    new BackgroundStore(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
    expect(new AccessStore(db).identity(userId)?.controlScenarios).toBe(true);
  });

  it.each([[7,13],[8,17],[9,15],[10,18],[11,17],[12,18]] as const)('upgrades legacy layout v%i with a denied-by-default capability and reopens without changing identities or data',async(version,expected)=>{
    const {dir,db,close}=await fixture();let store=new AccessStore(db);
    const userId=await store.saveAccount(account);
    const task=store.create(store.identity(userId)!,{title:'保留的公共任务',goal:'验证身份迁移不改写业务事实',visibility:'public',clientActionId:randomUUID()});
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run('retained-session',userId,Date.now()+60000,'{"retained":true}');
    if([8,10,11,12].includes(version))new BackgroundStore(db);
    if([9,10,12].includes(version))new AnnotationStore(db);
    if(version===8||version===10)for(const table of [...continuousTables].reverse())db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE seats DROP COLUMN control_scenarios; PRAGMA user_version=${version}`);
    const users=db.prepare('SELECT * FROM accounts').all(),sessions=db.prepare('SELECT * FROM auth_sessions').all();
    store=new AccessStore(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(expected);
    expect(store.identity(userId)).toMatchObject({controlScenarios:false,createPublicTask:true,manageModelSettings:true,viewWorkOverview:true});
    expect(store.get(task.id,account.seatId)).toEqual(task);
    expect(db.prepare('SELECT * FROM accounts').all()).toEqual(users);
    expect(db.prepare('SELECT * FROM auth_sessions').all()).toEqual(sessions);
    close();const reopened=await openDatabase(dir);cleanup.push(()=>reopened.close());
    expect(new AccessStore(reopened).identity(userId)?.controlScenarios).toBe(false);
    if([8,10,11,12].includes(version))new BackgroundStore(reopened);
    if([9,10,12].includes(version))new AnnotationStore(reopened);
    expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(expected);
    expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects a current capability schema with a missing required column instead of restoring permissions',async()=>{
    const {db}=await fixture();new AccessStore(db);
    db.exec('ALTER TABLE seats DROP COLUMN control_scenarios');
    const before=db.prepare('PRAGMA table_info(seats)').all();
    expect(()=>new AccessStore(db)).toThrow(expect.objectContaining({code:'RESOURCE_STATE_INVALID'}));
    expect(db.prepare('PRAGMA table_info(seats)').all()).toEqual(before);
  });
});
