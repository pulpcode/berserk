import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceStore } from '../../src/workspaces/store.js';
import { migrateSeats } from '../../src/workspaces/seat-migration.js';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0)) await rm(dir,{recursive:true,force:true});});
it('requires explicit v1 migration, preserves IDs/bindings/files and takes independent backup',async()=>{
  const root=await mkdtemp(join(tmpdir(),'berserk-seats-'));dirs.push(root);
  const dataDir=join(root,'data'),backupDir=join(root,'backup');
  const store=await WorkspaceStore.open(dataDir); const ws=store.list().workspaces[0];const sessionId=randomUUID();await store.bind(sessionId,ws.id);
  const index=JSON.parse(await readFile(join(dataDir,'workspace-index.json'),'utf8'));
  index.schemaVersion=1;for(const w of index.workspaces){delete w.taskSpaceId;delete w.seatId;}
  await writeFile(join(dataDir,'workspace-index.json'),JSON.stringify(index,null,2));await writeFile(join(dataDir,'.workspace-initialized'),'workspace-v1\n');
  await writeFile(join(dataDir,'sessions','history.jsonl'),'history untouched');
  await expect(WorkspaceStore.open(dataDir)).rejects.toMatchObject({code:'MIGRATION_REQUIRED'});
  await expect(migrateSeats({dataDir,backupDir,apply:true,serviceStopped:false})).rejects.toThrow(/停止/);
  expect((await migrateSeats({dataDir,backupDir,apply:false,serviceStopped:false})).stage).toBe('dry-run');
  expect((await migrateSeats({dataDir,backupDir,apply:true,serviceStopped:true})).stage).toBe('completed');
  const next=await WorkspaceStore.open(dataDir);expect(next.binding(sessionId)).toBe(ws.id);expect(next.get(ws.id).seatId).toBe('test-seat');
  expect(await readFile(join(dataDir,'sessions','history.jsonl'),'utf8')).toBe('history untouched');
  expect(JSON.parse(await readFile(join(backupDir,'workspace-index.json'),'utf8')).schemaVersion).toBe(1);
  const second=await WorkspaceStore.open(dataDir,'second-seat');const secondWs=await second.create('同任务席位',next.get(ws.id).taskSpaceId);
  expect(secondWs.id).not.toBe(ws.id);expect(second.list().workspaces).toHaveLength(1);
  expect(()=>second.get(ws.id)).toThrow();
});
