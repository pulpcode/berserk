import { crc32 } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { previewSkillImport } from '../src/skills/import.js';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import { semgrepScanner } from '../src/skills/scanner.js';
import { packageContent } from '../src/skills/package.js';
import type { SkillScanReport } from '../src/contracts/skills.js';
const method=Buffer.from('---\nname: demo\ndescription: test fixture\n---\n');
function zip(entries:Array<{name:string;data:Buffer;mode?:number;badCrc?:boolean}>):Buffer {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const e of entries){const name=Buffer.from(e.name),crc=e.badCrc?0:crc32(e.data),head=Buffer.alloc(30),record=Buffer.alloc(46);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(e.data.length,18);head.writeUInt32LE(e.data.length,22);head.writeUInt16LE(name.length,26);local.push(head,name,e.data);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(0x314,4);record.writeUInt16LE(20,6);record.writeUInt32LE(crc,16);record.writeUInt32LE(e.data.length,20);record.writeUInt32LE(e.data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(((e.mode??0x81a4)<<16)>>>0,38);record.writeUInt32LE(offset,42);central.push(record,name);offset+=head.length+name.length+e.data.length;}
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(Buffer.concat(central).length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
test('ZIP single root retains custom resources and rejects unsafe paths, links, duplicates, wrappers and CRC corruption',async()=>{
  const good=await previewSkillImport('demo.zip',zip([{name:'demo/SKILL.md',data:method},{name:'demo/templates/blank.txt',data:Buffer.from('template')}]));expect(good.validation.valid).toBe(true);expect(good.files.map(f=>f.path)).toContain('templates/blank.txt');
  for(const extra of [{name:'../escape',data:method},{name:'link',data:Buffer.from('/etc/passwd'),mode:0xa1ff},{name:'SKILL.md',data:method},{name:'bad.txt',data:method,badCrc:true}])await expect(previewSkillImport('bad.zip',zip([{name:'SKILL.md',data:method},extra]))).rejects.toThrow();
  await expect(previewSkillImport('deep.zip',zip([{name:'outer/demo/SKILL.md',data:method}]))).rejects.toThrow('层级');
  const mismatch=await previewSkillImport('name.zip',zip([{name:'wrong/SKILL.md',data:method}]));expect(mismatch.validation.valid).toBe(false);
});
test('automatic scans use a fixed content snapshot, failures do not become passing publication gates, and rescan deduplicates running work',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'axon-r3-scanner-'));const cap=await CapabilityService.open(dir);initializeR2Schema(cap.db);cap.close();
  let finish!:(value:SkillScanReport)=>void;let calls=0;const service=await SkillService.open(dir,{createdNew:true,scanner:async(_content,report)=>{calls++;return new Promise(resolve=>{finish=()=>resolve({...report,state:'failed',errors:['fixture actual infrastructure error'],completedAt:new Date().toISOString()});});}});
  const actor={userId:'admin',assertAdministrator:()=>{}};
  try{const created=await service.create(actor,{clientActionId:randomUUID()});const id=created.skill.skillId;const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:method.toString('base64')},{path:'script.py',contentBase64:Buffer.from('print(1)').toString('base64')}]});expect(calls).toBe(1);const queued=service.scans(actor,id)[0];const again=await service.rescan(actor,id,{expectedDraftRevision:draft.draftRevision,clientActionId:randomUUID()});expect(again.scanId).toBe(queued.scanId);finish(queued);await vi.waitFor(()=>expect(service.scans(actor,id)[0].state).toBe('failed'));await service.saveDraft(actor,id,{expectedDraftRevision:draft.draftRevision,files:[{path:'SKILL.md',contentBase64:method.toString('base64')}]});expect(service.scans(actor,id).find(r=>r.scanId===queued.scanId)?.packageDigest).toBe(draft.packageDigest);}finally{service.close();await rm(dir,{recursive:true,force:true});}
});
test('actual missing scanner executable returns explicit failure without claiming coverage',async()=>{
  const parsed=packageContent([{path:'SKILL.md',contentBase64:method.toString('base64')},{path:'x.py',contentBase64:Buffer.from('print(1)').toString('base64')}]);
  const report:SkillScanReport={scanId:randomUUID(),skillId:'test',packageDigest:parsed.packageDigest,scanner:'Semgrep CE',scannerVersion:'1.182.0',rulesDigest:'unused',state:'pending',findings:[],targets:['x.py'],scanned:[],skipped:[],errors:[],createdAt:new Date().toISOString()};
  const { readFile }=await import('node:fs/promises');const { fileHash }=await import('../src/skills/package.js');const rules=join(process.cwd(),'fixtures/skill-scanning/rules.yaml');const result=await semgrepScanner({command:'/nonexistent/semgrep',rulesPath:rules,rulesDigest:fileHash(await readFile(rules)),version:'1.182.0'})(parsed.content,report);expect(result.state).toBe('failed');expect(result.scanned).toEqual([]);expect(result.errors.join('')).toContain('不可用');
});
