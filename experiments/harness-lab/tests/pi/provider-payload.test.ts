import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { testConfig } from './fake-runtime.js';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllGlobals(); });
interface WireMessage { role: string; content: string | Array<{ type: string; text: string }> | null }
const textOf = (message: WireMessage) => typeof message.content === 'string' ? message.content : message.content?.map(block => block.text).join('') || '';
it('inserts one fixed system snapshot immediately before the current user on the wire, without changing native history', async () => {
  const payloads: Array<{ messages: WireMessage[]; thinking: { type: string } }> = [];
  let oldHash = '';
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    const body = init?.body ?? (input instanceof Request ? await input.text() : '');
    payloads.push(JSON.parse(String(body)));
    const update = payloads.length === 1;
    const delta = update ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-update', type: 'function', function: { name: 'instructions_update', arguments: JSON.stringify({ fileId: 'workspace', content: 'WIRE_NEW_RULE', expectedHash: oldHash }) } }] } : { role: 'assistant', content: 'HTTP 完成' };
    const data = [
      { id: 'fake-completion', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null }] },
      { id: 'fake-completion', object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: update ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } },
    ];
    return new Response(data.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  const dir = await mkdtemp(join(tmpdir(), 'berserk-payload-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const config = testConfig(dir, { provider: 'deepseek', model: 'deepseek-flash' }); const lab = await PiLab.create(config); cleanup.push(() => lab.close());
  const session = await lab.createSession();
  const initial = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  oldHash = (await lab.resources.updateInstruction(session.workspaceId, 'workspace', 'WIRE_OLD_RULE', initial.hash)).hash;
  const first = lab.start(session.id, '第一轮：修改约定'); await first.run(() => {});
  expect((await lab.resources.readInstruction(session.workspaceId, 'workspace')).content).toBe('WIRE_NEW_RULE');
  await lab.start(session.id, '第二轮').run(() => {});
  const latest = await lab.resources.readInstruction(session.workspaceId, 'workspace');
  await lab.resources.updateInstruction(session.workspaceId, 'workspace', '', latest.hash);
  await lab.start(session.id, '第三轮').run(() => {});
  expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
  expect(payloads).toHaveLength(4);
  const reminders = payloads.map(payload => {
    const userIndex = payload.messages.findLastIndex(message => message.role === 'user');
    expect(userIndex).toBeGreaterThan(0);
    expect(payload.messages[userIndex - 1].role).toBe('system');
    expect(payload.messages.filter(message => message.role === 'system')).toHaveLength(2);
    return textOf(payload.messages[userIndex - 1]);
  });
  const currentUsers = payloads.map(payload => textOf(payload.messages.filter(message => message.role === 'user').at(-1)!));
  expect(currentUsers).toEqual(['第一轮：修改约定', '第一轮：修改约定', '第二轮', '第三轮']);
  for (let index = 0; index < 2; index++) {
    expect(payloads[index].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('WIRE_OLD_RULE') });
    expect(textOf(payloads[index].messages[0])).not.toContain('WIRE_NEW_RULE');
    expect(reminders[index]).toContain('WIRE_OLD_RULE');
    expect(reminders[index]).toContain(oldHash);
    expect(reminders[index]).not.toContain('WIRE_NEW_RULE');
  }
  expect(reminders[1]).toBe(reminders[0]);
  expect(textOf(payloads[2].messages[0])).toContain('WIRE_NEW_RULE');
  expect(reminders[2]).toContain('WIRE_NEW_RULE');
  expect(reminders[2]).not.toContain('WIRE_OLD_RULE');
  expect(reminders[3]).toContain('工作区正文为空');
  expect(reminders[3]).toContain('"fileId":"workspace"');
  expect(reminders[3]).toContain('"content":""');
  expect(reminders[3]).not.toContain('WIRE_OLD_RULE');
  expect(reminders[3]).not.toContain('WIRE_NEW_RULE');
  expect(textOf(payloads[3].messages[0])).not.toContain('WIRE_NEW_RULE');
  for (const current of reminders) expect(current.match(/<host_request_instructions>/g)).toHaveLength(1);
  const allUsers = payloads[3].messages.filter(message => message.role === 'user').map(textOf);
  expect(allUsers).toEqual(['第一轮：修改约定', '第二轮', '第三轮']);
  expect(allUsers).toHaveLength(3);
  expect(lab.get(session.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['第一轮：修改约定', '第二轮', '第三轮']);
  expect(lab.getRequestResources(session.id, first.requestId)).toMatchObject({ status: 'available', instructions: [{ fileId: 'common' }, { fileId: 'workspace', content: 'WIRE_OLD_RULE' }] });
  for (const file of await readdir(join(dir, 'sessions'))) {
    const native = await readFile(join(dir, 'sessions', file), 'utf8');
    expect(native).not.toContain('host_request_instructions');
    const users = native.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message' && entry.message.role === 'user');
    expect(users).toHaveLength(3);
  }
  expect(payloads[3].thinking).toEqual({ type: 'disabled' });
  expect(JSON.stringify(payloads)).not.toContain(config.apiKey);
});

it('keeps annotation receipts in native details and UI while the actual provider receives projected content and v5 references', async () => {
  const payloads: Array<{messages: WireMessage[]}> = [];
  let publicationId = '';
  vi.stubGlobal('fetch', async (input: Request | string | URL, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : ''))));
    const calls = [
      {name:'annotation_read',arguments:{mode:'draft',objectIds:['north'],fields:['note','attributes']}},
      {name:'annotation_action',arguments:{action:'publish',revision:1,title:'固定发布'}},
      {name:'annotation_list',arguments:{}},
    ];
    const call=calls[payloads.length-1];
    const delta=call ? {role:'assistant',tool_calls:[{index:0,id:`projection-${payloads.length}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]} : {role:'assistant',content:'已完成'};
    const chunks=[{id:'projection',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason:null}]},{id:'projection',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:2,completion_tokens:2,total_tokens:4}}];
    return new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  });
  const dir=await mkdtemp(join(tmpdir(),'berserk-annotation-wire-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{provider:'deepseek',model:'deepseek-flash',seatId:'alpha',testSeats:[{id:'alpha',name:'甲'}]});
  const lab=await PiLab.create(config);cleanup.push(()=>lab.close());
  const session=await lab.createSession(undefined,'alpha'),actor=lab.annotations!.actorForSeat('alpha');
  const draft=lab.annotations!.action(actor,session.id,{clientActionId:'00000000-0000-4000-8000-000000000021',action:'create_draft',baseRef:null,operations:[{op:'add_layer',layer:{layerId:'points',name:'位置',order:0,defaultVisible:true,features:[{objectId:'north',name:'北点',kind:'point',geometry:{type:'Point',coordinates:[103,1]},note:'业务备注',attributes:{hash:'business-hash'}}]}}]});
  const events: import('../../src/contracts/index.js').StreamEvent[]=[];
  await lab.start(session.id,'发布当前标注',{annotationRefs:[{...draft.ref!,objectIds:['north']}]},'alpha').run(event=>events.push(event));
  const snapshot=lab.get(session.id,'alpha');expect(snapshot.lastResult?.status).toBe('succeeded');
  const publication=snapshot.messages.find(message=>message.toolName==='annotation_action')!;
  expect(publication.annotationResult?.origin).toBe('write');
  const receipt=publication.annotationResult!.receipt;publicationId=(receipt.ref as {publicationId:string}).publicationId;
  expect(receipt.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(events.find(event=>event.type==='tool.completed' && event.toolName==='annotation_action')).toMatchObject({annotationResult:publication.annotationResult});
  const wire=JSON.stringify(payloads);
  expect(wire).not.toContain(receipt.hash!);expect(wire).not.toContain(draft.hash!);expect(wire).not.toContain('annotationResult');
  expect(wire).toContain('business-hash');expect(wire).toContain(publicationId);expect(wire).toContain('业务备注');
  expect(wire).toContain('不是整个版本的对象清单');expect(wire).toContain('筛选后分页前');
  const read=payloads.at(-1)!.messages.filter(message=>message.role==='tool').map(message=>JSON.parse(textOf(message))).find(value=>value.data?.objects);
  expect(read.data.query).toEqual({objectIds:['north'],fields:['note','attributes']});
  expect(read.data.objects.total).toBe(1);
  const native=(await Promise.all((await readdir(join(dir,'sessions'))).map(file=>readFile(join(dir,'sessions',file),'utf8')))).join('\n');
  expect(native).toContain(receipt.hash!);expect(native).toContain('berserk.composer-input.v5');
  await lab.close();
  const reopened=await PiLab.create(config);cleanup.push(()=>reopened.close());
  expect(reopened.get(session.id,'alpha').messages).toEqual(snapshot.messages);
  await reopened.start(session.id,'继续核对',{},'alpha').run(()=>{});
  expect(JSON.stringify(payloads.at(-1))).not.toContain(receipt.hash!);
  expect(reopened.get(session.id,'alpha').messages.find(message=>message.toolName==='annotation_action')?.annotationResult).toEqual(publication.annotationResult);
});
