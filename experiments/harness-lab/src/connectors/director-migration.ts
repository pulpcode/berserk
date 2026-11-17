import { cp, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseEnv } from 'node:util';
import { capabilityDigest } from '../capabilities/service.js';
import { parseBackgroundConfig, type BackgroundConfig } from '../background/config.js';
import type { ContextConfig } from '../context/config.js';
import { atomicWrite, readControlled } from '../resources/files.js';
import { planLegacyConnectors } from './legacy-config.js';
import { inventory } from './migration.js';
import { ConnectorSecrets } from './secrets.js';

export interface DirectorSourceMapping {
  businessSlot: 'information' | 'situation'; canonicalSourceId: string;
  scenarioPolicySourceId: string; freeDebugPolicySourceId: string;
}
export const directorSourceMapping: DirectorSourceMapping[] = [
  {businessSlot:'information',canonicalSourceId:'scenario-intel-source',scenarioPolicySourceId:'scenario-intel-source',freeDebugPolicySourceId:'mock-intel-source'},
  {businessSlot:'situation',canonicalSourceId:'scenario-situation-source',scenarioPolicySourceId:'scenario-situation-source',freeDebugPolicySourceId:'mock-situation-source'},
];
interface Snapshot {context?: ContextConfig; background: BackgroundConfig; planDigest: string}
interface Options {dataDir:string;backupDir:string;mapping:DirectorSourceMapping[];apply:boolean;serviceStopped:boolean;externalFiles:string[]}
interface Marker {schemaVersion:1;stage:'prepared'|'completed';sourceDir:string;backupDir:string;mapping:DirectorSourceMapping[];before:Snapshot;after:Snapshot;files:Awaited<ReturnType<typeof inventory>>;external:Array<{path:string;name:string;hash:string}>;digest:string; capabilityFingerprint:string}
const snapshot = (db:DatabaseSync):Snapshot => {const row=db.prepare('SELECT data FROM r4_connection_legacy WHERE id=1').get();if(!row)throw Error('必须先完成 R4 连接器迁移。');return JSON.parse(String(row.data));};
function capabilityFingerprint(db:DatabaseSync):string {
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  return capabilityDigest({schema,tables:schema.filter(row=>row.type==='table'&&!['r4_connection_legacy','r4_connection_bindings'].includes(String(row.name))).map(row=>({name:row.name,rows:db.prepare('SELECT * FROM "'+String(row.name).replaceAll('"','""')+'"').all().map(value=>JSON.stringify(value)).sort()}))});
}
function plan(before:Snapshot,mapping:DirectorSourceMapping[]) {
  const after=structuredClone(before), conflicts:string[]=[];
  if(mapping.length!==2 || new Set(mapping.map(item=>item.businessSlot)).size!==2 || mapping.some(item=>!['information','situation'].includes(item.businessSlot)))throw Error('必须显式指定情报、态势两条来源映射。');
  const allIds=mapping.flatMap(item=>[item.scenarioPolicySourceId,item.freeDebugPolicySourceId]);
  if(new Set(allIds).size!==4 || mapping.some(item=>item.canonicalSourceId!==item.scenarioPolicySourceId))throw Error('本轮支持保留场景来源为运行标识，并显式绑定两个模式各自原授权范围。');
  if(before.background.sources.some(source=>!allIds.includes(source.sourceId))||before.background.sources.length!==4)conflicts.push('现有来源不等于映射中的四条，请先补充来源迁移方案。');
  for(const item of mapping) {
    const system=before.context?.systems.find(system=>system.adapter===(item.businessSlot==='information'?'mock-information-http':'mock-situation-http'));
    const canonical=after.background.sources.find(source=>source.sourceId===item.canonicalSourceId),old=after.background.sources.find(source=>source.sourceId===item.freeDebugPolicySourceId);
    if(!canonical||!old||!system||canonical.systemId!==system.id||old.systemId!==system.id){conflicts.push(`${item.businessSlot}: 原来源与查询系统不一致`);continue;}
    if(canonical.retired||canonical.operationPolicies||old.retired)conflicts.push(`${item.businessSlot}: 已存在不同迁移状态`);
    canonical.operationPolicies={scenario:item.scenarioPolicySourceId,free_debug:item.freeDebugPolicySourceId};canonical.name=item.businessSlot==='information'?'情报接入':'态势接入';old.retired=true;
    // Credentials and original policy definitions stay separate. The retired token is receipt-only.
    const target=after.context?.simulation?.sources.find(source=>source.systemId===system.id);if(!target)conflicts.push(`${item.businessSlot}: 缺少导演发送目标`);else target.sourceId=item.canonicalSourceId;
  }
  after.background=parseBackgroundConfig(after.background);
  const next=planLegacyConnectors(after.context,after.background);after.planDigest=next.digest;conflicts.push(...next.conflicts);
  return {after,bindings:next.bindings,conflicts};
}
function dependencies(db:DatabaseSync,mapping:DirectorSourceMapping[]) {
  const conflicts:string[]=[], policies=mapping.flatMap(item=>[item.scenarioPolicySourceId,item.freeDebugPolicySourceId]);
  const exists=(name:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const rows=(name:string):Record<string,unknown>[]=>exists(name)?db.prepare(`SELECT * FROM ${name}`).all():[];
  const events=rows('background_events');
  for(const item of mapping){const seen=new Set<string>();for(const row of events.filter(row=>[item.scenarioPolicySourceId,item.freeDebugPolicySourceId].includes(String(row.source_id)))){const key=String(row.message_id);if(seen.has(key))conflicts.push(`${item.businessSlot}: 跨旧来源消息标识冲突(${key})`);seen.add(key);}}
  for(const row of rows('background_jobs')){const job=JSON.parse(String(row.data));if(policies.includes(job.sourceId)&&['running','queued'].includes(job.status))conflicts.push(`存在未结束作业(${row.id})，请先排空队列`);}
  for(const row of rows('continuous_streams')){const stream=JSON.parse(String(row.data));if(stream.enabled&&stream.sourceIds.some((id:string)=>policies.includes(id)))conflicts.push(`持续配置(${stream.id})需要显式迁移，不能隐式合并授权`);}
  return {conflicts,eventCount:events.length,rules:rows('information_rules').map(row=>JSON.parse(String(row.data))),grants:rows('information_grants'),controls:rows('background_controls').map(row=>JSON.parse(String(row.data)))};
}
/** Offline only. Only connector snapshot/bindings change; original event/job/rule/grant bytes never change. */
export async function migrateDirectorSources(options:Options) {
  if(!isAbsolute(options.dataDir)||!isAbsolute(options.backupDir)||resolve(options.dataDir)==='/')throw Error('需要绝对数据根和独立备份目录。');
  if(options.apply&&!options.serviceStopped)throw Error('请先停服并显式传入 --service-stopped。');
  const sourceDir=await realpath(options.dataDir),backupDir=join(await realpath(dirname(options.backupDir)),resolve(options.backupDir).split('/').at(-1)!);
  for(const [a,b] of [[sourceDir,backupDir],[backupDir,sourceDir]]){const path=relative(a,b);if(!path||!path.startsWith('..')&&!isAbsolute(path))throw Error('备份必须位于数据根之外。');}
  const markerPath=join(sourceDir,'capabilities/director-migration.json'),raw=await readControlled(markerPath,32*1024*1024,true);
  let marker:Marker|undefined=raw?JSON.parse(raw):undefined;
  const capabilityPath=join(sourceDir,'capabilities/capabilities.sqlite'),collaborationPath=join(sourceDir,'collaboration/collaboration.sqlite');
  const capability=new DatabaseSync(capabilityPath,{readOnly:true});let current:Snapshot; let fingerprint:string;let currentBindings:unknown[];
  try {if(capability.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('能力库完整性检查失败。');current=snapshot(capability);fingerprint=capabilityFingerprint(capability);currentBindings=capability.prepare('SELECT data FROM r4_connection_bindings ORDER BY slot').all().map(row=>JSON.parse(String(row.data)));}finally{capability.close();}
  const before=marker?.before??current,planned=plan(before,options.mapping),external:Marker['external']=[],env:Record<string,string>={};
  for(const path of options.externalFiles){if(!isAbsolute(path))throw Error('外部配置和密钥文件必须是绝对路径。');const bytes=(await readControlled(path,4*1024*1024))!;external.push({path,name:String(external.length),hash:capabilityDigest(bytes)});try{Object.assign(env,parseEnv(bytes));}catch{/* JSON config/key files are backed up unchanged. */}}
  const required=planLegacyConnectors(before.context,before.background).bindings.flatMap(binding=>Object.values(binding.envRefs));
  // Encrypted secrets live in the complete data backup; env-backed credentials require their external files.
  const keyProviders:ConnectorSecrets[]=[];for(const file of options.externalFiles){try{const value=JSON.parse((await readControlled(file,4*1024*1024))!);if(value.keys&&value.activeKeyId)keyProviders.push(await ConnectorSecrets.open(sourceDir,file));}catch{/* A non-key external file is still backed up. */}}
  const credentials=new DatabaseSync(capabilityPath,{readOnly:true});try {for(const row of credentials.prepare('SELECT connection_id,subject_id,data FROM r4_connection_credentials').all()){const value=JSON.parse(String(row.data));if(value.secret&&!value.revoked&&!keyProviders.some(keys=>{try{keys.decrypt(value.secret,`${row.connection_id}:${row.subject_id}:${value.version}`);return true;}catch{return false;}}))planned.conflicts.push(`缺少可解密凭证的外置密钥配对备份(${value.secret.keyId})`);if(value.envRef&&!value.revoked&&required.includes(value.envRef)&&!env[value.envRef])planned.conflicts.push(`缺少环境凭证配对备份(${value.envRef})`);}}finally{credentials.close();}
  const expectedBindings=planLegacyConnectors(current.context,current.background);if(current.planDigest!==expectedBindings.digest || capabilityDigest(currentBindings)!==capabilityDigest([...expectedBindings.bindings].sort((a,b)=>a.slot.localeCompare(b.slot))))planned.conflicts.push('当前连接映射与权威配置不一致');
  const access=new DatabaseSync(collaborationPath,{readOnly:true});let deps:ReturnType<typeof dependencies>;try{if(access.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('业务库完整性检查失败。');deps=dependencies(access,options.mapping);}finally{access.close();}
  const conflicts=[...planned.conflicts,...deps.conflicts],summary={mapping:options.mapping,conflicts,policyScopes:before.background.sources.map(source=>({sourceId:source.sourceId,profileIds:source.allowedProfileIds,recipientSeatIds:source.allowedRecipientSeatIds})),dependencies:deps,historyRewritten:false,activeSourceIds:options.mapping.map(item=>item.canonicalSourceId),retiredCredentials:'receipt-only',rollback:'停服后配对恢复 backup/data、backup/external 与旧版本程序；不得混用新旧凭证'};
  if(marker&&(marker.schemaVersion!==1||marker.capabilityFingerprint!==fingerprint||marker.sourceDir!==sourceDir||marker.backupDir!==backupDir||capabilityDigest(marker.mapping)!==capabilityDigest(options.mapping)||capabilityDigest(marker.external)!==capabilityDigest(external)||capabilityDigest(marker.after)!==capabilityDigest(planned.after)))throw Error('迁移记录与本次参数不一致，请保留现场。');
  if(!options.apply)return {...summary,stage:'dry-run',resumed:!!raw};
  if(conflicts.length)throw Error('来源迁移存在冲突，请先查看 dry-run；未修改数据。');
  if(!marker){const files=await inventory(sourceDir);marker={schemaVersion:1,stage:'prepared',sourceDir,backupDir,mapping:options.mapping,before,after:planned.after,files,external,digest:capabilityDigest({files,external}),capabilityFingerprint:fingerprint};
    if(await lstat(backupDir).then(()=>true,()=>false))throw Error('备份目录已存在，不会覆盖。');await mkdir(backupDir,{mode:0o700});await cp(sourceDir,join(backupDir,'data'),{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});await mkdir(join(backupDir,'external'),{mode:0o700});for(const entry of external)await atomicWrite(join(backupDir,'external',entry.name),(await readControlled(entry.path,4*1024*1024))!);await atomicWrite(join(backupDir,'pairing.json'),JSON.stringify(marker));
  }
  const paired=JSON.parse((await readControlled(join(backupDir,'pairing.json'),32*1024*1024))!) as Marker;
  if(capabilityDigest({...paired,stage:'prepared'})!==capabilityDigest({...marker,stage:'prepared'})||paired.digest!==capabilityDigest({files:paired.files,external:paired.external})||capabilityDigest(await inventory(join(backupDir,'data')))!==capabilityDigest(marker.files))throw Error('完整备份校验失败，不会覆盖。');
  for(const entry of external)if(capabilityDigest((await readControlled(join(backupDir,'external',entry.name),4*1024*1024))!)!==entry.hash)throw Error('外部凭证备份校验失败。');
  if(marker.stage==='completed'){if(capabilityDigest(current)!==capabilityDigest(marker.after))throw Error('完成迁移后的配置已变化，不能再次重放。');return {...summary,stage:'completed',resumed:true};}
  const present=await inventory(sourceDir);if(capabilityDigest(present.filter(file=>file.path!=='capabilities/director-migration.json').map(file=>file.path))!==capabilityDigest(marker.files.map(file=>file.path)))throw Error('迁移期间文件清单已变化，请保留现场。');for(const file of present.filter(file=>!['capabilities/capabilities.sqlite','capabilities/director-migration.json'].includes(file.path)))if(marker.files.find(old=>old.path===file.path)?.hash!==file.hash)throw Error('迁移期间其他数据已变化，请保留现场。');
  await atomicWrite(markerPath,JSON.stringify(marker));
  if(capabilityDigest(current)===capabilityDigest(before)){
    const db=new DatabaseSync(capabilityPath);try{db.exec('PRAGMA synchronous=FULL;BEGIN IMMEDIATE');if(capabilityDigest(snapshot(db))!==capabilityDigest(before))throw Error('迁移配置已变化。');db.prepare('UPDATE r4_connection_legacy SET data=? WHERE id=1').run(JSON.stringify(planned.after));for(const binding of planned.bindings)db.prepare('UPDATE r4_connection_bindings SET data=? WHERE slot=? AND connection_id=?').run(JSON.stringify(binding),binding.slot,binding.connectorId);db.exec('COMMIT');}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}finally{db.close();}
  }else if(capabilityDigest(current)!==capabilityDigest(marker.after))throw Error('能力库超出本次迁移允许变更。');
  marker.stage='completed';await atomicWrite(markerPath,JSON.stringify(marker));return {...summary,stage:'completed',resumed:!!raw};
}
