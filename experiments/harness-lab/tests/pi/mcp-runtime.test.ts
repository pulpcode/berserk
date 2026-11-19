import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessStore } from '../../src/access/store.js';
import { openDatabase } from '../../src/access/database.js';
import { ConnectorService } from '../../src/connectors/service.js';
import type { ConnectorActor, ConnectorConfigInput, ConnectorPrincipal } from '../../src/contracts/connectors.js';
import type { ConfirmationInteraction } from '../../src/contracts/interactions.js';
import { PiLab } from '../../src/pi/lab.js';
import { RequestMcpTools } from '../../src/pi/mcp-tools.js';
import { MCP_ADMISSION, MCP_POLICY, MCP_REQUESTED, MCP_RESOLVED, mcpToolName } from '../../src/pi/mcp-history.js';
import { interactionHistory } from '../../src/pi/interactions.js';
import { startControlledMcp, type ControlledMcpOptions } from '../../scripts/mcp-controlled-fixture.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of clean.splice(0).reverse()) await close(); });
const admin: ConnectorActor = {userId: 'controlled-administrator', assertActive() {}, assertAdministrator() {}};
async function seed(service: ConnectorService, options: ControlledMcpOptions = {}, personal = false) {
  const endpoint = await startControlledMcp(options); clean.push(() => endpoint.close());
  const config: ConnectorConfigInput = {name: options.label ?? 'Controlled service', description: 'Controlled fixture', endpoint: endpoint.url,
    auth: {mode: personal ? 'bearer' : 'none', credentialSource: personal ? 'personal' : 'organization'}, approvedTargets: [...endpoint.networkPolicy.approvedTargets],
    policy: {mode: 'none', seatIds: [], personal: false}, exposedTools: []};
  let detail = await service.create(admin, {...config, clientActionId: randomUUID()}); const id = detail.connection.connectorId;
  if (personal) await service.setCredential(admin, id, {value: 'admin-fixture-token', expectedVersion: 0, clientActionId: randomUUID()}, true);
  const catalog = await service.discover(admin, id, {expectedRevisionId: detail.revision.revisionId, clientActionId: randomUUID()});
  detail = await service.update(admin, id, {...config, policy: {mode: 'all', seatIds: [], personal: true}, exposedTools: catalog.tools.filter(tool => tool.available).map(tool => ({name: tool.name, contractDigest: tool.contractDigest})), expectedRevisionId: detail.revision.revisionId, clientActionId: randomUUID()});
  await service.lifecycle(admin, id, {action: 'restore', expectedStateRevision: 0, clientActionId: randomUUID()});
  return {id, endpoint, detail};
}
async function setup(reply: Parameters<typeof fakeRuntime>[1], options: {publicTask?: boolean; roles?: boolean; trial?: boolean} = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'axon-r4-pi-')); clean.push(() => rm(parent, {recursive: true, force: true}));
  const dataDir = join(parent, 'data'), keyFile = join(parent, 'key.json');
  await writeFile(keyFile, JSON.stringify({activeKeyId: 'test', keys: {test: randomBytes(32).toString('base64')}}), {mode: 0o600});
  const db = await openDatabase(dataDir), access = new AccessStore(db);
  await access.saveAccount({username: 'mcp-user', displayName: 'MCP user', seatId: 'mcp-seat', seatName: 'MCP seat', password: 'fixture-password-123', createPublicTask: true, manageModelSettings: false}); db.close();
  const roles = join(parent, 'roles');
  if (options.roles) { await mkdir(roles); await writeFile(join(roles, 'reviewer.md'), '---\nname: reviewer\ndescription: Controlled reviewer\ntools: source_list, source_read\n---\nReview only.\n'); }
  const config = testConfig(dataDir, {seatId: 'mcp-seat', auth: {secret: 'mcp-test-signing-secret-at-least-32-characters', sessionMs: 28800000}, ...(options.roles ? {agentRolesDir: roles} : {})});
  const fake = await fakeRuntime(config, reply); const lab = await PiLab.create(config, fake.runtime, undefined, {executionMode: options.trial ? 'trial' : undefined}); clean.push(() => lab.close());
  const service = await ConnectorService.open(dataDir, {createdNew: true, keyFile}); lab.connectors = service;
  const identity = lab.access!.identityForSeat('mcp-seat')!;
  const task = lab.access!.create(identity, {title: 'MCP isolated workspace', goal: options.publicTask ? 'Verify isolated public task credentials' : '', visibility: options.publicTask ? 'public' : 'private', clientActionId: randomUUID()});
  const workspace = await lab.workspaces.ensureWorkspace(task.id, identity.seatId, task.title);
  const session = await lab.createSession(workspace.id, identity.seatId, undefined, undefined, undefined, {userId: identity.userId});
  return {parent, dataDir, keyFile, lab, service, fake, config, identity, session};
}
async function native(state: Awaited<ReturnType<typeof setup>>) {
  const dir = join(state.dataDir, 'sessions'); const name = (await readdir(dir)).find(name => name.endsWith(`_${state.session.id}.jsonl`))!;
  return SessionManager.open(join(dir, name), dir).getBranch();
}
const plan = (count = 1) => (context: Parameters<Parameters<typeof fakeRuntime>[1]>[0], index: number): Reply => index === 0
  ? {tools: (context.tools ?? []).filter(tool => tool.name.startsWith('mcp_')).slice(0, count).map(tool => ({name: tool.name, arguments: {query: 'approved-query'}}))}
  : {text: 'Controlled result received'};
async function pending(state: Awaited<ReturnType<typeof setup>>) {
  await vi.waitFor(() => expect(state.lab.get(state.session.id).interactions?.some(item => item.status === 'pending')).toBe(true));
  return state.lab.get(state.session.id).interactions!.find(item => item.status === 'pending')!;
}
function respond(state: Awaited<ReturnType<typeof setup>>, item: {requestId: string; interactionId: string}, decision: 'approve' | 'reject') {
  return state.lab.respondInteraction(state.session.id, item.interactionId, {requestId: item.requestId, kind: 'confirmation', decision}, state.identity.seatId);
}

describe('MCP through original native Pi request/confirmation/history', () => {
  it('keeps two same-family/same-name endpoints distinct, approves each operation and reopens without HTTP replay', async () => {
    const state = await setup(plan(2)); const a = await seed(state.service, {label: 'Alpha'}), b = await seed(state.service, {label: 'Beta'});
    const run = state.lab.start(state.session.id, 'Read both explicitly selected sources', {connectorIds: [a.id, b.id]}, state.identity.seatId, undefined, state.identity.userId);
    const done = run.run(() => {}); const first = await pending(state);
    expect(a.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0); expect(b.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    respond(state, first, 'approve'); const second = await pending(state); expect(second.interactionId).not.toBe(first.interactionId); respond(state, second, 'approve'); await done;
    const snapshot = state.lab.get(state.session.id); expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.interactions?.filter(item => item.kind === 'confirmation').map(item => item.execution)).toEqual(['succeeded', 'succeeded']);
    expect(a.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1); expect(b.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1);
    const tools = state.fake.calls[0].context.tools!.filter(tool => tool.name.startsWith('mcp_')); expect(new Set(tools.map(tool => tool.name)).size).toBe(2);
    expect(JSON.stringify(state.fake.calls[1].context.messages)).toContain('Alpha'); expect(JSON.stringify(state.fake.calls[1].context.messages)).toContain('Beta');
    const entries = await native(state); expect(entries.filter(entry => entry.type === 'custom' && entry.customType === MCP_ADMISSION)).toHaveLength(1);
    expect(entries.filter(entry => entry.type === 'custom' && entry.customType === MCP_REQUESTED)).toHaveLength(2); expect(entries.filter(entry => entry.type === 'custom' && entry.customType === MCP_RESOLVED)).toHaveLength(2);
    const before = a.endpoint.records.length + b.endpoint.records.length; await state.lab.close(); const restored = await PiLab.create(state.config, state.fake.runtime); clean.push(() => restored.close());
    expect(restored.get(state.session.id).interactions?.map(item => item.status)).toEqual(['approved', 'approved']); expect(restored.get(state.session.id).recoveryWarning).toBeUndefined();
    expect(a.endpoint.records.length + b.endpoint.records.length).toBe(before);
  });
  it.each(['reject', 'cancel'] as const)('sends no business POST when confirmation is %s', async decision => {
    const state = await setup(plan()); const {id, endpoint} = await seed(state.service);
    const run = state.lab.start(state.session.id, 'Read selected source', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {}); const item = await pending(state);
    if (decision === 'reject') respond(state, item, 'reject'); else state.lab.cancel(state.session.id, run.requestId, state.identity.seatId);
    await done; expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    expect(state.lab.get(state.session.id).interactions?.[0].status).toBe(decision === 'reject' ? 'rejected' : 'cancelled');
  });
  it('retains sent-but-unverified outcome and refuses automatic write replay after restart', async () => {
    const state = await setup(plan()); const {id, endpoint} = await seed(state.service, {dropCallReply: true});
    const run = state.lab.start(state.session.id, 'Read source', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {}); respond(state, await pending(state), 'approve'); await done;
    expect(state.lab.get(state.session.id).interactions?.[0]).toMatchObject({status: 'approved', execution: 'unknown'});
    expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1);
    await state.lab.close(); const restored = await PiLab.create(state.config, state.fake.runtime); clean.push(() => restored.close());
    expect(restored.get(state.session.id).interactions?.[0]).toMatchObject({execution: 'unknown'}); expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1);
  });
  it('confirms final Pi-coerced arguments and retains readable native history', async () => {
    const state = await setup((context, index) => index === 0 ? {tools: [{name: context.tools!.find(tool => tool.name.startsWith('mcp_'))!.name, arguments: {query: 123}}]} : {text: 'done'});
    const {id, endpoint} = await seed(state.service); const run = state.lab.start(state.session.id, 'Read source', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {});
    const item = await pending(state); expect(item.kind === 'confirmation' && item.action.parameters).toEqual({query: '123'}); respond(state, item, 'approve'); await done;
    expect(endpoint.records.find(item => item.method === 'tools/call')?.params?.arguments).toEqual({query: '123'});
    expect(state.lab.get(state.session.id).lastResult?.status).toBe('succeeded');
    expect(interactionHistory(await native(state), state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toHaveLength(1);
  });
  it('confirms original-hook transformed arguments and preserves final parameters in native evidence', async () => {
    const state = await setup(plan()); const {id, endpoint} = await seed(state.service);
    const prompt = AgentSession.prototype.prompt;
    vi.spyOn(AgentSession.prototype, 'prompt').mockImplementation(async function (this: AgentSession, ...args) {
      const before = this.agent.beforeToolCall;
      this.agent.beforeToolCall = async (context, signal) => {
        if (context.toolCall.name.startsWith('mcp_')) (context.args as Record<string, unknown>).query = 'final-transformed';
        return before?.(context, signal);
      };
      return prompt.apply(this, args);
    });
    const run = state.lab.start(state.session.id, 'Read source', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {});
    const item = await pending(state); expect(item.kind === 'confirmation' && item.action.parameters).toEqual({query: 'final-transformed'}); respond(state, item, 'approve'); await done;
    expect(endpoint.records.find(item => item.method === 'tools/call')?.params?.arguments).toEqual({query: 'final-transformed'});
    expect(state.lab.get(state.session.id).lastResult?.status).toBe('succeeded');
    expect(interactionHistory(await native(state), state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toHaveLength(1);
  });
  it('uses only the current account personal credential inside an authorized public task', async () => {
    const state = await setup(plan(), {publicTask: true}); const identities = {'Bearer admin-fixture-token': 'administrator', 'Bearer actual-user-token': 'current-user'};
    const {id, endpoint} = await seed(state.service, {identities}, true);
    const principal: ConnectorPrincipal = {userId: state.identity.userId, seatId: state.identity.seatId, workspaceKind: 'task', assertActive() {}};
    await state.service.setCredential(principal, id, {value: 'actual-user-token', expectedVersion: 0, clientActionId: randomUUID()});
    const run = state.lab.start(state.session.id, 'Read with my credential', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {}); respond(state, await pending(state), 'approve'); await done;
    expect(endpoint.records.find(item => item.method === 'tools/call')?.authorization).toBe('Bearer actual-user-token');
    expect(JSON.stringify(state.fake.calls)).not.toContain('actual-user-token'); expect(JSON.stringify(await native(state))).not.toContain('actual-user-token');
    expect(state.lab.get(state.session.id).interactions?.[0]).toMatchObject({action: {mcp: {subjectId: `user:${state.identity.userId}`}}});
  });
  it('discovers a unique uncached personal connection only under the current identity',async()=>{
    const state=await setup(plan());const {id,endpoint}=await seed(state.service,{identities:{'Bearer admin-fixture-token':'administrator','Bearer first-user-token':'current-user'}},true);
    const principal:ConnectorPrincipal={userId:state.identity.userId,seatId:state.identity.seatId,workspaceKind:'personal',assertActive(){}};
    await state.service.setCredential(principal,id,{value:'first-user-token',expectedVersion:0,clientActionId:randomUUID()});
    expect(state.service.catalog(principal)[0].tools).toEqual([]);const before=endpoint.records.length;
    const run=state.lab.start(state.session.id,'Read the unique authorized service',{},state.identity.seatId,undefined,state.identity.userId);const done=run.run(()=>{});
    const confirmation=await pending(state);expect(confirmation).toMatchObject({kind:'confirmation',action:{mcp:{connectorId:id,subjectId:`user:${state.identity.userId}`}}});
    expect(endpoint.records.slice(before).every(record=>record.authorization==='Bearer first-user-token')).toBe(true);
    expect(endpoint.records.filter(record=>record.method==='tools/call')).toHaveLength(0);
    respond(state,confirmation,'approve');await done;
    expect(endpoint.records.find(record=>record.method==='tools/call')?.authorization).toBe('Bearer first-user-token');
    expect(state.lab.get(state.session.id).lastResult?.status).toBe('succeeded');
  });
  it.each(['general','expert'] as const)('%s does not silently prefer a cached connection over an uncached authorized candidate',async mode=>{
    const state=await setup(plan());const cached=await seed(state.service,{label:'Cached service'}),uncached=await seed(state.service,{label:'Personal service'},true);
    const principal:ConnectorPrincipal={userId:state.identity.userId,seatId:state.identity.seatId,workspaceKind:'personal',assertActive(){}};
    await state.service.setCredential(principal,uncached.id,{value:'current-user-only',expectedVersion:0,clientActionId:randomUUID()});
    if(mode==='expert') {
      const expert=await state.lab.capabilities.registerExpert({expertId:'controlled-uncached-expert',releaseVersion:'1',name:'Controlled expert',description:'Choose before discovery',instructions:'Ask for a target.',modes:['interactive'],selectable:true,system:true,allowedTools:['ask_user'],skills:[],connectorRequirements:[cached,uncached].map(item=>({connectorId:item.id,actions:item.detail.revision.exposedTools}))});
      state.session=await state.lab.createSession(state.session.workspaceId,state.identity.seatId,undefined,undefined,undefined,{userId:state.identity.userId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest,clientActionId:randomUUID()});
    }
    const before=[cached.endpoint.httpRecords.length,uncached.endpoint.httpRecords.length];
    await state.lab.start(state.session.id,'Read the appropriate service',{},state.identity.seatId,undefined,state.identity.userId).run(()=>{});
    expect(state.fake.calls).toHaveLength(0);expect([cached.endpoint.httpRecords.length,uncached.endpoint.httpRecords.length]).toEqual(before);
    expect(state.lab.get(state.session.id).lastResult).toMatchObject({status:'failed',message:expect.stringContaining('输入区')});
    const run=state.lab.start(state.session.id,'Read the selected personal service',{connectorIds:[uncached.id]},state.identity.seatId,undefined,state.identity.userId);const done=run.run(()=>{});
    const confirmation=await pending(state);expect(confirmation).toMatchObject({kind:'confirmation',action:{mcp:{connectorId:uncached.id}}});respond(state,confirmation,'approve');await done;
    expect(cached.endpoint.httpRecords).toHaveLength(before[0]);expect(uncached.endpoint.records.filter(record=>record.method==='tools/call')).toHaveLength(1);
  });
  it('keeps MCP out of delegated child providers and rejects trial/authoring selection before network', async () => {
    const state = await setup((_context, index) => index === 0 ? {tools: [{name: 'subagent', arguments: {agent: 'reviewer', task: 'Controlled read'}}]} : {text: 'done'}, {roles: true});
    const {id, endpoint} = await seed(state.service); await state.lab.start(state.session.id, 'Delegate read', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId).run(() => {});
    expect(state.fake.calls.length).toBeGreaterThan(1); const child = state.fake.calls.find(call => JSON.stringify(call.context.messages.at(-1)).includes('Controlled read'))!;
    expect(child.context.tools?.some(tool => tool.name.startsWith('mcp_'))).not.toBe(true); expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    expect(() => state.lab.start(state.session.id, 'Create expert', {connectorIds: [id], authoring: {kind: 'expert'}}, state.identity.seatId, undefined, state.identity.userId)).toThrow('前台');
  });
  it('keeps MCP out of background native provider context and blocks explicit trial selection', async () => {
    const state = await setup(() => ({text: 'Background complete'}), {publicTask: true}); const {id, endpoint} = await seed(state.service);
    const before = endpoint.records.length;
    await state.lab.start(state.session.id, 'Controlled background', {}, state.identity.seatId, {background: true, jobId: randomUUID(), requestId: randomUUID()}, state.identity.userId).run(() => {});
    expect(state.fake.calls).toHaveLength(1); expect(state.fake.calls[0].context.tools?.some(tool => tool.name.startsWith('mcp_'))).not.toBe(true); expect(endpoint.records).toHaveLength(before);
    const trial = await setup(() => ({text: 'unused'}), {trial: true});
    expect(() => trial.lab.start(trial.session.id, 'Trial', {connectorIds: [id]}, trial.identity.seatId, undefined, trial.identity.userId)).toThrow('前台'); expect(trial.fake.calls).toHaveLength(0);
  });
});

describe('request-local MCP approval and strict evidence', () => {
  it.each(['general','expert'] as const)('%s requires the actual target answer before HTTP, then separately approves only the selected same-name service', async mode => {
    let requestId = '', alpha = '', beta = '';
    const questions = () => [{id: `mcp_target_${requestId}`, prompt: '本次要使用哪个连接？', options: [{id: alpha, label: 'Alpha'}, {id: beta, label: 'Beta'}].sort((a, b) => a.id.localeCompare(b.id)).map(option => ({...option, description: `连接标识 ${option.id}`}))}];
    const state = await setup((_context, index) => index === 0 ? {tools: [{name: mcpToolName(alpha, 'lookup'), arguments: {query: 'must-not-broadcast'}}]}
      : index === 1 ? {tools: [{name: 'ask_user', arguments: {questions: questions()}}]}
      : index === 2 ? {tools: [{name: mcpToolName(alpha, 'lookup'), arguments: {query: 'wrong-target-after-answer'}}]}
      : index === 3 ? {tools: [{name: mcpToolName(beta, 'lookup'), arguments: {query: 'selected-only'}}]} : {text: 'done'});
    const a = await seed(state.service, {label: 'Alpha'}), b = await seed(state.service, {label: 'Beta'}); alpha = a.id; beta = b.id;
    if (mode === 'expert') {
      const expert = await state.lab.capabilities.registerExpert({expertId:'controlled-mcp-expert',releaseVersion:'1',name:'Controlled MCP expert',description:'Controlled connector references',instructions:'Ask for an ambiguous target.',modes:['interactive'],selectable:true,system:true,allowedTools:['ask_user'],skills:[],connectorRequirements:[a,b].map(item=>({connectorId:item.id,actions:item.detail.revision.exposedTools}))});
      state.session = await state.lab.createSession(state.session.workspaceId,state.identity.seatId,undefined,undefined,undefined,{userId:state.identity.userId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest,clientActionId:randomUUID()});
    }
    const aBefore = a.endpoint.httpRecords.length, bBefore = b.endpoint.httpRecords.length;
    const run = state.lab.start(state.session.id, 'Read from the appropriate service', {}, state.identity.seatId, undefined, state.identity.userId); requestId = run.requestId; const done = run.run(() => {});
    const question = await pending(state); expect(question.kind).toBe('question'); expect(a.endpoint.httpRecords).toHaveLength(aBefore); expect(b.endpoint.httpRecords).toHaveLength(bBefore);
    // Required target guidance belongs to native context even when no DeepSeek payload reminder applies.
    expect(state.fake.calls[0].context.systemPrompt).toContain('外部服务有多个候选');
    expect(state.fake.calls[0].context.systemPrompt).toContain(JSON.stringify(questions()));
    expect(state.fake.calls[0].context.systemPrompt).not.toContain('host_request_instructions');
    expect(state.lab.get(state.session.id).interactions?.filter(item => item.kind === 'confirmation')).toHaveLength(0);
    state.lab.respondInteraction(state.session.id, question.interactionId, {requestId, kind: 'question', action: 'answer', answers: [{questionId: questions()[0].id, optionIds: [beta]}]}, state.identity.seatId);
    const confirmation = await pending(state); expect(confirmation).toMatchObject({kind: 'confirmation', action: {parameters: {query: 'selected-only'}, mcp: {connectorId: beta, connectionName: 'Beta'}}});
    expect(a.endpoint.httpRecords).toHaveLength(aBefore); expect(b.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    respond(state, confirmation, 'approve'); await done;
    expect(a.endpoint.httpRecords).toHaveLength(aBefore); expect(b.endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1);
    expect(b.endpoint.records.find(item => item.method === 'tools/call')?.params?.arguments).toEqual({query: 'selected-only'});
    expect(interactionHistory(await native(state), state.session.workspaceId, state.session.id, undefined, state.identity.seatId).map(item => item.status)).toEqual(['answered', 'approved']);
  });
  it('requires explicit selection when an expert cannot ask, preserving its original tool restriction', async () => {
    const state = await setup(plan()); const a = await seed(state.service), b = await seed(state.service);
    const expert = await state.lab.capabilities.registerExpert({expertId:'controlled-no-question-expert',releaseVersion:'1',name:'Controlled expert',description:'Explicit selection only',instructions:'Read a selected service.',modes:['interactive'],selectable:true,system:true,allowedTools:[],skills:[],connectorRequirements:[a,b].map(item=>({connectorId:item.id,actions:item.detail.revision.exposedTools}))});
    state.session = await state.lab.createSession(state.session.workspaceId,state.identity.seatId,undefined,undefined,undefined,{userId:state.identity.userId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest,clientActionId:randomUUID()});
    const before = [a.endpoint.httpRecords.length,b.endpoint.httpRecords.length];
    await state.lab.start(state.session.id,'Read the appropriate source',{},state.identity.seatId,undefined,state.identity.userId).run(()=>{});
    expect(state.fake.calls).toHaveLength(0); expect([a.endpoint.httpRecords.length,b.endpoint.httpRecords.length]).toEqual(before);
    expect(state.lab.get(state.session.id).lastResult).toMatchObject({status:'failed',message:expect.stringContaining('输入区')});
    const run=state.lab.start(state.session.id,'Read selected source',{connectorIds:[b.id]},state.identity.seatId,undefined,state.identity.userId);const done=run.run(()=>{});
    respond(state,await pending(state),'approve');await done;
    expect(state.fake.calls[0].context.tools?.some(tool=>tool.name==='ask_user')).toBe(false);
    expect(a.endpoint.records.filter(item=>item.method==='tools/call')).toHaveLength(0);expect(b.endpoint.records.filter(item=>item.method==='tools/call')).toHaveLength(1);
  });
  it.each([{allowedTools:null},{allowedTools:[]}])('does not expand old expert tool scope %j into implicit or explicit MCP use',async ({allowedTools})=>{
    const state=await setup(()=>({text:'No new tools'}));const {id,endpoint}=await seed(state.service);
    const expert=await state.lab.capabilities.registerExpert({expertId:'controlled-old-expert',releaseVersion:'1',name:'Old expert',description:'No connector references',instructions:'',modes:['interactive'],selectable:true,system:true,allowedTools,skills:[]});
    state.session=await state.lab.createSession(state.session.workspaceId,state.identity.seatId,undefined,undefined,undefined,{userId:state.identity.userId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest,clientActionId:randomUUID()});
    const before=endpoint.httpRecords.length;
    await state.lab.start(state.session.id,'Ordinary request',{},state.identity.seatId,undefined,state.identity.userId).run(()=>{});
    expect(state.fake.calls[0].context.tools?.some(tool=>tool.name.startsWith('mcp_'))).toBe(false);
    await state.lab.start(state.session.id,'Explicit MCP request',{connectorIds:[id]},state.identity.seatId,undefined,state.identity.userId).run(()=>{});
    expect(state.fake.calls).toHaveLength(1);expect(endpoint.httpRecords).toHaveLength(before);
    expect(state.lab.get(state.session.id).lastResult).toMatchObject({status:'failed',message:expect.stringContaining('尚未发布')});
  });
  it('rejects a connection outside expert references before current-user discovery or model use',async()=>{
    const state=await setup(()=>({text:'unused'}));const a=await seed(state.service),b=await seed(state.service,{},true);
    const principal:ConnectorPrincipal={userId:state.identity.userId,seatId:state.identity.seatId,workspaceKind:'personal',assertActive(){}};
    await state.service.setCredential(principal,b.id,{value:'current-user-only',expectedVersion:0,clientActionId:randomUUID()});
    const expert=await state.lab.capabilities.registerExpert({expertId:'controlled-ref-expert',releaseVersion:'1',name:'Restricted expert',description:'One fixed dependency',instructions:'',modes:['interactive'],selectable:true,system:true,allowedTools:['ask_user'],skills:[],connectorRequirements:[{connectorId:a.id,actions:a.detail.revision.exposedTools}]});
    state.session=await state.lab.createSession(state.session.workspaceId,state.identity.seatId,undefined,undefined,undefined,{userId:state.identity.userId,expertRef:{expertId:expert.expertId,revisionId:expert.revisionId},expectedDigest:expert.digest,clientActionId:randomUUID()});
    const before=b.endpoint.httpRecords.length;
    await state.lab.start(state.session.id,'Read selected source',{connectorIds:[b.id]},state.identity.seatId,undefined,state.identity.userId).run(()=>{});
    expect(state.fake.calls).toHaveLength(0);expect(b.endpoint.httpRecords).toHaveLength(before);
    expect(state.lab.get(state.session.id).lastResult).toMatchObject({status:'failed',message:expect.stringContaining('专家发布')});
  });
  it('does not turn a skipped target question into operation approval or send to any candidate', async () => {
    let requestId = '', alpha = '', beta = '';
    const questions = () => [{id: `mcp_target_${requestId}`, prompt: '本次要使用哪个连接？', options: [{id: alpha, label: 'Alpha'}, {id: beta, label: 'Beta'}].sort((a, b) => a.id.localeCompare(b.id)).map(option => ({...option, description: `连接标识 ${option.id}`}))}];
    const state = await setup((_context, index) => index === 0 ? {tools: [{name: 'ask_user', arguments: {questions: questions()}}]}
      : index === 1 ? {tools: [{name: mcpToolName(beta, 'lookup'), arguments: {query: 'still-unselected'}}]} : {text: 'No selected service'});
    const a = await seed(state.service, {label: 'Alpha'}), b = await seed(state.service, {label: 'Beta'}); alpha = a.id; beta = b.id;
    const before = [a.endpoint.httpRecords.length, b.endpoint.httpRecords.length];
    const run = state.lab.start(state.session.id, 'Read when a target is known', {}, state.identity.seatId, undefined, state.identity.userId); requestId = run.requestId; const done = run.run(() => {});
    const question = await pending(state); expect(question.kind).toBe('question');
    state.lab.respondInteraction(state.session.id, question.interactionId, {requestId, kind: 'question', action: 'skip'}, state.identity.seatId); await done;
    expect([a.endpoint.httpRecords.length, b.endpoint.httpRecords.length]).toEqual(before); expect(state.lab.get(state.session.id).interactions?.map(item => item.status)).toEqual(['skipped']);
    expect(state.fake.calls).toHaveLength(3); expect(interactionHistory(await native(state), state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toHaveLength(1);
  });
  it('binds one-use approval to exact final args and refuses resending an existing intent', async () => {
    const state = await setup(() => ({text: 'unused'})); const {id, endpoint} = await seed(state.service);
    const principal: ConnectorPrincipal = {userId: state.identity.userId, seatId: state.identity.seatId, workspaceKind: 'personal', assertActive() {}};
    const manager = SessionManager.inMemory('/workspace'), requestId = randomUUID();
    const request = await RequestMcpTools.create({service: state.service, principal, connectorIds: [id], controller: new AbortController(), manager, workspaceId: state.session.workspaceId, requestId, seatId: state.identity.seatId, check() {}, wait: async item => ({...item, status: 'approved', resolvedAt: new Date().toISOString()})}); clean.push(() => request.close());
    const tool = request.tools()[0], name = mcpToolName(id, 'lookup'); expect(tool.name).toBe(name);
    expect(await request.confirm(name, 'one', {query: 'approved'})).toBe(true);
    await expect(tool.execute('one', {query: 'different'}, undefined, undefined, {} as never)).rejects.toThrow('有效确认');
    expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(0);
    await request.confirm(name, 'two', {query: 'approved'}); await tool.execute('two', {query: 'approved'}, undefined, undefined, {} as never);
    await request.confirm(name, 'two', {query: 'approved'}); await expect(tool.execute('two', {query: 'approved'}, undefined, undefined, {} as never)).rejects.toThrow('不会自动重发');
    expect(endpoint.records.filter(item => item.method === 'tools/call')).toHaveLength(1);
  });
  it('rejects source/argument evidence tampering while retaining genuine approved native history', async () => {
    const state = await setup(plan()); const {id} = await seed(state.service); const run = state.lab.start(state.session.id, 'Read source', {connectorIds: [id]}, state.identity.seatId, undefined, state.identity.userId); const done = run.run(() => {}); respond(state, await pending(state), 'approve'); await done;
    const entries = await native(state); expect(interactionHistory(entries, state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toHaveLength(1);
    const forged = structuredClone(entries); const policy = forged.find(entry => entry.type === 'custom' && entry.customType === MCP_POLICY)!;
    if (policy.type === 'custom') (policy.data as {source: {connectorId: string}}).source.connectorId = randomUUID();
    expect(() => interactionHistory(forged, state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toThrow();
    const requested = structuredClone(entries); const item = requested.find(entry => entry.type === 'custom' && entry.customType === MCP_REQUESTED)!;
    if (item.type === 'custom') (item.data as {interaction: ConfirmationInteraction}).interaction.action.parameters.query = 'forged';
    expect(() => interactionHistory(requested, state.session.workspaceId, state.session.id, undefined, state.identity.seatId)).toThrow();
    for (const change of ['errorFlag','sentFlag','missingEvidence'] as const) {
      const altered=structuredClone(entries);const result=altered.find(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolName.startsWith('mcp_'))!;
      if(result.type==='message'&&result.message.role==='toolResult') {
        const details=result.message.details as {mcp?:unknown;executionStarted?:boolean};
        if(change==='errorFlag')result.message.isError=true;
        if(change==='sentFlag')details.executionStarted=false;
        if(change==='missingEvidence'){result.message.isError=true;delete details.mcp;}
      }
      expect(() => interactionHistory(altered,state.session.workspaceId,state.session.id,undefined,state.identity.seatId)).toThrow();
    }
  });
});
