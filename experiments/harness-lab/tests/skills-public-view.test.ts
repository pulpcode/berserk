import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { SkillSummary, SkillUseDetail } from '../src/contracts/skills.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

test('test-mode skill details provide the same safe display contract without starting a trial', async () => {
  const root=await mkdtemp(join(tmpdir(),'axon-r3-public-view-'));
  const config=testConfig(root);const fake=await fakeRuntime(config,()=>({text:'No automatic calls'}));
  const lab=await PiLab.create(config,fake.runtime);const app=await createApp(lab);
  try{
    const catalog=await app.inject('/api/capabilities/skills');expect(catalog.statusCode).toBe(200);
    const builtin=catalog.json<SkillSummary[]>().find(s=>s.skillId==='synthesis')!;
    expect(builtin.name).toBe('资料综合写作');
    const response=await app.inject(`/api/capabilities/skills/${builtin.skillId}?revisionId=${builtin.revisionId}&packageDigest=${builtin.packageDigest}`);
    expect(response.statusCode).toBe(200);const detail=response.json<SkillUseDetail>();
    expect(detail.trialSummary).toEqual({status:'not_tried'});
    expect(detail.releaseVersion).toBe(builtin.releaseVersion);
    expect(detail.files.some(file=>file.path==='SKILL.md')).toBe(true);
    expect(detail).not.toHaveProperty('snapshot');expect(detail).not.toHaveProperty('ownerId');
    expect(fake.calls).toHaveLength(0);expect(lab.list()).toHaveLength(0);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
