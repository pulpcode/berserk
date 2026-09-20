import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CollaborationService } from '../../../src/collaboration/service.js';
import { WorkspaceStore } from '../../../src/workspaces/store.js';
const [, , dir, stage] = process.argv;
const workspaces = await WorkspaceStore.open(dir,'seat-a');
let python: string | undefined;
if (stage === 'copying') {
  python = join(dir,'copy-stop-python');
  // Pause the real safe-fs copy after its first actual destination write. There
  // is no production hook and no fabricated service state. The test helper
  // exits when its Axon parent dies, leaving the unregistered partial copy.
  await writeFile(python,`#!/usr/bin/env python3\nimport json, os, runpy, sys, time\nparent = os.getppid()\noriginal = os.write\ndef write(fd, data):\n    size = original(fd, data)\n    with open(${JSON.stringify(join(dir,'copy-started'))}, 'w') as marker: json.dump({'helperPid': os.getpid(), 'bytesWritten': size}, marker)\n    while os.getppid() == parent: time.sleep(0.01)\n    with open(${JSON.stringify(join(dir,'copy-orphaned'))}, 'w') as marker: marker.write('parent-killed')\n    os._exit(17)\nos.write = write\nrunpy.run_path(sys.argv[1], run_name='__main__')\n`,{mode:0o700});
}
const service = await CollaborationService.open(workspaces,{seatIds:['seat-a','seat-b'],...(python ? {python} : {})});
const workspace = workspaces.get(); await writeFile(join(workspaces.filesDirectory(workspace.id),'input.txt'),stage === 'copying' ? Buffer.alloc(256*1024,97) : 'durable bytes');
const preparation = service.prepare({seatId:'seat-a'},{kind:'assign',taskSpaceId:workspace.taskSpaceId,payload:{workspaceId:workspace.id,assigneeSeatId:'seat-b',title:'崩溃测试',goal:'保留已完成效果',inputPaths:['input.txt']}},{source:'page',clientActionId:randomUUID()});
if (stage === 'copying') {
  void preparation.catch(error=>{ console.error(error); process.exitCode=1; });
  let marker: {helperPid:number;bytesWritten:number} | undefined;
  for (let i=0;i<1000;i++) {
    const raw = await readFile(join(dir,'copy-started'),'utf8').catch(()=>'');
    if (raw) { marker = JSON.parse(raw); break; }
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  if (!marker) throw new Error('Copy phase not reached');
  const [fileId] = await readdir(join(dir,'collaboration','files'));
  process.send!({...marker,fileId});
} else {
  const action = await preparation;
  if (stage === 'committed') await service.commitPage({seatId:'seat-a'},action.operationId);
  process.send!({operationId:action.operationId,fileId:action.files[0].fileId});
}
// The test kills us here without close/finally or a downstream JSONL/HTTP result.
setInterval(() => {},1000);
