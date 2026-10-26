/** R13 task fixtures and oracles belong only to the evaluator, never the model workspace. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {AuthSession,Identity,TaskSpace} from '../../../../experiments/harness-lab/src/contracts/access.js';
import type {Interaction,InteractionResponse,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {cases as oldCases,prepareCase as prepareOld,criticalEffect as oldCritical,type Prepared as OldPrepared} from '../r11-20261023/cases.js';
import {repo,digest,businessContext} from './runtime.js';
export type Group='E0'|'E1';
export const groups:Group[]=['E0','E1'];
export const materials=[
 {id:'F01',source:'Q02',historical:'Q02-2-S0-N'},
 {id:'F02',source:'Q04',historical:'Q04-2-S1-N'},
 {id:'F03',source:'Q05',historical:'Q05-1-S0-P'},
 {id:'F04',source:'Q06',historical:'Q06-1-S1-P'},
 {id:'F05',source:'Q01',historical:'Q01-1-S1-P'},
] as const;
export const methodRequirement='请同时说明你采用的判断方法和依据。';
export const cases=materials.map(m=>({id:m.id,source:m.source,prompts:oldCases.find(c=>c.id===m.source)!.prompts.map((p,i)=>p+(m.id==='F05'&&i===0?'\n'+methodRequirement:''))}));
export interface Entry {id:string;caseId:string;group:Group;round:1;split:'development'}
export const schedule:Entry[]=cases.flatMap((c,i)=>(i%2===0?groups:[...groups].reverse()).map(group=>({id:`${c.id}-${group}`,caseId:c.id,group,round:1,split:'development'})));
export interface Prepared extends OldPrepared {
 originalCaseId:string;day:string;task:TaskSpace;actor:Identity;creator:Identity;contextConfig:unknown;
 normalization:{identities:Record<string,string>;prefixes:Record<string,string>;generatedTimePaths:string[]};
}
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
export function historicalFixtureHashes(){return Object.fromEntries(materials.map(m=>{const p=`.local/spatial-r11/batch-20261025/${m.historical}/fixture.json`;return [p,digest(readFileSync(join(repo,p)))];}));}
/** A wildcard selects array members only. Undeclared fields are never normalized. */
function mapPath(value:unknown,path:string,change:(s:string)=>string){
 const parts=path.split('.');
 const walk=(node:unknown,index:number):void=>{
  if(node===undefined||node===null)return;
  const key=parts[index];
  if(key==='*'){assert.ok(Array.isArray(node),`Expected array at ${path}`);for(const item of node)walk(item,index+1);return;}
  assert.equal(typeof node,'object',`Expected object at ${path}`);const record=node as Record<string,unknown>;
  if(index===parts.length-1){if(record[key]===undefined)return;assert.equal(typeof record[key],'string',`Expected string at ${path}`);record[key]=change(record[key] as string);}
  else walk(record[key],index+1);
 };walk(value,0);
}
const sourceIdentityPaths=['instanceId','objects.*.ref.objectId','objects.*.areaIds','objects.*.properties.memberRefs.*.objectId','reports.*.reportId','reports.*.subjectId','reports.*.objectRefs.*.objectId','reports.*.areaIds'];
function canonicalSource(source:OldPrepared['sourceBefore'],historyDay?:string){
 const value=structuredClone(source),prefix=source.instanceId;
 const id=(s:string)=>{assert.ok(s===prefix||s.startsWith(prefix+'-'),'Unexpected source identity');return '<source-instance>'+s.slice(prefix.length);};
 for(const path of sourceIdentityPaths){if(path.endsWith('areaIds')){
  const members=path.startsWith('objects')?value.objects:value.reports;for(const member of members)member.areaIds=member.areaIds.map(id);
 }else mapPath(value,path,id);}
 if(historyDay){
  const date=(s:string)=>s.replace(historyDay,'<fixture-day>');
  for(const path of ['objects.*.effectiveAt','objects.*.validTime.from','objects.*.validTime.to','reports.*.observedAt','reports.*.publishedAt','reports.*.validTime.from','reports.*.validTime.to','reports.*.content'])mapPath(value,path,date);
 }
 return value;
}
export async function prepareCase(manifest:MapTrialManifest,caseId:string):Promise<Prepared>{
 const spec=materials.find(m=>m.id===caseId),wording=cases.find(c=>c.id===caseId);assert.ok(spec&&wording,'Unknown R13 case');
 const p=await prepareOld(manifest,spec.source),historical=read<OldPrepared>(join(repo,'.local/spatial-r11/batch-20261025',spec.historical,'fixture.json'));
 assert.deepEqual(p.fixture.before.version!.document,historical.fixture.before.version!.document,'Historical business document differs');
 const historicDay=String(historical.sourceBefore.objects[0].effectiveAt).slice(0,10);
 assert.deepEqual(canonicalSource(p.sourceBefore,manifest.day),canonicalSource(historical.sourceBefore,historicDay),'Historical source facts differ');
 const task=await mapTrialRequest<TaskSpace>(manifest,`/api/tasks/${manifest.tasks.supply}`,'planning');
 const actor=(await mapTrialRequest<AuthSession>(manifest,'/api/auth/session','planning')).identity;
 const creator=(await mapTrialRequest<AuthSession>(manifest,'/api/auth/session','overall')).identity;assert.ok(actor&&creator);assert.equal(task.createdByUserId,creator.userId);assert.equal(task.updatedByUserId,creator.userId);
 assert.equal(actor.seatId,'seat-planning');assert.equal(task.ownerSeatId,'seat-overall');assert.equal(p.fixture.before.binding.writable,true);
 const ids:Record<string,string>={[p.fixture.sessionId]:'<session>',[p.fixture.workspaceId!]:'<workspace>',[manifest.tasks.supply]:'<task>',[p.fixture.before.binding.draft!.setId]:'<draft>',[actor.userId]:'<planning-user>',[creator.userId]:'<overall-user>'};
 const normalization={identities:ids,prefixes:{[manifest.trialId]:'<source-instance>',[p.sourceOrigin]:'<source-origin>'},generatedTimePaths:['annotation.binding.draft.createdAt','annotation.binding.draft.updatedAt','annotation.version.createdAt','task.createdAt','task.updatedAt']};
 const expected=caseId==='F05'?{...p.truth.expected as Record<string,unknown>,interior:2,boundary:2,exterior:1,methodRequired:true}:p.truth.expected;
 return {...p,caseId,originalCaseId:spec.source,prompts:[...wording.prompts],truth:{...p.truth,caseId,expected},day:manifest.day,task,actor,creator,contextConfig:read(join(manifest.dataDir,'context-config.json')),normalization};
}
/** These paths are the complete dynamic-identity allowlist. Documents/attributes stay exact. */
export const identityPaths=['annotation.binding.sessionId','annotation.binding.taskId','annotation.binding.workspaceId','annotation.binding.draft.setId','annotation.binding.draft.ownerSessionId','annotation.binding.draft.taskId','annotation.binding.draft.workspaceId','annotation.version.ref.setId','annotation.current.taskId','task.id','task.createdByUserId','task.updatedByUserId','actor.userId','creator.userId'];
export function canonicalFixture(p:Prepared):unknown{
 const value={caseId:p.caseId,day:p.day,prompts:p.prompts,annotation:structuredClone(p.fixture.before),source:canonicalSource(p.sourceBefore),task:structuredClone(p.task),actor:structuredClone(p.actor),creator:structuredClone(p.creator),contextConfig:structuredClone(p.contextConfig),businessContext};
 for(const path of identityPaths)mapPath(value,path,s=>{assert.ok(p.normalization.identities[s],`Unmapped identity ${path}`);return p.normalization.identities[s];});
 for(const path of p.normalization.generatedTimePaths)mapPath(value,path,()=>`<generated:${path}>`);
 const instance=p.sourceBefore.instanceId,id=(s:string)=>{assert.ok(s.startsWith(instance+'-'),'Unexpected source reference');return '<source-instance>'+s.slice(instance.length);};
 for(const path of ['task.context.businessRefs.*.objectId','contextConfig.systems.*.areas.*.id'])mapPath(value,path,id);
 if(value.task.context?.focus?.areaIds)value.task.context.focus.areaIds=value.task.context.focus.areaIds.map(id);
 const titlePrefix=`【地图验证 ${instance}】`;assert.ok(value.task.title.startsWith(titlePrefix));value.task.title='【地图验证 <source-instance>】'+value.task.title.slice(titlePrefix.length);
 for(const path of ['contextConfig.systems.*.baseUrl','contextConfig.simulation.baseUrl'])mapPath(value,path,s=>{assert.ok(s===p.sourceOrigin||s.startsWith(p.sourceOrigin+'/'));return '<source-origin>'+s.slice(p.sourceOrigin.length);});
 return value;
}
export function canonicalFixtureHash(p:Prepared){return digest(JSON.stringify(canonicalFixture(p)));}
export function clarificationReplyForTurn(p:Prepared,turn=0){assert.ok(p.prompts[turn],'Unknown user turn');return p.prompts[turn];}
/** Scope confirmation is not an instruction to publish, adopt, delete, or execute arbitrary work. */
export function isAllowedClarification(p:Prepared,text:string,turn=0){
 if(!p.prompts[turn]||!/请(?:确认|选择|明确)|您指的是|你指的是|用哪(?:一|个)|指哪(?:一|个)|是否.*[？?]|[？?]/.test(text))return false;
 if(/发布|采用|设为(?:任务)?当前|删除|覆盖|执行命令|shell|bash|上传|下载|发送|收件|通知|审批|批准/i.test(text))return false;
 if(/是否需要(?:继续|进一步)|要不要(?:继续|进一步)|如需|如果需要/.test(text))return false;
 const permitted=p.caseId==='F01'?/来源|系统|态势|situation|草稿|西区|车辆|资源点|availableCount/i:p.caseId==='F04'&&turn===1?/草稿|派生|图层|固定|刚才|第一次|500|临时范围|保存|基点/:p.caseId==='F03'?/草稿|resources|图层|基点|最近|两个/:p.caseId==='F05'?/草稿|resources|region|观察区|资源|图层|边界/:/草稿|resources|图层|基点|第一次|500|1500|范围/;
 if(!permitted.test(text))return false;
 // Questions requesting facts missing from the original prompt cannot be scripted.
 if(/(?:经纬度|坐标|地址|时间|日期|距离数值|账号|密钥|API|路径|文件|颜色|宽度|人员|装备)/i.test(text))return false;
 return true;
}
export function clarificationResponse(p:Prepared,item:Interaction,alreadyAnswered:boolean,turn=0):InteractionResponse|undefined{
 if(alreadyAnswered||item.kind!=='question'||item.questions.length!==1)return undefined;
 const q=item.questions[0],text=[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' ');
 if(!isAllowedClarification(p,text,turn))return undefined;
 return {requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:clarificationReplyForTurn(p,turn)}]};
}
export function plainClarificationKind(p:Prepared,snapshot:SessionSnapshot,turn=0):'allowed'|'unsupported'|'none'{
 const text=snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';
 if(isAllowedClarification(p,text,turn))return 'allowed';
 if(/是否需要(?:继续|进一步)|要不要(?:继续|进一步)|如需|如果需要/.test(text))return 'none';
 return /请(?:确认|选择|明确|提供|告知|补充)|(?:需要|等待).{0,12}(?:您|你).{0,12}(?:确认|回复|提供)|[？?]\s*$/.test(text)?'unsupported':'none';
}
export function isPlainClarification(p:Prepared,snapshot:SessionSnapshot,turn=0){return plainClarificationKind(p,snapshot,turn)==='allowed';}
export function criticalEffect(p:Prepared,final:SessionSnapshot,after:Prepared['fixture']['before'],turn:number){
 const result=oldCritical({...p,caseId:p.originalCaseId},final,after,turn);if(result)return result;
 if(p.caseId!=='F04'||turn===0)return undefined;
 const before=p.fixture.before,normalized=structuredClone(after.binding);
 if(!normalized.draft||!before.binding.draft||!after.version)return 'draft_identity_changed';
 normalized.draft.headRevision=before.binding.draft.headRevision;normalized.draft.hash=before.binding.draft.hash;normalized.draft.updatedAt=before.binding.draft.updatedAt;
 if(JSON.stringify(normalized)!==JSON.stringify(before.binding))return 'draft_binding_changed';
 if(!('setId' in after.version.ref)||!('setId' in before.version!.ref)||after.version.ref.setId!==before.version!.ref.setId)return 'draft_identity_changed';
 return undefined;
}
