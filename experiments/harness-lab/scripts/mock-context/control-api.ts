import type { IncomingMessage } from 'node:http';
import { RequestError } from '../../src/contracts/errors.js';
import type { InformationReport, SituationObject } from '../../src/contracts/context.js';
import type { SimulationAction, SimulationState, SimulationReceipt } from '../../src/contracts/simulation.js';
import { contextInteger, contextRecord, contextText, contextTimestamp, decodeContextResponse, situationObject } from '../../src/context/validation.js';
export interface NotificationTarget {systemId: string; sourceId: string; url: string; token: string}
export interface StoredAction extends SimulationAction {input: string}
const fail = (message: string, code = 'INVALID_ARGUMENT', status = 400) => new RequestError(code, message, status);
const stable = (v: unknown): string => JSON.stringify(v, function (_k, x) {return x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a.localeCompare(b))) : x;});
export function createControlApi(options: {
  instanceId: string; targets: NotificationTarget[];
  state: () => {objects: SituationObject[]; reports: InformationReport[]; actions: StoredAction[]};
  save: () => void; updateObject: (object: SituationObject) => void; updateReport: (report: InformationReport) => void;
}) {
  const running = new Map<string,Promise<SimulationAction>>();
  const publicAction = ({input: _input, ...action}: StoredAction): SimulationAction => {void _input; return structuredClone(action);};
  function lookup(id: string) {const a = options.state().actions.find(a => a.id === id); if (!a) throw fail('操作不存在。','NOT_FOUND',404); return a;}
  const output = (): SimulationState => {
    const reports = new Map<string, InformationReport>();
    for (const report of options.state().reports) if (!reports.has(report.reportId) || reports.get(report.reportId)!.revision < report.revision) reports.set(report.reportId, report);
    return {instanceId:options.instanceId,objects:structuredClone(options.state().objects),reports:structuredClone([...reports.values()]),actions:options.state().actions.slice(-20).map(publicAction)};
  };
  async function request(target: NotificationTarget, action: StoredAction, method: 'GET'|'POST') {
    const url = new URL(`/api/integrations/${encodeURIComponent(target.sourceId)}/events`,target.url);
    if (method === 'GET') url.searchParams.set('sourceMessageId',action.notification.sourceMessageId);
    const response = await fetch(url,{method,headers:{Authorization:`Bearer ${target.token}`,...(method === 'POST' ? {'Content-Type':'application/json'} : {})},redirect:'error',signal:AbortSignal.timeout(5000),...(method === 'POST' ? {body:JSON.stringify(action.notification)} : {})});
    if (!response.ok) throw new Error('notification request failed');
    const reader = response.body?.getReader(); if (!reader) throw new Error('empty receipt');
    let body='',size=0;
    try {for (;;) {const part=await reader.read(); if(part.done)break; size+=part.value.byteLength; if(size>16384)throw new Error('oversized receipt'); body+=Buffer.from(part.value).toString('utf8');}} finally {await reader.cancel();}
    const value: unknown = JSON.parse(body), r = contextRecord(value,['eventId','sourceMessageId','receivedAt','status'],['eventId','sourceMessageId','receivedAt','status']);
    if(r.sourceMessageId!==action.notification.sourceMessageId || r.status!=='accepted')throw new Error('invalid receipt');
    contextText(r.eventId); contextTimestamp(r.receivedAt); return r as unknown as SimulationReceipt;
  }
  async function deliver(action: StoredAction, send: boolean) {
    if (action.sendState === 'accepted') return publicAction(action);
    const target = options.targets.find(t => t.systemId === action.systemId);
    if (!target) throw fail('未配置该来源的通知接入。','NOT_CONFIGURED',503);
    // Always look up an uncertain earlier attempt before any repeat POST.
    if (!send || action.sendState === 'unconfirmed') {
      try {action.receipt=await request(target,action,'GET');action.sendState='accepted';delete action.error;options.save();return publicAction(action);} catch {if (!send) return publicAction(action);}
    }
    action.sendState='unconfirmed'; action.error='接收结果尚未确认，请核对回执。';options.save();
    try {action.receipt=await request(target,action,'POST'); action.sendState='accepted';delete action.error;}
    catch {try {action.receipt=await request(target,action,'GET');action.sendState='accepted';delete action.error;} catch {action.error='发送未确认，可查询回执或重送同一通知。';}}
    options.save(); return publicAction(action);
  }
  return async function control(req: IncomingMessage, path: string): Promise<unknown> {
    if (req.method==='GET' && path==='/control/state') return output();
    const match=/^\/control\/actions\/([^/]+)(\/send)?$/.exec(path);
    if(match) {
      if ((match[2] && req.method!=='POST') || (!match[2] && req.method!=='GET'))throw fail('请求方式无效。');
      const action=lookup(decodeURIComponent(match[1]));
      if (match[2]) {
        let text='',bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>1024)throw fail('发送操作不接受替换内容。');text+=chunk;}
        if(text.trim()) {let body:unknown;try{body=JSON.parse(text);}catch{throw fail('发送操作仅接受空请求。');}contextRecord(body,[]);}
      }
      if (!match[2] && action.sendState !== 'unconfirmed') return publicAction(action);
      if(running.has(action.id))return running.get(action.id)!;
      const promise=deliver(action,Boolean(match[2])).finally(()=>running.delete(action.id));running.set(action.id,promise);return promise;
    }
    if(req.method!=='POST'||!['/control/object-updates','/control/report-updates'].includes(path))throw fail('控制接口不存在。','NOT_FOUND',404);
    let text='',bytes=0; for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>128*1024)throw fail('请求过大。');text+=chunk;}
    let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw fail('JSON 无效。');}
    const object=path.endsWith('object-updates');
    const keys=object?['clientActionId','ref','expectedRevision','properties','effectiveAt','validTime']:['clientActionId','reportId','expectedRevision','report'];
    const r=contextRecord(parsed,keys,keys), id=contextText(r.clientActionId);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw fail('操作编号需要 UUID。');
    const input=stable({path,body:r}), prior=options.state().actions.find(a=>a.id===id);
    if(prior){if(prior.input!==input)throw fail('操作编号已用于不同内容。','ACTION_CONFLICT',409);return publicAction(prior);}
    const expected=contextInteger(r.expectedRevision);let revision:number,systemId:string,title:string,subjectId:string,effectiveAt:string,description:string;
    let updatedObject:SituationObject|undefined,updatedReport:InformationReport|undefined;
    if(object){
      const current=options.state().objects.find(o=>stable(o.ref)===stable(r.ref));
      if(!current || !['road','resource'].includes(current.ref.objectType))throw fail('对象不可修改。','NOT_FOUND',404);
      if(current.revision!==expected)throw fail('对象已更新，请刷新后重提。','REVISION_CONFLICT',409);
      effectiveAt=contextTimestamp(r.effectiveAt);
      updatedObject=situationObject({...current,revision:expected+1,properties:r.properties,effectiveAt,validTime:r.validTime},current.ref.systemId);
      if(current.ref.objectType==='road'&&!('passability' in updatedObject.properties))throw fail('需要道路通行状态。');
      revision=updatedObject.revision;systemId=current.ref.systemId;subjectId=current.ref.objectId;title=`${current.name}态势更新`;
      description=`对象 ${systemId}/${current.ref.objectType}/${subjectId} 由修订 ${expected} 更新为 ${revision}；当前属性 ${JSON.stringify(updatedObject.properties)}。请查询当前状态及变化。`;
    }else{
      const reportId=contextText(r.reportId), current=options.state().reports.filter(a=>a.reportId===reportId).sort((a,b)=>b.revision-a.revision)[0];
      if(!current)throw fail('报告不存在。','NOT_FOUND',404);
      if(current.revision!==expected)throw fail('报告已更新，请刷新后重提。','REVISION_CONFLICT',409);
      const body=contextRecord(r.report,['subjectId','title','summary','content','objectRefs','areaIds','observedAt','publishedAt','validTime']);
      updatedReport={...body,reportId,revision:expected+1} as unknown as InformationReport;
      decodeContextResponse('information_read',{systemId:'intel',reportId},{systemId:'intel',asOf:new Date().toISOString(),item:updatedReport});
      revision=updatedReport.revision;systemId='intel';subjectId=reportId;title=updatedReport.title;effectiveAt=updatedReport.publishedAt??new Date().toISOString();description=`报告 ${reportId} 已更新至修订 ${revision}。请查询报告正文及历史。`;
    }
    if(!options.targets.some(t=>t.systemId===systemId))throw fail('未配置该来源的通知接入。','NOT_CONFIGURED',503);
    const action:StoredAction={id,input,systemId,revision,createdAt:new Date().toISOString(),sendState:'unsent',notification:{sourceMessageId:`${options.instanceId}-${id}`,title,text:`${description} 生效时间：${effectiveAt}。`,subjectId,occurredAt:effectiveAt}};
    if(options.state().actions.length>=1000)throw fail('本实例操作记录已达上限，请建立新测试实例。');
    if(updatedObject)options.updateObject(updatedObject);if(updatedReport)options.updateReport(updatedReport);
    options.state().actions.push(action); options.save();return publicAction(action);
  };
}
