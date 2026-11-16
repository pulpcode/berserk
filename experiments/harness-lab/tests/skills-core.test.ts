import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import { packageContent } from '../src/skills/package.js';
import { previewSkillImport } from '../src/skills/import.js';
import { migrateSkillsR3 } from '../src/skills/migration.js';
import type { SkillActor, SkillFileInput } from '../src/contracts/skills.js';
const method=(body='Explain the inputs.',extra=''):SkillFileInput=>({path:'SKILL.md',contentBase64:Buffer.from(`---\nname: demo-method\ndescription: Explain sample inputs\n${extra}---\n${body}`).toString('base64')});
const actor:SkillActor={userId:'administrator',assertAdministrator:()=>{}};
async function root(){const dir=await mkdtemp(join(tmpdir(),'axon-r3-core-'));const capabilities=await CapabilityService.open(dir);initializeR2Schema(capabilities.db);capabilities.close();return dir;}
test('whole package identity, custom directories, standard advice and unknown invocation constraints',()=>{
  const base=packageContent([method(''),{path:'templates/custom.txt',contentBase64:Buffer.from('template').toString('base64')}]);
  expect(base.validation.valid).toBe(true);expect(base.validation.issues.some(i=>i.code==='AXON_EMPTY_BODY')).toBe(true);
  expect(packageContent([method(''),{path:'templates/custom.txt',contentBase64:Buffer.from('changed').toString('base64')}]).packageDigest).not.toBe(base.packageDigest);
  expect(packageContent([method('Use','disable-model-invocation: true\n')]).content.autoInvocationEligible).toBe(false);
  expect(packageContent([method('[missing](references/missing.txt)')]).validation.valid).toBe(false);
  expect(packageContent([method('[external](https://example.com/file)')]).validation.valid).toBe(true);
  expect(()=>packageContent([method(),{path:'../escape',contentBase64:''}])).toThrow();
  expect(()=>packageContent([method(),{path:'SKILL.MD',contentBase64:''}])).toThrow();
});
test('flat Markdown preview preserves bytes and flags format separately from upload wrapping',async()=>{
  const input=Buffer.from(method().contentBase64,'base64');const preview=await previewSkillImport('demo.md',input);
  expect(preview.validation.valid).toBe(true);expect(Buffer.from(preview.files[0].contentBase64,'base64')).toEqual(input);expect(preview.warnings).toHaveLength(1);
  await expect(previewSkillImport('archive.tar',input)).rejects.toThrow();
});
test('publish without successful scans or trial; immutable history, scope, concurrency and ordinary disable',async()=>{
  const dir=await root();const service=await SkillService.open(dir,{createdNew:true,seats:()=>['business']});
  try{
    const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files:[method(),{path:'scripts/demo.py',contentBase64:Buffer.from('print(1)').toString('base64')}]});
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
    const input={expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'first',clientActionId:randomUUID()};
    const publications=await Promise.all([service.publish(actor,id,input),service.publish(actor,id,input)]);expect(publications[0]).toEqual(publications[1]);expect(service.detail(id).publications).toHaveLength(1);
    const ref=publications[0];const principal={userId:'user',seatId:'business'};
    expect((await service.resolve(ref,principal)).files).toHaveLength(2);expect(service.catalog({userId:actor.userId,seatId:'account-no-seat',canCollaborate:false})).toEqual([]);
    const mountParent=join(dir,'request');await mkdir(mountParent);const mount=await service.materialize(ref,principal,join(mountParent,'package'));expect(await readFile(join(mount.root,'demo-method/SKILL.md'),'utf8')).toContain('demo-method');
    await service.lifecycle(actor,id,{action:'disable',expectedStateRevision:0,clientActionId:randomUUID()});expect(service.catalog(principal)).toEqual([]);expect(()=>service.assertAvailable(ref,principal,true)).not.toThrow();await expect(service.resolve(ref,principal)).rejects.toThrow();
    await service.lifecycle(actor,id,{action:'restore',expectedStateRevision:1,clientActionId:randomUUID()});const next=await service.saveDraft(actor,id,{expectedDraftRevision:draft.draftRevision,files:[method('Second version')]});const second=await service.publish(actor,id,{expectedDraftRevision:next.draftRevision,expectedCurrentRevisionId:ref.revisionId,releaseNotes:'patch',clientActionId:randomUUID()});expect(second.releaseVersion).toBe('1.0.1');expect((await service.resolve(ref,principal)).files).toHaveLength(2);
    await service.setPolicy(actor,id,{expectedRevision:1,mode:'none',seatIds:[],clientActionId:randomUUID()});expect(()=>service.assertAvailable(ref,principal,true)).toThrow();
  }finally{service.close();await rm(dir,{recursive:true,force:true});}
});
test('explicit migration dry run preserves bytes, resumes after schema commit, and old data remains paired',async()=>{
  const dir=await root(),backup=dir+'-backup';const path=join(dir,'capabilities/capabilities.sqlite');const original=await readFile(path);
  try{
    await expect(SkillService.open(dir)).rejects.toThrow('迁移');
    await migrateSkillsR3({dataDir:dir,backupDir:backup,apply:false,serviceStopped:false});expect(await readFile(path)).toEqual(original);
    await expect(migrateSkillsR3({dataDir:dir,backupDir:backup,apply:true,serviceStopped:true,hooks:{afterSchema:async()=>{throw Error('interrupted');}}})).rejects.toThrow('interrupted');
    await expect(SkillService.open(dir)).rejects.toThrow('未完成');
    expect((await migrateSkillsR3({dataDir:dir,backupDir:backup,apply:true,serviceStopped:true})).stage).toBe('completed');const service=await SkillService.open(dir);service.close();expect(await readFile(join(backup,'capabilities/capabilities.sqlite'))).toEqual(original);
  }finally{await rm(dir,{recursive:true,force:true});await rm(backup,{recursive:true,force:true});}
});
