import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';
import { previewSkillImport } from '../src/skills/import.js';

const method = '---\nname: sample\ndescription: Test method\n---\nUse the attached data.';
/** Independent ZIP writer; uploaded contents are data and are never executed. */
function archive(entries: Array<{path:string; text?:string; mode?:number}>) {
  const written = spawnSync('python3', ['-c', `import sys,json,zipfile,io
items=json.load(sys.stdin); output=io.BytesIO()
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED) as z:
 for item in items:
  info=zipfile.ZipInfo(item['path']);info.create_system=3
  info.external_attr=(item.get('mode',0o100644)<<16)
  z.writestr(info,item.get('text','').encode())
sys.stdout.buffer.write(output.getvalue())`], {input:JSON.stringify(entries), maxBuffer:2*1024*1024});
  if (written.status !== 0) throw new Error('Independent ZIP fixture writer failed');
  return written.stdout;
}

test('ZIP import preserves custom resource directories and exact bytes without executing contents', async () => {
  const zip = archive([{path:'sample/SKILL.md',text:method},{path:'sample/custom/data.txt',text:'reference bytes'},{path:'sample/scripts/never-run.py',text:'raise RuntimeError("must never execute on import")'}]);
  const preview = await previewSkillImport('sample.zip',zip);
  expect(preview.validation.valid).toBe(true);
  expect(preview.files.map(f=>f.path)).toContain('custom/data.txt');
  expect(Buffer.from(preview.files.find(f=>f.path==='SKILL.md')!.contentBase64,'base64').toString()).toBe(method);
});

test.each(['../escape.txt','/absolute.txt','C:/absolute.txt','path\\escape.txt'])('ZIP rejects unsafe path %s', async path => {
  await expect(previewSkillImport('bad.zip',archive([{path:'SKILL.md',text:method},{path,text:'untrusted'}]))).rejects.toThrow();
});

test('ZIP rejects links, normalized duplicate paths, multiple skills and deep packaging', async () => {
  for(const entries of [
    [{path:'SKILL.md',text:method},{path:'link',text:'/etc/passwd',mode:0o120777}],
    [{path:'SKILL.md',text:method},{path:'a.txt',text:'one'},{path:'A.txt',text:'two'}],
    [{path:'one/SKILL.md',text:method},{path:'two/SKILL.md',text:method}],
    [{path:'outer/sample/SKILL.md',text:method}],
    [{path:'SKILL.md',text:method},{path:'ref',text:'file'},{path:'ref/child.txt',text:'collision'}],
  ]) await expect(previewSkillImport('bad.zip',archive(entries))).rejects.toThrow();
});

test('directory-name mismatch is a visible format error and unsupported archives are rejected', async () => {
  const mismatch=await previewSkillImport('other.zip',archive([{path:'other/SKILL.md',text:method}]));
  expect(mismatch.validation.valid).toBe(false);
  expect(mismatch.validation.issues.some(i=>i.code==='ROOT_NAME_MISMATCH')).toBe(true);
  await expect(previewSkillImport('data.tar',Buffer.from('untrusted archive'))).rejects.toThrow();
});

test('declared excessive ZIP expansion and encrypted archives are rejected before extraction', async () => {
  const excessive=archive([{path:'SKILL.md',text:method}]);
  const central=excessive.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  excessive.writeUInt32LE(101*1024*1024,central+24);
  await expect(previewSkillImport('large.zip',excessive)).rejects.toThrow();
  const encrypted=archive([{path:'SKILL.md',text:method}]);
  encrypted.writeUInt16LE(1,6);encrypted.writeUInt16LE(1,encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]))+8);
  await expect(previewSkillImport('encrypted.zip',encrypted)).rejects.toThrow();
});
