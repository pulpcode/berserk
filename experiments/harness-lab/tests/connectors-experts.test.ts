import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CapabilityService, expertRevision } from '../src/capabilities/service.js';
import { CapabilityManagement } from '../src/capabilities/management.js';
import { loadControlledSkills } from '../src/resources/service.js';
import { SkillService } from '../src/skills/service.js';
import { AuthoringService } from '../src/authoring/service.js';
import { validAuthoringConfirmation } from '../src/pi/authoring-history.js';

const cleanup: Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const refs=[{connectorId:'10000000-0000-4000-a000-000000000001',actions:[{name:'lookup',contractDigest:'a'.repeat(64)}]}];
const content={name:'外部资料专家',description:'核对明确服务资料',instructions:'保留来源及未知项。',skillIds:[],allowedTools:['ask_user'],connectorRequirements:refs};
async function setup(){
  const dir=await mkdtemp(join(tmpdir(),'axon-r4-expert-'));
  const cap=await CapabilityService.open(dir);const controlled=await loadControlledSkills(['synthesis','review']);await cap.registerBuiltins({skills:controlled,roles:[]});
  let current=true;
  const management=await CapabilityManagement.open(cap,{skills:()=>[],tools:()=>[{id:'ask_user',name:'询问用户',group:'read'}],seats:()=>[{id:'seat-a',name:'席位A'}],assertConnectorRequirements:value=>{if(!current||JSON.stringify(value)!==JSON.stringify(refs))throw Error('changed');}});
  const skills=await SkillService.open(dir,{createdNew:true});
  cleanup.push(async()=>{await skills.close();cap.close();await rm(dir,{recursive:true,force:true});});
  return{dir,cap,management,skills,actor:{userId:'admin'},change:()=>{current=false;}};
}
test('new immutable expert contracts publish/copy/restore while old general bytes and optional trial remain unchanged',async()=>{
  const env=await setup(),old=await env.cap.current('axon-general');
  const oldPath=join(env.cap.directory,'blobs',old.digest);
  // Native blob layout belongs to CapabilityService; resolve again verifies original digest and content.
  const oldBytes=await readFile(oldPath);
  const created=await env.management.create(env.actor,{clientActionId:randomUUID()});
  const id=created.expert.expertId;
  const saved=await env.management.save(env.actor,id,{expectedDraftRevision:1,content});
  expect(saved.content).toMatchObject({schemaVersion:2,connectorRequirements:refs});
  const validation=await env.management.validate(env.actor,id,{expectedDraftRevision:saved.draftRevision});
  expect(validation.valid).toBe(true);
  env.management.setPolicy(env.actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
  const publication=await env.management.publish(env.actor,id,{clientActionId:randomUUID(),expectedDraftRevision:saved.draftRevision,expectedCurrentRevisionId:null,validationId:validation.validationId,releaseNotes:'增加明确连接动作',acceptedRiskCodes:validation.issues.filter(issue=>issue.severity==='warning').map(issue=>issue.code)});
  expect(publication.trialId).toBeUndefined();
  const revision=await env.cap.current(id);expect(revision).toMatchObject({schemaVersion:2,connectorRequirements:refs});
  const copy=await env.management.create(env.actor,{clientActionId:randomUUID(),copyFrom:{expertId:id,revisionId:revision.revisionId}});
  expect(copy.draft?.content.connectorRequirements).toEqual(refs);
  await env.management.restore(env.actor,id,{revisionId:revision.revisionId,expectedDraftRevision:saved.draftRevision,clientActionId:randomUUID()});
  expect((await env.management.get(id)).draft?.content.connectorRequirements).toEqual(refs);
  expect(await env.cap.resolve(old,old.digest)).toEqual(old);
  expect(await readFile(oldPath)).toEqual(oldBytes);
  env.change();
  const next=await env.management.validate(env.actor,id,{expectedDraftRevision:saved.draftRevision+1});
  expect(next.valid).toBe(false);
});
test('R3A proposes and preserves real connector refs under a new strict proposal version',async()=>{
  const env=await setup(),service=new AuthoringService(env.management,env.skills);
  const context={actor:{userId:'admin',assertAdministrator:()=>{}},sessionId:randomUUID(),requestId:randomUUID(),assertActive:()=>{}};
  const proposal=await service.propose(context,{kind:'expert',content,summary:'创建明确动作专家'});
  expect(proposal.schemaVersion).toBe(2);
  expect(validAuthoringConfirmation({proposal},context.sessionId,context.requestId,2)).toBe(true);
  expect(validAuthoringConfirmation({proposal},context.sessionId,context.requestId)).toBe(false);
  const receipt=await service.commit(context,proposal.proposalId,{interactionId:randomUUID(),toolCallId:'save'});
  const read=await service.read(context,{kind:'expert',targetId:receipt.targetId});
  const patch=await service.propose(context,{kind:'expert',targetId:receipt.targetId,baseline:read.baseline,content:{description:'仅修改介绍'},summary:'保留动作引用'});
  expect(patch.candidate.kind==='expert'&&patch.candidate.content.connectorRequirements).toEqual(refs);
  const altered=structuredClone(patch);if(altered.candidate.kind==='expert')altered.candidate.content.connectorRequirements![0].actions[0].contractDigest='b'.repeat(64);
  expect(validAuthoringConfirmation({proposal:altered},context.sessionId,context.requestId,2)).toBe(false);
  env.change();await expect(service.commit(context,patch.proposalId,{interactionId:randomUUID(),toolCallId:'save-2'})).rejects.toThrow('changed');
});
test('old definitions remain v1; malformed/duplicate connector action references fail closed',()=>{
  const definition={expertId:'expert-v1',releaseVersion:'1',name:'旧专家',description:'旧行为',instructions:'',modes:['interactive' as const],selectable:true,system:false,allowedTools:null,skills:[]};
  expect(expertRevision(definition).schemaVersion).toBe(1);
  expect(()=>expertRevision({...definition,connectorRequirements:[...refs,...refs]})).toThrow();
  expect(()=>expertRevision({...definition,connectorRequirements:[{...refs[0],actions:[refs[0].actions[0],refs[0].actions[0]]}]})).toThrow();
});
