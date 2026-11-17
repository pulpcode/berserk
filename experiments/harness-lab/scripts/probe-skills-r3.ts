/** Isolated R3 physical acceptance. Real configured provider and Docker; no production data/listener. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { PiLab } from '../src/pi/lab.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import { packageMethod } from '../src/resources/skill-package.js';
import type { SkillActor, SkillPackageRevision } from '../src/contracts/skills.js';
import type { StreamEvent } from '../src/contracts/index.js';
import { SkillTrials } from '../src/pi/skill-trials.js';

const dataDir=await mkdtemp(join(tmpdir(),'axon-skills-r3-live-'));
const password=randomBytes(24).toString('base64url');
const config=loadConfig({...process.env,PORT:'4310',LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_TEST_SEATS:undefined,
  LAB_SESSION_SECRET:randomBytes(40).toString('hex'),LAB_EXECUTION_ENABLED:'true',AGENT_RUN_TIMEOUT_MS:'180000'});
assert.ok(config.apiKey,'真实模型配置缺失。');
let calls=0;
const trackedRuntime=async(selected:typeof config)=>{const runtime=await configuredRuntime(selected);const original=runtime.streamSimple.bind(runtime);runtime.streamSimple=(...args)=>{assert.ok(++calls<=35,'探针35次模型调用预算耗尽；不自动重试。');return original(...args);};return runtime;};
const runtime=await trackedRuntime(config);
const checks:string[]=[],records:unknown[]=[];let lab:PiLab|undefined,trials:SkillTrials|undefined,failure:string|undefined;
const started=Date.now();
try {
  const db=await openDatabase(dataDir),access=new AccessStore(db);
  await access.saveAccount({username:'business',displayName:'合成业务席位',seatId:'probe-business',seatName:'合成业务席位',password,createPublicTask:true,manageModelSettings:false});
  migrateAdministratorAccounts(db);const adminId=await access.saveAdministratorAccount({username:'admin',displayName:'合成管理员',password});db.close();
  lab=await PiLab.create(config,runtime);assert.ok(lab.info().files?.executionAvailable,'真实Docker不可用。');
  const actor:SkillActor={userId:adminId,assertAdministrator:()=>new SystemRoles(lab!.access!.db).requireAdministrator(adminId)};
  const business=lab.access!.identityForSeat('probe-business')!;
  const space=lab.access!.create(business,{title:'R3合成验收',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await lab.workspaces.ensureWorkspace(space.id,business.seatId,space.title);
  const publish=async(name:string,extras:Array<{path:string;content:string}>=[],instructions='只根据本条请求执行，不扩大权限。')=>{
    const detail=await lab!.skills.create(actor,{clientActionId:randomUUID()});const id=detail.skill.skillId;
    const files=[{path:'SKILL.md',content:`---\nname: ${name}\ndescription: 合成R3验收技能\n---\n${instructions}\n`},...extras].map(file=>({path:file.path,contentBase64:Buffer.from(file.content).toString('base64')}));
    const draft=await lab!.skills.saveDraft(actor,id,{expectedDraftRevision:1,files});
    await lab!.skills.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:[business.seatId],clientActionId:randomUUID()});
    const publication=await lab!.skills.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'合成验证，未进行试用直接发布',clientActionId:randomUUID()});
    return lab!.skills.resolve(publication,{userId:business.userId,seatId:business.seatId,canCollaborate:true});
  };
  const method=await publish('probe-method',[],'用当前方法时回答固定标记 METHOD-R3-OK。');
  const python=await publish('probe-python',[{path:'scripts/report.py',content:'from pathlib import Path\nPath("/workspace/python-report.md").write_text("PYTHON-R3-OK", encoding="utf-8")\nprint("PYTHON-R3-OK")\n'}]);
  const js=await publish('probe-javascript',[{path:'scripts/report.js',content:'require("fs").writeFileSync("/workspace/javascript-report.md","JAVASCRIPT-R3-OK"); console.log("JAVASCRIPT-R3-OK");\n'}]);
  const template=await publish('probe-template',[{path:'templates/report.md',content:'# TEMPLATE-R3-OK\n模板原始内容\n'}]);
  checks.push('四类合成技能包可在未试用情况下发布，范围明确为真实合成业务席位');
  const commands=new Set<string>();
  const run=async(pkg:SkillPackageRevision,text:string,expectedTool?:string)=>{
    const method=packageMethod(pkg),session=await lab!.createSession(workspace.id,business.seatId,undefined,undefined,undefined,{userId:business.userId});
    const events:StreamEvent[]=[];
    await lab!.start(session.id,text,{skill:{id:method.id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest}},business.seatId,undefined,business.userId).run(event=>{
      events.push(event);
      if(event.type==='interaction.updated'&&event.interaction.status==='pending'){
        const i=event.interaction;
        if(i.kind!=='confirmation'||!i.action.command||!commands.has(i.action.command))throw new Error('出现未授权的探针交互，停止验收。');
        lab!.respondInteraction(session.id,i.interactionId,{requestId:i.requestId,kind:'confirmation',decision:'approve'},business.seatId);
      }
    });
    const saved=lab!.get(session.id,business.seatId);assert.equal(saved.lastResult?.status,'succeeded',saved.lastResult?.message);
    if(expectedTool)assert.ok(events.some(e=>e.type==='tool.started'&&e.toolName===expectedTool),`未实际调用${expectedTool}`);
    records.push({kind:pkg.name,sessionId:session.id,events,snapshot:saved});return saved;
  };
  const result=await run(method,'请使用显式选择的方法回答，不调用其他工具。');
  assert.match(result.messages.filter(m=>m.role==='assistant').at(-1)?.text??'',/METHOD-R3-OK/);
  checks.push('已发布方法在业务会话通过固定修订实际使用');
  for(const [pkg,interpreter,file,marker]of [[python,'python','python-report.md','PYTHON-R3-OK'],[js,'node','javascript-report.md','JAVASCRIPT-R3-OK']]as const){
    const path=`${packageMethod(pkg).resourceRoot}/scripts/report.${interpreter==='python'?'py':'js'}`,command=`${interpreter} ${path}`;commands.add(command);
    const saved=await run(pkg,`这是明确授权的合成任务。只需用bash原样执行命令 ${JSON.stringify(command)}，再用file_output交付 /workspace/${file}。不要改写脚本或命令，不安装依赖，不自动重试。`,'bash');
    const output=saved.fileOutputs?.find(f=>f.name===file);assert.ok(output,'没有实际下载成果');
    const download=await lab.files.openDownload(workspace.id,output.downloadId,business.seatId);
    const chunks:Buffer[]=[];for await(const chunk of download.stream)chunks.push(Buffer.from(chunk));assert.match(Buffer.concat(chunks).toString(),new RegExp(marker));
  }
  checks.push('Python与JavaScript通过真实Docker读取固定只读包脚本，生成并下载实际成果');
  const selectedTemplate=await run(template,`请用read读取 ${packageMethod(template).resourceRoot}/templates/report.md，用write把原文写入 /workspace/template-copy.md，再用file_output交付。禁止修改/skills。`,'read');
  assert.ok(selectedTemplate.fileOutputs?.some(f=>f.name==='template-copy.md'));checks.push('模板从只读资源区读取并写入工作区成果');
  assert.equal((await lab.skills.resolve(method,{userId:adminId,seatId:`account-${adminId}`,canCollaborate:false})).packageDigest,method.packageDigest);
  await assert.rejects(lab.skills.resolve(method,{userId:adminId,seatId:business.seatId,canCollaborate:false}));
  await assert.rejects(lab.skills.resolve(method,{userId:'other',seatId:'other-seat',canCollaborate:true}));
  checks.push('独立管理员个人范围可解析已发布技能，伪造业务范围及未授权席位仍拒绝');
  trials=await SkillTrials.open({dataDir,modelConfig:()=>config,runtimeFactory:trackedRuntime,assertTrialAllowed:skillId=>lab!.skills.assertTrialAllowed(skillId),authorize:userId=>new SystemRoles(lab!.access!.db).requireAdministrator(userId)});
  const action=randomUUID(),trial=await trials.start(actor,{clientActionId:action,package:method,input:'按固定技能只回答 METHOD-R3-OK，不用工具。'});
  const wait=async(id:string)=>{const until=Date.now()+180000;while(Date.now()<until){const view=trials!.get(actor,id);if(!['prepared','running'].includes(view.trial.status))return view;await new Promise(r=>setTimeout(r,100));}throw new Error('试用超时。');};
  const completed=await wait(trial.trial.trialId);assert.equal(completed.trial.status,'succeeded',completed.trial.evidence?.summary);
  const before=calls;const repeated=await trials.start(actor,{clientActionId:action,package:method,input:'按固定技能只回答 METHOD-R3-OK，不用工具。'});assert.equal(repeated.trial.trialId,trial.trial.trialId);assert.equal(calls,before);
  await trials.close();trials=await SkillTrials.open({dataDir,modelConfig:()=>config,runtimeFactory:trackedRuntime,assertTrialAllowed:skillId=>lab!.skills.assertTrialAllowed(skillId),authorize:userId=>new SystemRoles(lab!.access!.db).requireAdministrator(userId)});
  assert.equal(trials.get(actor,trial.trial.trialId).trial.status,'succeeded');assert.equal(calls,before);
  records.push({kind:'optional-trial',view:completed});checks.push('可选隔离试用真实模型成功，动作重试/服务重开不重跑');
  // Direct sandbox checks are physical evidence independent of model obedience.
  const {DockerExecutionService}=await import('../src/execution/docker.js');
  const execution=new DockerExecutionService({instanceId:dataDir+'-isolation',...config.execution,memoryMiB:config.execution?.memoryMb});await execution.initialize();
  const {mkdir}=await import('node:fs/promises');const privateRoot=join(dataDir,'physical-skills');await mkdir(join(privateRoot,method.skillId),{recursive:true});
  await lab.skills.materialize(method,{userId:business.userId,seatId:business.seatId,canCollaborate:true},join(privateRoot,method.skillId,method.revisionId));
  const logs=join(dataDir,'physical-logs');await mkdir(logs);const sandbox=execution.create({requestId:randomUUID(),workspaceDir:lab.files.filesDirectory(workspace.id,business.seatId),logsDir:logs,skillsDir:privateRoot});
  try{
    await sandbox.readFile(`${packageMethod(method).resourceRoot}/SKILL.md`);
    const searched=await sandbox.grep(packageMethod(method).resourceRoot!,{pattern:'probe-method',literal:true}) as {matches:unknown[]};assert.ok(searched.matches.length,'只读技能资源grep无实际命中');
    await assert.rejects(sandbox.writeFile(`${packageMethod(method).resourceRoot}/SKILL.md`,'overwrite'));
    await assert.rejects(sandbox.readFile('/etc/passwd'));
    let stdout='';const missing=await sandbox.exec('python -c "import axon_r3_intentionally_missing_dependency"','/workspace',{onData:data=>{stdout+=data.toString();}});
    assert.notEqual(missing.exitCode,0);assert.match(stdout,/ModuleNotFoundError/);
    const aborter=new AbortController();const pending=sandbox.exec('python -c "import time; time.sleep(60)"','/workspace',{signal:aborter.signal,onData:()=>{}});setTimeout(()=>aborter.abort(),250);
    await assert.rejects(pending);records.push({kind:'physical-missing-dependency',output:stdout});
  }finally{await sandbox.close();await execution.close();}
  checks.push('真实沙箱包只读/宿主路径拒绝，缺依赖实际错误与进程取消已验证（独立于模型试用）');
  const history=await lab.readSavedSession(result.id,business.seatId);assert.equal(history.messages.find(m=>m.role==='user')?.selections?.skill?.packageDigest,method.packageDigest);
}catch(error){failure=error instanceof Error?error.message:'验收失败';}
finally{
  await trials?.close();await lab?.close();
  const report={passed:!failure,...(failure?{failure}:{}),dataDir,calls,elapsedMs:Date.now()-started,checks,records,model:{provider:config.provider,id:config.model}};
  const serialized=JSON.stringify(report,null,2);assert.ok(!serialized.includes(config.apiKey!)&&!serialized.includes(password),'报告含凭证，拒绝写入');
  const path=join(dataDir,'skills-r3-evidence.json');await writeFile(path,serialized);console.log(JSON.stringify({passed:!failure,checks,evidence:path,calls}));
  if(failure)process.exitCode=1;
}
