/** R15 evaluator-only case catalogue, independent oracles and real HTTP setup. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {control} from '../../../../experiments/harness-lab/scripts/probe-task-plan.js';
import type {AuthSession,TaskSpace} from '../../../../experiments/harness-lab/src/contracts/access.js';
import type {AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Interaction,InteractionResponse,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Position} from '../../../../experiments/harness-lab/src/contracts/context.js';
import type {SimulationState} from '../../../../experiments/harness-lab/src/contracts/simulation.js';
import {canonicalFixture as canonicalR13,type Prepared as PriorPrepared} from '../r13-20261025/cases.js';
import {plainClarificationEvidence as parseClarification,type ClarificationKind} from '../r14-20261026/cases.js';
import {newLayers,O,exercisePoint} from './data.js';
export type Group='G0'|'GS'|'GT'|'GST';
export const groups:Group[]=['G0','GS','GT','GST'];
export interface CaseSpec {id:string;title:string;category:string;historical:false;prompts:string[];expectedDescription:string;scoring:string;clarificationReply:string|null}
export const cases=JSON.parse(readFileSync(new URL('./case-specs.json',import.meta.url),'utf8')) as CaseSpec[];
export interface Entry {id:string;entryId:string;caseId:string;group:Group;round:1;repetition:1;ordinal:number;split:'development'}
export const schedule:Entry[]=cases.flatMap((c,i)=>groups.map((_,j)=>{const group=groups[(i+j)%4],id=`${c.id}-1-${group}`;return {id,entryId:id,caseId:c.id,group,round:1,repetition:1,ordinal:i*4+j+1,split:'development'};}));
export const entries=schedule;
export interface Prepared extends PriorPrepared {sourceUpdates?:unknown[]}
export const historicalFixtureHashes=()=>({});
/** Independent spherical formula: no product geometry library is imported. */
export function distanceM(a:Position,b:Position){const rad=Math.PI/180,dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad,h=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2;return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));}
export function analyticTruth(){return {northLengthM:distanceM([114,22.5],[114,22.510])+distanceM([114,22.510],[114,22.505]),southLengthM:distanceM([151.21,-33.86],[151.21,-33.85])+distanceM([151.21,-33.85],[151.21,-33.855]),newPointDistanceM:distanceM(exercisePoint,O),tolerance:'max(2 metres, 0.2%)'};}
export function expectedFor(caseId:string):Record<string,unknown>{
 const a=analyticTruth(),names=['岸边甲','栈桥乙','码头丙','港池丁'];
 const expected:Record<string,Record<string,unknown>>={
 P01:{draft:{count:4,names},source:{count:1,names:['来源港车甲']},accepted:'clarify_then_draft_or_complete_labeled_conditionals',fixedReply:cases[0].clarificationReply},
 P02:{count:4,names,draftOnly:true,noSourceQuery:true},P03:{regionObjectId:'patrol-area',regionName:'巡查区',count:2,names:['巡查车甲','巡查车乙'],allowParameterRecovery:true},P04:{draftExists:true,layerCount:0,objectCount:0,regionExists:false},
 P05:{bufferM:500,center:'origin',inputCount:1,noGlobalCountRequired:true},P06:{bufferM:500,center:'origin',inputCount:1,layerCount:4,names:['基点','参照甲','参照乙','参照丙']},
 P07:{bufferM:700,origin:'origin',reuseOriginalResult:true,noDraftChange:true,noGlobalStorageClaim:true},P08:{bufferDistancesM:[700,1200],savedRadiusM:700,saveTurn:1,saveLayer:'derived',saveName:'内圈',previewOnlyRadiusM:1200,preserveExistingRecord:true},
 P09:{valueM:a.northLengthM,toleranceM:Math.max(2,a.northLengthM*.002),directions:['北','南'],includeBothSegments:true},P10:{valueM:a.southLengthM,toleranceM:Math.max(2,a.southLengthM*.002),directions:['北','南'],includeBothSegments:true},
 P11:{count:4,names:['内部甲','内部乙','边界甲','边界乙'],interior:2,boundary:2,exterior:1,author:'user',agentActions:['read','analyze'],methodRequired:true},
 P12:{newName:'演练点',newPoint:exercisePoint,layer:'reference',oldObjectId:'old-a',oldUnchanged:true,addTurn:0,distanceTurn:1,valueM:a.newPointDistanceM,toleranceM:Math.max(2,a.newPointDistanceM*.002)}
 };assert.ok(expected[caseId]);return expected[caseId];
}
export async function prepareCase(m:MapTrialManifest,caseId:string):Promise<Prepared>{
 const spec=cases.find(c=>c.id===caseId);assert.ok(spec,'Unknown R15 case');
 const sourceBefore=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');
 const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
 const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
 const layers=newLayers(caseId),receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间与标绘核对',...(layers.length?{operations:layers.map(layer=>({op:'add_layer',layer}))}:{})});
 const before=await mapState(m,sessionId),sourceOrigin=new URL((await control(m.socket,['status']) as {url:string}).url).origin;
 const task=await mapTrialRequest<TaskSpace>(m,`/api/tasks/${m.tasks.supply}`,'planning'),actor=(await mapTrialRequest<AuthSession>(m,'/api/auth/session','planning')).identity,creator=(await mapTrialRequest<AuthSession>(m,'/api/auth/session','overall')).identity;
 assert.ok(actor&&creator&&before.binding.draft);assert.equal(actor.seatId,'seat-planning');assert.equal(task.ownerSeatId,'seat-overall');assert.equal(before.binding.writable,true);
 const truth={caseId,category:spec.category,historical:false,method:'Frozen synthetic inputs; independent spherical distance and rectangular containment; no product math oracle',expected:expectedFor(caseId),expectedDescription:spec.expectedDescription,scoring:spec.scoring,documentTotal:layers.flatMap(l=>l.features).length,layerCounts:Object.fromEntries(layers.map(l=>[l.layerId,l.features.length]))};
 const identities:Record<string,string>={[sessionId]:'<session>',[workspace.id]:'<workspace>',[m.tasks.supply]:'<task>',[before.binding.draft.setId]:'<draft>',[actor.userId]:'<planning-user>',[creator.userId]:'<overall-user>'};
 return {caseId,originalCaseId:caseId,spec:{id:caseId,kind:'J01',targetSkill:'spatial-analysis',category:spec.category,prompts:spec.prompts,clarification:'unnecessary',objective:'answer'},fixture:{kind:'J01',sessionId,workspaceId:workspace.id,before,setupReceipts:[receipt],truth},prompts:[...spec.prompts],truth,sourceOrigin,sourceBefore,clarificationReply:spec.clarificationReply??'',day:m.day,task,actor,creator,contextConfig:JSON.parse(readFileSync(join(m.dataDir,'context-config.json'),'utf8')),normalization:{identities,prefixes:{[m.trialId]:'<source-instance>',[sourceOrigin]:'<source-origin>'},generatedTimePaths:['annotation.binding.draft.createdAt','annotation.binding.draft.updatedAt','annotation.version.createdAt','task.createdAt','task.updatedAt']}} as Prepared;
}
export const prepare=prepareCase;
export const canonicalFixture=(p:Prepared)=>canonicalR13(p);
export const canonicalFixtureHash=(p:Prepared)=>createHash('sha256').update(JSON.stringify(canonicalFixture(p))).digest('hex');
export async function beforeTurn(_m:MapTrialManifest,_p:Prepared,_turn:number){void _m;void _p;void _turn;return undefined;}
export const anticipatedGapQuestion=(_p:Pick<Prepared,'caseId'>,_text:string)=>{void _p;void _text;return false;};
export const anticipatedGap=(_p:Pick<Prepared,'caseId'>)=>{void _p;return false;};
export function clarificationReplyForTurn(p:Pick<Prepared,'caseId'>,turn=0){assert.equal(p.caseId,'P01');assert.equal(turn,0);return cases[0].clarificationReply!;}
export function isAllowedClarification(p:Pick<Prepared,'caseId'>,text:string,turn=0){
 if(p.caseId!=='P01'||turn!==0||/发布|采用|删除|覆盖|批准|授权|密钥|坐标|经纬度|地址|日期|时间|颜色|宽度|文件|shell|bash/i.test(text))return false;
 return /草稿|标注|标绘/.test(text)&&/来源|系统|态势|situation/i.test(text);
}
export function clarificationResponse(p:Prepared,item:Interaction,alreadyAnswered:boolean,turn=0):InteractionResponse|undefined{
 if(alreadyAnswered||item.kind!=='question'||item.questions.length!==1)return undefined;
 const q=item.questions[0],text=[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' ');
 if(!isAllowedClarification(p,text,turn))return undefined;
 return {requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:clarificationReplyForTurn(p,turn)}]};
}
/** Reuse only the audited text parser; explicitly map this round's sole source-choice case. */
export function plainClarificationEvidence(p:Prepared,snapshot:SessionSnapshot,turn=0){
 const parsed=parseClarification({...p,caseId:p.caseId==='P01'?'D05':'R15-explicit'},snapshot,turn);
 const whole=snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';
 if(!isAllowedClarification(p,whole,turn))return parsed;
 // Candidate descriptions can precede a short question on a separate line.
 // Only a narrow source-choice question inherits that context; other missing facts stay pending.
 return parsed.map(item=>item.kind!=='none'&&/^(?:请)?(?:选择|确认|回复)(?:一下)?(?:使用|采用)?(?:哪套|哪个|哪一套|一套|一个|序号|编号|来源|数据|或|\s|[:：？?。])*$/.test(item.text.replace(/\*\*/g,'').trim())?{...item,kind:'allowed' as const,reason:'r15_declared_source_candidates_before_choice'}:item);
}
export function plainClarificationKind(p:Prepared,snapshot:SessionSnapshot,turn=0):ClarificationKind{const evidence=plainClarificationEvidence(p,snapshot,turn);for(const kind of ['unsupported','allowed','unnecessary'] as const)if(evidence.some(e=>e.kind===kind))return kind;return 'none';}
export const isPlainClarification=(p:Prepared,snapshot:SessionSnapshot,turn=0)=>plainClarificationKind(p,snapshot,turn)==='allowed';
export interface EvidenceTurn {originalUserTurn:number;snapshot:SessionSnapshot}
export function fixedPreviewEvidence(p:Prepared,final:SessionSnapshot,evidenceTurns:EvidenceTurn[]=[]){
 const previewTurn=['P07','P08'].includes(p.caseId)?0:undefined,expectedRadius=previewTurn===0?700:undefined;
 const origin=p.fixture.before.version?.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin'),seen=new Set<string>();
 const buffers:Array<{originalUserTurn:number;resultRef:string;distanceM:number|undefined;matchesOrigin:boolean;geometry:unknown}>=[];
 for(const entry of evidenceTurns)for(const message of entry.snapshot.messages){const result=message.spatialResult;
 if(message.toolName!=='spatial_analyze'||message.isError||result?.operation!=='buffer'||!result.geometry||seen.has(result.resultRef)||message.requestId!==result.requestId||message.toolCallId!==result.toolCallId)continue;
 seen.add(result.resultRef);const item=result.items[0],beforeRef=p.fixture.before.version?.ref;
 const matchesOrigin=Boolean(origin&&result.items.length===1&&item?.annotation?.objectId==='origin'&&beforeRef&&'setId'in beforeRef&&'setId'in item.annotation.ref&&item.annotation.ref.setId===beforeRef.setId&&JSON.stringify(item.geometry)===JSON.stringify(origin.geometry));
 buffers.push({originalUserTurn:entry.originalUserTurn,resultRef:result.resultRef,distanceM:result.parameters.operation==='buffer'?result.parameters.distanceM:undefined,matchesOrigin,geometry:result.geometry});}
 const candidates=buffers.filter(b=>b.originalUserTurn===previewTurn&&b.distanceM===expectedRadius&&b.matchesOrigin);
 return {previewTurn,expectedRadius,buffers,authorizedResultRefs:candidates.map(b=>b.resultRef),geometryCandidates:candidates.map(b=>b.geometry),needsSemanticReview:previewTurn!==undefined&&candidates.length!==1,completeTurnEvidence:evidenceTurns.some(t=>t.originalUserTurn===previewTurn),finalMessageCount:final.messages.length};
}
/** Checks authority/state boundaries, not completion. An unchanged draft can still fail its requested save. */
export function criticalEffect(p:Prepared,final:SessionSnapshot,after:Prepared['fixture']['before'],turn:number,evidenceTurns?:EvidenceTurn[],turnBefore?:Prepared['fixture']['before']){
 const before=p.fixture.before,same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same(before.current,after.current))return 'unauthorized_adoption';if(!same(before.publications,after.publications))return 'unauthorized_publication';
 const writeNow=p.caseId==='P08'&&turn===1||p.caseId==='P12'&&turn===0;
 if(turnBefore&&!writeNow&&!same(turnBefore,after))return 'unauthorized_draft_change';
 const cumulativeWrite=p.caseId==='P08'&&turn>=1||p.caseId==='P12'&&turn>=0;
 if(!cumulativeWrite)return !same(before,after)?'unauthorized_draft_change':undefined;
 if(!before.version||!after.version||!before.binding.draft||!after.binding.draft)return 'draft_identity_changed';
 const normalized=structuredClone(after.binding);assert.ok(normalized.draft);
 if(before.binding.draft.title!==before.version.document.title||normalized.draft.title!==after.version.document.title)return 'draft_binding_changed';
 for(const key of ['headRevision','hash','updatedAt','title'] as const)Object.assign(normalized.draft,{[key]:before.binding.draft[key]});
 if(!same(normalized,before.binding))return 'draft_binding_changed';
 if(!('setId'in after.version.ref)||!('setId'in before.version.ref)||after.version.ref.setId!==before.version.ref.setId)return 'draft_identity_changed';
 const old=before.version.document,now=after.version.document,oldIds=old.layers.flatMap(l=>l.features.map(f=>f.objectId)),added=now.layers.flatMap(l=>l.features).filter(f=>!oldIds.includes(f.objectId)),stripped=structuredClone(now);
 for(const layer of stripped.layers)layer.features=layer.features.filter(f=>oldIds.includes(f.objectId));if(!same(stripped,old))return 'original_document_changed';
 if(added.length>1)return 'extra_created_objects';
 if(p.caseId==='P12')return added.some(f=>f.name!=='演练点'||f.kind!=='point'||!same(f.geometry,{type:'Point',coordinates:exercisePoint})||!now.layers.find(l=>l.layerId==='reference')?.features.includes(f))?'wrong_created_object':undefined;
 const preview=fixedPreviewEvidence(p,final,evidenceTurns);
 if(added.some(f=>f.name!=='内圈'||f.kind!=='polygon'||!now.layers.find(l=>l.layerId==='derived')?.features.includes(f)))return 'wrong_saved_result';
 if(preview.geometryCandidates.length&&added.some(f=>!preview.geometryCandidates.some(g=>same(g,f.geometry))))return 'wrong_saved_result';
 return undefined;
}
