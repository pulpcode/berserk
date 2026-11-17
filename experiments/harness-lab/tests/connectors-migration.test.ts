import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { initializeSkillSchema } from '../src/skills/service.js';
import { ConnectorService } from '../src/connectors/service.js';
import { migrateConnectorsR4 } from '../src/connectors/migration.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const parent=await mkdtemp(join(tmpdir(),'axon-r4-migration-'));roots.push(parent);const dataDir=join(parent,'active');const cap=await CapabilityService.open(dataDir);initializeR2Schema(cap.db);initializeSkillSchema(cap.db);cap.close();await writeFile(join(dataDir,'old-history.txt'),'native history unchanged\n',{mode:0o600});const contextConfigPath=join(parent,'context.json');await writeFile(contextConfigPath,JSON.stringify({systems:[{id:'old-intel',name:'Original intelligence',adapter:'mock-information-http',baseUrl:'https://source.example',tokenEnv:'SOURCE_QUERY'}],scopes:[]}),{mode:0o600});const credentialFile=join(parent,'credentials.env');await writeFile(credentialFile,'SOURCE_QUERY=original-query-secret\n',{mode:0o600});return{parent,dataDir,credentialFiles:[credentialFile],backupDir:join(parent,'backup'),contextConfigPath,serviceStopped:true,apply:true};}

test('write-free conflict inventory lists every extra source and refuses apply without taking first',async()=>{const input=await setup(),before=await readFile(join(input.dataDir,'capabilities/capabilities.sqlite'));const config=JSON.parse(await readFile(input.contextConfigPath,'utf8'));config.systems.push({...config.systems[0],id:'second'});await writeFile(input.contextConfigPath,JSON.stringify(config));const preview=await migrateConnectorsR4({...input,apply:false,serviceStopped:false});expect(preview.systems).toHaveLength(2);expect(preview.conflicts[0]).toContain('多条');await expect(migrateConnectorsR4(input)).rejects.toThrow('冲突');expect(await readFile(join(input.dataDir,'capabilities/capabilities.sqlite'))).toEqual(before);await expect(readFile(join(input.dataDir,'capabilities/r4-migration.json'))).rejects.toMatchObject({code:'ENOENT'});await expect(ConnectorService.open(input.dataDir)).rejects.toMatchObject({code:'CONNECTOR_MIGRATION_REQUIRED'});});

test('stopped full data plus external config backup, schema-crash recovery, frozen authority and paired old root',async()=>{const input=await setup(),original=await readFile(join(input.dataDir,'capabilities/capabilities.sqlite')),originalConfig=await readFile(input.contextConfigPath);await migrateConnectorsR4({...input,apply:false,serviceStopped:false});expect(await readFile(join(input.dataDir,'capabilities/capabilities.sqlite'))).toEqual(original);await expect(migrateConnectorsR4({...input,serviceStopped:false})).rejects.toThrow('停服');await expect(migrateConnectorsR4({...input,hooks:{afterSchema:async()=>{throw Error('schema-crash');}}})).rejects.toThrow('schema-crash');await expect(ConnectorService.open(input.dataDir)).rejects.toMatchObject({code:'CONNECTOR_MIGRATION_INCOMPLETE'});const result=await migrateConnectorsR4(input);expect(JSON.stringify(result)).not.toContain('original-query-secret');expect(result.stage).toBe('completed');expect(result.resumed).toBe(true);expect(await readFile(join(input.backupDir,'data/capabilities/capabilities.sqlite'))).toEqual(original);expect(await readFile(join(input.backupDir,'external/0-context'))).toEqual(originalConfig);expect(await readFile(join(input.dataDir,'old-history.txt'),'utf8')).toBe('native history unchanged\n');const service=await ConnectorService.open(input.dataDir,{env:{SOURCE_QUERY:'old-query-secret'}});try{expect(service.resolveLegacy({systemId:'old-intel'}).endpoint).toBe('https://source.example');await writeFile(input.contextConfigPath,JSON.stringify({systems:[],scopes:[]}));expect(service.legacyProjection()?.context?.systems[0].id).toBe('old-intel');await expect(migrateConnectorsR4(input)).rejects.toThrow('不匹配');}finally{service.close();}const restored=join(input.parent,'restored');await cp(join(input.backupDir,'data'),restored,{recursive:true});const old=new DatabaseSync(join(restored,'capabilities/capabilities.sqlite'),{readOnly:true});try{expect(old.prepare("SELECT 1 FROM sqlite_master WHERE name='r4_connector_meta'").get()).toBeUndefined();expect(old.prepare("SELECT version FROM r3_skill_meta WHERE id=1").get()?.version).toBe(1);}finally{old.close();}});

test('prepared restart rejects unknown root files, unrelated SQLite mutations and changed external inputs',async()=>{const input=await setup();await expect(migrateConnectorsR4({...input,hooks:{afterPrepared:async()=>{throw Error('prepared-crash');}}})).rejects.toThrow('prepared-crash');await writeFile(join(input.dataDir,'extra.txt'),'changed');await expect(migrateConnectorsR4(input)).rejects.toThrow('文件清单');await rm(join(input.dataDir,'extra.txt'));const db=new DatabaseSync(join(input.dataDir,'capabilities/capabilities.sqlite'));db.exec('CREATE TABLE unrelated_change(id TEXT)');db.close();await expect(migrateConnectorsR4(input)).rejects.toThrow('超出已知');await cp(join(input.backupDir,'data/capabilities/capabilities.sqlite'),join(input.dataDir,'capabilities/capabilities.sqlite'));await writeFile(input.contextConfigPath,'{"systems":[],"scopes":[]}');await expect(migrateConnectorsR4(input)).rejects.toThrow('不匹配');});


test('apply refuses an unpaired legacy environment credential and dry-run never prints secret values',async()=>{const input=await setup();const preview=await migrateConnectorsR4({...input,apply:false,credentialFiles:[]});expect(preview.conflicts.some(item=>item.includes('SOURCE_QUERY'))).toBe(true);expect(JSON.stringify(preview)).not.toContain('original-query-secret');await expect(migrateConnectorsR4({...input,credentialFiles:[]})).rejects.toThrow('冲突');await expect(readFile(join(input.dataDir,'capabilities/r4-migration.json'))).rejects.toMatchObject({code:'ENOENT'});});

test('completed retries verify original data, external secrets and the exact rollback pairing', async () => {
  const input = await setup();
  await migrateConnectorsR4(input);
  const pairingPath = join(input.backupDir,'pairing.json'), pairing = await readFile(pairingPath,'utf8');
  await writeFile(pairingPath,JSON.stringify({...JSON.parse(pairing),sourceDir:'/different-root'}));
  await expect(migrateConnectorsR4(input)).rejects.toThrow('配对');
  await writeFile(pairingPath,pairing);
  const credentialPath = join(input.backupDir,'external/1-credential'), credential = await readFile(credentialPath);
  await writeFile(credentialPath,'SOURCE_QUERY=wrong-version\n');
  await expect(migrateConnectorsR4(input)).rejects.toThrow('备份校验');
  await writeFile(credentialPath,credential);
  await writeFile(join(input.backupDir,'data/old-history.txt'),'modified history');
  await expect(migrateConnectorsR4(input)).rejects.toThrow('备份校验');
});

test('production migration CLI accepts repeated credential files and rejects misspelled flags', async () => {
  const input = await setup(), context = JSON.parse(await readFile(input.contextConfigPath,'utf8'));
  context.systems.push({id:'situation',name:'Original situation',adapter:'mock-situation-http',baseUrl:'https://situation.example',tokenEnv:'SITUATION_QUERY'});
  await writeFile(input.contextConfigPath,JSON.stringify(context));
  const secondCredential = join(input.parent,'situation.env');
  await writeFile(secondCredential,'SITUATION_QUERY=original-situation-secret\n',{mode:0o600});
  const args = ['--import','tsx','scripts/migrate-connectors-r4.ts','--data-dir',input.dataDir,'--backup-dir',input.backupDir,'--context-config',input.contextConfigPath,'--credential-file',input.credentialFiles[0],'--credential-file',secondCredential];
  const run = promisify(execFile);
  const preview = await run(process.execPath,[...args,'--dry-run']);
  expect(JSON.parse(preview.stdout)).toMatchObject({stage:'dry-run',conflicts:[],requiredEnvironmentReferences:['SITUATION_QUERY','SOURCE_QUERY']});
  expect(preview.stdout).not.toContain('original-query-secret');
  expect(preview.stdout).not.toContain('original-situation-secret');
  await expect(run(process.execPath,[...args,'--dry-run','--context-confg',input.contextConfigPath])).rejects.toMatchObject({code:1});
  const applied = await run(process.execPath,[...args,'--apply','--service-stopped']);
  expect(JSON.parse(applied.stdout)).toMatchObject({stage:'completed',resumed:false});
  const repeated = await run(process.execPath,[...args,'--apply','--service-stopped']);
  expect(JSON.parse(repeated.stdout)).toMatchObject({stage:'completed',resumed:true});
});

test('paired ingress credentials retain the original length and HTTP header validity requirements', async () => {
  const input=await setup(),backgroundConfigPath=join(input.parent,'background.json'),credentialPath=join(input.parent,'ingress.env');
  await writeFile(backgroundConfigPath,JSON.stringify({enabled:false,sources:[{sourceId:'generic',name:'Generic source',credentialRef:'INGRESS',allowedProfileIds:['legacy'],allowedRecipientSeatIds:['seat-a']}],profiles:[{id:'legacy',name:'Legacy',goal:'Process',tools:['source_read']}]}),{mode:0o600});
  const options={...input,backgroundConfigPath,credentialFiles:[...input.credentialFiles,credentialPath],apply:false};
  for (const value of ['short-token','"long-enough-token-but\ninvalid-header"']) {
    await writeFile(credentialPath,`INGRESS=${value}\n`,{mode:0o600});
    expect((await migrateConnectorsR4(options)).conflicts.some(conflict=>conflict.includes('INGRESS'))).toBe(true);
  }
  await writeFile(credentialPath,'INGRESS=original-inbound-token-at-least-24\n');
  expect((await migrateConnectorsR4(options)).conflicts).toEqual([]);
});
