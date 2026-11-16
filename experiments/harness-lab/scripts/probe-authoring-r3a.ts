/** R3A live acceptance: isolated synthetic accounts/data, original Pi loop and real confirmations. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {loadConfig,type LabConfig} from '../src/server/config.js';
import {configuredRuntime} from '../src/pi/model-runtime.js';
import {PiLab} from '../src/pi/lab.js';
import {createApp} from '../src/server/app.js';
import {openDatabase} from '../src/access/database.js';
import {AccessStore} from '../src/access/store.js';
import {migrateAdministratorAccounts} from '../src/access/administrator-schema.js';
import {SystemRoles} from '../src/access/system-roles.js';
import {packageMethod} from '../src/resources/skill-package.js';
import type {AuthSession} from '../src/contracts/access.js';
import type {AuthoringIntent,AuthoringProposal} from '../src/contracts/authoring.js';
import type {SessionSnapshot,StreamEvent} from '../src/contracts/index.js';
import type {ExpertValidation,ExpertPublication} from '../src/contracts/capability-management.js';
import type {ExpertTrialRunView} from '../src/contracts/capability-trials.js';

// Existing Node env-file configuration supplies the selected model in memory.
// No production auth/context/history or credential files are copied.
delete process.env.LAB_CONTEXT_CONFIG;delete process.env.LAB_BACKGROUND_CONFIG;
const dataDir=await mkdtemp(join(tmpdir(),'axon-r3a-live-'));
const password=randomBytes(24).toString('hex');
const config=loadConfig({...process.env,PORT:'4310',LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_TEST_SEATS:undefined,LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined,LAB_SESSION_SECRET:randomBytes(40).toString('hex'),LAB_EXECUTION_ENABLED:'true',AGENT_RUN_TIMEOUT_MS:'180000'});
assert.ok(config.apiKey,'请提供现有授权模型配置。');
const calls:Array<{tools:string[];model:string}>=[],checks:string[]=[],records:unknown[]=[];
const runtimeFactory=async(cfg:LabConfig)=>{const runtime=await configuredRuntime(cfg),original=runtime.streamSimple.bind(runtime);runtime.streamSimple=(...args)=>{assert.ok(calls.length<45,'探针45次调用预算耗尽；不自动重试任务。');calls.push({model:args[0].id,tools:args[1].tools?.map(t=>t.name)??[]});return original(...args);};return runtime;};
let lab:PiLab|undefined,app:FastifyInstance|undefined,failure:string|undefined;const started=Date.now();
const db=await openDatabase(dataDir),access=new AccessStore(db);
await access.saveAccount({username:'business',displayName:'合成业务用户',seatId:'business',seatName:'合成业务席位',password,createPublicTask:false,manageModelSettings:false});
migrateAdministratorAccounts(db);const adminId=await access.saveAdministratorAccount({username:'admin',displayName:'R3A合成管理员',password});db.close();
try{
  lab=await PiLab.create(config,await runtimeFactory(config));assert.ok(lab.info().files?.executionAvailable,'真实Docker执行环境不可用。');
  app=await createApp(lab,false,undefined,{config:{systems:[],scopes:[]},env:{}},{runtimeFactory});
  const first=await app.inject('/api/auth/session'),anon=first.json<AuthSession>();
  const logged=await app.inject({method:'POST',url:'/api/auth/login',headers:{cookie:first.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anon.csrf!},payload:{username:'admin',password}});assert.equal(logged.statusCode,200);
  const auth=logged.json<AuthSession>();assert.equal(auth.identity?.role,'administrator');
  const headers={cookie:logged.cookies.map(c=>`${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
  const ok=async<T>(url:string,payload?:object,method?:'GET'|'POST'|'PUT'):Promise<T>=>{const r=await app!.inject({url,method:method??(payload?'POST':'GET'),headers,...(payload?{payload}:{})});assert.equal(r.statusCode,200,`${url}: ${r.body}`);return r.json<T>();};
  const task=await ok<{id:string}>('/api/tasks',{title:'R3A隔离创作验收',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await ok<{id:string}>(`/api/tasks/${task.id}/workspace`,{});
  const session=await ok<SessionSnapshot>('/api/sessions',{workspaceId:workspace.id,clientActionId:randomUUID()});
  const scope=auth.identity!.personalScopeId;assert.ok(scope);assert.equal(session.messages.length,0);assert.equal(calls.length,0);
  const actor={userId:adminId,assertAdministrator:()=>new SystemRoles(lab!.access!.db).requireAdministrator(adminId)};
  const run=async(text:string,intent?:AuthoringIntent,selection:Parameters<PiLab['start']>[2]={})=>{
    const events:StreamEvent[]=[];let approvals=0,confirmationError:unknown;
    const request=lab!.start(session.id,text,{...selection,...(intent?{authoring:intent}:{})},scope,undefined,adminId);
    await request.run(event=>{events.push(event);if(event.type==='interaction.updated'&&event.interaction.status==='pending'){
      try{
        const i=event.interaction;assert.equal(i.kind,'confirmation');if(i.kind!=='confirmation')throw Error('出现未预期问答。');
        const proposal=i.action.authoring?.proposal as AuthoringProposal|undefined;assert.ok(proposal,'只批准明确合成创作保存。');
        assert.equal(proposal.ownerUserId,adminId);assert.equal(proposal.sessionId,session.id);assert.equal(proposal.requestId,request.requestId);assert.equal(proposal.candidate.kind,intent?.kind);assert.equal(proposal.targetId,intent?.targetId);
        if(proposal.candidate.kind==='expert'){assert.match(proposal.candidate.content.name,/R3A/);assert.deepEqual(proposal.candidate.content.allowedTools,[]);assert.deepEqual(proposal.candidate.content.skillIds,[]);}
        else{assert.ok(proposal.candidate.files.every(f=>/^(SKILL\.md|references\/[\w.-]+\.md|templates\/[\w.-]+\.md)$/.test(f.path)));}
        approvals++;lab!.respondInteraction(session.id,i.interactionId,{requestId:i.requestId,kind:'confirmation',decision:'approve'},scope);
      }catch(error){confirmationError=error;lab!.cancel(session.id,request.requestId);}
    }});
    if(confirmationError)throw confirmationError;
    const saved=lab!.get(session.id,scope);records.push({text,intent,approvals,events,snapshot:saved});assert.equal(saved.lastResult?.status,'succeeded',saved.lastResult?.message);if(intent)assert.equal(approvals,1,'每次候选只确认一次。');return saved;
  };
  await run('请创建一个专家草稿，名称为“R3A资料核对专家”，简介为“核对明确输入并保留未知项”。专业指令为“只根据用户给出的内容核对资料；未知就说明未知；回答末尾加 R3A_EXPERT_READY。”工具范围为空数组、旧技能引用为空数组、新技能引用为空数组。需求已明确，无需问答；请按管理方法提出完整候选并请求网页确认保存，不发布、不改范围。',{kind:'expert'});
  const experts=(await lab.management!.list()).filter(e=>e.name==='R3A资料核对专家');assert.equal(experts.length,1);const expertId=experts[0].expertId;
  assert.equal(experts[0].currentRevisionId,null);checks.push('真实管理员原个人对话创建完整专家草稿，原确认后真实数据库保存且未发布');
  const before=(await lab.management!.get(expertId)).draft!;
  await run(`请只修改专家 ${expertId} 的简介，改为“R3A 精确核对与未知项记录”，其他字段全部保持。先读取当前草稿及基线，提出单字段候选，然后请求网页确认保存，不发布。`,{kind:'expert',targetId:expertId});
  const edited=(await lab.management!.get(expertId)).draft!;assert.equal(edited.content.description,'R3A 精确核对与未知项记录');assert.equal(edited.content.instructions,before.content.instructions);assert.deepEqual(edited.content.allowedTools,before.content.allowedTools);checks.push('同会话精确修改专家简介，原指令和工具不变');
  await run('请创建方法型技能草稿，标准名称 r3a-check-method，描述“核对给定输入并列出未知项”。SKILL.md frontmatter 除 name/description 外，明确加 license: MIT、metadata: {round: r3a}，并加一行注释 # R3A_PRESERVE_COMMENT。SKILL.md正文：先列事实，再列未知项，最后给出核对建议；回答结尾加 R3A_METHOD_READY。另建 references/example.md，内容为“示例：未提供的数量保持未知。”不要脚本、依赖、二进制；需求已完整无需问答。使用真实管理方法生成候选，请求网页确认保存，不发布不改范围。',{kind:'skill'});
  const skills=lab.skills.list().filter(s=>s.name==='r3a-check-method');assert.equal(skills.length,1);const skillId=skills[0].skillId;assert.equal(skills[0].revisionId,'');
  const original=lab.skills.detail(skillId).draft!;const methodBytes=original.files.find(f=>f.path==='SKILL.md')!.contentBase64;
  await run(`请修改技能 ${skillId}，只把 references/example.md 改为“示例：未提供的数量保持未知，不能猜测。”其他文件及元数据保持原字节。先读取真实草稿与基线，再提出候选并请求网页确认保存。`,{kind:'skill',targetId:skillId});
  let savedSkill=lab.skills.detail(skillId).draft!;assert.equal(savedSkill.files.find(f=>f.path==='SKILL.md')!.contentBase64,methodBytes);assert.match(Buffer.from(savedSkill.files.find(f=>f.path==='references/example.md')!.contentBase64,'base64').toString(),/不能猜测/);checks.push('同会话转向方法技能创建与单文件修改，未改SKILL.md字节保真');
  const methodBefore=Buffer.from(methodBytes,'base64').toString('utf8');assert.match(methodBefore,/R3A_PRESERVE_COMMENT/);assert.match(methodBefore,/license:/);assert.match(methodBefore,/metadata:/);
  const frontmatter=/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(methodBefore)?.[0];assert.ok(frontmatter);
  const referenceBytes=savedSkill.files.find(f=>f.path==='references/example.md')!.contentBase64;
  await run(`只修改技能 ${skillId} 的SKILL.md正文，在原正文末尾加“核对后仍需记录未知项。”，务必使用methodBody补丁通道，不要提交完整SKILL.md文件；frontmatter、注释、扩展字段及references/example.md都保持原字节。先读取当前基线，再提出候选和网页保存确认。`,{kind:'skill',targetId:skillId});
  savedSkill=lab.skills.detail(skillId).draft!;const bodyEdited=Buffer.from(savedSkill.files.find(f=>f.path==='SKILL.md')!.contentBase64,'base64').toString('utf8');assert.ok(bodyEdited.startsWith(frontmatter));assert.match(bodyEdited,/核对后仍需记录未知项/);assert.equal(savedSkill.files.find(f=>f.path==='references/example.md')!.contentBase64,referenceBytes);checks.push('真实正文专用补丁保留原frontmatter注释、license、metadata及其他文件字节');
  // Publication is deliberately separate from model authoring tools, using original management APIs.
  await lab.skills.setPolicy(actor,skillId,{mode:'none',seatIds:[],expectedRevision:0,clientActionId:randomUUID()});
  const publication=await lab.skills.publish(actor,skillId,{expectedDraftRevision:savedSkill.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'R3A隔离验收：无需试用直接发布',clientActionId:randomUUID()});
  const pkg=await lab.skills.resolve(publication,{userId:adminId,seatId:scope,canCollaborate:false}),method=packageMethod(pkg);
  await run('请使用本条明确选择的方法，根据输入“计划10，完成数未知”给出核对说明。不要调用管理工具。',undefined,{skill:{id:method.id,hash:method.hash,revisionId:method.revisionId,packageDigest:method.packageDigest}});
  assert.match(lab.get(session.id,scope).messages.filter(m=>m.role==='assistant').at(-1)?.text??'',/R3A_METHOD_READY/);checks.push('原范围明确未开放业务席位，技能未试用直接发布后管理员个人对话真实使用');
  const root=`/api/admin/capabilities/experts/${expertId}`;
  await ok(`${root}/policy`,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()},'PUT');
  const validation=await ok<ExpertValidation>(`${root}/validate`,{expectedDraftRevision:edited.draftRevision});assert.ok(validation.valid);
  let trial=await ok<ExpertTrialRunView>(`${root}/trials`,{expectedDraftRevision:edited.draftRevision,validationId:validation.validationId,clientActionId:randomUUID(),input:'合成试用：只根据输入“已知事实为A，数量未知”做简短核对，不用工具。'});
  const deadline=Date.now()+210000;while(['prepared','running'].includes(trial.trial.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,500));trial=await ok(`${root}/trials/${trial.trial.trialId}`);}
  records.push({expertTrial:trial});assert.equal(trial.trial.status,'succeeded',trial.trial.evidence?.summary);
  await ok(`${root}/trials/${trial.trial.trialId}/confirm`,{approved:true,reason:'已核对合成试用实际回答与未知项，无业务工具。',clientActionId:randomUUID()});
  const released=await ok<ExpertPublication>(`${root}/publish`,{expectedDraftRevision:edited.draftRevision,expectedCurrentRevisionId:null,validationId:validation.validationId,trialId:trial.trial.trialId,releaseNotes:'R3A合成专家原流程试用确认后发布',acceptedRiskCodes:validation.issues.filter(i=>i.severity==='warning').map(i=>i.code),clientActionId:randomUUID()});
  const business=lab.access!.identityForSeat('business')!;const businessTask=lab.access!.create(business,{title:'R3A合成专家使用',goal:'',visibility:'private',clientActionId:randomUUID()});
  const businessWorkspace=await lab.workspaces.ensureWorkspace(businessTask.id,business.seatId,businessTask.title);
  const expertSession=await lab.createSession(businessWorkspace.id,business.seatId,undefined,undefined,undefined,{userId:business.userId,expertRef:{expertId,revisionId:released.revisionId},expectedDigest:released.digest,clientActionId:randomUUID()});
  await lab.start(expertSession.id,'核对输入：事实为A，数量未知。',{},business.seatId,undefined,business.userId).run(()=>{});
  const actual=lab.get(expertSession.id,business.seatId);assert.equal(actual.lastResult?.status,'succeeded');assert.match(actual.messages.filter(m=>m.role==='assistant').at(-1)?.text??'',/R3A_EXPERT_READY/);records.push({publishedExpertUse:actual});checks.push('专家沿用原校验、真实试用、独立人工确认后发布并实际使用');
  const count=calls.length;await app.close();app=undefined;lab=await PiLab.create(config,await runtimeFactory(config));assert.equal(calls.length,count);assert.equal(lab.get(session.id,scope).messages.filter(m=>m.role==='user').length,6);assert.equal((await lab.management!.get(expertId)).draft!.content.description,edited.content.description);checks.push('重开读取真实原会话与草稿，不调用模型、不重放保存');
}catch(error){failure=error instanceof Error?error.message:'R3A真实验收失败。';}
finally{await app?.close();if(!app)await lab?.close();const report={passed:!failure,failure,dataDir,elapsedMs:Date.now()-started,model:{provider:config.provider,id:config.model},calls,checks,records};const serialized=JSON.stringify(report,null,2);assert.ok(!serialized.includes(config.apiKey)&&!serialized.includes(password),'证据含凭据拒绝落盘。');const evidence=join(dataDir,'r3a-live-evidence.json');await writeFile(evidence,serialized,{mode:0o600});console.log(JSON.stringify({passed:!failure,failure,evidence,checks,calls:calls.length}));if(failure)process.exitCode=1;}
