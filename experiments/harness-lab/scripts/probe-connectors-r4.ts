/** Actual model + actual SDK/HTTP loop, using disposable synthetic accounts and targets. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { configuredRuntime } from '../src/pi/model-runtime.js';
import { PiLab } from '../src/pi/lab.js';
import { ConnectorService } from '../src/connectors/service.js';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import type { ConnectorConfigInput, ConnectorSummary } from '../src/contracts/connectors.js';
import type { SessionSnapshot } from '../src/contracts/index.js';
import { startControlledMcp } from './mcp-controlled-fixture.js';

const outputIndex=process.argv.indexOf('--output-dir');
assert.ok(outputIndex>=0&&process.argv[outputIndex+1],'请指定独立 --output-dir；不会使用生产数据。');
const output=resolve(process.argv[outputIndex+1]);await mkdir(output,{recursive:true,mode:0o700});
const dataDir=await mkdtemp(join(tmpdir(),'axon-r4-live-'));
const config=loadConfig({...process.env,PORT:'4398',LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_TEST_SEATS:undefined,LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined,LAB_SESSION_SECRET:randomBytes(40).toString('hex'),LAB_EXECUTION_ENABLED:'false',LAB_CONTEXT_CONFIG:undefined,LAB_BACKGROUND_CONFIG:undefined,AGENT_RUN_TIMEOUT_MS:'180000'});
assert.ok(config.apiKey,'请使用现有授权方舟配置；不要将密钥写入探针参数或产物。');
const fixtureA=await startControlledMcp({label:'alpha'}),fixtureB=await startControlledMcp({label:'beta',era:'legacy'});
let lab:PiLab|undefined;
const records:unknown[]=[],snapshots:SessionSnapshot[]=[],modelCalls:Array<{model:string;tools:string[];contextBytes:number}>=[];
const sourceFiles=['src/pi/lab.ts','src/pi/mcp-tools.ts','src/pi/mcp-history.ts','src/pi/interactions.ts','src/pi/history-evidence.ts','src/connectors/remote.ts','src/connectors/network.ts','src/connectors/schema.ts','src/connectors/service.ts','src/contracts/mcp.ts','package-lock.json'];
const sourceHashes=await Promise.all(sourceFiles.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
const start=performance.now();let failure:string|undefined;
try {
  const db=await openDatabase(dataDir),access=new AccessStore(db),password=randomBytes(32).toString('hex');
  await access.saveAccount({username:'business',displayName:'合成业务席位',seatId:'business',seatName:'业务席位',password,createPublicTask:true,manageModelSettings:false});
  migrateAdministratorAccounts(db);const userId=await access.saveAdministratorAccount({username:'admin',displayName:'合成管理员',password});db.close();
  const runtime=await configuredRuntime(config),stream=runtime.streamSimple.bind(runtime);
  runtime.streamSimple=(...args)=>{assert.ok(modelCalls.length<18,'真实模型调用预算18次耗尽；不自动重试探针。');modelCalls.push({model:args[0].id,tools:args[1].tools?.map(tool=>tool.name)??[],contextBytes:Buffer.byteLength(JSON.stringify(args[1]))});return stream(...args);};
  lab=await PiLab.create(config,runtime);
  lab.connectors=await ConnectorService.open(dataDir,{createdNew:true});lab.connectors.initializeLegacy();
  const actor={userId,assertActive:()=>{assert.ok(lab!.access!.accountIdentity(userId));},assertAdministrator:()=>new SystemRoles(lab!.access!.db).requireAdministrator(userId)};
  const add=async(name:string,endpoint:string,approvedTargets:string[],toolName='lookup'):Promise<ConnectorSummary>=>{
    const input:ConnectorConfigInput={name,description:'R4受控真实线协议探针',endpoint,approvedTargets,auth:{mode:'none',credentialSource:'organization'},policy:{mode:'none',seatIds:[],personal:false},exposedTools:[]};
    let detail=await lab!.connectors!.create(actor,{...input,clientActionId:randomUUID()});
    const before=performance.now(),catalog=await lab!.connectors!.discover(actor,detail.connection.connectorId,{expectedRevisionId:detail.revision.revisionId,clientActionId:randomUUID()});
    const first=catalog.tools.find(tool=>tool.available&&tool.name===toolName)!;assert.ok(first);
    detail=await lab!.connectors!.update(actor,detail.connection.connectorId,{...input,policy:{mode:'all',seatIds:[],personal:true},exposedTools:[{name:first.name,contractDigest:first.contractDigest}],expectedRevisionId:detail.revision.revisionId,clientActionId:randomUUID()});
    await lab!.connectors!.lifecycle(actor,detail.connection.connectorId,{action:'restore',expectedStateRevision:detail.connection.stateRevision,clientActionId:randomUUID()});
    records.push({kind:'discovery',name,protocolVersion:catalog.protocolVersion,protocolEra:catalog.protocolEra,tools:catalog.tools.map(tool=>tool.name),catalogBytes:Buffer.byteLength(JSON.stringify(catalog)),durationMs:performance.now()-before});
    return lab!.connectors!.detail(actor,detail.connection.connectorId).connection;
  };
  const a=await add('R4-alpha',fixtureA.url,fixtureA.networkPolicy.approvedTargets),b=await add('R4-beta',fixtureB.url,fixtureB.networkPolicy.approvedTargets);
  const identity=lab.access!.workspaceIdentity(userId)!;
  const task=lab.access!.create(identity,{title:'R4合成个人空间',goal:'',visibility:'private',clientActionId:randomUUID()});
  const workspace=await lab.workspaces.create(task.title,task.id,identity.seatId);
  const run=async(connection:ConnectorSummary,query:string,action='lookup')=>{
    const session=await lab!.createSession(workspace.id,identity.seatId,undefined,undefined,undefined,{userId});
    let approvals=0,approvalError:unknown;const before=performance.now();
    const request=lab!.start(session.id,`请调用已选连接${connection.name}的${action}工具，query参数必须为${JSON.stringify(query)}。只查询一次，并用真实结果说明来源。不要使用其他连接。`,{connectorIds:[connection.connectorId]},identity.seatId,undefined,userId);
    await request.run(event=>{
      if(event.type!=='interaction.updated'||event.interaction.status!=='pending')return;
      try {const item=event.interaction;assert.equal(item.kind,'confirmation');if(item.kind!=='confirmation')throw Error('未预期问答');assert.equal(item.action.mcp?.connectorId,connection.connectorId);assert.equal(item.action.mcp.toolName,action);assert.deepEqual(item.action.parameters,{query});approvals++;assert.ok(approvals<=1,'不批准重复调用');lab!.respondInteraction(session.id,item.interactionId,{requestId:request.requestId,kind:'confirmation',decision:'approve'},identity.seatId);}catch(error){approvalError=error;lab!.cancel(session.id,request.requestId);}
    });
    if(approvalError)throw approvalError;
    const snapshot=lab!.get(session.id,identity.seatId);snapshots.push(snapshot);
    assert.equal(snapshot.lastResult?.status,'succeeded');assert.equal(approvals,1);
    const tool=snapshot.messages.find(message=>message.toolDetails?.mcp?.connectorId===connection.connectorId);
    assert.equal(tool?.toolDetails?.mcp?.status,'success');assert.ok(tool.text.length>0);if(action==='lookup')assert.ok(tool.text.includes(query));
    records.push({kind:'model-loop',name:connection.name,model:config.model,requestId:request.requestId,source:tool.toolDetails?.mcp,durationMs:performance.now()-before,assembly:lab!.capabilityTimings.at(-1)});
  };
  if(!process.argv.includes('--public-only')) {
    await run(a,'R4_SYNTHETIC_ALPHA');
    if(process.argv.includes('--measure-warm'))await run(a,'R4_SYNTHETIC_ALPHA_WARM');
    await run(b,'R4_SYNTHETIC_BETA');
  }
  if(process.argv.includes('--public-cloudflare')) {
    const ipIndex=process.argv.indexOf('--approved-ip'),ip=ipIndex>=0?process.argv[ipIndex+1]:undefined;
    const publicConnection=await add('Cloudflare 官方文档','https://docs.mcp.cloudflare.com/mcp',ip?[ip]:[],'search_cloudflare_documentation');
    await run(publicConnection,'How do Cloudflare Workers handle HTTP requests?','search_cloudflare_documentation');
  }
  assert.equal(fixtureA.records.filter(record=>record.method==='tools/call').length,process.argv.includes('--public-only')?0:process.argv.includes('--measure-warm')?2:1);assert.equal(fixtureB.records.filter(record=>record.method==='tools/call').length,process.argv.includes('--public-only')?0:1);
  assert.ok(modelCalls.every(call=>!JSON.stringify(call).includes(config.apiKey)));
} catch(error) {failure=error instanceof Error?error.message:'探针失败';}
finally {
  await lab?.close();await fixtureA.close();await fixtureB.close();
  const report={schemaVersion:1,sourceHashes,node:process.version,model:config.model,sdk:'@modelcontextprotocol/client@2.4.0',scope:process.argv.includes('--public-cloudflare')?'受控双服务及Cloudflare公开文档MCP、真实方舟模型、原Pi确认；不代表用户验收':'受控MCP、真实方舟模型、原Pi确认；不代表第三方业务或用户验收',publicNetwork:process.argv.includes('--public-cloudflare')?{endpoint:'https://docs.mcp.cloudflare.com/mcp',tlsVerification:'native HTTPS certificate and hostname validation retained',temporaryApprovedIp:process.argv.includes('--approved-ip')?process.argv[process.argv.indexOf('--approved-ip')+1]:null}:null,durationMs:performance.now()-start,records,modelCalls,...(process.argv.includes('--public-cloudflare')?{publicTarget:'https://docs.mcp.cloudflare.com/mcp',temporaryApprovedIp:process.argv[process.argv.indexOf('--approved-ip')+1],tlsHostnameVerification:true}:{}),...(failure?{failure}:{})};
  const serialized=JSON.stringify({report,snapshots});assert.ok(!serialized.includes(config.apiKey),'拒绝保存秘密');
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2),{mode:0o600});await writeFile(join(output,'snapshots.json'),JSON.stringify(snapshots,null,2),{mode:0o600});
  await rm(dataDir,{recursive:true,force:true});
  console.log(JSON.stringify({ok:!failure,report:join(output,'report.json'),modelCalls:modelCalls.length,loops:records.filter(record=>(record as {kind?:string}).kind==='model-loop').length,...(failure?{failure}:{})}));
}
if(failure)process.exitCode=1;
