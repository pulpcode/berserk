import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { COMPOSER_INPUT, composerInputText, decodeComposerInput, validSkill } from '../../src/pi/composer-input.js';
import { decodeResourceRecord } from '../../src/pi/history-evidence.js';
import { requestRecord, RESOURCE_ENTRY } from '../../src/pi/resource-tools.js';
import { hashContent } from '../../src/resources/files.js';
import { loadControlledSkills } from '../../src/resources/service.js';
import { WorkspaceStore } from '../../src/workspaces/store.js';
import { fakeRuntime, testConfig, type Reply } from './fake-runtime.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(reply: Parameters<typeof fakeRuntime>[1] = () => ({text:'完成'})) {
  const dir=await mkdtemp(join(tmpdir(),'axon-map-skill-')); cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir), fake=await fakeRuntime(config,reply), lab=await PiLab.create(config,fake.runtime);
  cleanup.push(()=>lab.close()); const session=await lab.createSession();
  return {dir,config,lab,session,...fake};
}

describe('deployed map Skill and native compatibility',()=>{
  it('exposes one effective catalog without rewriting the legacy workspace index',async()=>{
    const f=await setup(),path=join(f.dir,'workspace-index.json'),before=await readFile(path,'utf8');
    const info=await f.lab.resources.info(f.session.workspaceId);
    expect(info.skills.map(s=>s.id)).toEqual(['synthesis','review','map-annotations']);
    const body=await f.lab.resources.readSkill(f.session.workspaceId,'map-annotations');
    expect(body.hash).toBe(hashContent(body.content)); expect(Buffer.byteLength(body.content)).toBeLessThan(16384);
    expect(body.content).toContain('新增对象不等于新建图层');
    expect((await f.lab.resources.snapshot(f.session.workspaceId)).skills.map(s=>s.id)).toEqual(info.skills.map(s=>s.id));
    expect(await readFile(path,'utf8')).toBe(before);
    expect((await WorkspaceStore.open(f.dir)).get(f.session.workspaceId).skillIds).toEqual(['synthesis','review']);
    await expect(f.lab.resources.readSkill(f.session.workspaceId,'unknown-map')).rejects.toMatchObject({code:'RESOURCE_NOT_FOUND'});
  });

  it('loads the body only on demand and preserves actual Skill reads through restart',async()=>{
    const f=await setup((_context,index):Reply=>index===1?{tools:[{name:'skill_read',arguments:{id:'map-annotations'}}]}:{text:'完成'});
    const skill=await f.lab.resources.readSkill(f.session.workspaceId,'map-annotations');
    await f.lab.start(f.session.id,'你好').run(()=>{});
    expect(f.calls[0].context.systemPrompt).toContain('map-annotations');
    expect(JSON.stringify(f.calls[0].context)).not.toContain(skill.content);
    const request=f.lab.start(f.session.id,'修改地图标注'); await request.run(()=>{});
    expect(f.lab.getRequestResources(f.session.id,request.requestId)).toMatchObject({readSkills:[skill]});
    expect(JSON.stringify(f.calls[2].context.messages)).toContain('新增对象不等于新建图层');
    const before=f.lab.get(f.session.id); await f.lab.close();
    const next=await PiLab.create(f.config,(await fakeRuntime(f.config,()=>({text:'继续'}))).runtime); cleanup.push(()=>next.close());
    expect(next.get(f.session.id).messages).toEqual(before.messages);
    expect(next.getRequestResources(f.session.id,request.requestId)).toMatchObject({readSkills:[skill]});
  });

  it('continues a two-Skill historical record and reopens mixed explicit selections without changing old bytes',async()=>{
    const f=await setup(),review=await f.lab.resources.readSkill(f.session.workspaceId,'review');
    await f.lab.start(f.session.id,'检查资料',{skill:review}).run(()=>{}); await f.lab.close();
    const file=join(f.dir,'sessions',(await readdir(join(f.dir,'sessions')))[0]);
    const lines=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    for(const line of lines)if(line.customType===RESOURCE_ENTRY)line.data.skills=line.data.skills.filter((s:{id:string})=>s.id!=='map-annotations');
    const old=lines.map(line=>JSON.stringify(line)).join('\n')+'\n'; await writeFile(file,old);
    const next=await PiLab.create(f.config,(await fakeRuntime(f.config,()=>({text:'新标绘答复'}))).runtime); cleanup.push(()=>next.close());
    expect(next.get(f.session.id).recoveryWarning).toBeUndefined();
    expect(await readFile(file,'utf8')).toBe(old);
    const map=await next.resources.readSkill(f.session.workspaceId,'map-annotations');
    await next.start(f.session.id,'查阅地图方法',{skill:map}).run(()=>{});
    const snapshot=next.get(f.session.id); expect(snapshot.lastResult?.status).toBe('succeeded');
    expect(snapshot.messages.filter(m=>m.role==='user').map(m=>m.selections?.skill?.id)).toEqual(['review','map-annotations']);
    expect((await readFile(file,'utf8')).startsWith(old)).toBe(true); await next.close();
    const reopened=await PiLab.create(f.config,(await fakeRuntime(f.config,()=>({text:'继续'}))).runtime); cleanup.push(()=>reopened.close());
    expect(reopened.get(f.session.id).messages).toEqual(snapshot.messages);
  });

  it('retains strict ID, body hash, resource membership and duplicate checks for new records',async()=>{
    const f=await setup(),snapshot=await f.lab.resources.snapshot(f.session.workspaceId),skill=snapshot.skills.find(s=>s.id==='map-annotations')!;
    const record=requestRecord(randomUUID(),snapshot);
    expect(decodeResourceRecord(record,f.session.workspaceId).skills).toHaveLength(3);
    expect(()=>decodeResourceRecord({...record,skills:[...record.skills,record.skills[0]]},f.session.workspaceId)).toThrow();
    expect(()=>decodeResourceRecord({...record,readSkills:[{...skill,content:skill.content+'fake'}]},f.session.workspaceId)).toThrow();
    expect(()=>decodeResourceRecord({...record,skills:record.skills.filter(s=>s.id!=='map-annotations'),readSkills:[skill]},f.session.workspaceId)).toThrow();
    expect(validSkill({...skill,id:'unknown'},true)).toBe(false);
    const composer={workspaceId:f.session.workspaceId,sessionId:f.session.id,requestId:randomUUID(),skill};
    expect(decodeComposerInput(composer,f.session.workspaceId,f.session.id,COMPOSER_INPUT).skill).toEqual(skill);
    expect(()=>decodeComposerInput({...composer,skill:{...skill,hash:'0'.repeat(64)}},f.session.workspaceId,f.session.id)).toThrow();
    expect(composerInputText({skill})).toContain('所选 Skill 正文已经加载');
    expect((await loadControlledSkills(['review'])).map(s=>s.id)).toEqual(['review']);
  });

  it('forwards an explicitly selected map method to a read-only child without adding map tools',async()=>{
    const f=await setup((_context,index)=>index===0?{tools:[{name:'subagent',arguments:{agent:'analyst',task:'按所选方法检查术语'}}]}:{text:'已检查'});
    const skill=await f.lab.resources.readSkill(f.session.workspaceId,'map-annotations');
    const agent=(await f.lab.agents(f.session.workspaceId)).find(a=>a.name==='analyst')!;
    await f.lab.start(f.session.id,'检查地图术语',{skill,agent}).run(()=>{});
    expect(f.lab.get(f.session.id).lastResult?.status).toBe('succeeded');
    expect(JSON.stringify(f.calls[1].context.messages)).toContain('新增对象不等于新建图层');
    expect(f.calls[1].context.tools?.map(t=>t.name)).toEqual(['source_list','source_read','instructions_read']);
  });
});
