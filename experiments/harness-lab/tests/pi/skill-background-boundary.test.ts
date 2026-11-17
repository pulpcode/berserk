import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { SkillService } from '../../src/skills/service.js';
import { packageMethod } from '../../src/resources/skill-package.js';
import { controlledSkillIds, loadControlledSkills } from '../../src/resources/service.js';
import { skillRevision } from '../../src/capabilities/service.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const done of cleanup.splice(0).reverse())await done();});
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'axon-r3-background-boundary-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const config=testConfig(root),fake=await fakeRuntime(config,()=>({text:'本轮已完成'})),lab=await PiLab.create(config,fake.runtime);cleanup.push(()=>lab.close());
  // Isolated synthetic management authority only; no production identity or credentials.
  lab.skills.close();lab.skills=await SkillService.open(root);
  const actor={userId:'synthetic-admin',assertAdministrator:()=>{}};
  const created=await lab.skills.create(actor,{clientActionId:randomUUID()}),id=created.skill.skillId;
  const content='---\nname: foreground-only-method\ndescription: R3组织技能不自动投放后台\n---\nORG-SKILL-FOREGROUND-BODY\n';
  const draft=await lab.skills.saveDraft(actor,id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from(content).toString('base64')}]});
  await lab.skills.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
  const publication=await lab.skills.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'仅前台范围',clientActionId:randomUUID()});
  const method=packageMethod(await lab.skills.resolve(publication,{userId:'seat:test-seat',seatId:'test-seat'}));
  return {lab,fake,method};
}
const background=()=>({background:true as const,jobId:randomUUID(),requestId:randomUUID()});

test('seat-analysis background uses only the legacy builtin catalog while foreground retains organization choices',async()=>{
  const {lab,fake,method}=await fixture();
  const foreground=await lab.createSession();await lab.start(foreground.id,'前台普通请求').run(()=>{});
  expect(JSON.stringify(fake.calls[0].context.tools)).toContain(method.id);
  expect(fake.calls[0].context.systemPrompt).toContain(method.id);
  const session=await lab.createSession();const work=lab.start(session.id,'后台普通请求',{},undefined,background());await work.run(()=>{});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');expect(fake.calls).toHaveLength(2);
  expect(JSON.stringify(fake.calls[1].context)).not.toContain(method.id);
  expect(JSON.stringify(fake.calls[1].context)).not.toContain('ORG-SKILL-FOREGROUND-BODY');
  const resources=lab.getRequestResources(session.id,work.requestId);
  expect(resources.status).toBe('available');
  if(resources.status==='available')expect(resources.skills.map(skill=>skill.id).sort()).toEqual([...controlledSkillIds].sort());
});

test('explicit organization skill input cannot start background model work',async()=>{
  const {lab,fake,method}=await fixture();const session=await lab.createSession();
  const selection={id:method.id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest};
  expect(()=>lab.start(session.id,'不能借显式选择投放后台',{skill:selection},undefined,background())).toThrowError(expect.objectContaining({code:'SKILL_BACKGROUND_UNSUPPORTED'}));
  expect(()=>lab.start(session.id,'旧形状也不能绕过后台边界',{skill:{id:method.id,hash:method.hash}},undefined,background())).toThrowError(expect.objectContaining({code:'SKILL_BACKGROUND_UNSUPPORTED'}));
  expect(fake.calls).toHaveLength(0);expect(lab.get(session.id).active).toBeNull();
});

test('a fixed organization expert dependency fails clearly in background instead of silently dropping its dependency',async()=>{
  const {lab,fake,method}=await fixture();
  const expert=await lab.capabilities.registerExpert({expertId:'fixed-organization-expert',releaseVersion:'1.0.0',name:'组织技能专家',description:'固定组织依赖',instructions:'使用固定方法',modes:['interactive'],selectable:true,system:false,allowedTools:['skill_read'],skills:[skillRevision(method)]});
  const session=await lab.createSession(undefined,undefined,undefined,undefined,undefined,{expertRef:expert,expectedDigest:expert.digest,clientActionId:randomUUID()});
  expect(()=>lab.start(session.id,'组织专家后台请求',{},undefined,background())).toThrowError(expect.objectContaining({code:'SKILL_BACKGROUND_UNSUPPORTED'}));
  expect(fake.calls).toHaveLength(0);expect(lab.get(session.id).expert?.revisionId).toBe(expert.revisionId);
  const resolve=vi.spyOn(lab.resources.dynamicSkills!,'resolve');
  await expect(lab.resources.snapshot(session.workspaceId,undefined,undefined,[method],undefined,false)).rejects.toMatchObject({code:'SKILL_BACKGROUND_UNSUPPORTED'});
  expect(resolve).not.toHaveBeenCalled();
});

test('legacy builtin explicit selection still works in background and does not invoke the dynamic provider',async()=>{
  const {lab,fake}=await fixture(),method=(await loadControlledSkills(['review']))[0];
  const catalog=vi.spyOn(lab.resources.dynamicSkills!,'catalog');
  const session=await lab.createSession();await lab.start(session.id,'沿用既有后台方法',{skill:{id:method.id,hash:method.hash}},undefined,background()).run(()=>{});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');expect(fake.calls).toHaveLength(1);
  expect(lab.get(session.id).messages.find(message=>message.role==='user')?.selections?.skill?.content).toBe(method.content);
  expect(JSON.stringify(fake.calls[0].context.messages)).toContain('所选 Skill 正文已经加载');
  expect(catalog).not.toHaveBeenCalled();
});
