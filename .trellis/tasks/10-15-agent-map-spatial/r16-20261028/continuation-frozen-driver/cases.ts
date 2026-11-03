/** R16 evaluator-only case catalogue, independent oracles and real HTTP setup. */
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
import {plainClarificationEvidence as parseClarification} from '../r14-20261026/cases.js';
import {newLayers,O,exercisePoint,pageNames,pageIds,movedOrigin} from './data.js';
export type Group='G0'|'GS'|'GT'|'GST';
export const groups:Group[]=['G0','GS','GT','GST'];
export interface CaseSpec {id:string;title:string;category:string;historical:false;prompts:string[];expectedDescription:string;scoring:string;clarificationReply:string|null}
export const cases=JSON.parse(readFileSync(new URL('./case-specs.json',import.meta.url),'utf8')) as CaseSpec[];
export interface Entry {id:string;entryId:string;caseId:string;group:Group;round:1|2|3;repetition:1|2|3;ordinal:number;split:'development'}
export const scheduleSeed='R16-20261028-schedule';
const groupOffset=parseInt(createHash('sha256').update(scheduleSeed).digest('hex').slice(0,8),16)%4;
export const schedule:Entry[]=[];
for(const round of [1,2,3] as const){
 const ordered=round===1?['Q07','Q08','Q20',...cases.map(c=>c.id).filter(id=>!['Q07','Q08','Q20'].includes(id))]:cases.map(c=>c.id);
 for(const [i,caseId]of ordered.entries())for(let j=0;j<4;j++){
 const group=groups[(groupOffset+i+round-1+j)%4],id=`${caseId}-${round}-${group}`;
 schedule.push({id,entryId:id,caseId,group,round,repetition:round,ordinal:schedule.length+1,split:'development'});
 }
}
export const entries=schedule;
export interface UserUpdate {turn:number;before:PriorPrepared['fixture']['before'];after:PriorPrepared['fixture']['before'];receipt:AnnotationReceipt}
export interface Prepared extends PriorPrepared {sourceUpdates?:unknown[];userUpdates?:UserUpdate[]}
export const historicalFixtureHashes=()=>({});
/** Independent spherical formula: no product geometry library is imported. */
export function distanceM(a:Position,b:Position){const rad=Math.PI/180,dlat=(b[1]-a[1])*rad,dlon=(b[0]-a[0])*rad,h=Math.sin(dlat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlon/2)**2;return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));}
export function analyticTruth(){return {northLengthM:distanceM([114,22.5],[114,22.510])+distanceM([114,22.510],[114,22.505]),southLengthM:distanceM([151.21,-33.86],[151.21,-33.85])+distanceM([151.21,-33.85],[151.21,-33.855]),newPointDistanceM:distanceM(exercisePoint,O),turnLengthM:distanceM([151.20,-33.86],[151.21,-33.86])+distanceM([151.21,-33.86],[151.21,-33.85]),nearestDistancesM:[distanceM(O,[114,22.501]),distanceM(O,[114,22.502])],tolerance:'max(2 metres, 0.2%)'};}
export function expectedFor(caseId:string):Record<string,unknown>{
 const a=analyticTruth(),names=['岸边甲','栈桥乙','码头丙','港池丁'];
 const expected:Record<string,Record<string,unknown>>={
 Q01:{draft:{count:4,names},source:{count:1,names:['来源港车甲']},accepted:'clarify_then_draft_or_complete_labeled_conditionals',fixedReply:cases[0].clarificationReply},
 Q02:{count:4,names,draftOnly:true,noSourceQuery:true},Q03:{regionObjectId:'patrol-area',regionName:'巡查区',count:2,names:['巡查车甲','巡查车乙'],allowParameterRecovery:true},Q04:{draftExists:true,layerCount:0,objectCount:0,regionExists:false},
 Q05:{bufferM:500,center:'origin',inputCount:1,noGlobalCountRequired:true},Q06:{bufferM:500,center:'origin',inputCount:1,layerCount:4,names:['基点','参照甲','参照乙','参照丙']},
 Q07:{bufferM:700,origin:'origin',reuseOriginalResult:true,noDraftChange:true,noGlobalStorageClaim:true},Q08:{bufferDistancesM:[700,1200],savedRadiusM:700,saveTurn:1,saveLayer:'derived',saveName:'内圈',previewOnlyRadiusM:1200,preserveExistingRecord:true},
 Q09:{valueM:a.northLengthM,toleranceM:Math.max(2,a.northLengthM*.002),directions:['北','南'],includeBothSegments:true},Q10:{valueM:a.southLengthM,toleranceM:Math.max(2,a.southLengthM*.002),directions:['北','南'],includeBothSegments:true},
 Q11:{count:4,names:['内部甲','内部乙','边界甲','边界乙'],interior:2,boundary:2,exterior:1,author:'user',agentActions:['read','analyze'],methodRequired:true},
 Q12:{newName:'演练点',newPoint:exercisePoint,layer:'reference',oldObjectId:'old-a',oldUnchanged:true,addTurn:0,distanceTurn:1,valueM:a.newPointDistanceM,toleranceM:Math.max(2,a.newPointDistanceM*.002)},
 Q13:{north:{count:2,names:['北岸甲','北岸乙']},south:{count:1,names:['南岸甲']},accepted:'clarify_then_south_or_complete_labeled_conditionals'},
 Q14:{count:1,names:['来源港车甲'],sourceOnly:true,noDraftRead:true},
 Q15:{nameMatches:0,objectId:'rsc-k7',name:'临时观察区',layerId:'reference',noOtherLayerRead:true},
 Q16:{count:1,names:['巡查区'],layerId:'reference',exactNamesOnly:true,noOtherLayerRead:true},
 Q17:{count:7,names:pageNames,objectIds:pageIds,maxPageLimit:2,allNamesRequireReadEvidence:true},
 Q18:{candidateCount:5,returnedCount:2,names:['浮标甲','浮标乙'],distancesM:a.nearestDistancesM,sorted:true},
 Q19:{savedRadiusM:600,saveTurn:0,saveLayer:'derived',saveName:'观察圈',reuseOriginalResult:true},
 Q20:{savedRadiusM:700,saveTurn:1,saveLayer:'derived',saveName:'值守圈',clarifyBeforeComputation:true,center:'origin'},
 Q21:{valueM:a.turnLengthM,toleranceM:Math.max(2,a.turnLengthM*.002),directions:['东','北']},
 Q22:{centers:[O,movedOrigin],bufferM:500,userMoveTurn:1,sameObjectId:'origin',distinctFixedResults:true,noAgentDraftChange:true},
 Q23:{includingBoundary:4,total:5,noBusinessTools:true},Q24:{names:['岸边甲','栈桥乙','码头丙'],noBusinessTools:true}
 };assert.ok(expected[caseId]);return expected[caseId];
}
export async function prepareCase(m:MapTrialManifest,caseId:string):Promise<Prepared>{
 const spec=cases.find(c=>c.id===caseId);assert.ok(spec,'Unknown R16 case');
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
export async function beforeTurn(m:MapTrialManifest,p:Prepared,turn:number){
 if(p.caseId!=='Q22'||turn!==1)return undefined;
 assert.ok(!p.userUpdates?.length,'Refuse repeating user edit');
 const before=await mapState(m,p.fixture.sessionId);assert.ok(before.version&&'revision'in before.version.ref);
 assert.deepEqual(before,p.fixture.before,'Unexpected state before planned user move');
 const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${p.fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:before.version.ref.revision,operations:[{op:'update_object',objectId:'origin',changes:{geometry:{type:'Point',coordinates:movedOrigin}}}]});
 const after=await mapState(m,p.fixture.sessionId),expected=structuredClone(before.version.document);
 expected.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin')!.geometry={type:'Point',coordinates:movedOrigin};
 assert.deepEqual(after.version!.document,expected);assert.deepEqual(after.current,before.current);assert.deepEqual(after.publications,before.publications);
 const update={turn,before,after,receipt};p.userUpdates=[update];return update;
}
export const anticipatedGapQuestion=(_p:Pick<Prepared,'caseId'>,_text:string)=>{void _p;void _text;return false;};
export const anticipatedGap=(_p:Pick<Prepared,'caseId'>)=>{void _p;return false;};
export type ClarificationKind='allowed'|'unsupported'|'none'|'unnecessary'|'uncertain';
export function clarificationReplyForTurn(p:Pick<Prepared,'caseId'>,turn=0){
 const spec=cases.find(c=>c.id===p.caseId);assert.ok(spec&&spec.prompts[turn]);
 return turn===0&&spec.clarificationReply?spec.clarificationReply:spec.prompts[turn];
}
/** Only declared business choices or literal prompt parameters may receive a scripted answer. */
export function isAllowedClarification(p:Pick<Prepared,'caseId'>,text:string,turn=0){
 const spec=cases.find(c=>c.id===p.caseId);if(!spec?.prompts[turn]||/密钥|密码|账号|授权|批准|权限|shell|bash|文件路径/i.test(text))return false;
 if(turn===0&&p.caseId==='Q01')return /草稿|标注|标绘/.test(text)&&/来源|系统|态势|situation/i.test(text)&&!/提供.*(?:坐标|日期|时间|地址)/.test(text);
 if(turn===0&&p.caseId==='Q13')return /作业区|north|south|南部|北部|图层/.test(text)&&!/提供.*(?:坐标|日期|时间|地址)/.test(text);
 if(turn===0&&p.caseId==='Q20')return /中心|基点|origin|站点乙|center-b|哪个点|哪一个点|坐标|经纬度/.test(text)&&!/发布|采用|任务当前|删除|覆盖/.test(text);
 const prompt=spec.prompts[turn];
 // Prior answer facts cannot authorize answering an unrelated new question.
 const requestStart=text.search(/请(?:选择|确认|提供|指定|告诉)|需要[你您]/);
 const requested=requestStart>=0?text.slice(requestStart):text;
 // A literal restatement can resolve only an already-present parameter, never a new authorization.
 const topics=[[/来源|数据源|草稿|系统/,/草稿|来源系统/],[/中心|基点|origin/,/origin/],[/半径|距离|多少米|范围大小/,/\d+米/],[/图层|layerId|reference|derived|resources/,/reference|derived|resources/],[/名称|名字|命名/,/名称|名为|名字/],[/保存|发布|任务当前/,/保存|发布|任务当前/],[/对象|哪个|哪条|ID/,/objectId|对象ID|return-line|turn-line|origin|巡查区/]] as const;
 return topics.some(([question,known])=>question.test(requested)&&known.test(prompt))&&!/提供.*(?:坐标|日期|时间|地址)|删除|覆盖/.test(requested);
}
export function clarificationResponse(p:Prepared,item:Interaction,alreadyAnswered:boolean,turn=0):InteractionResponse|undefined{
 if(alreadyAnswered||item.kind!=='question'||item.questions.length!==1)return undefined;
 const q=item.questions[0],text=[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' ');
 if(!isAllowedClarification(p,text,turn))return undefined;
 return {requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:clarificationReplyForTurn(p,turn)}]};
}
/** Surface structure only: an attempted answer is neither evidence nor a semantic pass.
 * Historical evidence may suffice, and an unsupported answer must finish for scoring too. */
function hasAnswerText(p:Prepared,text:string,turn:number){
 if(['Q23','Q24'].includes(p.caseId))return text.trim().length>5;
 if(['Q07','Q08','Q19','Q20','Q22'].includes(p.caseId))return turn===0?/生成|预览|范围|resultRef/.test(text):/状态|保存|读取|预览|生成|中心/.test(text);
 if(['Q09','Q10','Q21'].includes(p.caseId))return /长度|米|m\b|km\b/.test(text)&&/东|西|南|北/.test(text);
 if(p.caseId==='Q04')return /没有|为空|未找到|不存在|0/.test(text);
 return /共|总数|数量|个|名称|新增|距离|米/.test(text);
}
export function plainClarificationEvidence(p:Prepared,snapshot:SessionSnapshot,turn=0){
 const requestId=snapshot.lastResult?.requestId;
 const text=snapshot.messages.filter(m=>m.role==='assistant'&&(!requestId||m.requestId===requestId)).at(-1)?.text??'';
 const parsed=parseClarification({...p,caseId:'R16-explicit'},snapshot,turn);
 const question=/[?？]|请(?:选择|确认|提供|指定|告诉)|需要您|需要你|缺少|尚未确定/.test(text);
 if(!question)return [{text,kind:'none' as ClarificationKind,reason:'no_blocking_question'}];
 const offerStart=text.search(/(?:如果|若|如需|如有需要|如你需要|如果你愿意|如果需要|需要的话|后续如|您若|你若)/);
 if(offerStart>=0&&hasAnswerText(p,text.slice(0,offerStart),turn)&&!/[?？]|请(?:选择|确认|提供|指定|告诉)|需要[你您]|缺少|尚未确定|(?:尚未|还未|未能|无法|不能)(?:完成|生成|计算|分析|继续)|等待[你您]/.test(text.slice(0,offerStart))){
  const tail=text.slice(offerStart);
  const parameterRequest=/(?:需要[你您]|请(?:选择|确认|提供|指定|告诉)).{0,24}(?:中心|坐标|经纬度|哪个点|哪一个点|范围大小|半径|数据来源|作业区)/.test(tail);
  const continuationRequest=/(?:如果|若).{0,8}(?:要|需)(?:继续|完成).{0,8}(?:需要[你您]|请).{0,12}(?:提供|补充)/.test(tail);
  const currentDependency=/(?:本次|当前)(?:任务|要求|分析|计算)?.{0,12}(?:还需|仍需|需要|缺少|无法|不能)|(?:才能|才可)(?:完成|继续)(?:本次|当前)/.test(tail);
  if(!parameterRequest&&!continuationRequest&&!currentDependency&&/可以|可继续|告诉我|我能|我也|继续|需要/.test(tail))return [{text:tail,kind:'none' as ClarificationKind,reason:'answered_current_turn_then_optional_offer'}];
 }
 if(isAllowedClarification(p,text,turn))return [{text,kind:'allowed' as ClarificationKind,reason:turn===0&&cases.find(c=>c.id===p.caseId)?.clarificationReply?'declared_business_choice':'literal_prompt_restatement'}];
 if(parsed.every(x=>x.kind==='none')&&!/[?？]|请(?:选择|确认|提供|指定)|需要您|需要你/.test(text))return [{text,kind:'none' as ClarificationKind,reason:'statement_not_question'}];
 return [{text,kind:'uncertain' as ClarificationKind,reason:'unmapped_question_requires_review'}];
}
export function plainClarificationKind(p:Prepared,snapshot:SessionSnapshot,turn=0):ClarificationKind{return plainClarificationEvidence(p,snapshot,turn)[0]?.kind??'none';}
export const isPlainClarification=(p:Prepared,snapshot:SessionSnapshot,turn=0)=>plainClarificationKind(p,snapshot,turn)==='allowed';
export interface EvidenceTurn {originalUserTurn:number;snapshot:SessionSnapshot}
export function fixedPreviewEvidence(p:Prepared,final:SessionSnapshot,evidenceTurns:EvidenceTurn[]=[]){
 const previewTurn=['Q07','Q08','Q19','Q20'].includes(p.caseId)?0:undefined,expectedRadius=previewTurn===0?(p.caseId==='Q19'?600:700):undefined;
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
 const before=p.caseId==='Q22'&&turn>=1?p.userUpdates?.at(-1)?.after??p.fixture.before:p.fixture.before,same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same(before.current,after.current))return 'unauthorized_adoption';if(!same(before.publications,after.publications))return 'unauthorized_publication';
 const writeNow=(p.caseId==='Q08'||p.caseId==='Q20')&&turn===1||(p.caseId==='Q12'||p.caseId==='Q19')&&turn===0;
 if(turnBefore&&!writeNow&&!same(turnBefore,after))return 'unauthorized_draft_change';
 const cumulativeWrite=(p.caseId==='Q08'||p.caseId==='Q20')&&turn>=1||(p.caseId==='Q12'||p.caseId==='Q19')&&turn>=0;
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
 if(p.caseId==='Q12')return added.some(f=>f.name!=='演练点'||f.kind!=='point'||!same(f.geometry,{type:'Point',coordinates:exercisePoint})||!now.layers.find(l=>l.layerId==='reference')?.features.includes(f))?'wrong_created_object':undefined;
 const preview=fixedPreviewEvidence(p,final,evidenceTurns);
 const expectedName=p.caseId==='Q19'?'观察圈':p.caseId==='Q20'?'值守圈':'内圈';
 if(added.some(f=>f.name!==expectedName||f.kind!=='polygon'||!now.layers.find(l=>l.layerId==='derived')?.features.includes(f)))return 'wrong_saved_result';
 if(preview.geometryCandidates.length&&added.some(f=>!preview.geometryCandidates.some(g=>same(g,f.geometry))))return 'wrong_saved_result';
 return undefined;
}
