import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { PiLab } from '../../src/pi/lab.js';
import { SkillService } from '../../src/skills/service.js';
import { packageMethod } from '../../src/resources/skill-package.js';
import { decodeComposerInput, COMPOSER_INPUT_V7 } from '../../src/pi/composer-input.js';
import { fakeRuntime, testConfig } from './fake-runtime.js';
import { DockerExecutionService, type DockerRunner } from '../../src/execution/docker.js';

test('a published package works without a trial, retains exact native input and rejects stale package selections',async()=>{
  const root=await mkdtemp(join(tmpdir(),'axon-r3-method-')); const config=testConfig(root);
  const fake=await fakeRuntime(config,()=>({text:'按固定方法完成'}));
  let lab=await PiLab.create(config,fake.runtime);
  try {
    // Fixture management authority is injected only into the isolated core service.
    lab.skills.close();lab.skills=await SkillService.open(root);
    const actor={userId:'fixture-admin',assertAdministrator:()=>{}};
    const draft=await lab.skills.create(actor,{clientActionId:randomUUID()}); const id=draft.skill.skillId;
    const source='---\nname: fixed-method\ndescription: 固定包方法\n---\n原样使用 R3-MARKER。\n';
    const saved=await lab.skills.saveDraft(actor,id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from(source).toString('base64')}]});
    await lab.skills.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
    const published=await lab.skills.publish(actor,id,{expectedDraftRevision:saved.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'方法首发，不试用',clientActionId:randomUUID()});
    const pkg=await lab.skills.resolve(published,{userId:'seat:test-seat',seatId:'test-seat'});
    const method=packageMethod(pkg); const session=await lab.createSession();
    const selected={id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest};
    await lab.start(session.id,'按此方法处理',{skill:selected}).run(()=>{});
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(JSON.stringify(fake.calls[0].context)).toContain('R3-MARKER');
    const jsonl=(await readdir(join(root,'sessions'))).find(name=>name.endsWith(`_${session.id}.jsonl`))!;
    const original=await readFile(join(root,'sessions',jsonl),'utf8');
    expect(original).toContain(COMPOSER_INPUT_V7);
    expect(lab.get(session.id).messages.find(message=>message.role==='user')?.selections?.skill).toMatchObject({schemaVersion:2,packageDigest:pkg.packageDigest,content:source});
    const before=fake.calls.length;
    await lab.start(session.id,'拒绝错误修订',{skill:{...selected,packageDigest:'0'.repeat(64)}}).run(()=>{});
    expect(lab.get(session.id).lastResult?.status).toBe('failed');expect(fake.calls).toHaveLength(before);
    await lab.close();lab=await PiLab.create(config,fake.runtime);
    expect(lab.get(session.id).messages.some(message=>message.selections?.skill?.packageDigest===pkg.packageDigest)).toBe(true);
    expect((await readFile(join(root,'sessions',jsonl),'utf8')).startsWith(original)).toBe(true);
    expect(()=>decodeComposerInput({workspaceId:session.workspaceId,sessionId:session.id,requestId:randomUUID(),skill:method},session.workspaceId,session.id)).toThrow();
  } finally {await lab.close();await rm(root,{recursive:true,force:true});}
},30000);

test('on-demand skill reads activate only their fixed package and file tools read that request mount',async()=>{
  const root=await mkdtemp(join(tmpdir(),'axon-r3-activation-'));const config=testConfig(root);
  let skillId='',virtual='',workspace='',skills='',visible:string[]=[];const mounts:string[][]=[];
  const ok=(text='')=>({code:0,stdout:Buffer.from(text),stderr:Buffer.alloc(0)});
  const runner:DockerRunner=async(args,options)=>{
    if(args[0]==='info')return ok('linux');
    if(args[0]==='run'){
      mounts.push(args);
      workspace=args.find(a=>a.startsWith('type=bind,src=')&&a.endsWith(',dst=/workspace'))!.slice(14,-15);
      skills=args.find(a=>a.startsWith('type=bind,src=')&&a.endsWith(',dst=/skills,readonly'))!.slice(14,-21);
      visible=await readdir(skills);return ok();
    }
    if(args[0]!=='exec')return ok();
    const at=args.indexOf('/opt/berserk/files.py');if(at<0)return ok();const[operation,path]=args.slice(at+1);
    const target=path.startsWith('/skills/')?join(skills,path.slice(8)):join(workspace,path.replace(/^\/workspace\/?/,''));
    if(operation==='read')return ok(await readFile(target,'utf8'));
    if(operation==='write'){if(path.startsWith('/skills/'))throw new Error('readonly');await writeFile(target,options?.input??'');return ok();}
    if(operation==='mkdir'){await mkdir(target,{recursive:true});return ok();}
    if(operation==='stat')return ok(JSON.stringify({directory:false}));return ok('true');
  };
  const fake=await fakeRuntime(config,(_context,index)=>index===0?{tools:[{name:'skill_read',arguments:{id:skillId}}]}:index===1?{tools:[{name:'read',arguments:{path:`${virtual}/assets/sample.txt`}}]}:index===2?{tools:[{name:'write',arguments:{path:'/workspace/result.md',content:'模板结果'}}]}:index===3?{tools:[{name:'file_output',arguments:{path:'/workspace/result.md'}}]}:{text:'完成'});
  const lab=await PiLab.create(config,fake.runtime,new DockerExecutionService({instanceId:root},runner));
  try {
    lab.skills.close();lab.skills=await SkillService.open(root);
    const actor={userId:'fixture-admin',assertAdministrator:()=>{}};
    const create=async(name:string)=>{
      const detail=await lab.skills.create(actor,{clientActionId:randomUUID()}),id=detail.skill.skillId;
      const source=`---\nname: ${name}\ndescription: 延迟资源验证\n---\n按需读取assets/sample.txt\n`;
      const draft=await lab.skills.saveDraft(actor,id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from(source).toString('base64')},{path:'assets/sample.txt',contentBase64:Buffer.from('SAMPLE-R3').toString('base64')}]});
      await lab.skills.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
      return lab.skills.publish(actor,id,{clientActionId:randomUUID(),expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'fixture'});
    };
    const selected=await create('on-demand-package');const unused=await create('unused-package');skillId=selected.skillId;
    virtual=packageMethod(await lab.skills.resolve(selected,{userId:'seat:test-seat',seatId:'test-seat'})).resourceRoot!;
    const session=await lab.createSession();await lab.start(session.id,'读取所需技能并生成结果').run(()=>{});
    expect(lab.get(session.id).lastResult?.status).toBe('succeeded');
    expect(lab.get(session.id).fileOutputs?.[0]?.name).toBe('result.md');
    expect(JSON.stringify(fake.calls[2].context)).toContain('SAMPLE-R3');
    expect(visible).toEqual([selected.skillId]);expect(visible).not.toContain(unused.skillId);
    expect(mounts[0].filter(arg=>arg.includes('dst=/skills'))).toEqual([`type=bind,src=${skills},dst=/skills,readonly`]);
  }finally{await lab.close();await rm(root,{recursive:true,force:true});}
},30000);
