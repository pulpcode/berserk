import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicWrite, checkDirectory, readControlled } from '../resources/files.js';
import { initializeR2Schema } from './management.js';
import { capabilityDigest } from './service.js';

interface FileDigest { path: string; digest: string }
interface MigrationRecord { schemaVersion:1; stage:'prepared'|'completed'; sourceDir:string; backupDir:string; files:FileDigest[]; backupDigest:string }
async function inventory(root:string,prefix=''):Promise<FileDigest[]> {
  await checkDirectory(root);const result:FileDigest[]=[];
  for(const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(root,entry.name);const name=prefix?`${prefix}/${entry.name}`:entry.name;const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile()||stat.isFile()&&stat.nlink!==1)throw Error('数据目录包含链接或运行时特殊文件，请停服后核对。');if(stat.isDirectory())result.push(...await inventory(path,name));else result.push({path:name,digest:createHash('sha256').update(await readFile(path)).digest('hex')});}return result;
}
const hash=(files:FileDigest[])=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
export async function migrateCapabilityManagement(options:{dataDir:string;backupDir:string;apply:boolean;serviceStopped:boolean;hooks?:{afterPrepared?:()=>Promise<void>;afterSchema?:()=>Promise<void>}}) {
  if(!isAbsolute(options.dataDir)||!isAbsolute(options.backupDir)||resolve(options.dataDir)==='/')throw Error('请输入绝对数据目录和独立备份目录。');
  if(options.apply&&!options.serviceStopped)throw Error('请停止服务后传入 --service-stopped。');
  const source=await realpath(options.dataDir);await checkDirectory(dirname(options.backupDir));const backup=join(await realpath(dirname(options.backupDir)),resolve(options.backupDir).split('/').at(-1)!);
  for(const [from,to] of [[source,backup],[backup,source]]){const rel=relative(from,to);if(!rel||!rel.startsWith('..')&&!isAbsolute(rel))throw Error('备份目录必须独立于数据目录。');}
  const marker=join(source,'capabilities','r2-migration.json');const raw=await readControlled(marker,32*1024*1024,true);let record:MigrationRecord|undefined;
  if(raw){record=JSON.parse(raw) as MigrationRecord;if(record.schemaVersion!==1||!['prepared','completed'].includes(record.stage)||record.sourceDir!==source||record.backupDir!==backup||!Array.isArray(record.files)||hash(record.files)!==record.backupDigest)throw Error('R2迁移记录不匹配，请保留现场。');}
  const path=join(source,'capabilities','capabilities.sqlite');const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('能力库文件异常。');
  const inspect=new DatabaseSync(path,{readOnly:true});let summary;
  try{if(inspect.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('能力库完整性检查失败。');const version=Number(inspect.prepare('PRAGMA user_version').get()?.user_version);if(![1,2].includes(version))throw Error('不支持的能力库版本。');if(version===2&&!record)throw Error('能力库已升级但缺少迁移记录，请核对来源。');const labels=new Map<string,{expertId:string;releaseVersion:string;revisionIds:string[]}>();
    for(const row of inspect.prepare('SELECT expert_id,revision_id,digest FROM revisions ORDER BY expert_id,revision_id').all()){
      if(typeof row.digest!=='string'||!/^([0-9a-f]{64})$/.test(row.digest))throw Error('修订摘要异常。');
      const rawRevision=await readControlled(join(source,'capabilities','blobs',row.digest),2*1024*1024);if(!rawRevision)throw Error('不可变修订正文缺失。');
      const value=JSON.parse(rawRevision) as Record<string,unknown>;
      const {revisionId,digest,...body}=value;if(revisionId!==row.revision_id||digest!==row.digest||value.expertId!==row.expert_id||typeof value.releaseVersion!=='string'||capabilityDigest(body)!==digest)throw Error('不可变修订内容未通过摘要核对。');
      const key=JSON.stringify([row.expert_id,value.releaseVersion]);const entry=labels.get(key)??{expertId:String(row.expert_id),releaseVersion:value.releaseVersion,revisionIds:[]};entry.revisionIds.push(String(row.revision_id));labels.set(key,entry);
    }
    summary={fromVersion:version,builtinSources:inspect.prepare('SELECT expert_id,current_revision FROM experts WHERE system=1 ORDER BY expert_id').all(),duplicateReleaseLabels:[...labels.values()].filter(item=>item.revisionIds.length>1),denials:inspect.prepare('SELECT principal_id,expert_id FROM access_rules WHERE allowed=0 ORDER BY principal_id,expert_id').all(),unfinishedCreationIntents:inspect.prepare("SELECT principal_id,action_id,json_extract(data,'$.sessionId') sessionId,json_extract(data,'$.state') state FROM creation_intents WHERE json_extract(data,'$.state')!='completed'").all(),builtinAssets:Number(inspect.prepare('SELECT COUNT(*) n FROM experts WHERE system=1').get()?.n),accountDenials:Number(inspect.prepare('SELECT COUNT(*) n FROM access_rules WHERE allowed=0').get()?.n),unfinishedIntents:Number(inspect.prepare("SELECT COUNT(*) n FROM creation_intents WHERE json_extract(data,'$.state')!='completed'").get()?.n),revisions:Number(inspect.prepare('SELECT COUNT(*) n FROM revisions').get()?.n)};}finally{inspect.close();}
  if(record?.stage==='completed')return {...summary,stage:options.apply?'completed':'dry-run',resumed:true,backupDigest:record.backupDigest};
  if(!record){const files=await inventory(source);record={schemaVersion:1,stage:'prepared',sourceDir:source,backupDir:backup,files,backupDigest:hash(files)};}
  if(!options.apply)return {...summary,stage:'dry-run',resumed:!!raw,backupDigest:record.backupDigest};
  const exists=await lstat(backup).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!exists)await cp(source,backup,{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
  if(hash(await inventory(backup))!==record.backupDigest)throw Error('完整备份校验失败，不会覆盖备份。');
  if(raw){for(const item of record.files.filter(item=>item.path==='workspace-index.json'||item.path.startsWith('sessions/'))){if(createHash('sha256').update(await readFile(join(source,item.path))).digest('hex')!==item.digest)throw Error('迁移准备后的历史已变化，请停止恢复。');}}
  await mkdir(dirname(marker),{recursive:true,mode:0o700});await atomicWrite(marker,JSON.stringify(record));await options.hooks?.afterPrepared?.();const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');initializeR2Schema(db);}finally{db.close();}
  await options.hooks?.afterSchema?.();record.stage='completed';await atomicWrite(marker,JSON.stringify(record));return {...summary,stage:'completed',resumed:!!raw,backupDigest:record.backupDigest};
}
