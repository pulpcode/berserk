import { cp, mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { initializeSkillSchema } from '../src/skills/service.js';
import { ConnectorService } from '../src/connectors/service.js';
import { parseBackgroundConfig } from '../src/background/config.js';
import { parseContextConfig } from '../src/context/config.js';
import { directorSourceMapping, migrateDirectorSources } from '../src/connectors/director-migration.js';
import { inventory } from '../src/connectors/migration.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { BackgroundStore } from '../src/background/store.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const actor={userId:'admin',assertActive:()=>{},assertAdministrator:()=>{}};
async function setup() {
  const parent=await mkdtemp(join(tmpdir(),'axon-director-migration-'));roots.push(parent);const dataDir=join(parent,'data');
  const cap=await CapabilityService.open(dataDir);initializeR2Schema(cap.db);initializeSkillSchema(cap.db);cap.close();
  const context=parseContextConfig(JSON.parse(await readFile(new URL('./fixtures/r4-online/context.json',import.meta.url),'utf8'))),background=parseBackgroundConfig(JSON.parse(await readFile(new URL('./fixtures/r4-online/background.json',import.meta.url),'utf8')));
  const refs=[...context.systems.map(system=>system.tokenEnv),context.simulation!.tokenEnv,...background.sources.map(source=>source.credentialRef)],file=join(parent,'env');await writeFile(file,refs.map(ref=>`${ref}=credential-for-${ref}-long-enough`).join('\n'),{mode:0o600});const env=parseEnv(await readFile(file,'utf8'));
  const connectors=await ConnectorService.open(dataDir,{createdNew:true,env,ingressEnv:env});connectors.initializeLegacy(context,background);connectors.close();
  await mkdir(join(dataDir,'collaboration'));const db=new DatabaseSync(join(dataDir,'collaboration/collaboration.sqlite'));db.exec('CREATE TABLE background_events(id TEXT,source_id TEXT,message_id TEXT,data TEXT); CREATE TABLE information_rules(id TEXT,data TEXT); CREATE TABLE information_grants(id TEXT,source_id TEXT,permission TEXT); CREATE TABLE background_jobs(id TEXT,data TEXT);');
  for(const [index,source] of background.sources.entries()){db.prepare('INSERT INTO background_events VALUES(?,?,?,?)').run(`event-${index}`,source.sourceId,`message-${index}`,JSON.stringify({sourceId:source.sourceId,payloadHash:'original-hash'}));db.prepare('INSERT INTO information_rules VALUES(?,?)').run(`rule-${index}`,JSON.stringify({id:`rule-${index}`,sourceId:source.sourceId,profileId:source.allowedProfileIds[0],recipientSeatIds:source.allowedRecipientSeatIds}));db.prepare('INSERT INTO information_grants VALUES(?,?,?)').run(`seat-${index}`,source.sourceId,'manage');}db.close();await writeFile(join(dataDir,'native.jsonl'),'immutable native session\n');
  return {parent,dataDir,backupDir:join(parent,'backup'),externalFiles:[file],mapping:directorSourceMapping,serviceStopped:true,apply:true,env};
}
test('actual four-source configuration migrates to two live sources without merging rules, recipients, grants, historical bytes or credentials',async()=>{
  const input=await setup(),before=await inventory(input.dataDir),business=await readFile(join(input.dataDir,'collaboration/collaboration.sqlite'));
  const preview=await migrateDirectorSources({...input,apply:false});expect(preview.conflicts).toEqual([]);expect(preview.policyScopes.map(source=>source.sourceId)).toHaveLength(4);expect(await inventory(input.dataDir)).toEqual(before);expect(JSON.stringify(preview)).not.toContain('credential-for-');
  expect((await migrateDirectorSources(input)).stage).toBe('completed');expect((await migrateDirectorSources(input)).resumed).toBe(true);expect(await readFile(join(input.dataDir,'collaboration/collaboration.sqlite'))).toEqual(business);
  const controlsDb=await openDatabase(join(input.parent,'controls'));new AccessStore(controlsDb);const controls=new BackgroundStore(controlsDb);
  const service=await ConnectorService.open(input.dataDir,{env:input.env,ingressEnv:input.env});service.bindInboundControl({read:sourceId=>controls.getControl(`source:${sourceId}`),write:(actor,sourceId,enabled,revision)=>controls.setControl(`source:${sourceId}`,revision,enabled,actor.userId)});try{
    const config=service.legacyProjection()!.background!;expect(config.sources.filter(source=>!source.retired).map(source=>source.sourceId)).toEqual(['scenario-intel-source','scenario-situation-source']);expect(config.sources.find(source=>source.sourceId==='scenario-intel-source')!.operationPolicies).toEqual({scenario:'scenario-intel-source',free_debug:'mock-intel-source'});
    expect(()=>service.resolveLegacy({sourceId:'mock-intel-source'})).toThrow();expect(service.resolveLegacy({sourceId:'mock-intel-source',receiptOnly:true}).token).toBe(input.env[config.sources.find(source=>source.sourceId==='mock-intel-source')!.credentialRef]);
    expect(service.list(actor).some(item=>item.businessSlot==='ingress')).toBe(false);const detail=service.detail(actor,'legacy-information');expect(detail.inbound).toHaveLength(1);expect(detail.inbound![0].policyScopes.find(scope=>scope.mode==='free_debug')!.profileIds).toEqual(['context-analysis']);expect(detail.inbound![0].policyScopes.find(scope=>scope.mode==='scenario')!.profileIds).toEqual(['scenario-source-review']);
    controls.setControl('source:scenario-intel-source',0,false,'ordinary-manager');
    expect(service.detail(actor,'legacy-information').inbound![0]).toMatchObject({accepting:false,revision:1});
    await expect(service.inboundState(actor,'legacy-information','scenario-intel-source',{enabled:true,expectedRevision:0,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});
    const action={enabled:true,expectedRevision:1,clientActionId:randomUUID()};await service.inboundState(actor,'legacy-information','scenario-intel-source',action);
    expect(controls.getControl('source:scenario-intel-source')).toMatchObject({enabled:true,revision:2,updatedByUserId:'admin'});
    await service.inboundState(actor,'legacy-information','scenario-intel-source',action);expect(controls.getControl('source:scenario-intel-source').revision).toBe(2);
    expect(service.detail(actor,'legacy-information').audit.some(entry=>entry.action==='inbound_enabled')).toBe(true);
    expect(service.legacyProjection()!.background).toEqual(config);
    const uncertain={enabled:false,expectedRevision:2,clientActionId:randomUUID()},prepare=service.db.prepare.bind(service.db);
    const auditFailure=vi.spyOn(service.db,'prepare').mockImplementation(sql=>{if(sql.startsWith('INSERT INTO r4_connection_audit'))throw Error('audit write failed');return prepare(sql);});
    try {await expect(service.inboundState(actor,'legacy-information','scenario-intel-source',uncertain)).rejects.toThrow('audit write failed');}finally{auditFailure.mockRestore();}
    expect(service.detail(actor,'legacy-information').inbound![0]).toMatchObject({accepting:false,revision:3});
    await expect(service.inboundState(actor,'legacy-information','scenario-intel-source',uncertain)).rejects.toMatchObject({code:'CONNECTOR_CONFLICT'});
    expect(controls.getControl('source:scenario-intel-source').revision).toBe(3);
    expect(service.resolveLegacy({sourceId:'scenario-intel-source',receiptOnly:true}).token).toBeTruthy();expect(service.resolveLegacy({systemId:'intel'}).token).toBeTruthy();expect(service.resolveLegacy({sourceId:'scenario-situation-source'}).token).toBeTruthy();
    await expect(service.inboundState(actor,'legacy-situation','scenario-intel-source',{enabled:false,expectedRevision:0,clientActionId:randomUUID()})).rejects.toMatchObject({code:'CONNECTOR_NOT_FOUND'});
  }finally{service.close();controlsDb.close();}
});
test('collision and unfinished work are enumerated without writes; missing paired credentials block apply',async()=>{
  const input=await setup(),db=new DatabaseSync(join(input.dataDir,'collaboration/collaboration.sqlite'));db.prepare('UPDATE background_events SET message_id=? WHERE source_id IN (?,?)').run('collision','mock-intel-source','scenario-intel-source');db.prepare('INSERT INTO background_jobs VALUES(?,?)').run('running',JSON.stringify({sourceId:'scenario-intel-source',status:'running'}));db.close();const before=await inventory(input.dataDir);const preview=await migrateDirectorSources({...input,apply:false,externalFiles:[]});expect(preview.conflicts.some(value=>value.includes('标识冲突'))).toBe(true);expect(preview.conflicts.some(value=>value.includes('未结束'))).toBe(true);expect(preview.conflicts.some(value=>value.includes('凭证'))).toBe(true);await expect(migrateDirectorSources(input)).rejects.toThrow('冲突');expect(await inventory(input.dataDir)).toEqual(before);
});
test('full backup pairing is immutable and service refuses incomplete migration',async()=>{
  const input=await setup();await migrateDirectorSources(input);const markerPath=join(input.dataDir,'capabilities/director-migration.json'),marker=JSON.parse(await readFile(markerPath,'utf8'));await writeFile(markerPath,JSON.stringify({...marker,stage:'prepared'}));await expect(ConnectorService.open(input.dataDir)).rejects.toMatchObject({code:'CONNECTOR_MIGRATION_INCOMPLETE'});expect((await migrateDirectorSources(input)).stage).toBe('completed');
  const restored=join(input.parent,'restored');await cp(join(input.backupDir,'data'),restored,{recursive:true});
  expect(await readFile(join(restored,'native.jsonl'),'utf8')).toBe('immutable native session\n');
  expect(await readFile(join(restored,'collaboration/collaboration.sqlite'))).toEqual(await readFile(join(input.backupDir,'data/collaboration/collaboration.sqlite')));
  await expect(readFile(join(restored,'capabilities/director-migration.json'))).rejects.toMatchObject({code:'ENOENT'});
  const restoredService=await ConnectorService.open(restored,{env:input.env,ingressEnv:input.env});try{const original=restoredService.legacyProjection()!.background!;expect(original.sources).toHaveLength(4);expect(original.sources.some(source=>source.retired||source.operationPolicies)).toBe(false);for(const source of original.sources)expect(restoredService.resolveLegacy({sourceId:source.sourceId}).token).toBe(input.env[source.credentialRef]);}finally{restoredService.close();}
  await writeFile(join(input.backupDir,'data/native.jsonl'),'changed');await expect(migrateDirectorSources(input)).rejects.toThrow('备份校验');
});
