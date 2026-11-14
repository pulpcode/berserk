import { createHash } from 'node:crypto';
import { cp, lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicWrite, checkDirectory, readControlled } from '../resources/files.js';
import { migrateAdministratorAccounts, requireAdministratorSchema } from './administrator-schema.js';

interface FileDigest { path: string; digest: string }
interface MigrationRecord { schemaVersion:1; stage:'prepared'|'completed'; sourceDir:string; backupDir:string; files:FileDigest[]; backupDigest:string }
async function inventory(root:string,prefix=''):Promise<FileDigest[]> {
  await checkDirectory(root);const result:FileDigest[]=[];
  for(const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const path=join(root,entry.name),name=prefix?`${prefix}/${entry.name}`:entry.name,stat=await lstat(path);
    if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile()||stat.isFile()&&stat.nlink!==1)throw Error('数据目录包含链接或运行时特殊文件，请停服后核对。');
    if(stat.isDirectory())result.push(...await inventory(path,name));else result.push({path:name,digest:createHash('sha256').update(await readFile(path)).digest('hex')});
  }
  return result;
}
const hash=(files:FileDigest[])=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
function logicalDatabase(db:DatabaseSync):string {
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  const tables=schema.filter(item=>item.type==='table').map(item=>{
    const name=String(item.name),quoted='"'+name.replaceAll('"','""')+'"';
    return{name,rows:db.prepare(`SELECT * FROM ${quoted}`).all().map(row=>JSON.stringify(row)).sort()};
  });
  return createHash('sha256').update(JSON.stringify({schema,tables,version:db.prepare('PRAGMA user_version').get()?.user_version})).digest('hex');
}
async function verifyPreparedDatabase(path:string,backup:string,fromVersion:number,record:MigrationRecord) {
  if(fromVersion<19){
    const expected=record.files.find(item=>item.path==='collaboration/collaboration.sqlite');
    if(!expected||createHash('sha256').update(await readFile(path)).digest('hex')!==expected.digest)throw Error('迁移准备后的认证数据库已变化，请保留现场。');
    return;
  }
  // A post-schema crash may change the SQLite file representation. Reproduce
  // only our known transformation on a private backup copy, then compare every
  // table and schema definition without logging account or password material.
  const scratch=await mkdtemp(join(tmpdir(),'axon-admin-migration-proof-'));
  try {
    const candidate=join(scratch,'collaboration.sqlite');await cp(join(backup,'collaboration','collaboration.sqlite'),candidate,{force:false,errorOnExist:true});
    const expected=new DatabaseSync(candidate),actual=new DatabaseSync(path,{readOnly:true});
    try{expected.exec('PRAGMA foreign_keys=ON');migrateAdministratorAccounts(expected);if(logicalDatabase(expected)!==logicalDatabase(actual))throw Error('迁移后的认证数据库超出既定变更，请保留现场。');}
    finally{expected.close();actual.close();}
  } finally{await rm(scratch,{recursive:true,force:true});}
}

/** Explicit stopped full-root migration; never grants a new administrator. */
export async function migrateAdministratorAccess(options:{dataDir:string;backupDir:string;apply:boolean;serviceStopped:boolean;hooks?:{afterPrepared?:()=>Promise<void>;afterSchema?:()=>Promise<void>}}) {
  if(!isAbsolute(options.dataDir)||!isAbsolute(options.backupDir)||resolve(options.dataDir)==='/')throw Error('请输入绝对数据目录和独立备份目录。');
  if(options.apply&&!options.serviceStopped)throw Error('请停止服务后传入 --service-stopped。');
  const source=await realpath(options.dataDir);await checkDirectory(dirname(options.backupDir));
  const backup=join(await realpath(dirname(options.backupDir)),resolve(options.backupDir).split('/').at(-1)!);
  for(const [from,to]of[[source,backup],[backup,source]]){const rel=relative(from,to);if(!rel||!rel.startsWith('..')&&!isAbsolute(rel))throw Error('备份目录必须独立于数据目录。');}
  const marker=join(source,'collaboration','administrator-migration.json'),raw=await readControlled(marker,32*1024*1024,true);
  let record:MigrationRecord|undefined;
  if(raw){record=JSON.parse(raw)as MigrationRecord;if(record.schemaVersion!==1||!['prepared','completed'].includes(record.stage)||record.sourceDir!==source||record.backupDir!==backup||!Array.isArray(record.files)||hash(record.files)!==record.backupDigest)throw Error('管理员账号迁移记录不匹配，请保留现场。');}
  const path=join(source,'collaboration','collaboration.sqlite'),stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('认证数据库文件异常。');
  const db=new DatabaseSync(path,{readOnly:true});let summary;
  try {
    if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').get())throw Error('认证数据库完整性检查失败。');
    const fromVersion=Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if(record?.stage==='completed')requireAdministratorSchema(db);
    if(fromVersion<13||fromVersion>24)throw Error('请先使用当前版本完成业务账号 schema 升级。');
    if(fromVersion>=19&&!record)throw Error('管理员账号库已升级但缺少迁移记录，请核对来源。');
    const roleTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_roles'").get()?'account_roles':db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='capability_account_roles'").get()?'capability_account_roles':undefined;
    summary={fromVersion,toVersion:fromVersion>=19?fromVersion:fromVersion+6,accounts:Number(db.prepare('SELECT COUNT(*) n FROM accounts').get()?.n),seats:Number(db.prepare('SELECT COUNT(*) n FROM seats').get()?.n),administratorGrants:roleTable?Number(db.prepare(`SELECT COUNT(*) n FROM ${roleTable} WHERE role='administrator'`).get()?.n):0,createsAccounts:false,grantsRoles:false};
  } finally { db.close(); }
  if(!record){const files=await inventory(source);record={schemaVersion:1,stage:'prepared',sourceDir:source,backupDir:backup,files,backupDigest:hash(files)};}
  if(!options.apply)return{...summary,stage:'dry-run',resumed:!!raw,backupDigest:record.backupDigest};
  const exists=await lstat(backup).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!exists)await cp(source,backup,{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
  if(hash(await inventory(backup))!==record.backupDigest)throw Error('完整备份校验失败，不会覆盖备份。');
  if(record.stage==='completed')return{...summary,stage:'completed',resumed:true,backupDigest:record.backupDigest};
  if(raw){
    const current=(await inventory(source)).filter(item=>item.path!=='collaboration/administrator-migration.json');
    if(JSON.stringify(current.map(item=>item.path))!==JSON.stringify(record.files.map(item=>item.path)))throw Error('迁移准备后的文件清单已变化，请保留现场。');
    for(const item of current.filter(item=>item.path!=='collaboration/collaboration.sqlite'))if(item.digest!==record.files.find(prior=>prior.path===item.path)?.digest)throw Error('迁移准备后的其他数据已变化，请保留现场。');
    await verifyPreparedDatabase(path,backup,summary.fromVersion,record);
  }
  await atomicWrite(marker,JSON.stringify(record));await options.hooks?.afterPrepared?.();
  const writable=new DatabaseSync(path);
  try{writable.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');migrateAdministratorAccounts(writable);}finally{writable.close();}
  await options.hooks?.afterSchema?.();record.stage='completed';await atomicWrite(marker,JSON.stringify(record));
  return{...summary,stage:'completed',resumed:!!raw,backupDigest:record.backupDigest};
}
