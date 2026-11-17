import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { SkillService } from '../../src/skills/service.js';
import { skillRevision } from '../../src/capabilities/service.js';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { migrateAdministratorAccounts } from '../../src/access/administrator-schema.js';
import { SystemRoles } from '../../src/access/system-roles.js';
import { packageMethod } from '../../src/resources/skill-package.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const done of cleanup.splice(0).reverse())await done();});
async function setup(reply:Parameters<typeof fakeRuntime>[1],extension='') {
  const directory=await mkdtemp(join(tmpdir(),'axon-r3-cross-guard-'));
  cleanup.push(()=>rm(directory,{recursive:true,force:true}));
  const config=testConfig(directory),fake=await fakeRuntime(config,reply),lab=await PiLab.create(config,fake.runtime);
  cleanup.push(()=>lab.close());
  // Only this authless fixture bypasses management authentication; production APIs are covered separately.
  lab.skills.close();lab.skills=await SkillService.open(directory);
  const actor={userId:'isolated-admin',assertAdministrator:()=>{}};
  const item=await lab.skills.create(actor,{clientActionId:randomUUID()});
  const source=`---\nname: guarded-method\ndescription: Check a fixed input\n${extension}---\nR3-CROSS-REVIEW-METHOD-BODY\n`;
  const draft=await lab.skills.saveDraft(actor,item.skill.skillId,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from(source).toString('base64')}]});
  await lab.skills.setPolicy(actor,item.skill.skillId,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
  const published=await lab.skills.publish(actor,item.skill.skillId,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'Guard fixture',clientActionId:randomUUID()});
  const pkg=await lab.skills.resolve(published,{userId:'seat:test-seat',seatId:'test-seat'}),method=packageMethod(pkg);
  const selection={id:method.id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest};
  const session=await lab.createSession();
  return{lab,fake,actor,published,method,selection,session};
}

test('manual-only extensions suppress autonomous invocation while explicit user selection still delivers exact body',async()=>{
  const fixture=await setup(()=>({text:'Completed'}),'disable-model-invocation: true\n');
  await fixture.lab.start(fixture.session.id,'Ordinary request').run(()=>{});
  expect(fixture.fake.calls[0].context.systemPrompt).not.toContain(fixture.method.id);
  expect(JSON.stringify(fixture.fake.calls[0].context.tools)).not.toContain(fixture.method.id);
  expect(JSON.stringify(fixture.fake.calls[0].context)).not.toContain('R3-CROSS-REVIEW-METHOD-BODY');
  await fixture.lab.start(fixture.session.id,'Use my selected method',{skill:fixture.selection}).run(()=>{});
  expect(fixture.lab.get(fixture.session.id).lastResult?.status).toBe('succeeded');
  expect(JSON.stringify(fixture.fake.calls[1].context.messages)).toContain('R3-CROSS-REVIEW-METHOD-BODY');
});

test('on-demand package loading supplies exact method body and native read evidence only after the actual tool call',async()=>{
  let id='';
  const f=await setup((_context,index)=>index===0?{text:'Hello'}:index===1?{tools:[{name:'skill_read',arguments:{id}}]}:{text:'Method applied'});
  id=f.method.id;
  await f.lab.start(f.session.id,'Do not select a method yet').run(()=>{});
  expect(JSON.stringify(f.fake.calls[0].context)).not.toContain('R3-CROSS-REVIEW-METHOD-BODY');
  const work=f.lab.start(f.session.id,'Read the appropriate method');await work.run(()=>{});
  expect(f.lab.get(f.session.id).lastResult?.status).toBe('succeeded');
  expect(f.lab.getRequestResources(f.session.id,work.requestId)).toMatchObject({readSkills:[f.method]});
  expect(JSON.stringify(f.fake.calls[2].context.messages)).toContain('R3-CROSS-REVIEW-METHOD-BODY');
});

test.each(['ordinary-disable','policy-withdrawal'] as const)('loaded request handles %s using current authorization and original package',async change=>{
  const f=await setup(()=>({text:'Completed accepted request'}));
  const original=AgentSession.prototype.prompt;
  let release!:()=>void,prepared!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{prepared=resolve;});
  vi.spyOn(AgentSession.prototype,'prompt').mockImplementation(async function(this:AgentSession,...args){prepared();await gate;return original.apply(this,args);});
  const work=f.lab.start(f.session.id,'Already accepted request',{skill:f.selection}).run(()=>{});
  await Promise.race([ready,work.then(()=>{throw new Error('Request ended before model gate: '+JSON.stringify(f.lab.get(f.session.id).lastResult));})]);
  if(change==='ordinary-disable')await f.lab.skills.lifecycle(f.actor,f.method.id,{action:'disable',expectedStateRevision:0,clientActionId:randomUUID()});
  else await f.lab.skills.setPolicy(f.actor,f.method.id,{expectedRevision:1,mode:'none',seatIds:[],clientActionId:randomUUID()});
  release();await work;
  expect(f.lab.get(f.session.id).lastResult?.status).toBe(change==='ordinary-disable'?'succeeded':'failed');
  expect(f.fake.calls).toHaveLength(change==='ordinary-disable'?1:0);
  if(change==='ordinary-disable'){
    await f.lab.start(f.session.id,'New request cannot reuse disabled skill',{skill:f.selection}).run(()=>{});
    expect(f.lab.get(f.session.id).lastResult?.status).toBe('failed');expect(f.fake.calls).toHaveLength(1);
  }
});

test('a selected package reaches only the matching readonly child with the fixed body and no execution tools',async()=>{
  const f=await setup((_context,index)=>index===0?{tools:[{name:'subagent',arguments:{agent:'analyst',task:'Check the supplied method'}}]}:{text:'Readonly check complete'});
  const analyst=(await f.lab.agents(f.session.workspaceId)).find(item=>item.name==='analyst')!;
  await f.lab.start(f.session.id,'Delegate a readonly check',{skill:f.selection,agent:analyst}).run(()=>{});
  expect(f.lab.get(f.session.id).lastResult?.status).toBe('succeeded');
  expect(JSON.stringify(f.fake.calls[1].context.messages)).toContain('R3-CROSS-REVIEW-METHOD-BODY');
  expect(f.fake.calls[1].context.tools?.map(tool=>tool.name)).toEqual(['source_list','source_read','instructions_read']);
});

test('new skill publication cannot drift an existing expert dependency or override it with a different explicit revision',async()=>{
  let selectedId='';
  const f=await setup((_context,index)=>index===0?{tools:[{name:'skill_read',arguments:{id:selectedId}}]}:{text:'Used the fixed dependency'});
  selectedId=f.method.id;
  // Controlled registration creates a fixture binding; production expert publication retains its R2 workflow.
  const expert=await f.lab.capabilities.registerExpert({expertId:'guard-expert',name:'Fixed expert',description:'Fixture fixed package',instructions:'Use the fixed dependency',releaseVersion:'1.0.0',modes:['interactive'],selectable:true,system:false,allowedTools:['skill_read'],skills:[skillRevision(f.method)]});
  const bound=await f.lab.createSession(undefined,undefined,undefined,undefined,undefined,{expertRef:expert,expectedDigest:expert.digest,clientActionId:randomUUID()});
  const current=f.lab.skills.detail(f.method.id).draft!;
  const source='---\nname: guarded-method\ndescription: Check a fixed input\n---\nNEW-PACKAGE-MUST-NOT-DRIFT-OLD-EXPERT\n';
  const saved=await f.lab.skills.saveDraft(f.actor,f.method.id,{expectedDraftRevision:current.draftRevision,files:[{path:'SKILL.md',contentBase64:Buffer.from(source).toString('base64')}]});
  const next=await f.lab.skills.publish(f.actor,f.method.id,{expectedDraftRevision:saved.draftRevision,expectedCurrentRevisionId:f.published.revisionId,releaseNotes:'A new skill version',clientActionId:randomUUID()});
  await f.lab.start(bound.id,'Use the original fixed method').run(()=>{});
  expect(f.lab.get(bound.id).lastResult?.status).toBe('succeeded');
  expect(JSON.stringify(f.fake.calls[1].context)).toContain('R3-CROSS-REVIEW-METHOD-BODY');
  expect(JSON.stringify(f.fake.calls[1].context)).not.toContain('NEW-PACKAGE-MUST-NOT-DRIFT-OLD-EXPERT');
  const newMethod=packageMethod(await f.lab.skills.resolve(next,{userId:'seat:test-seat',seatId:'test-seat'}));
  await f.lab.start(bound.id,'Do not override the fixed method',{skill:{id:newMethod.id,hash:newMethod.hash,revisionId:newMethod.revisionId,packageDigest:newMethod.packageDigest}}).run(()=>{});
  expect(f.lab.get(bound.id).lastResult?.status).toBe('failed');expect(f.fake.calls).toHaveLength(2);
});

test('a genuine authenticated policy withdrawal cancels an already generating package request',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'axon-r3-current-policy-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
  const db=await openDatabase(directory),access=new AccessStore(db);
  await access.saveAccount({username:'business',displayName:'Business',seatId:'business',seatName:'Business',password:'test-password-123',createPublicTask:false,manageModelSettings:false});
  migrateAdministratorAccounts(db);
  const adminId=await access.saveAdministratorAccount({username:'admin',displayName:'Admin',password:'test-password-123'});db.close();
  const config=testConfig(directory,{auth:{secret:'test-only-policy-signing-key-at-least-32-characters',sessionMs:28800000}});
  const fake=await fakeRuntime(config,()=>({waitForAbort:true})),lab=await PiLab.create(config,fake.runtime);cleanup.push(()=>lab.close());
  const actor={userId:adminId,assertAdministrator:()=>new SystemRoles(lab.access!.db).requireAdministrator(adminId)};
  const created=await lab.skills.create(actor,{clientActionId:randomUUID()});
  const saved=await lab.skills.saveDraft(actor,created.skill.skillId,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: callback-method\ndescription: Verify current authorization\n---\nUse current input.').toString('base64')}]});
  await lab.skills.setPolicy(actor,created.skill.skillId,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
  const published=await lab.skills.publish(actor,created.skill.skillId,{expectedDraftRevision:saved.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'Callback test',clientActionId:randomUUID()});
  const business=lab.access!.identityForSeat('business')!;
  const task=lab.access!.create(business,{title:'Private callback test',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await lab.workspaces.ensureWorkspace(task.id,business.seatId,task.title);
  const session=await lab.createSession(workspace.id,business.seatId,undefined,undefined,undefined,{userId:business.userId});
  const method=packageMethod(await lab.skills.resolve(published,{userId:business.userId,seatId:business.seatId,canCollaborate:true}));
  const work=lab.start(session.id,'Wait while the current policy is withdrawn',{skill:{id:method.id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest}},business.seatId,undefined,business.userId).run(()=>{});
  await vi.waitFor(()=>expect(fake.calls).toHaveLength(1));
  await lab.skills.setPolicy(actor,method.id,{expectedRevision:1,mode:'none',seatIds:[],clientActionId:randomUUID()});await work;
  expect(fake.calls[0].aborted).toBe(true);expect(lab.get(session.id,business.seatId).lastResult?.status).toBe('failed');
});
