/** Fresh, isolated map trial. Starting it never sends source events or model messages. */
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../src/access/database.js';
import {AccessStore} from '../src/access/store.js';
import {BackgroundStore} from '../src/background/store.js';
import {parseBackgroundConfig} from '../src/background/config.js';
import {parseContextConfig} from '../src/context/config.js';
import {PiLab} from '../src/pi/lab.js';
import {createApp} from '../src/server/app.js';
import {loadConfig} from '../src/server/config.js';
import type {AuthSession} from '../src/contracts/access.js';
import type {SessionSnapshot} from '../src/contracts/index.js';
import type {ContextRef} from '../src/contracts/context.js';
import {control} from './probe-task-plan.js';

const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const seats=['overall','intelligence','planning','situation'] as const;
const seatNames=['总体席','情报席','筹划席','态势席'];
type Seat=typeof seats[number];
export interface MapTrialManifest {
  version:1; trialId:string; day:string; dataDir:string; url:string; socket:string;
  tasks:{supply:string;transfer:string;control:string};
  objects:{road:ContextRef;resource:ContextRef}; createdAt:string;
}
interface PrivateConfig {
  accounts:Record<string,{username:string;password:string}>;
  sessions:Record<string,Record<string,string>>;
}
async function save(path:string,value:unknown) {
  await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600}); await chmod(path,0o600);
}
export async function mapTrialAuth(manifest:MapTrialManifest,seat:Seat='overall') {
  const path=join(manifest.dataDir,'credentials.json');
  const config=JSON.parse(await readFile(path,'utf8')) as PrivateConfig;
  if (config.sessions[seat]) return config.sessions[seat];
  const initial=await fetch(`${manifest.url}/api/auth/session`);
  const initialAuth=await initial.json() as AuthSession;
  const response=await fetch(`${manifest.url}/api/auth/login`,{method:'POST',headers:{
    'content-type':'application/json',origin:manifest.url,'x-csrf-token':initialAuth.csrf!,
    cookie:initial.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),
  },body:JSON.stringify(config.accounts[seat])});
  if (!response.ok) throw new Error(`登录失败 HTTP ${response.status}`);
  const session=await response.json() as AuthSession;
  const headers={cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),
    origin:manifest.url,'x-csrf-token':session.csrf!,'x-axon-view':session.viewId!};
  config.sessions[seat]=headers; await save(path,config); return headers;
}
export async function mapTrialRequest<T>(manifest:MapTrialManifest,path:string,seat:Seat='overall',method='GET',body?:unknown):Promise<T> {
  const headers=await mapTrialAuth(manifest,seat);
  const response=await fetch(`${manifest.url}${path}`,{method,headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export interface MapTrialOptions {background?:'original'|'neutral'}
/** Neutral diagnostics change only synthetic task text/seat duties; data ownership and access stay fixed. */
export function mapTrialBackground(options:MapTrialOptions,original:{title:string;goal:string;responsibility:string}) {
  return options.background==='neutral'
    ? {title:'空间资料核对任务',goal:'空间资料核对合成测试。',responsibility:'合成测试席位。'}
    : original;
}
export async function startMapTrial(port=4321,env:NodeJS.ProcessEnv=process.env,serveWeb=true,options:MapTrialOptions={}) {
  const dataDir=await mkdtemp(join(tmpdir(),'axon-map-')); await chmod(dataDir,0o700);
  const trialId=`map-${randomUUID().slice(0,8)}`;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const url=`http://127.0.0.1:${port}`, socket=join(dataDir,'mock.sock');
  const secret=randomBytes(40).toString('hex'),queryToken=randomBytes(32).toString('hex'),controlToken=randomBytes(32).toString('hex');
  const sourceEnv:NodeJS.ProcessEnv={MOCK_CONTEXT_API_TOKEN:queryToken,MOCK_CONTEXT_CONTROL_TOKEN:controlToken,
    MOCK_INTEL_SOURCE_TOKEN:randomBytes(32).toString('hex'),MOCK_SITUATION_SOURCE_TOKEN:randomBytes(32).toString('hex')};
  const notificationConfig=join(dataDir,'notifications.json');
  await save(notificationConfig,[
    {systemId:'intel',sourceId:'mock-intel-source',url,tokenEnv:'MOCK_INTEL_SOURCE_TOKEN'},
    {systemId:'situation',sourceId:'mock-situation-source',url,tokenEnv:'MOCK_SITUATION_SOURCE_TOKEN'},
  ]);
  await save(join(dataDir,'service-secrets.json'),{...sourceEnv,LAB_SESSION_SECRET:secret});
  const mock=spawn(process.execPath,['--import','tsx',join(packageRoot,'scripts/mock-context/main.ts')],{
    cwd:packageRoot,env:{...env,...sourceEnv,MOCK_CONTEXT_PORT:'0',MOCK_CONTEXT_CONTROL_SOCKET:socket,
      MOCK_CONTEXT_INSTANCE_ID:trialId,MOCK_CONTEXT_DAY:day,MOCK_CONTEXT_DATA_DIR:join(dataDir,'mock'),MOCK_CONTEXT_NOTIFICATION_CONFIG:notificationConfig},stdio:'ignore',
  });
  let app:Awaited<ReturnType<typeof createApp>>|undefined;
  let stopped=false;
  const stop=async()=>{
    if (stopped) return; stopped=true;
    try {await app?.close();} finally {
      if (mock.exitCode===null && mock.signalCode===null) {
        const ended=new Promise<void>(resolveEnd=>mock.once('exit',()=>resolveEnd()));
        mock.kill('SIGTERM'); await ended;
      }
    }
  };
  try {
    let mockUrl:string|undefined;
    for (let attempt=0;attempt<100;attempt++) {
      if (mock.exitCode!==null) throw new Error('模拟服务启动失败，请核对本期模拟配置。');
      try {mockUrl=(await control(socket,['status']) as {url:string}).url;break;}
      catch {await new Promise(resolveWait=>setTimeout(resolveWait,50));}
    }
    if (!mockUrl) throw new Error('模拟服务启动超时。');
    const context=parseContextConfig({systems:[
      {id:'intel',name:'模拟特情系统',adapter:'mock-information-http',baseUrl:`${mockUrl}/intel`,tokenEnv:'MOCK_CONTEXT_API_TOKEN',areas:[{id:`${trialId}-zone-west`,name:'西区'},{id:`${trialId}-zone-east`,name:'东区'}]},
      {id:'situation',name:'模拟态势系统',adapter:'mock-situation-http',baseUrl:`${mockUrl}/situation`,tokenEnv:'MOCK_CONTEXT_API_TOKEN',areas:[{id:`${trialId}-zone-west`,name:'西区'},{id:`${trialId}-zone-east`,name:'东区'}]},
    ],scopes:[{id:'demo-context',name:'本轮模拟资料',systemIds:['intel','situation'],seatIds:seats.map(seat=>`seat-${seat}`)}],
    simulation:{enabled:true,baseUrl:mockUrl,tokenEnv:'MOCK_CONTEXT_CONTROL_TOKEN',sources:[{systemId:'intel',sourceId:'mock-intel-source'},{systemId:'situation',sourceId:'mock-situation-source'}]}});
    const background=parseBackgroundConfig(JSON.parse(await readFile(join(packageRoot,'fixtures/background-seat-routing.example.json'),'utf8')));
    await save(join(dataDir,'context-config.json'),context); await save(join(dataDir,'background-config.json'),background);
    const credentials:PrivateConfig={accounts:{},sessions:{}};
    const db=await openDatabase(dataDir),access=new AccessStore(db);
    const tasks:MapTrialManifest['tasks']={supply:'',transfer:'',control:''};
    try {
      for (const [index,seat] of seats.entries()) {
        credentials.accounts[seat]={username:seat,password:randomBytes(18).toString('hex')};
        await access.saveAccount({...credentials.accounts[seat],displayName:seatNames[index],seatId:`seat-${seat}`,seatName:seatNames[index],createPublicTask:seat==='overall',manageModelSettings:seat==='overall',viewWorkOverview:seat==='overall'});
        const responsibility=await readFile(join(packageRoot,'fixtures/seat-responsibilities',`${seat}.md`),'utf8');
        access.updateSeat(`seat-${seat}`,{responsibility:mapTrialBackground(options,{title:'',goal:'',responsibility}).responsibility});
      }
      const actor=access.identityForSeat('seat-overall')!;
      for (const [key,title,zone,count,time] of [
        ['supply','西区补给任务','west',3,'09:40'],['transfer','西区设备转移任务','west',1,'10:20'],['control','东区对照任务','east',2,'09:45'],
      ] as const) {
        const backgroundText=mapTrialBackground(options,{title,
          goal:`合成测试：在 ${day} ${time} 开始办理，至少需要 ${count} 辆车，关注${zone==='west'?'西':'东'}区通道与车辆池。供人员研判，不直接下达真实执行指令。`,responsibility:''});
        tasks[key]=access.create(actor,{clientActionId:randomUUID(),title:`【地图验证 ${trialId}】${backgroundText.title}`,visibility:'public',
          goal:backgroundText.goal,
          context:{businessRefs:[{systemId:'situation',objectType:'road',objectId:`${trialId}-road-${zone}-01`},{systemId:'situation',objectType:'resource',objectId:`${trialId}-vehicles-${zone}-01`}],
            focus:{areaIds:[`${trialId}-zone-${zone}`],time:{from:`${day}T${time}:00+08:00`,to:`${day}T11:00:00+08:00`},topics:['通行','车辆']}}}).id;
      }
    } finally {db.close();}
    await save(join(dataDir,'credentials.json'),credentials);
    const config=loadConfig({...env,PORT:String(port),LAB_DATA_DIR:dataDir,LAB_AUTH_MODE:'login',LAB_SESSION_SECRET:secret,LAB_SEAT_ID:'seat-overall',LAB_TEST_SEATS:undefined});
    const lab=await PiLab.create(config),store=new BackgroundStore(lab.access!.db);
    for (const source of background.sources) store.grant('seat','seat-overall',source.sourceId,'manage');
    app=await createApp(lab,serveWeb,{config:background,env:sourceEnv},{config:context,env:sourceEnv});
    await app.listen({host:'127.0.0.1',port});
    const manifest:MapTrialManifest={version:1,trialId,day,dataDir,url,socket,tasks,createdAt:new Date().toISOString(),
      objects:{road:{systemId:'situation',objectType:'road',objectId:`${trialId}-road-west-01`},resource:{systemId:'situation',objectType:'resource',objectId:`${trialId}-vehicles-west-01`}}};
    for (const source of background.sources) await mapTrialRequest(manifest,'/api/information/rules','overall','POST',{
      clientActionId:randomUUID(),name:'地图验证：情报席接收，总体席审批补充投递',sourceId:source.sourceId,profileId:'context-analysis',
      recipientSeatIds:['seat-intelligence'],supplementaryDelivery:{candidateSeatIds:['seat-planning','seat-situation']},enabled:true,
    });
    await save(join(dataDir,'manifest.json'),manifest);
    return {manifest,stop,lab};
  } catch (error) {await stop();throw error;}
}

/** Explicit synthetic-data live request; saves actual response without rewriting expected conclusions. */
export async function queryMapTrial(manifest:MapTrialManifest) {
  const workspace=await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'planning','POST',{});
  const session=await mapTrialRequest<{id:string}>(manifest,'/api/sessions','planning','POST',{workspaceId:workspace.id});
  const headers=await mapTrialAuth(manifest,'planning');
  const response=await fetch(`${manifest.url}/api/sessions/${session.id}/messages`,{method:'POST',headers:{...headers,'content-type':'application/json'},
    body:JSON.stringify({text:'请结合本任务目标，说明所引用道路和车辆池的当前状态及影响，列出依据的版本；需要补充资料时可以查询。',contextRefs:[manifest.objects.road,manifest.objects.resource]}),signal:AbortSignal.timeout(600_000)});
  if (!response.ok) throw new Error(`模型请求未接受：HTTP ${response.status}`);
  const reader=response.body!.getReader(),decoder=new TextDecoder();let stream='',buffer='',cancelled=false;
  for (;;) {
    const part=await reader.read();if(part.done)break;
    const text=decoder.decode(part.value,{stream:true});stream+=text;buffer+=text;
    const lines=buffer.split('\n');buffer=lines.pop()!;
    for (const line of lines) if (line.startsWith('data: ')) {
      const event=JSON.parse(line.slice(6));
      if (!cancelled && event.type==='interaction.updated' && event.interaction?.status==='pending') {
        cancelled=true;
        await mapTrialRequest(manifest,`/api/sessions/${session.id}/cancel`,'planning','POST',{requestId:event.requestId});
      }
    }
  }
  const snapshot=await mapTrialRequest<SessionSnapshot>(manifest,`/api/sessions/${session.id}`,'planning');
  const evidenceDir=join(manifest.dataDir,'evidence');await mkdir(evidenceDir,{recursive:true,mode:0o700});
  const path=join(evidenceDir,`query-${Date.now()}.json`);
  await save(path,{at:new Date().toISOString(),sessionId:session.id,stream,snapshot});return {sessionId:session.id,path,snapshot};
}
async function main() {
  const [command,...args]=process.argv.slice(2);
  if (!['serve','verify'].includes(command) || (args.length && !(args.length===2 && args[0]==='--port' && /^\d+$/.test(args[1])))) throw new Error('用法：serve/verify [--port 4321]；每次建立独立测试目录。verify 明确发起一次真实模型请求。');
  const trial=await startMapTrial(args.length?Number(args[1]):4321,process.env,command==='serve');
  console.info(JSON.stringify({url:trial.manifest.url,dataDir:trial.manifest.dataDir,manifest:join(trial.manifest.dataDir,'manifest.json'),credentials:join(trial.manifest.dataDir,'credentials.json'),tasks:trial.manifest.tasks}));
  if (command==='verify') {
    try {
      const evidence=await queryMapTrial(trial.manifest);
      console.info(JSON.stringify({evidence:evidence.path,status:evidence.snapshot.lastResult?.status,loaded:evidence.snapshot.messages.filter(message=>message.role==='user').at(-1)?.selections?.context?.refs.length??0}));
      if (evidence.snapshot.lastResult?.status!=='succeeded') process.exitCode=1;
    } finally {await trial.stop();}
    return;
  }
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>void trial.stop());
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
