import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { PiLab } from '../../src/pi/lab.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';
import { COMPOSER_INPUT, COMPOSER_INPUT_V2, COMPOSER_INPUT_V3, COMPOSER_INPUT_V4, COMPOSER_INPUT_V5, composerInputText, recordedComposerText, decodeComposerInput } from '../../src/pi/composer-input.js';
import { AnnotationRequestState } from '../../src/pi/annotation-state.js';
import { annotationActionId, annotationTools } from '../../src/pi/annotation-tools.js';
import type { AnnotationRef, AnnotationSelection } from '../../src/contracts/annotations.js';
import { createApp } from '../../src/server/app.js';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import type { LabConfig } from '../../src/server/config.js';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of clean.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({text: '收到'}), overrides: Partial<LabConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axon-annotations-pi-')); clean.push(() => rm(dir, {recursive: true, force: true}));
  const config = testConfig(dir, {seatId: 'alpha', testSeats: [{id: 'alpha', name: '甲'}, {id: 'bravo', name: '乙'}], ...overrides});
  const fake = await fakeRuntime(config, reply); const lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
  const session = await lab.createSession(undefined, 'alpha'); const actor = lab.annotations!.actorForSeat('alpha');
  const taskId = lab.workspaces.get(session.workspaceId, 'alpha').taskSpaceId!;
  const draft = lab.annotations!.action(actor, session.id, {action: 'create_draft', clientActionId: randomUUID(), baseRef: null, title: '私有地图', operations: [
    {op: 'add_layer', layer: {layerId: 'meeting', name: '集合图层', order: 0, defaultVisible: true, features: [
      {objectId: 'a', kind: 'point', name: '集合点 A', note: '不应自动载入的业务备注', geometry: {type: 'Point', coordinates: [120,30]}},
      {objectId: 'b', kind: 'point', name: '集合点 B', geometry: {type: 'Point', coordinates: [121,31]}},
    ]}},
  ]});
  return {lab, config, session, actor, taskId, draft, ...fake};
}
async function ask(lab: PiLab, session: string, annotationRefs?: AnnotationSelection[]) {
  await lab.start(session, '请按当前问题处理', {annotationRefs}, 'alpha').run(() => {}); return lab.get(session, 'alpha');
}

describe('annotation input and native tools', () => {
  it('matches the adoption description to actual formal task permissions and schema', async () => {
    const dir=await mkdtemp(join(tmpdir(),'axon-annotation-description-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
    const db=await openDatabase(dir),access=new AccessStore(db);
    for(const seatId of ['manager','reader'])await access.saveAccount({username:seatId,displayName:seatId,seatId,seatName:seatId,password:'annotations-test-password',createPublicTask:seatId==='manager',manageModelSettings:false});
    const manager=access.identityForSeat('manager')!,reader=access.identityForSeat('reader')!;
    const task=access.create(manager,{clientActionId:randomUUID(),title:'公共任务',goal:'核对权限',visibility:'public'});db.close();
    const config=testConfig(dir,{seatId:'manager',auth:{secret:'annotation-description-test-secret-32',sessionMs:28800000}});
    const lab=await PiLab.create(config,(await fakeRuntime(config,()=>({text:'收到'}))).runtime);clean.push(()=>lab.close());
    for(const actor of [manager,reader]) {
      const workspace=await lab.workspaces.ensureWorkspace(task.id,actor.seatId,task.title),session=await lab.createSession(workspace.id,actor.seatId);
      const tools=annotationTools(lab.annotations!,{actor,taskId:task.id,sessionId:session.id,requestId:randomUUID(),signal:new AbortController().signal,check:()=>{}});
      const action=tools.find(tool=>tool.name==='annotation_action')!,allowed=actor===manager;
      expect(lab.annotations!.canSetCurrent(actor,task.id)).toBe(allowed);
      expect(JSON.stringify(action.parameters).includes('set_current')).toBe(allowed);
      expect(action.description.includes('当前席位可以 set_current')).toBe(allowed);
      expect(action.description.includes('当前席位不能设为任务当前')).toBe(!allowed);
      if(!allowed)expect(action.description).not.toContain('set_current');
    }
  });
  it('reopens a native v1/v2/v3/v4 conversation and appends new map requests as v5 without rewriting old input', async () => {
    const {lab,session,config,draft}=await setup();const skill=await lab.resources.readSkill(session.workspaceId,'review','alpha');
    for(let i=0;i<5;i++)await lab.start(session.id,'检查引用',{skill,annotationRefs:[draft.ref!]},'alpha').run(()=>{});
    const file=join(config.dataDir,'sessions',(await readdir(join(config.dataDir,'sessions')))[0]);await lab.close();
    const entries=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const inputs=entries.filter(entry=>entry.customType===COMPOSER_INPUT_V5);expect(inputs).toHaveLength(5);
    inputs[0].customType=COMPOSER_INPUT;delete inputs[0].details.annotationContext;delete inputs[0].details.annotationRefs;
    inputs[1].customType=COMPOSER_INPUT_V2;inputs[2].customType=COMPOSER_INPUT_V3;inputs[3].customType=COMPOSER_INPUT_V4;
    for(const entry of inputs.slice(0,4))entry.content=recordedComposerText(entry.details,entry.customType);
    const old=entries.map(entry=>JSON.stringify(entry)).join('\n')+'\n';await writeFile(file,old);
    const next=await PiLab.create(config,(await fakeRuntime(config,()=>({text:'继续'}))).runtime);clean.push(()=>next.close());
    expect(next.get(session.id,'alpha').recoveryWarning).toBeUndefined();expect(next.get(session.id,'alpha').messages.filter(m=>m.role==='user')).toHaveLength(5);
    await ask(next,session.id);expect(next.get(session.id,'alpha').lastResult?.status).toBe('succeeded');
    const after=await readFile(file,'utf8');expect(after.startsWith(old)).toBe(true);
    expect(after.trim().split('\n').map(line=>JSON.parse(line)).filter(entry=>entry.customType===COMPOSER_INPUT_V5)).toHaveLength(2);
  });
  it('preserves cancelled v5 preparation without executing it or replaying selections on continuation', async () => {
    const {lab,session,config,draft,calls}=await setup();const request=lab.start(session.id,'检查固定参考',{annotationRefs:[draft.ref!]},'alpha');
    const original=AgentSession.prototype.sendCustomMessage;
    const spy=vi.spyOn(AgentSession.prototype,'sendCustomMessage').mockImplementation(async function(this:AgentSession,message,options){await original.call(this,message,options);if(message.customType===COMPOSER_INPUT_V5)lab.cancel(session.id,request.requestId,'alpha');});
    await request.run(()=>{});spy.mockRestore();expect(calls).toHaveLength(0);expect(lab.get(session.id,'alpha').messages).toHaveLength(0);
    await lab.close();const fake=await fakeRuntime(config,()=>({text:'新请求'}));const next=await PiLab.create(config,fake.runtime);clean.push(()=>next.close());
    expect(next.get(session.id,'alpha').lastResult?.status).toBe('cancelled');
    const continued=await ask(next,session.id);expect(continued.lastResult?.status).toBe('succeeded');expect(fake.calls).toHaveLength(1);
    expect(continued.messages.find(m=>m.role==='user')?.selections?.annotationRefs).toBeUndefined();
  });
  it('uses provider-compatible object roots and homogeneous coordinate arrays while the service rejects invalid latitude', async () => {
    const {lab, session, actor, taskId} = await setup();
    const state = new AnnotationRequestState();
    state.observeDraft(lab.annotations!.binding(actor, session.id)); state.beginInference();
    const tools = annotationTools(lab.annotations!, {actor, taskId, sessionId: session.id, requestId: randomUUID(), signal: new AbortController().signal, check: () => {}, state});
    const inspect = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (!Array.isArray(node) && 'type' in node && node.type === 'array' && 'items' in node) expect(Array.isArray(node.items)).toBe(false);
      for (const child of Object.values(node)) inspect(child);
    };
    for (const tool of tools) {
      // DeepSeek rejected draft-07 tuple `items: [schema, schema]` with HTTP 400 in the live trial.
      const schema = JSON.parse(JSON.stringify(tool.parameters)); expect(schema.type).toBe('object'); inspect(schema);
    }
    const action = tools.find(tool => tool.name === 'annotation_action')!;
    await expect(action.execute('bad-latitude', {action: 'apply', operations: [{op: 'add_object', layerId: 'meeting',
      feature: {objectId: 'invalid', kind: 'point', name: '无效点', geometry: {type: 'Point', coordinates: [120,91]}}}]} as never, undefined, undefined, {} as never)).rejects.toThrow('坐标');
    expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(1);
  });
  it('captures only fixed draft identity and refreshes it next request, without auto-reading map contents', async () => {
    const {lab, session, actor, calls, draft} = await setup();
    const request = lab.start(session.id, '你好', {}, 'alpha');
    lab.annotations!.action(actor, session.id, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 1, operations: [{op: 'rename_set', title: '新标题'}]});
    await request.run(() => {});
    expect(lab.get(session.id, 'alpha').lastResult?.status).toBe('succeeded');
    const input = JSON.stringify(calls[0].context.messages);
    expect(input).toContain(JSON.stringify(draft.ref).replaceAll('"', '\\"'));
    expect(input).not.toContain('集合图层'); expect(input).not.toContain('业务备注'); expect(input).not.toContain('coordinates');
    expect(input).toContain('baseRef 是草稿的固定派生基线');
    expect(input).toContain('draft.revision 是本会话草稿修订');
    expect(input).toContain('writable 仅表示草稿可编辑，不代表任务采用权限');
    expect(input).toContain('未提供任务当前采用状态');
    expect(input).not.toContain('所选 Skill 正文已经加载');
    expect(lab.getRequestResources(session.id, request.requestId, 'alpha')).toMatchObject({readSkills: []});
    expect(lab.get(session.id, 'alpha').messages.some(message => message.role === 'tool')).toBe(false);
    const action = calls[0].context.tools!.find(tool => tool.name === 'annotation_action')!;
    const list = calls[0].context.tools!.find(tool => tool.name === 'annotation_list')!;
    expect(action.description).toContain('无需顺带总结任务当前');
    expect(action.description).toContain('本次实际成功采用回执');
    expect(action.description).toContain('旧动作回执及 replayed:true 都不能代替');
    expect(JSON.stringify(action.parameters)).toContain('该引用不证明此版本曾被或正在被任务采用');
    expect(list.description).toContain('current.publication:null 才表示读取时尚未设置');

    const snapshot = await ask(lab, session.id);
    expect(snapshot.messages.filter(message => message.role === 'user').at(-1)?.selections?.annotationContext?.draft?.revision).toBe(2);
  });

  it('keeps automatic context size constant when a saved map grows from 2 to 500 objects', async () => {
    const {lab, session, actor, calls} = await setup();
    const small = await ask(lab, session.id);
    lab.annotations!.action(actor, session.id, {action: 'apply', expectedRevision: 1, clientActionId: randomUUID(), operations: [{op: 'add_layer', layer: {
      layerId: 'large', name: '不应自动展开的图层', order: 1, defaultVisible: true, features: Array.from({length: 498}, (_, i) => ({objectId: `object-${i}`, kind: 'point', name: `对象${i}`, note: '业务资料'.repeat(10), geometry: {type: 'Point', coordinates: [120 + i / 1000, 30]}})),
    }}]});
    const large = await ask(lab, session.id);
    const first = small.messages.find(message => message.role === 'user')!.selections!;
    const second = large.messages.filter(message => message.role === 'user').at(-1)!.selections!;
    expect(Buffer.byteLength(recordedComposerText(first))).toBe(Buffer.byteLength(recordedComposerText(second)));
    expect(JSON.stringify(calls[1].context.messages)).not.toContain('不应自动展开的图层');
    expect(large.messages.some(message => message.role === 'tool')).toBe(false);
  });

  it('resolves explicit fixed selections as metadata, paged geometry is read only by the actual tool, and restart preserves versions', async () => {
    const selected: {ref?: AnnotationRef} = {};
    const {lab, session, actor, taskId, calls, config, draft} = await setup((_context, index): Reply => index === 0
      ? {tools: [{name: 'annotation_read', arguments: {mode: 'read', ref: selected.ref, objectIds: ['a'], fields: ['geometry'], limit: 1}}]} : {text: '已读取集合点 A'});
    const ref = draft.ref!; selected.ref = ref;
    const snapshot = await ask(lab, session.id, [{...ref, objectIds: ['a']}]);
    expect(snapshot.lastResult?.status).toBe('succeeded');
    const initial = JSON.stringify(calls[0].context.messages);
    expect(initial).toContain('集合点 A'); expect(initial).not.toContain('集合点 B'); expect(initial).not.toContain('coordinates'); expect(initial).not.toContain('业务备注');
    expect(JSON.stringify(calls[1].context.messages)).toContain('coordinates');
    expect(snapshot.messages.find(message => message.role === 'tool')?.text).not.toContain('业务备注');
    lab.annotations!.action(actor, session.id, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 1, operations: [{op: 'delete_object', objectId: 'a'}]});
    expect(lab.annotations!.read(actor, taskId, {ref, objectIds: ['a']}).objects.items).toHaveLength(1);
    const path = join(config.dataDir, 'sessions', (await readdir(join(config.dataDir, 'sessions')))[0]);
    expect(await readFile(path, 'utf8')).toContain(COMPOSER_INPUT_V5);
    await lab.close(); const reopened = await PiLab.create(config, (await fakeRuntime(config, () => ({text: '继续'}))).runtime); clean.push(() => reopened.close());
    expect(reopened.get(session.id, 'alpha').messages).toEqual(snapshot.messages);
    expect(reopened.get(session.id, 'alpha').recoveryWarning).toBeUndefined();
  });

  it('requires a current draft read and keeps own-session write target even with a reference to another draft', async () => {
    const {lab, session, actor, draft, taskId} = await setup((_context,index) => index === 0 ? {tools: [{name: 'annotation_action', arguments: {action: 'apply', operations: [{op: 'delete_object', objectId: 'a'}]}}]} : {text: '冲突已保留'});
    const other = await lab.createSession(session.workspaceId, 'alpha');
    const otherDraft = lab.annotations!.action(actor, other.id, {action: 'create_draft', clientActionId: randomUUID(), baseRef: draft.ref});
    const request = lab.start(session.id, '删除我草稿中的 A', {annotationRefs: [otherDraft.ref!]}, 'alpha');
    lab.annotations!.action(actor, session.id, {action: 'apply', clientActionId: randomUUID(), expectedRevision: 1, operations: [{op: 'rename_set', title: '人工修改'}]});
    await request.run(() => {});
    expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
    expect(lab.annotations!.version(actor, taskId, otherDraft.ref!).document.layers[0].features).toHaveLength(2);
    expect(lab.get(session.id, 'alpha').messages.find(message => message.role === 'tool')?.isError).toBe(true);
  });

  it('rereads the original fixed revision after native automatic compaction without rewriting selected history', async () => {
    let replies=0;
    const {lab,session,actor,draft,calls}=await setup(context=>{
      if(!context.tools?.length)return {text:`摘要：继续核对已引用固定版本 ${JSON.stringify(reference)} 中对象 a 的几何。`,usageInput:50};
      replies++;
      if(replies===1)return {text:'已记录参考，等待后续核对。'.repeat(500),usageInput:1800};
      if(replies===2)return {tools:[{name:'annotation_read',arguments:{mode:'read',ref:reference,objectIds:['a'],fields:['geometry']}}]};
      return {text:'已按原固定版本重新读取。'};
    },{contextWindow:8192,maxOutputTokens:6000,compactionReserveTokens:7000,compactionKeepRecentTokens:128});
    const reference=draft.ref!;
    const before=await ask(lab,session.id,[{...reference,objectIds:['a']}]);
    const originalSelection=before.messages.find(message=>message.role==='user')!.selections;
    lab.annotations!.action(actor,session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_object',objectId:'a',changes:{geometry:{type:'Point',coordinates:[130,40]}}}]});
    const after=await ask(lab,session.id);
    expect(after.lastResult?.status).toBe('succeeded');expect(after.latestCompaction).toBeDefined();
    expect(calls.some(call=>!call.context.tools?.length)).toBe(true);
    expect(after.messages.find(message=>message.role==='user')!.selections).toEqual(originalSelection);
    const result=JSON.parse(after.messages.find(message=>message.role==='tool' && message.toolName==='annotation_read')!.text).data;
    expect(result.ref).toEqual(reference);expect(result.objects.items[0].geometry.coordinates).toEqual([120,30]);
    expect(lab.annotations!.binding(actor,session.id).draft?.headRevision).toBe(2);
  });

  it('deduplicates native call actions, checks cancellation, and exposes no foreign session authority fields', async () => {
    const {lab, session, actor, taskId} = await setup(); const controller = new AbortController(); const requestId = randomUUID();
    const state = new AnnotationRequestState();
    state.observeDraft(lab.annotations!.binding(actor, session.id)); state.beginInference();
    const tools = annotationTools(lab.annotations!, {actor, taskId, sessionId: session.id, requestId, signal: controller.signal, check: () => {}, state});
    const action = tools.find(tool => tool.name === 'annotation_action')!;
    const params = {action: 'apply', operations: [{op: 'rename_set', title: '重试一次'}]};
    const first = await action.execute('retry-call', params as never, undefined, undefined, {} as never); const second = await action.execute('retry-call', params as never, undefined, undefined, {} as never);
    expect(JSON.parse((second.content[0] as {text: string}).text).data).toEqual({...JSON.parse((first.content[0] as {text: string}).text).data, replayed: true}); expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
    expect(lab.annotations!.receipt(actor, annotationActionId(requestId, 'retry-call'))?.ref).toBeDefined();
    const read = tools.find(tool => tool.name === 'annotation_read')!;
    const recovered = await read.execute('inspect-receipt', {mode: 'receipt', requestId, toolCallId: 'retry-call'} as never, undefined, undefined, {} as never);
    expect(recovered.content).toEqual(first.content);
    expect(recovered.details.annotationResult).toMatchObject({origin:'receipt_read',receipt:first.details.annotationResult!.receipt});
    expect(JSON.stringify(action.parameters)).not.toContain('sessionId');
    controller.abort(); await expect(action.execute('after-stop', params as never, undefined, undefined, {} as never)).rejects.toThrow();
    expect(lab.annotations!.binding(actor, session.id).draft?.headRevision).toBe(2);
  });

  it('keeps legacy custom input validation and rejects forged geometry in v2 descriptive selections', async () => {
    const {lab, session, actor, taskId, draft} = await setup(); const skill = await lab.resources.readSkill(session.workspaceId, 'review', 'alpha');
    const record = {workspaceId: session.workspaceId, sessionId: session.id, requestId: randomUUID(), skill};
    expect(decodeComposerInput(record, session.workspaceId, session.id, COMPOSER_INPUT).skill).toEqual(skill);
    expect(composerInputText({skill})).toContain('所选 Skill 正文已经加载');
    const annotationRefs = lab.annotations!.resolveSelections(actor, taskId, [{...draft.ref!, objectIds: ['a']}]);
    expect(() => decodeComposerInput({...record, annotationRefs}, session.workspaceId, session.id)).toThrow();
    expect(() => decodeComposerInput({...record, annotationRefs: [{...annotationRefs[0], geometry: {}}]}, session.workspaceId, session.id, COMPOSER_INPUT_V2)).toThrow();
  });

  it('does not expose another task receipt through a current-task annotation tool', async () => {
    const {lab, session, actor, taskId} = await setup();
    const otherTaskId=randomUUID();
    const workspace=await lab.workspaces.create('另一任务',otherTaskId,'alpha');
    const other=await lab.createSession(workspace.id,'alpha');
    const receipt=lab.annotations!.action(actor,other.id,{action:'create_draft',baseRef:null,clientActionId:randomUUID(),title:'另一任务私人草稿'});
    const tools=annotationTools(lab.annotations!,{actor,taskId,sessionId:session.id,requestId:randomUUID(),signal:new AbortController().signal,check:()=>{}});
    const read=tools.find(tool=>tool.name==='annotation_read')!;
    await expect(read.execute('cross-task-receipt',{mode:'receipt',clientActionId:receipt.clientActionId} as never,undefined,undefined,{} as never)).rejects.toThrow('ANNOTATION_NOT_FOUND');
    expect(lab.annotations!.receipt(actor,receipt.clientActionId)).toEqual(receipt);
  });

  it('accepts reference IDs via ordinary message API but keeps rich references out of the text queue', async () => {
    const {lab, session, draft} = await setup(); const app = await createApp(lab); clean.push(() => app.close());
    const response = await app.inject({method: 'POST', url: `/api/test-seats/alpha/sessions/${session.id}/messages`, payload: {text: '检查此点', annotationRefs: [{...draft.ref!, objectIds: ['a']}]}});
    expect(response.statusCode).toBe(200); expect(response.body).toContain('response.completed');
    const rejected = await app.inject({method: 'POST', url: `/api/test-seats/alpha/sessions/${session.id}/inputs`, payload: {submissionId: randomUUID(), expectedRequestId: randomUUID(), mode: 'followUp', text: '比较', annotationRefs: [draft.ref]}});
    expect(rejected.statusCode).toBe(400);
  });

  it('does not pass annotation writes or automatic draft context to delegated children', async () => {
    const {lab, session, calls} = await setup((_context, index) => index === 0
      ? {tools: [{name: 'subagent', arguments: {agent: 'reviewer', task: '检查表达方式'}}]} : {text: '检查完毕'});
    const snapshot = await ask(lab, session.id);
    expect(snapshot.lastResult?.status).toBe('succeeded'); expect(calls).toHaveLength(3);
    expect(calls[1].context.tools?.some(tool => tool.name.startsWith('annotation_'))).toBe(false);
    expect(JSON.stringify(calls[1].context.messages)).not.toContain('自动会话草稿上下文');
  });

  it('captures the real account and refuses a pending write after that account is replaced within the same seat', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'axon-annotations-actor-')); clean.push(() => rm(dir, {recursive: true, force: true}));
    const db = await openDatabase(dir); const access = new AccessStore(db);
    await access.saveAccount({username: 'original', displayName: '原人员', seatId: 'alpha', seatName: '甲席', password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
    const original = access.identityForSeat('alpha')!;
    const task = access.create(original, {title: '测试任务', goal: '验证账号撤权边界', visibility: 'public', clientActionId: randomUUID()}); db.close();
    const config = testConfig(dir, {seatId: 'alpha', auth: {secret: 'test-only-signing-key-at-least-32-characters', sessionMs: 28800000}});
    let replace: () => void = () => {};
    const fake = await fakeRuntime(config, (_context, index) => {
      if (index === 0) { replace(); return {tools: [{name: 'annotation_read', arguments: {mode: 'draft'}}]}; }
      return {text: '账号已失效'};
    });
    const lab = await PiLab.create(config, fake.runtime); clean.push(() => lab.close());
    const workspace = await lab.workspaces.ensureWorkspace(task.id, 'alpha', task.title); const session = await lab.createSession(workspace.id, 'alpha');
    lab.annotations!.action(original, session.id, {action: 'create_draft', baseRef: null, clientActionId: randomUUID(), title: '原稿'});
    // Provision an inactive replacement before admission; enabling it simulates offline replacement without substituting the captured actor.
    lab.access!.db.prepare("UPDATE accounts SET enabled=0 WHERE id=?").run(original.userId);
    await lab.access!.saveAccount({username: 'replacement', displayName: '接任人员', seatId: 'alpha', seatName: '甲席', password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
    const replacement = lab.access!.identityForSeat('alpha')!;
    lab.access!.db.prepare('UPDATE accounts SET enabled=0 WHERE id=?').run(replacement.userId);
    lab.access!.db.prepare('UPDATE accounts SET enabled=1 WHERE id=?').run(original.userId);
    replace = () => { lab.access!.disable('original'); lab.access!.db.prepare('UPDATE accounts SET enabled=1 WHERE id=?').run(replacement.userId); };
    await lab.start(session.id, '重命名当前草稿', {}, 'alpha', undefined, original.userId).run(() => {});
    expect(lab.annotations!.binding(replacement, session.id).draft?.headRevision).toBe(1);
    expect(lab.get(session.id, 'alpha').messages.find(message => message.role === 'tool')).toMatchObject({isError: true, text: expect.stringContaining('AUTH_REQUIRED')});
  });
});

it('returns actual selector-scoped counts and pages without pretending unread fields are empty',async()=>{
 const {lab,session,actor,taskId}=await setup();
 lab.annotations!.action(actor,session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'add_layer',layer:{layerId:'other',name:'其他图层',order:1,defaultVisible:true,features:[{objectId:'c',name:'其他对象',kind:'point',note:'真实备注',geometry:{type:'Point',coordinates:[122,32]}}]}}]});
 const tools=annotationTools(lab.annotations!,{actor,taskId,sessionId:session.id,requestId:randomUUID(),signal:new AbortController().signal,check:()=>{}}),read=tools.find(tool=>tool.name==='annotation_read')!;
 const cases=[
  {query:{layerIds:['meeting']},total:2,names:['a','b'],hasMore:false},
  {query:{layerNames:['集合图层']},total:2,names:['a','b'],hasMore:false},
  {query:{layerNames:['集合图层'],offset:1,limit:1},total:2,names:['b'],hasMore:false},
  {query:{layerNames:['集合图层'],objectIds:['b']},total:1,names:['b'],hasMore:false},
  {query:{layerIds:['meeting'],offset:1,limit:1},total:2,names:['b'],hasMore:false},
  {query:{objectIds:['a'],fields:['style']},total:1,names:['a'],hasMore:false},
  {query:{objectNames:['集合点 A','集合点 B'],offset:1,limit:1},total:2,names:['b'],hasMore:false},
  {query:{objectNames:['集合点 A','不存在']},total:1,names:['a'],hasMore:false},
  {query:{objectNames:['集合点 A'],layerIds:['other']},total:0,names:[],hasMore:false},
  {query:{objectNames:['集合点 B'],layerNames:['集合图层']},total:1,names:['b'],hasMore:false},
  {query:{fields:[],offset:0,limit:1},total:3,names:['a'],hasMore:true},
  {query:{offset:99},total:3,names:[],hasMore:false},
 ];
 for(const [index,item] of cases.entries()){
  const result=await read.execute(`scope-${index}`,{mode:'draft',...item.query} as never,undefined,undefined,{} as never),data=JSON.parse((result.content[0] as {text:string}).text).data;
  expect(data.objects).toMatchObject({total:item.total,hasMore:item.hasMore});
  expect(data.objects.items.map((object:{objectId:string})=>object.objectId)).toEqual(item.names);
  expect(data.query).toEqual(Object.fromEntries(Object.entries(item.query).filter(([key])=>!['offset','limit'].includes(key))));
  for(const object of data.objects.items){expect(object).not.toHaveProperty('note');expect(object).not.toHaveProperty('geometry');}
 }
 expect(lab.annotations!.binding(actor,session.id).draft?.headRevision).toBe(2);
 await expect(read.execute('unknown',{mode:'draft',objectIds:['missing']} as never,undefined,undefined,{} as never)).rejects.toThrow();
});

it('delivers named draft reads through the native schema and permits a later edit using the original host basis',async()=>{
 const {lab,session,actor,calls}=await setup((_context,index)=>index===0
  ? {tools:[{name:'annotation_read',arguments:{mode:'draft',layerNames:['集合图层'],objectIds:['a']}}]}
  : index===1 ? {tools:[{name:'annotation_action',arguments:{action:'apply',operations:[{op:'update_object',objectId:'a',changes:{note:'已核对'}}]}}]} : {text:'已修改'});
 const snapshot=await ask(lab,session.id),messages=snapshot.messages.filter(message=>message.role==='tool');
 expect(snapshot.lastResult?.status).toBe('succeeded');expect(messages.every(message=>!message.isError)).toBe(true);
 expect(JSON.parse(messages[0].text).data).toMatchObject({query:{layerNames:['集合图层'],objectIds:['a']},layers:[{layerId:'meeting'}],objects:{total:1}});
 expect(messages[0].annotationResult).toBeUndefined();expect(messages[1].annotationResult?.origin).toBe('write');
 expect(lab.annotations!.binding(actor,session.id).draft?.headRevision).toBe(2);
 const schema=JSON.parse(JSON.stringify(calls[0].context.tools!.find(tool=>tool.name==='annotation_read')!.parameters));
 for(const mode of ['draft','read']) {
  const branch=schema.anyOf.find((entry:{properties:{mode:{const:string}}})=>entry.properties.mode.const===mode);
  expect(branch.required).not.toContain('layerNames');expect(branch.properties.layerNames.items.maxLength).toBe(120);
  expect(branch.allOf).toEqual([{not:{required:['layerIds','layerNames']}},{not:{required:['objectIds','objectNames']}}]);
 }
});

it('uses fixed-version layer names and never establishes editing evidence from a fixed read or failed name match',async()=>{
 const selected:{ref?:AnnotationRef}={};
 const {lab,session,actor,draft}=await setup((_context,index)=>{
  if(index===0)return {tools:[{name:'annotation_read',arguments:{mode:'read',ref:selected.ref,layerNames:['集合图层']}}]};
  if(index===1)return {tools:[{name:'annotation_read',arguments:{mode:'draft',layerNames:['集合图层']}}]};
  if(index===2)return {tools:[{name:'annotation_action',arguments:{action:'apply',operations:[{op:'rename_set',title:'不应保存'}]}}]};
  return {text:'停止'};
 });selected.ref=draft.ref;
 lab.annotations!.action(actor,session.id,{action:'apply',clientActionId:randomUUID(),expectedRevision:1,operations:[{op:'update_layer',layerId:'meeting',changes:{name:'已改名'}}]});
 const snapshot=await ask(lab,session.id),messages=snapshot.messages.filter(message=>message.role==='tool');
 expect(messages[0].isError).not.toBe(true);expect(JSON.parse(messages[0].text).data).toMatchObject({ref:draft.ref,layers:[{name:'集合图层'}],query:{layerNames:['集合图层']}});
 expect(messages[1]).toMatchObject({isError:true,text:expect.stringContaining('ANNOTATION_LAYER_NAME_NOT_FOUND')});
 expect(messages[2]).toMatchObject({isError:true,text:expect.stringContaining('ANNOTATION_READ_REQUIRED')});
 expect(JSON.parse(messages[2].text).resources).toEqual([{kind:'draft',state:'missing'}]);
 expect(lab.annotations!.binding(actor,session.id).draft?.headRevision).toBe(2);
});

it('rejects simultaneous ID and name selectors through native validation even for an empty draft',async()=>{
 const {lab,session,calls}=await setup((_context,index)=>index===0
  ? {tools:[{name:'annotation_read',arguments:{mode:'draft',layerNames:['集合图层'],layerIds:['meeting']}}]} : {text:'修正筛选'});
 const empty=await lab.createSession(session.workspaceId,'alpha');
 const snapshot=await ask(lab,empty.id);
 expect(calls).toHaveLength(2);expect(snapshot.messages.find(message=>message.role==='tool')).toMatchObject({isError:true});
});

it('retains exact structured receipt entries through real native compaction and restart',async()=>{
 let replies=0;
 const {lab,session,config,calls}=await setup(context=>{
  if(!context.tools?.length)return {text:'摘要：已经发布固定版本，继续讨论。',usageInput:50};
  replies++;
  if(replies===1)return {tools:[{name:'annotation_action',arguments:{action:'publish',revision:1,title:'压缩前发布'}}]};
  if(replies===2)return {text:'发布已完成，等待后续讨论。'.repeat(500),usageInput:1800};
  return {text:'继续讨论，不修改。'};
 },{contextWindow:8192,maxOutputTokens:6000,compactionReserveTokens:7000,compactionKeepRecentTokens:128});
 const before=await ask(lab,session.id),receipt=before.messages.find(message=>message.toolName==='annotation_action')!;
 expect(receipt.annotationResult?.origin).toBe('write');
 const after=await ask(lab,session.id);expect(after.latestCompaction).toBeDefined();expect(calls.some(call=>!call.context.tools?.length)).toBe(true);
 expect(after.messages.find(message=>message.toolName==='annotation_action')).toEqual(receipt);
 await lab.close();const reopened=await PiLab.create(config,(await fakeRuntime(config,()=>({text:'继续'}))).runtime);clean.push(()=>reopened.close());
 expect(reopened.get(session.id,'alpha').messages.find(message=>message.toolName==='annotation_action')).toEqual(receipt);
});

it('delivers exact object-name results in the native loop, keeps fixed reads readonly, and reopens old/new reads unchanged',async()=>{
 const selected:{ref?:AnnotationRef}={};
 const {lab,session,actor,config,taskId}=await setup((_context,index)=>{
  if(index===0)return {tools:[{name:'annotation_read',arguments:{mode:'read',ref:selected.ref,objectIds:['a']}}]};
  if(index===1)return {tools:[{name:'annotation_read',arguments:{mode:'read',ref:selected.ref,objectNames:['集合点 A','未命中'],fields:['geometry']}}]};
  if(index===2)return {tools:[{name:'annotation_action',arguments:{action:'apply',operations:[{op:'rename_set',title:'不应保存'}]}}]};
  if(index===3)return {tools:[{name:'annotation_read',arguments:{mode:'draft',objectNames:['集合点 A'],layerNames:['集合图层']}}]};
  if(index===4)return {tools:[{name:'annotation_action',arguments:{action:'apply',operations:[{op:'update_object',objectId:'a',changes:{note:'名称查询后编辑'}}]}}]};
  return {text:'完成'};
 });selected.ref=lab.annotations!.binding(actor,session.id).draft ? {setId:lab.annotations!.binding(actor,session.id).draft!.setId,revision:1} : undefined;
 const snapshot=await ask(lab,session.id),messages=snapshot.messages.filter(message=>message.role==='tool');
 expect(JSON.parse(messages[1].text).data).toMatchObject({ref:selected.ref,query:{objectNames:['集合点 A','未命中'],fields:['geometry']},objects:{total:1,items:[{objectId:'a',name:'集合点 A',geometry:{type:'Point',coordinates:[120,30]}}]}});
 expect(messages[2]).toMatchObject({isError:true,text:expect.stringContaining('ANNOTATION_READ_REQUIRED')});
 expect(JSON.parse(messages[2].text)).toMatchObject({code:'ANNOTATION_READ_REQUIRED',outcome:'not_committed',resources:[{kind:'draft',state:'missing'}],methodAdvice:{skillId:'map-annotations'}});
 expect(JSON.parse(messages[3].text).data.query).toEqual({objectNames:['集合点 A'],layerNames:['集合图层']});
 expect(messages[4].annotationResult?.origin).toBe('write');
 const head=lab.annotations!.binding(actor,session.id).draft!;
 expect(head.headRevision).toBe(2);expect(lab.annotations!.version(actor,taskId,{setId:head.setId,revision:2}).document.layers[0].features[0].note).toBe('名称查询后编辑');
 const file=join(config.dataDir,'sessions',(await readdir(join(config.dataDir,'sessions')))[0]),before=await readFile(file,'utf8');
 await lab.close();const reopened=await PiLab.create(config,(await fakeRuntime(config,()=>({text:'继续'}))).runtime);clean.push(()=>reopened.close());
 expect(reopened.get(session.id,'alpha').recoveryWarning).toBeUndefined();expect(reopened.get(session.id,'alpha').messages).toEqual(snapshot.messages);
 expect(await readFile(file,'utf8')).toBe(before);
});

it.each([
 {objectNames:['集合点 A'],objectIds:['a']},
 {objectNames:[]},
 {objectNames:[' ']},
 {objectNames:['x','x']},
])('rejects malformed object-name selectors through native schema even without a draft: %j',async selectors=>{
 const {lab,session,calls}=await setup((_context,index)=>index===0 ? {tools:[{name:'annotation_read',arguments:{mode:'draft',...selectors}}]} : {text:'修正查询'});
 const empty=await lab.createSession(session.workspaceId,'alpha'),snapshot=await ask(lab,empty.id);
 expect(calls).toHaveLength(2);expect(snapshot.messages.find(message=>message.role==='tool')).toMatchObject({isError:true});
});
