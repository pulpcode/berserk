import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import { hashContent } from '../src/resources/files.js';

test('builtin display names remain separate from canonical package roots without rewriting revisions', async () => {
  const root=await mkdtemp(join(tmpdir(),'axon-r3-builtin-label-'));
  const cap=await CapabilityService.open(root);initializeR2Schema(cap.db);cap.close();
  const service=await SkillService.open(root,{createdNew:true});
  const actor={userId:'synthetic-admin',assertAdministrator:()=>{}};
  const content='---\nname: synthesis\ndescription: Builtin method\n---\nUse evidence.';
  const builtin={id:'synthesis',name:'资料综合写作',description:'中文目录名',version:'1',content,hash:hashContent(content)};
  try{
    await service.registerBuiltins([builtin]);const first=service.list()[0];
    expect(first.name).toBe('资料综合写作');
    const original=await service.resolveForManagement(first,actor);
    expect(original.name).toBe('synthesis');
    await service.registerBuiltins([{...builtin,name:'资料综合写作（内置）'}]);
    const second=service.list()[0];expect(second.name).toBe('资料综合写作（内置）');
    expect(second.revisionId).toBe(first.revisionId);expect(second.packageDigest).toBe(first.packageDigest);
    expect(await service.resolveForManagement(second,actor)).toEqual(original);
    await expect(service.saveDraft(actor,builtin.id,{expectedDraftRevision:1,files:[]})).rejects.toThrow('内置技能只读');
  }finally{service.close();await rm(root,{recursive:true,force:true});}
});
