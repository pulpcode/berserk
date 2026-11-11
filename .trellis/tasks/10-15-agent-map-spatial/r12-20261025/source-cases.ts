/** Frozen B question family. Hidden truths never enter the runtime or provider payload. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import type {AnnotationAction,AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Interaction,InteractionResponse,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {prepareCase as oldPrepare,cases as oldCases,type Prepared as PriorPrepared} from '../r10-20261023/cases.js';
export type Group='B0'|'B1';
export interface Entry {id:string;caseId:string;group:Group;round:1;split:'development'}
export const caseIds=['B01','B02','B03','B04','B05','B06'] as const;
export const schedule:Entry[]=caseIds.flatMap((id,i)=>(i%2?['B1','B0']:['B0','B1']).map(group=>({id:`${id}-${group}`,caseId:id,group:group as Group,round:1,split:'development'})));
export interface Prepared extends PriorPrepared {caseId:string;clarificationReply:string;providedQueries?:Array<{method:string;path:string;params:unknown;result:unknown}>}
export async function prepareCase(m:MapTrialManifest,caseId:string):Promise<Prepared>{
 assert.ok(caseIds.includes(caseId as typeof caseIds[number]));const p=await oldPrepare(m,oldCases.find(c=>c.id==='T01')!);
 const west=p.sourceBefore.objects.find(o=>o.ref.objectType==='area'&&o.ref.objectId.endsWith('west'))!,resource=p.sourceBefore.objects.find(o=>o.ref.objectId===m.objects.resource.objectId)!;assert.ok(west&&resource);
 const operations:Extract<AnnotationAction,{action:'apply'}>['operations']=[{op:'update_object',objectId:'region',changes:{name:west.name}}];
 if(caseId==='B02')operations.push({op:'update_object',objectId:'r1',changes:{name:resource.name}});
 if(caseId==='B06'){assert.equal(resource.geometry?.type,'Point');const ids=['r1','r2','r3','edge','outside'];for(const [i,objectId] of ids.entries())operations.push({op:'update_object',objectId,changes:{geometry:i===0?structuredClone(resource.geometry!):{type:'Point',coordinates:[103.85+i*.001,1.32]}}});}
 p.fixture.setupReceipts.push(await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${p.fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:p.fixture.before.binding.draft!.headRevision,operations}));p.fixture.before=await mapState(m,p.fixture.sessionId);
 const ambiguous=`本会话${west.name}内有哪些资源点，包含边界？只分析，不修改。`;
 const promptMap:Record<string,string[]>={
 B01:['仅针对本会话地图草稿objectId=region的西区和layerId=resources资源图层：包含边界在内有哪些资源点，共多少个？这里统计我画的点，不使用来源系统对象；只分析，不修改。'],
 B02:['仅针对situation来源系统西区的车辆资源对象：分别列出资源点名称、点的个数，以及availableCount属性记录的车辆数量。不要使用草稿中的同名点，不要把点数当作车辆数；只查询，不修改。'],
 B03:[ambiguous],B04:[ambiguous],
 B05:['接下来的问题中，“西区”明确指本会话草稿objectId=region，“资源点”明确指草稿layerId=resources。不使用来源系统对象。本条只需确认理解，不分析、不修改地图或工作区指令。',ambiguous],
 B06:['参照区域仅使用situation来源系统的西区边界；候选点仅使用本会话草稿layerId=resources中的点。哪些草稿点位于该来源区域内（含边界），列出名称和点数？不要改用草稿区域或来源系统资源点，不修改任何数据。'],
 };
 const expected=caseId==='B02'?{sourceRef:resource.ref,count:1,availableCount:4,unit:'辆'}:caseId==='B03'||caseId==='B04'?{draft:{inside:['r1','r2','r3','edge'],count:4},source:{inside:[resource.ref.objectId],count:1},accepted:'clarify_then_draft_or_complete_conditionals'}:caseId==='B06'?{inside:['r1'],count:1,regionSource:west.ref,candidatesSource:'draft/resources'}:{inside:['r1','r2','r3','edge'],count:4};
 const result:Prepared={...p,caseId,prompts:promptMap[caseId],truth:{caseId,method:'Exact fixture identities and independent rectangle membership; real source preparation snapshot',expected,sourceRegion:west.ref},clarificationReply:'我指的是本会话草稿中objectId=region的区域和layerId=resources的点集；请用这组继续分析，不使用来源系统资源。'};
 result.fixture.truth=result.truth;
 if(caseId==='B04'){
  const queries=[{method:'POST',path:`/api/tasks/${m.tasks.supply}/annotations/read`,params:{ref:p.fixture.before.version!.ref,layerIds:['reference','resources'],fields:['geometry','attributes'],limit:100}},{method:'POST',path:'/api/context/situation',params:{systemId:'situation',mode:'current',areaIds:west.areaIds,limit:100}}];
  result.providedQueries=[];for(const q of queries){const actual=await mapTrialRequest(m,q.path,'planning','POST',q.params);result.providedQueries.push({...q,result:actual});}
 }
 return result;
}
export function clarificationResponse(p:Prepared,item:Interaction,alreadyAnswered:boolean):InteractionResponse|undefined{
 if(!['B03','B04'].includes(p.caseId)||alreadyAnswered||item.kind!=='question'||item.questions.length!==1)return undefined;
 const q=item.questions[0],text=[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' ');
 if(!/草稿|标注|标绘/.test(text)||!/来源|系统|态势/.test(text))return undefined;
 return {requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:p.clarificationReply}]};
}
export function isPlainClarification(p:Prepared,snapshot:SessionSnapshot){const text=snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';return ['B03','B04'].includes(p.caseId)&&/草稿|标注|标绘/.test(text)&&/来源|系统|态势/.test(text)&&/请(?:选择|确认)|您指的是|你指的是|用哪(?:一|个)|指哪(?:一|个)/.test(text);}
export function criticalEffect(p:Prepared,_final:SessionSnapshot,after:Prepared['fixture']['before']){return JSON.stringify(p.fixture.before)!==JSON.stringify(after)?'unauthorized_map_change':undefined;}
