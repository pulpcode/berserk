import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import { semgrepScanner } from '../src/skills/scanner.js';
import { fileHash, loadSkillLimits, packageContent } from '../src/skills/package.js';
import type { SkillActor, SkillScanReport } from '../src/contracts/skills.js';

const files=[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: review-method\ndescription: Review test\n---\nUse the given inputs.').toString('base64')}];
async function root(){const path=await mkdtemp(join(tmpdir(),'axon-r3-review-'));const cap=await CapabilityService.open(path);initializeR2Schema(cap.db);cap.close();return path;}
const actor:SkillActor={userId:'admin',assertAdministrator:()=>{}};

test('operator skill limits can be tightened with validated values without expanding platform ceilings',()=>{
  const defaults=loadSkillLimits({});
  expect(defaults).toEqual({archiveBytes:20*1024*1024,expandedBytes:100*1024*1024,files:256,resourceBytes:20*1024*1024,methodBytes:64*1024,textBytes:2*1024*1024});
  const tightened=loadSkillLimits({LAB_SKILL_MAX_ARCHIVE_BYTES:'1000',LAB_SKILL_MAX_EXPANDED_BYTES:'2000',LAB_SKILL_MAX_FILES:'4',LAB_SKILL_MAX_RESOURCE_BYTES:'500',LAB_SKILL_MAX_METHOD_BYTES:'300',LAB_SKILL_MAX_TEXT_BYTES:'400'});
  expect(tightened).toEqual({archiveBytes:1000,expandedBytes:2000,files:4,resourceBytes:500,methodBytes:300,textBytes:400});
  expect(Object.isFrozen(tightened)).toBe(true);
  for(const raw of ['', '0','-1','1.5','1e3','NaN','257'])expect(()=>loadSkillLimits({LAB_SKILL_MAX_FILES:raw})).toThrow('LAB_SKILL_MAX_FILES');
  expect(()=>loadSkillLimits({LAB_SKILL_MAX_METHOD_BYTES:String(64*1024+1)})).toThrow('LAB_SKILL_MAX_METHOD_BYTES');
  expect(loadSkillLimits({})).toEqual(defaults);
});

test('late scanner completion after close cannot write into a removed data root',async()=>{
  const path=await root();let finish!:(report:SkillScanReport)=>void;
  const service=await SkillService.open(path,{createdNew:true,scanner:async(_content,report)=>new Promise(resolve=>{finish=()=>resolve({...report,state:'completed',completedAt:new Date().toISOString()});})});
  const created=await service.create(actor,{clientActionId:randomUUID()});
  await service.saveDraft(actor,created.skill.skillId,{expectedDraftRevision:1,files:[...files,{path:'x.py',contentBase64:Buffer.from('print(1)').toString('base64')}]});
  const report=service.scans(actor,created.skill.skillId)[0];
  const write=vi.spyOn(service.db,'prepare');
  service.close();await rm(path,{recursive:true,force:true});write.mockClear();
  finish(report);
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

test('publication retry uses the original immutable blob after authority is lost between file and database commits',async()=>{
  const path=await root();const service=await SkillService.open(path,{createdNew:true,seats:()=>['business']});
  try{
    const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files});
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
    const input={expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'first',clientActionId:randomUUID()};
    let checks=0;
    const revoked:SkillActor={userId:actor.userId,assertAdministrator:()=>{if(++checks===2)throw Error('authority revoked after immutable file persisted');}};
    await expect(service.publish(revoked,id,input)).rejects.toThrow('revoked');
    expect(service.detail(id).publications).toEqual([]);
    await new Promise(resolve=>setTimeout(resolve,5));
    const publication=await service.publish(actor,id,input);
    const loaded=await service.resolve(publication,{userId:'user',seatId:'business',canCollaborate:true});
    expect(loaded.files[0].contentBase64).toBe(files[0].contentBase64);
    expect(await service.publish(actor,id,input)).toEqual(publication);
    expect(service.detail(id).publications).toHaveLength(1);
  }finally{service.close();await rm(path,{recursive:true,force:true});}
});

test('an account revoked during asynchronous package loading receives no package body',async()=>{
  const path=await root();let enabled=true,withdrawDuringRead=false;
  const service=await SkillService.open(path,{createdNew:true,seats:()=>['business'],authorizeUse:()=>{if(!enabled)throw Error('account disabled');if(withdrawDuringRead)queueMicrotask(()=>{enabled=false;});}});
  try{
    const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files});
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
    const publication=await service.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'first',clientActionId:randomUUID()});
    withdrawDuringRead=true;
    await expect(service.resolve(publication,{userId:'user',seatId:'business',canCollaborate:true})).rejects.toThrow('disabled');
  }finally{service.close();await rm(path,{recursive:true,force:true});}
});

test('malformed stored use policy and asset authority fields fail closed',async()=>{
  const path=await root();const service=await SkillService.open(path,{createdNew:true,seats:()=>['business']});
  try{
    const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files});
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
    const published=await service.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'first',clientActionId:randomUUID()});
    const principal={userId:'user',seatId:'business',canCollaborate:true};
    service.db.prepare('UPDATE r3_skill_policies SET data=? WHERE id=?').run(JSON.stringify({revision:1,mode:'invalid-policy',seatIds:[]}),id);
    expect(service.catalog(principal)).toEqual([]);
    await expect(service.resolve(published,principal)).rejects.toMatchObject({code:'SKILL_STATE_INVALID'});
    service.db.prepare('UPDATE r3_skill_policies SET data=? WHERE id=?').run(JSON.stringify({revision:1,mode:'none',seatIds:[]}),id);
    const row=service.db.prepare('SELECT data FROM r3_skill_assets WHERE id=?').get(id)!;
    const asset=JSON.parse(String(row.data));
    service.db.prepare('UPDATE r3_skill_assets SET data=? WHERE id=?').run(JSON.stringify({...asset,system:'true'}),id);
    await expect(service.resolve(published,principal)).rejects.toMatchObject({code:'SKILL_STATE_INVALID'});
  }finally{service.close();await rm(path,{recursive:true,force:true});}
});

test('published method metadata is available without loading resources and policy notifications follow the committed state',async()=>{
  const path=await root();let policyUpdates=0;
  const principal={userId:'user',seatId:'business',canCollaborate:true};
  const service=await SkillService.open(path,{createdNew:true,seats:()=>['business'],onPolicyChange:()=>{policyUpdates++;expect(service.detail(id).policy.revision).toBeGreaterThan(0);}});
  let id='';
  try{
    const created=await service.create(actor,{clientActionId:randomUUID()});id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files});
    const policyInput={expectedRevision:0,mode:'all' as const,seatIds:[],clientActionId:randomUUID()};
    await service.setPolicy(actor,id,policyInput);
    await service.setPolicy(actor,id,policyInput);
    expect(policyUpdates).toBe(1);
    const published=await service.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'first',clientActionId:randomUUID()});
    const methodHash=fileHash(Buffer.from(files[0].contentBase64,'base64'));
    expect(service.methodHash(published)).toBe(methodHash);
    // Unpublished/corrupt mutable drafts are not part of a formal request catalog.
    await service.create(actor,{clientActionId:randomUUID()});
    service.db.prepare('UPDATE r3_skill_drafts SET data=?').run(JSON.stringify({files:[{path:'../invalid',contentBase64:''}]}));
    expect(service.catalog(principal).map(item=>item.skillId)).toEqual([id]);
    await rm(join(path,'capabilities/skill-packages',published.revisionId));
    expect(service.methodHash(published)).toBe(methodHash);
    await expect(service.resolve(published,principal)).rejects.toThrow();
    await service.setPolicy(actor,id,{expectedRevision:1,mode:'none',seatIds:[],clientActionId:randomUUID()});
    expect(policyUpdates).toBe(2);expect(service.catalog(principal)).toEqual([]);
  }finally{service.close();await rm(path,{recursive:true,force:true});}
});

test('Semgrep tuple error types retain actual codes and package locations without serializing internal spans',async()=>{
  const path=await mkdtemp(join(tmpdir(),'axon-r3-review-scanner-'));
  try{
    const tool=join(path,'scanner');
    await writeFile(tool,`#!${process.execPath}\nconsole.log(JSON.stringify({version:'1.182.0',paths:{scanned:['x.py']},results:[],errors:[{type:['PartialParsing',[{path:'/private/host/source',start:{line:1}}]],code:3,path:'x.py'},{type:['LexicalError',[{path:'/private/secret'}]],code:4,path:'/private/secret'}]}));\n`,{mode:0o700});
    const parsed=packageContent([...files,{path:'x.py',contentBase64:Buffer.from('eval(\n"unterminated').toString('base64')}]);
    const rules=join(process.cwd(),'fixtures/skill-scanning/rules.yaml');
    const report:SkillScanReport={scanId:randomUUID(),skillId:'fixture',packageDigest:parsed.packageDigest,scanner:'Semgrep CE',scannerVersion:'1.182.0',rulesDigest:'',state:'pending',findings:[],targets:['x.py'],scanned:[],skipped:[],errors:[],createdAt:new Date().toISOString()};
    const result=await semgrepScanner({command:tool,rulesPath:rules,rulesDigest:fileHash(await readFile(rules)),version:'1.182.0'})(parsed.content,report);
    expect(result.state).toBe('partial');
    expect(result.errors).toEqual(['PartialParsing (3): x.py','LexicalError (4)']);
    expect(JSON.stringify(result)).not.toContain('/private/');
    expect(JSON.stringify(result)).not.toContain('[object Object]');
  }finally{await rm(path,{recursive:true,force:true});}
});
