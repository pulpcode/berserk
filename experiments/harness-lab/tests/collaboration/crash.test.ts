import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { CollaborationService } from '../../src/collaboration/service.js';
import { WorkspaceStore } from '../../src/workspaces/store.js';

it.each(['prepared','committed'])('SIGKILL %s retains exact business boundary without replay', async stage => {
  const dir = await mkdtemp(join(tmpdir(),'axon-handoff-crash-'));
  const child = fork(fileURLToPath(new URL('./fixtures/crash.ts',import.meta.url)),[dir,stage],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  let service: CollaborationService | undefined;
  let stderr = ''; child.stderr!.on('data',chunk=> { stderr += String(chunk); });
  try {
    const closed = new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    const record = await new Promise<{operationId:string;fileId:string}>((resolve,reject)=>{
      child.once('message',message=>resolve(message as {operationId:string;fileId:string}));
      child.once('error',reject); child.once('exit',code=>reject(new Error(`child exit ${code}: ${stderr}`)));
    });
    child.kill('SIGKILL'); await closed;
    const workspaces = await WorkspaceStore.open(dir,'seat-a'); service = await CollaborationService.open(workspaces,{seatIds:['seat-a','seat-b']});
    const action = service.getAction({seatId:'seat-a'},record.operationId);
    expect(action.status).toBe(stage === 'committed' ? 'committed' : 'expired');
    expect(service.list({seatId:'seat-b'})).toHaveLength(stage === 'committed' ? 1 : 0);
    if (stage === 'committed') {
      expect(await service.commitPage({seatId:'seat-a'},record.operationId)).toEqual(action.receipt);
      const file = await service.openFile({seatId:'seat-b'},record.fileId); let text = ''; for await (const chunk of file.stream) text += String(chunk); expect(text).toBe('durable bytes');
    } else {
      await expect(service.commitPage({seatId:'seat-a'},record.operationId)).rejects.toMatchObject({code:'WORK_CONFLICT'});
      await expect(service.openFile({seatId:'seat-b'},record.fileId)).rejects.toMatchObject({statusCode:404});
    }
  } finally { child.kill('SIGKILL'); service?.close(); await rm(dir,{recursive:true,force:true}); }
},15000);

it('SIGKILL during the real fixed-file copy leaves no business records or recipient access', async () => {
  const { readFile, stat } = await import('node:fs/promises');
  const { DatabaseSync } = await import('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(),'axon-handoff-copy-crash-'));
  const child = fork(fileURLToPath(new URL('./fixtures/crash.ts',import.meta.url)),[dir,'copying'],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  let service: CollaborationService | undefined; let helperPid: number | undefined; let stderr=''; child.stderr!.on('data',chunk=>{ stderr += String(chunk); });
  try {
    const closed = new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    const record = await new Promise<{fileId:string;helperPid:number;bytesWritten:number}>((resolve,reject)=>{
      child.once('message',message=>resolve(message as {fileId:string;helperPid:number;bytesWritten:number}));
      child.once('error',reject); child.once('exit',code=>reject(new Error(`child exit ${code}: ${stderr}`)));
    });
    helperPid = record.helperPid;
    const copy = join(dir,'collaboration','files',record.fileId,'content');
    expect(record.bytesWritten).toBeGreaterThan(0); expect((await stat(copy)).size).toBeLessThan(256*1024);
    child.kill('SIGKILL'); await closed;
    let orphaned = false;
    for (let i=0;i<1000;i++) { if (await readFile(join(dir,'copy-orphaned'),'utf8').catch(()=>'')) { orphaned=true; break; } await new Promise(resolve=>setTimeout(resolve,5)); }
    expect(orphaned).toBe(true);
    const workspaces = await WorkspaceStore.open(dir,'seat-a'); service = await CollaborationService.open(workspaces,{seatIds:['seat-a','seat-b']});
    expect(service.list({seatId:'seat-a'})).toEqual([]); expect(service.list({seatId:'seat-b'})).toEqual([]);
    await expect(service.openFile({seatId:'seat-b'},record.fileId)).rejects.toMatchObject({statusCode:404});
    // The file is only an orphan, not an approved action, handoff or submission.
    const db = new DatabaseSync(join(dir,'collaboration','collaboration.sqlite'),{readOnly:true});
    try { for (const table of ['works','submissions','actions','files']) expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count).toBe(0); }
    finally { db.close(); }
    expect((await stat(copy)).size).toBe(record.bytesWritten);
  } finally {
    child.kill('SIGKILL'); if (helperPid) { try { process.kill(helperPid,'SIGKILL'); } catch { /* Already stopped after the parent exited. */ } }
    service?.close(); await rm(dir,{recursive:true,force:true});
  }
},15000);
