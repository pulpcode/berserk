import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { CollaborationService } from '../../src/collaboration/service.js';
import type { WorkPrepareInput } from '../../src/contracts/collaboration.js';
import { WorkspaceStore } from '../../src/workspaces/store.js';
const dirs: string[] = []; const services: CollaborationService[] = [];
const a = {seatId:'seat-a'}; const b = {seatId:'seat-b'};
afterEach(async () => { for (const service of services.splice(0)) service.close(); for (const dir of dirs.splice(0)) await rm(dir,{recursive:true,force:true}); });
async function setup(maxFileBytes = 1024*1024) {
  const dir = await mkdtemp(join(tmpdir(),'axon-handoff-')); dirs.push(dir);
  const workspaces = await WorkspaceStore.open(dir,a.seatId); const workspace = workspaces.get();
  const options = {seatIds:[a.seatId,b.seatId],maxFileBytes};
  const service = await CollaborationService.open(workspaces, options); services.push(service);
  const prepare = (actor: typeof a, input: WorkPrepareInput, key = randomUUID()) => service.prepare(actor,input,{source:'page',clientActionId:key});
  const assign = async (paths: string[] = []) => {
    const action = await prepare(a,{kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'编制方案',goal:'根据输入编制文件',inputPaths:paths}});
    const receipt = await service.commitPage(a,action.operationId); return service.read(a,receipt.workItemId);
  };
  const claim = async (workId: string) => { const work = service.read(b,workId); const action = await prepare(b,{kind:'claim',workItemId:workId,expectedRevision:work.revision,payload:{}}); await service.commitPage(b,action.operationId); return service.read(b,workId); };
  const root = workspaces.filesDirectory(workspace.id,a.seatId);
  return {dir,workspaces,workspace,service,options,prepare,assign,claim,root};
}
async function contents(stream: Readable) { let text = ''; for await (const chunk of stream) text += String(chunk); return text; }

describe('task handoff business boundaries', () => {
  it('assigns fixed inputs, claims, submits, returns and accepts two distinct versions', async () => {
    const {service,workspace,workspaces,prepare,assign,claim,root} = await setup();
    await writeFile(join(root,'任务书.txt'),'input-one'); await writeFile(join(root,'数据.csv'),'a,b');
    let work = await assign(['任务书.txt','数据.csv']);
    expect(work.inputFiles).toHaveLength(2); expect(work.state).toBe('assigned');
    const own = workspaces.list(b.seatId).workspaces.find(w => w.taskSpaceId === workspace.taskSpaceId)!;
    expect(await readFile(join(workspaces.directory(own.id,b.seatId),'AGENTS.md'),'utf8')).toBe('');
    await writeFile(join(root,'任务书.txt'),'changed');
    const copied = await service.importFile(b,work.inputFiles[0].fileId,own.id);
    expect(await readFile(join(workspaces.filesDirectory(own.id,b.seatId),copied.path),'utf8')).toBe('input-one');
    work = await claim(work.id);
    const output = join(workspaces.filesDirectory(own.id,b.seatId),'方案.md'); await writeFile(output,'first version');
    const first = await prepare(b,{kind:'submit',workItemId:work.id,expectedRevision:work.revision,payload:{workspaceId:own.id,path:'方案.md'}});
    await writeFile(output,'later edits');
    expect(await contents((await service.openFile(b,first.files[0].fileId)).stream)).toBe('first version');
    await expect(service.openFile(a,first.files[0].fileId)).rejects.toMatchObject({statusCode:404});
    const submitted = await service.commitPage(b,first.operationId);
    expect(await service.commitPage(b,first.operationId)).toEqual(submitted);
    expect(await contents((await service.openFile(a,first.files[0].fileId)).stream)).toBe('first version');
    const review = await prepare(a,{kind:'review',workItemId:work.id,expectedRevision:submitted.revision,payload:{submissionId:submitted.submissionId!,decision:'return',reason:'补充交通方案'}});
    expect(review.description).toContain('第 1 次提交');
    await service.commitPage(a,review.operationId);
    work = service.read(b,work.id); expect(work.state).toBe('returned'); expect(work.submissions[0].review?.reason).toBe('补充交通方案');
    const second = await prepare(b,{kind:'submit',workItemId:work.id,expectedRevision:work.revision,payload:{workspaceId:own.id,path:'方案.md'}});
    const resubmitted = await service.commitPage(b,second.operationId);
    const accept = await prepare(a,{kind:'review',workItemId:work.id,expectedRevision:resubmitted.revision,payload:{submissionId:resubmitted.submissionId!,decision:'accept'}});
    expect(accept.description).toContain('第 2 次提交');
    await service.commitPage(a,accept.operationId);
    work = service.read(a,work.id); expect(work.state).toBe('completed'); expect(work.submissions.map(s => s.attempt)).toEqual([1,2]);
    expect(await contents((await service.openFile(a,first.files[0].fileId)).stream)).toBe('first version');
    expect(await contents((await service.openFile(a,second.files[0].fileId)).stream)).toBe('later edits');
  });
  it('deduplicates preparation by key and exact parameters even after state changed, not by text', async () => {
    const {service,workspace,prepare} = await setup();
    const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标'}};
    const key = randomUUID(); const [one,two] = await Promise.all([prepare(a,input,key),prepare(a,input,key)]);
    expect(one.operationId).toBe(two.operationId); expect(service.findPageAction(a,key)).toEqual(one);
    await expect(prepare(a,{...input,payload:{...input.payload,goal:'不同'}},key)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    expect(()=>service.findPageAction(b,key)).toThrow();
    const receipts = await Promise.all([service.commitPage(a,one.operationId),service.commitPage(a,two.operationId)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(service.list(b)).toHaveLength(1);
    const duplicate = await prepare(a,input); await service.commitPage(a,duplicate.operationId); expect(service.list(b)).toHaveLength(2);
  });
  it('rejects stale revisions, wrong roles, empty returns and old submission reviews', async () => {
    const {service,prepare,assign,claim,workspaces} = await setup(); const work = await assign();
    const input: WorkPrepareInput = {kind:'claim',workItemId:work.id,expectedRevision:work.revision,payload:{}};
    await expect(prepare(a,input)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    const [one,two] = await Promise.all([prepare(b,input),prepare(b,input)]);
    await service.commitPage(b,one.operationId); await expect(service.commitPage(b,two.operationId)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    const own = workspaces.list(b.seatId).workspaces[0]; await writeFile(join(workspaces.filesDirectory(own.id,b.seatId),'out'),'out');
    const submit = await prepare(b,{kind:'submit',workItemId:work.id,expectedRevision:2,payload:{workspaceId:own.id,path:'out'}}); const receipt = await service.commitPage(b,submit.operationId);
    await expect(prepare(a,{kind:'review',workItemId:work.id,expectedRevision:3,payload:{submissionId:receipt.submissionId!,decision:'return',reason:' '}})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(prepare(a,{kind:'review',workItemId:work.id,expectedRevision:3,payload:{submissionId:randomUUID(),decision:'accept'}})).rejects.toMatchObject({code:'WORK_CONFLICT'});
    await expect(claim(work.id)).rejects.toMatchObject({code:'WORK_CONFLICT'});
  });
  it('expires uncommitted actions on restart but retains committed receipts and fixed bytes', async () => {
    const {service,workspaces,workspace,options,prepare,root} = await setup(); await writeFile(join(root,'input'),'saved');
    const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标',inputPaths:['input']}};
    const pending = await prepare(a,input); const completed = await prepare(a,input); const receipt = await service.commitPage(a,completed.operationId); service.close();
    const reopened = await CollaborationService.open(workspaces,options); services.push(reopened);
    expect(reopened.getAction(a,pending.operationId).status).toBe('expired');
    await expect(reopened.commitPage(a,pending.operationId)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    expect(await reopened.commitPage(a,completed.operationId)).toEqual(receipt);
    expect(await contents((await reopened.openFile(b,completed.files[0].fileId)).stream)).toBe('saved');
    expect(reopened.list(b)).toHaveLength(1);
  });
  it('binds agent actions to request, exact internal approval and seat; page cannot bypass HITL', async () => {
    const {service,workspace,workspaces} = await setup(); const sessionId = randomUUID(); const requestId = randomUUID(); await workspaces.bind(sessionId,workspace.id,a.seatId); service.beginRequest(sessionId,requestId);
    const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标'}};
    const action = await service.prepare(a,input,{source:'agent',sessionId,requestId,toolCallId:'prepare'});
    const grant = {sessionId,requestId,toolCallId:'commit',interactionId:randomUUID()};
    await expect(service.commitPage(a,action.operationId)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    await expect(service.commitAgent(a,action.operationId,grant)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    service.authorizeAgent(a,action.operationId,grant);
    await expect(service.commitAgent(a,action.operationId,{...grant,toolCallId:'other'})).rejects.toMatchObject({code:'WORK_CONFLICT'});
    const result = await service.commitAgent(a,action.operationId,grant); expect(result.state).toBe('assigned');
    const next = await service.prepare(a,input,{source:'agent',sessionId,requestId,toolCallId:'prepare2'});
    service.authorizeAgent(a,next.operationId,grant); service.endRequest(sessionId,requestId);
    expect(service.getAction(a,next.operationId).status).toBe('expired');
    await expect(service.commitAgent(a,next.operationId,grant)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    expect(service.getAction(a,action.operationId).receipt).toEqual(result);
  });
  it('keeps session links private and refuses active or different-task bindings and agent source overrides', async () => {
    const {service,workspace,workspaces,assign} = await setup(); const work = await assign();
    const aSession = randomUUID(); const bSession = randomUUID(); const requestId = randomUUID();
    await workspaces.bind(aSession,workspace.id,a.seatId); const own = workspaces.list(b.seatId).workspaces[0]; await workspaces.bind(bSession,own.id,b.seatId);
    service.beginRequest(aSession,requestId); expect(()=>service.bindSession(a,aSession,work.id)).toThrow(); service.endRequest(aSession,requestId);
    service.bindSession(a,aSession,work.id); service.bindSession(b,bSession,work.id);
    expect(service.read(a,work.id).sessionIds).toEqual([aSession]); expect(service.read(b,work.id).sessionIds).toEqual([bSession]);
    expect(service.workIdForSession(a,aSession)).toBe(work.id); expect(()=>service.workForSession(a,bSession)).toThrow();
    const other = await workspaces.create('另一个项目',undefined,a.seatId); const otherSession = randomUUID(); await workspaces.bind(otherSession,other.id,a.seatId);
    expect(()=>service.bindSession(a,otherSession,work.id)).toThrow();
    service.beginRequest(aSession,requestId);
    await expect(service.prepare(a,{kind:'assign',taskSpaceId:other.taskSpaceId!,payload:{workspaceId:other.id,assigneeSeatId:b.seatId,title:'跨任务',goal:'目标'}},{source:'agent',sessionId:aSession,requestId,toolCallId:'prepare'})).rejects.toMatchObject({statusCode:404});
  });
  it('rejects cross-task imports, symbolic links and overwrite, and repeats identical import safely', async () => {
    const {service,workspaces,assign,root,dir} = await setup(); await writeFile(join(root,'input'),'original'); const work = await assign(['input']); const fileId = work.inputFiles[0].fileId;
    const own = workspaces.list(b.seatId).workspaces[0]; const other = await workspaces.create('other',undefined,b.seatId);
    await expect(service.importFile(b,fileId,other.id)).rejects.toMatchObject({statusCode:404});
    const first = await service.importFile(b,fileId,own.id); expect(await service.importFile(b,fileId,own.id)).toEqual(first);
    const target = join(workspaces.filesDirectory(own.id,b.seatId),first.path); await writeFile(target,'my edits');
    await expect(service.importFile(b,fileId,own.id)).rejects.toMatchObject({code:'FILE_EXISTS'}); expect(await readFile(target,'utf8')).toBe('my edits');
    await symlink(dir,join(workspaces.filesDirectory(own.id,b.seatId),'outside'));
    await expect(service.importFile(b,fileId,own.id,'outside/escape')).rejects.toMatchObject({code:'FILE_UNSAFE_FILE'});
    await expect(service.importFile(b,fileId,own.id,'../escape')).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('detects changed fixed bytes before commit and download, and does not create a work', async () => {
    const {service,prepare,workspace,root,dir} = await setup(); await writeFile(join(root,'input'),'original');
    const action = await prepare(a,{kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标',inputPaths:['input']}});
    await writeFile(join(dir,'collaboration','files',action.files[0].fileId,'content'),'modified');
    await expect(service.commitPage(a,action.operationId)).rejects.toThrow(); await expect(service.openFile(a,action.files[0].fileId)).rejects.toThrow(); expect(service.list(b)).toEqual([]);
  });
  it('cancellation prevents commit but cannot revoke committed work; abort creates no work', async () => {
    const {service,prepare,workspace} = await setup(); const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标'}};
    const action = await prepare(a,input); service.cancelPage(a,action.operationId); await expect(service.commitPage(a,action.operationId)).rejects.toMatchObject({code:'WORK_CONFLICT'});
    const pending = await prepare(a,input); const controller = new AbortController(); controller.abort(); await expect(service.commitPage(a,pending.operationId,controller.signal)).rejects.toThrow(); expect(service.list(b)).toHaveLength(0);
    const receipt = await service.commitPage(a,pending.operationId); expect(service.cancelPage(a,pending.operationId).receipt).toEqual(receipt); expect(service.list(b)).toHaveLength(1);
  });
  it('rolls back business state when receipt save fails, allowing same operation retry', async () => {
    const {service,prepare,workspace,dir} = await setup(); const action = await prepare(a,{kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'事务',goal:'保存失败'}});
    const db = new DatabaseSync(join(dir,'collaboration','collaboration.sqlite'));
    db.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE ON actions BEGIN SELECT RAISE(ABORT,'disk fault'); END;");
    await expect(service.commitPage(a,action.operationId)).rejects.toThrow('disk fault'); expect(service.list(b)).toHaveLength(0); expect(service.getAction(a,action.operationId).status).toBe('prepared');
    db.exec('DROP TRIGGER fail_receipt'); db.close(); await service.commitPage(a,action.operationId); expect(service.list(b)).toHaveLength(1);
  });
  it('refuses missing initialized DB and malformed DB instead of resetting state', async () => {
    const {service,workspaces,options,dir} = await setup(); service.close(); const path = join(dir,'collaboration','collaboration.sqlite'); const bytes = await readFile(path);
    await unlink(path); await expect(CollaborationService.open(workspaces,options)).rejects.toThrow();
    await writeFile(path,'invalid database'); await expect(CollaborationService.open(workspaces,options)).rejects.toThrow();
    await writeFile(path,bytes); const valid = await CollaborationService.open(workspaces,options); services.push(valid); expect(valid.list(a)).toEqual([]);
  });
});
it('only one competing submission commits, and the losing private copy remains unshared', async () => {
  const {service,prepare,workspaces,assign,claim} = await setup(); let work = await assign(); work = await claim(work.id);
  const own = workspaces.list(b.seatId).workspaces[0]; const root = workspaces.filesDirectory(own.id,b.seatId); await writeFile(join(root,'one'),'one'); await writeFile(join(root,'two'),'two');
  const input: WorkPrepareInput = {kind:'submit',workItemId:work.id,expectedRevision:work.revision,payload:{workspaceId:own.id,path:'one'}};
  const first = await prepare(b,input); const second = await prepare(b,{...input,payload:{...input.payload,path:'two'}});
  const results = await Promise.allSettled([service.commitPage(b,first.operationId),service.commitPage(b,second.operationId)]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  const detail = service.read(a,work.id); expect(detail.submissions).toHaveLength(1); expect(detail.revision).toBe(3);
  const lost = detail.submissions[0].file.fileId === first.files[0].fileId ? second : first;
  await expect(service.openFile(a,lost.files[0].fileId)).rejects.toMatchObject({statusCode:404});
});
it('rejects foreign source workspaces, extra authority, unsafe sources and oversized copies', async () => {
  const {service,prepare,workspace,workspaces,root,dir} = await setup(8);
  const input: WorkPrepareInput = {kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:b.seatId,title:'任务',goal:'目标'}};
  await expect(prepare(a,{...input,approved:true} as WorkPrepareInput)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const foreign = await workspaces.ensureWorkspace(workspace.taskSpaceId,b.seatId,'项目');
  await expect(prepare(a,{...input,payload:{...input.payload,workspaceId:foreign.id}})).rejects.toMatchObject({statusCode:404});
  await writeFile(join(dir,'secret'),'secret'); await symlink(join(dir,'secret'),join(root,'link'));
  await expect(prepare(a,{...input,payload:{...input.payload,inputPaths:['link']}})).rejects.toMatchObject({code:'FILE_UNSAFE_FILE'});
  await writeFile(join(root,'large'),'123456789');
  await expect(prepare(a,{...input,payload:{...input.payload,inputPaths:['large']}})).rejects.toMatchObject({code:'FILE_TOO_LARGE'});
  expect(service.list(b)).toEqual([]);
});
it('rejects a structurally valid SQLite database with broken business references on reopen', async () => {
  const {service,assign,options,workspaces,dir} = await setup(); const work = await assign(); service.close();
  const db = new DatabaseSync(join(dir,'collaboration','collaboration.sqlite'));
  const record = JSON.parse(String(db.prepare('SELECT data FROM works WHERE id=?').get(work.id)!.data)); record.inputFileIds = [randomUUID()];
  db.prepare('UPDATE works SET data=? WHERE id=?').run(JSON.stringify(record),work.id); db.close();
  await expect(CollaborationService.open(workspaces,options)).rejects.toMatchObject({code:'RESOURCE_STATE_INVALID'});
});
it('settles import publication when cancelled between link and unlink', async () => {
  const {service,assign,workspaces,root,dir,options} = await setup(); await writeFile(join(root,'input'),'complete'); const work = await assign(['input']); service.close();
  const linked = join(dir,'linked'); const wrapper = join(dir,'python-wrapper');
  await writeFile(wrapper,`#!/usr/bin/env python3\nimport os, runpy, sys, time\noriginal = os.link\ndef link(*args, **kwargs):\n    original(*args, **kwargs)\n    if sys.argv[1].endswith('safe-import.py'):\n        with open(${JSON.stringify(linked)}, 'w') as marker: marker.write('linked')\n        time.sleep(0.2)\nos.link = link\nrunpy.run_path(sys.argv[1], run_name='__main__')\n`,{mode:0o700});
  const reopened = await CollaborationService.open(workspaces,{...options,python:wrapper}); services.push(reopened);
  const own = workspaces.list(b.seatId).workspaces[0]; const controller = new AbortController();
  const importing = reopened.importFile(b,work.inputFiles[0].fileId,own.id,'cancelled.txt',controller.signal).catch(error=>error);
  let found = false;
  for (let i=0;i<400;i++) { if (await readFile(linked,'utf8').catch(()=>'')) { found=true; break; } await new Promise(resolve=>setTimeout(resolve,5)); }
  expect(found).toBe(true); controller.abort(); expect(await importing).toBeInstanceOf(Error);
  const {stat} = await import('node:fs/promises'); const target = join(workspaces.filesDirectory(own.id,b.seatId),'cancelled.txt');
  expect((await stat(target)).nlink).toBe(1); expect(await readFile(target,'utf8')).toBe('complete');
  expect((await reopened.importFile(b,work.inputFiles[0].fileId,own.id,'cancelled.txt')).path).toBe('cancelled.txt');
});
