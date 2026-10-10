/** Manual, fresh-only task-plan trial. No agent messages or business confirmations are automated. */
import {spawn, execFileSync} from 'node:child_process';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, writeFile, appendFile} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
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
import type {WorkDetail, WorkItem} from '../src/contracts/collaboration.js';
import type {IncomingInformation} from '../src/background/service.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const seats = ['overall', 'intelligence', 'planning', 'situation'] as const;
const names = ['总体席', '情报席', '筹划席', '态势席'];
type EventName = 'E1' | 'E2' | 'E4';
export interface Manifest {
  version: 1; trialId: string; dataDir: string; url: string; socket: string;
  tasks: {primary: string; control: string}; workspaceId: string;
  createdAt: string; metadata: Record<string, unknown>;
}
interface PrivateConfig {
  accounts: Record<string, {username: string; password: string}>;
  tokens: Record<string, string>; sessions: Record<string, Record<string,string>>;
}
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
async function save(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2), {mode: 0o600});
  await chmod(path, 0o600);
}
export async function control(socketPath: string, args: string[]): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const socket = createConnection(socketPath); let body = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('模拟控制超时')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`${JSON.stringify(args)}\n`));
    socket.on('data', data => {body += data.toString(); if (body.length > 2_000_000) socket.destroy(new Error('模拟响应过大'));});
    socket.on('end', () => {try {const result = JSON.parse(body); if (result.error) reject(new Error(result.error)); else resolveResult(result);} catch {reject(new Error('模拟响应无效'));}});
  });
}
async function request<T>(manifest: Manifest, path: string, headers: Record<string,string>, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${manifest.url}${path}`, {method, headers: {...headers, ...(body === undefined ? {} : {'content-type':'application/json'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
async function auth(manifest: Manifest, seat = 'overall') {
  const path = join(manifest.dataDir, 'credentials.json'), config = await json<PrivateConfig>(path);
  if (config.sessions[seat]) return config.sessions[seat];
  const initial = await fetch(`${manifest.url}/api/auth/session`);
  const initialAuth = await initial.json() as AuthSession;
  const response = await fetch(`${manifest.url}/api/auth/login`, {method:'POST', headers:{'content-type':'application/json', cookie:initial.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '), origin:manifest.url, 'x-csrf-token':initialAuth.csrf!}, body:JSON.stringify(config.accounts[seat])});
  if (!response.ok) throw new Error(`登录失败 HTTP ${response.status}`);
  const session = await response.json() as AuthSession;
  const headers = {cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '), origin:manifest.url, 'x-csrf-token':session.csrf!, 'x-axon-view':session.viewId!};
  config.sessions[seat] = headers; await save(path, config); return headers;
}
export function hasSubmittedPrimaryV1(manifest: Manifest, detail: WorkDetail) {
  return detail.taskSpaceId === manifest.tasks.primary && detail.creatorSeatId === 'seat-overall'
    && detail.assigneeSeatId === 'seat-planning' && detail.state === 'submitted'
    && detail.submissions.some(submission => submission.id === detail.latestSubmissionId && submission.attempt === 1 && submission.submittedBy === 'seat-planning');
}
export async function sendEvent(manifest: Manifest, event: EventName) {
  const cache = join(manifest.dataDir, `${event}-payload.json`);
  let payload: IncomingInformation | undefined;
  try {payload = await json<IncomingInformation>(cache);} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  const source = event === 'E2' ? 'mock-situation-source' : 'mock-intel-source';
  const secrets = await json<PrivateConfig>(join(manifest.dataDir, 'credentials.json'));
  const headers = {authorization:`Bearer ${secrets.tokens[source]}`};
  // Receipt lookup precedes any replay, including after an uncertain network result.
  const receiptResponse = await fetch(`${manifest.url}/api/integrations/${source}/events?sourceMessageId=${encodeURIComponent(`${manifest.trialId}-${event}`)}`, {headers, signal:AbortSignal.timeout(30000)});
  if (receiptResponse.ok) return receiptResponse.json();
  if (receiptResponse.status !== 404) throw new Error(`查询接入回执失败 HTTP ${receiptResponse.status}`);
  if (!payload) {
    if (event === 'E4') {
      const authorized = await auth(manifest);
      const works = await request<WorkItem[]>(manifest, '/api/work-items', authorized);
      let submitted = false;
      for (const work of works.filter(work=>work.taskSpaceId === manifest.tasks.primary)) {
        if (hasSubmittedPrimaryV1(manifest, await request<WorkDetail>(manifest, `/api/work-items/${work.id}`, authorized))) submitted = true;
      }
      if (!submitted) throw new Error('E4 需要主任务由筹划席实际提交第一稿、总体席尚未验收的交接记录。');
    }
    await control(manifest.socket, ['advance', event === 'E1' ? 'intel' : event === 'E2' ? 'situation' : 'recovery']);
    payload = {...await control(manifest.socket, ['event', event]) as IncomingInformation, sourceMessageId:`${manifest.trialId}-${event}`};
    await save(cache, payload); // Freeze E2's epoch cursor before HTTP admission.
  }
  return request(manifest, `/api/integrations/${source}/events`, headers, 'POST', payload);
}
export async function startTrial(port = 4320, env: NodeJS.ProcessEnv = process.env, serveWeb = true) {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-plan-'));
  await chmod(dataDir, 0o700);
  const config = loadConfig({...env, LAB_DATA_DIR:dataDir, LAB_AUTH_MODE:'login', LAB_SESSION_SECRET:randomBytes(40).toString('hex'), LAB_SEAT_ID:'seat-overall', LAB_TEST_SEATS:undefined, PORT:String(port)});
  const privateConfig: PrivateConfig = {accounts:{}, tokens:{}, sessions:{}};
  const db = await openDatabase(dataDir), access = new AccessStore(db);
  let tasks: Manifest['tasks'];
  try {
    for (const [index, seat] of seats.entries()) {
      privateConfig.accounts[seat] = {username:`seat-${seat}`, password:randomBytes(24).toString('hex')};
      await access.saveAccount({...privateConfig.accounts[seat], displayName:names[index], seatId:`seat-${seat}`, seatName:names[index], createPublicTask:seat === 'overall', manageModelSettings:seat === 'overall', viewWorkOverview:seat === 'overall'});
      access.updateSeat(`seat-${seat}`, {responsibility:await readFile(join(packageRoot, 'fixtures/seat-responsibilities', `${seat}.md`), 'utf8')});
    }
    const actor = access.identityForSeat('seat-overall')!;
    const ids: string[] = [];
    for (const [zone, title, count, time] of [['west','西区补给方案',3,'09:40'],['east','东区独立补给方案',2,'09:45']] as const) {
      ids.push(access.create(actor, {clientActionId:randomUUID(), title, visibility:'public', goal:`合成验证任务。在 2026-10-01 ${time} 使用${zone === 'west' ? '西' : '东'}区通道，至少需要 ${count} 辆车。提出供人员决策的补给方案，不直接下达执行。`, context:{businessRefs:[{systemId:'situation',objectType:'road',objectId:`road-${zone}-01`},{systemId:'situation',objectType:'resource',objectId:`vehicles-${zone}-01`}],focus:{areaIds:[`zone-${zone}`],time:{from:`2026-10-01T${time}:00+08:00`,to:'2026-10-01T10:30:00+08:00'},topics:['车辆','通行']}}}).id);
    }
    tasks = {primary:ids[0], control:ids[1]};
  } finally {db.close();}
  const socket = join(dataDir, 'mock.sock'), queryToken = randomBytes(32).toString('hex');
  const mock = spawn(process.execPath, ['--import','tsx', join(packageRoot,'scripts/mock-context/main.ts')], {cwd:packageRoot, env:{...env,MOCK_CONTEXT_API_TOKEN:queryToken,MOCK_CONTEXT_PORT:'0',MOCK_CONTEXT_CONTROL_SOCKET:socket}, stdio:'ignore'});
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  const stop = async () => {try {await app?.close();} finally {mock.kill('SIGTERM');}};
  try {
    let mockStatus: {url: string} | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (mock.exitCode !== null) throw new Error('隔离模拟服务启动失败');
      try {mockStatus = await control(socket, ['status']) as {url:string}; break;} catch {await new Promise(resolveWait=>setTimeout(resolveWait,50));}
    }
    if (!mockStatus) throw new Error('隔离模拟服务启动超时');
    const backgroundRaw = await readFile(join(packageRoot,'fixtures/background-seat-routing.example.json'),'utf8');
    const background = parseBackgroundConfig(JSON.parse(backgroundRaw));
    const contextRaw = await json<{systems:Array<{id:string;baseUrl:string}>}>(join(packageRoot,'fixtures/context-seat-routing.example.json'));
    for (const system of contextRaw.systems) system.baseUrl = `${mockStatus.url}/${system.id}`;
    const context = parseContextConfig(contextRaw);
    const sourceEnv: NodeJS.ProcessEnv = {};
    for (const source of background.sources) {const token = randomBytes(32).toString('hex'); privateConfig.tokens[source.sourceId] = token; sourceEnv[source.credentialRef] = token;}
    await save(join(dataDir,'credentials.json'),privateConfig);
    await save(join(dataDir,'background-config.json'),JSON.parse(backgroundRaw));
    await save(join(dataDir,'context-config.json'),contextRaw);
    const lab = await PiLab.create(config), store = new BackgroundStore(lab.access!.db);
    for (const source of background.sources) store.grant('seat','seat-overall',source.sourceId,'manage');
    app = await createApp(lab,serveWeb,{config:background,env:sourceEnv},{config:context,env:{MOCK_CONTEXT_API_TOKEN:queryToken}});
    await app.listen({host:'127.0.0.1',port});
    let revision = 'unknown'; try {revision = execFileSync('git',['rev-parse','HEAD'],{cwd:packageRoot,encoding:'utf8'}).trim();} catch { /* Metadata only. */ }
    const manifest: Manifest = {version:1,trialId:randomUUID(),dataDir,url:`http://127.0.0.1:${port}`,socket,tasks,workspaceId:'',createdAt:new Date().toISOString(),metadata:{revision,node:process.version,platform:process.platform,model:config.model,provider:config.provider,baseUrl:config.baseUrl,modelParameters:{contextWindow:config.contextWindow,maxOutputTokens:config.maxOutputTokens,compactionReserveTokens:config.compactionReserveTokens,compactionKeepRecentTokens:config.compactionKeepRecentTokens},execution:config.execution,profileHash:createHash('sha256').update(backgroundRaw).digest('hex')}};
    const headers = await auth(manifest);
    for (const source of background.sources) await request(manifest,'/api/information/rules',headers,'POST',{clientActionId:randomUUID(),name:'固定情报席与候选补充席位',sourceId:source.sourceId,profileId:'context-analysis',recipientSeatIds:['seat-intelligence'],supplementaryDelivery:{candidateSeatIds:['seat-planning','seat-situation']},enabled:true});
    const workspace = await request<{id:string}>(manifest,`/api/tasks/${tasks.primary}/workspace`,headers,'POST',{});
    manifest.workspaceId = workspace.id;
    const draft = await readFile(join(packageRoot,'fixtures/task-plan-validation/补给方案_初稿.md'));
    const upload = await request<{uploadId:string}>(manifest,`/api/workspaces/${workspace.id}/uploads`,headers,'POST',{name:'补给方案_初稿.md',size:draft.length});
    const uploaded = await fetch(`${manifest.url}/api/workspaces/${workspace.id}/uploads/${upload.uploadId}/content`,{method:'PUT',headers:{...headers,'content-type':'application/octet-stream'},body:draft});
    if (!uploaded.ok) throw new Error(`初稿上传失败 HTTP ${uploaded.status}`);
    manifest.metadata.initialUpload = await uploaded.json();
    await save(join(dataDir,'manifest.json'),manifest);
    return {manifest,stop};
  } catch (error) {await stop(); throw error;}
}

export async function capture(manifest: Manifest) {
  const result: Record<string, unknown> = {capturedAt:new Date().toISOString(),trialId:manifest.trialId};
  for (const seat of seats) {
    const headers = await auth(manifest,seat), records: Record<string,unknown> = {};
    for (const path of ['/api/workbench/items?bucket=all&limit=200','/api/work-items','/api/workspaces','/api/activity', ...(seat === 'overall' ? ['/api/information/jobs?limit=100','/api/information/delivery-reviews?limit=100','/api/work-overview/items?limit=200'] : [])]) {
      try {records[path] = await request(manifest,path,headers);} catch (error) {records[path] = {error:(error as Error).message};}
    }
    for (const work of (Array.isArray(records['/api/work-items']) ? records['/api/work-items'] as WorkItem[] : [])) records[`work:${work.id}`] = await request(manifest,`/api/work-items/${work.id}`,headers);
    const activity = records['/api/activity'] as {sessions?: Array<{id:string}>};
    for (const session of activity?.sessions ?? []) records[`session:${session.id}`] = await request(manifest,`/api/sessions/${session.id}`,headers);
    const jobs = records['/api/information/jobs?limit=100'] as {items?:Array<{id:string}>} | undefined;
    for (const job of jobs?.items ?? []) records[`job:${job.id}`] = await request(manifest,`/api/information/jobs/${job.id}`,headers);
    const workspaces = records['/api/workspaces'] as {workspaces?:Array<{id:string}>};
    for (const workspace of workspaces?.workspaces ?? []) records[`files:${workspace.id}`] = await request(manifest,`/api/workspaces/${workspace.id}/files?limit=100`,headers);
    result[seat] = records;
  }
  result.mockRequests = await control(manifest.socket,['requests']);
  await mkdir(join(manifest.dataDir,'evidence'),{recursive:true,mode:0o700});
  const path = join(manifest.dataDir,'evidence',`${Date.now()}-${randomUUID()}.json`);
  await save(path,result); return path;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'serve') {
    if (args.length && !(args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]))) throw new Error('serve 仅接受 --port；每次创建新目录，不支持恢复。');
    const trial = await startTrial(args.length ? Number(args[1]) : 4320);
    console.info(JSON.stringify({url:trial.manifest.url,dataDir:trial.manifest.dataDir,tasks:trial.manifest.tasks,credentials:join(trial.manifest.dataDir,'credentials.json')}));
    for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>void trial.stop());
    return;
  }
  const event = command === 'send' ? args.shift() : undefined;
  if (!['send','status','evidence'].includes(command) || (command === 'send' && !['E1','E2','E4'].includes(event ?? '')) || args.length !== 2 || args[0] !== '--dir' || !isAbsolute(args[1])) throw new Error('用法：serve [--port 4320] | send E1/E2/E4 --dir ABS | status/evidence --dir ABS');
  const manifest = await json<Manifest>(join(args[1],'manifest.json'));
  if (manifest.version !== 1 || resolve(manifest.dataDir) !== resolve(args[1]) || manifest.socket !== join(manifest.dataDir,'mock.sock') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(manifest.url)) throw new Error('试验目录或地址不匹配');
  try {console.info(JSON.stringify(command === 'send' ? await sendEvent(manifest,event as EventName) : {evidence:await capture(manifest)}));}
  catch (error) {await appendFile(join(manifest.dataDir,'failures.jsonl'),`${JSON.stringify({at:new Date().toISOString(),command,event,error:(error as Error).message})}\n`,{mode:0o600}); throw error;}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
