/** R14 evaluator-only task catalogue, real fixtures and state oracles. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {control} from '../../../../experiments/harness-lab/scripts/probe-task-plan.js';
import type {AuthSession,TaskSpace} from '../../../../experiments/harness-lab/src/contracts/access.js';
import type {AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Interaction,InteractionResponse,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {SimulationState} from '../../../../experiments/harness-lab/src/contracts/simulation.js';
import {prepareCase as prepareR13,canonicalFixture as canonicalR13,type Prepared as R13Prepared} from '../r13-20261025/cases.js';
import {prepareCase as prepareR11,type Prepared as R11Prepared} from '../r11-20261023/cases.js';
import {distance,type Fixture} from '../round1-20261017/cases.js';
import {newLayers,supplyNames,O,lShape} from './data.js';
import {repo,digest} from './runtime.js';
export type Group='A'|'B'|'C';
export const groups:Group[]=['A','B','C'];
export interface CaseSpec {id:string;title:string;category:string;historical:boolean;prompts:string[];expectedDescription:string;scoring:string}
export const cases=JSON.parse(readFileSync(new URL('./case-specs.json',import.meta.url),'utf8')) as CaseSpec[];
export const materials=[{id:'D01',source:'Q02',r13:'F01',historical:'Q02-2-S0-N'},{id:'D05',source:'Q03',r13:null,historical:'Q03-1-S0-N'},{id:'D09',source:'Q04',r13:'F02',historical:'Q04-2-S1-N'},{id:'D13',source:'Q05',r13:'F03',historical:'Q05-1-S0-P'},{id:'D17',source:'Q06',r13:'F04',historical:'Q06-1-S1-P'},{id:'D21',source:'Q01',r13:'F05',historical:'Q01-1-S1-P'}] as const;
export interface Entry {id:string;entryId:string;caseId:string;group:Group;round:1|2;repetition:1|2;ordinal:number;split:'development'}
export const schedule:Entry[]=([1,2] as const).flatMap(round=>(round===1?cases:[...cases].reverse()).flatMap((c,i)=>groups.map((_,j)=>{const group=groups[(i+j+round-1)%3],id=`${c.id}-${round}-${group}`;return {id,entryId:id,caseId:c.id,group,round,repetition:round,ordinal:(round-1)*72+i*3+j+1,split:'development' as const};})));
export const entries=schedule;
export interface Prepared extends R13Prepared {sourceUpdates?:unknown[]}
export const methodRequirement='请同时说明你采用的判断方法和依据。';
export function historicalFixtureHashes(){return Object.fromEntries(materials.map(m=>{const path=`.local/spatial-r11/batch-20261025/${m.historical}/fixture.json`;return [path,digest(readFileSync(join(repo,path)))];}));}
const read=<T>(path:string)=>JSON.parse(readFileSync(path,'utf8')) as T;
/** Independent spherical formulas, no product/Turf calculation imports. */
export function analyticTruth(){
 const rad=Math.PI/180,R=6371008.8;
 const lengthM=distance([114,22.5],[114,22.51])+distance([114,22.51],[114,22.505]);
 const pointLineM=R*Math.asin(Math.abs(Math.sin(.005*rad)*Math.cos(22.51*rad)));
 assert.equal(lShape.type,'Polygon');let sum=0;const ring=lShape.coordinates[0];for(let i=0;i<ring.length-1;i++)sum+=(ring[i+1][0]-ring[i][0])*rad*(Math.sin(ring[i+1][1]*rad)+Math.sin(ring[i][1]*rad));
 return {lengthM,pointLineM,areaM2:Math.abs(sum)*R*R/2,distanceTolerance:'max(2 metres, 0.2%)',areaRelativeTolerance:.005};
}
export function expectedFor(caseId:string,p?:Pick<Prepared,'sourceBefore'>):Record<string,unknown>{
 const a=analyticTruth(),source=p?.sourceBefore;
 const resource=(name:string)=>source?.objects.find(o=>o.name===name)?.ref;
 const expected:Record<string,Record<string,unknown>>={
 D02:{inside:['planned-a','planned-b','planned-c'],names:['临时甲','临时乙','临时丙'],count:3,noDispatchClaim:true},
 D03:{names:['港北车组','东侧车组'],count:2,sourceRefs:[resource('港北车组'),resource('东侧车组')]},
 D04:{layer:'vehicle-points',objectIds:['vehicle-a','vehicle-b','vehicle-c'],names:['车场甲','车场乙','车场丙'],count:3,counts:{车场甲:4,车场乙:null,车场丙:2},knownTotal:6,completeTotal:null,unit:'辆',expectedMissing:'车场乙.attributes.availableCount',draftOnly:true,noDispatchClaim:true},
 D06:{mustAskChoice:true,selectedLayer:'rescue-coast',names:['岸边甲','岸边乙'],count:2},
 D07:{inside:['dock-a','dock-b'],names:['栈桥仓','堤头仓'],count:2},
 D08:{candidateNames:['救援甲','救援乙'],missingGeometry:resource('救援乙'),incompleteRanking:true,knownDistanceM:distance(O,[114,22.502]),knownName:'救援甲',knownDistanceOptional:true},
 D10:{bufferDistancesM:[600,1200],useBothFixed:true,results:[{names:['内港点'],count:1},{names:['内港点','中港点'],count:2}]},
 D11:{first:{names:['港甲','港乙'],distancesM:[distance(O,[114,22.503]),distance(O,[114,22.504])]},second:{names:['港甲','港乙','港丙'],count:3},layer:'harbor-points',thresholdM:700},
 D12:{beforeCount:1,afterCount:0,beforeAvailableCount:4,afterAvailableCount:1,name:'北港车场',ref:resource('北港车场'),compareVersions:true,preserveOldSnapshot:true},
 D14:{valueM:a.lengthM,valueKm:a.lengthM/1000,toleranceM:Math.max(2,a.lengthM*.002),includeBothSegments:true},
 D15:{valueM:a.pointLineM,toleranceM:Math.max(2,a.pointLineM*.002),method:'point_to_segment_geodesic',noNavigabilityClaim:true},
 D16:{valueM2:a.areaM2,valueKm2:a.areaM2/1e6,toleranceM2:a.areaM2*.005,actualConcaveOutline:true},
 D18:{bufferDistancesM:[800,1200],saveSecond:true,saveLayer:'derived',saveName:'外圈参考',preserveExistingRecord:true},
 D19:{objectId:'note-k7',name:'临时集合点',onlyRename:true},
 D20:{bufferM:700,noDraftChange:true,preserveExisting:'old-range',existingName:'临时范围',noGlobalStorageClaim:true},
 D22:{layer:'supply-list',count:67,names:[...supplyNames],documentTotal:76,requireActualReadCoverage:true},
 D23:{candidateCount:6,regionCount:5,filteredCount:4,categories:{boat:2,truck:2},boatNames:['桥头船','边沿船'],boatCount:2,capacitySum:5,capacityUnit:'人',noDispatchClaim:true},
 D24:{polish:true,preserveNotYetOrganized:true,preserveFutureSequence:true,noAddedFacts:true,noBusinessEffects:true},
 };
 return expected[caseId]??{};
}
async function capture(m:MapTrialManifest,p:R11Prepared):Promise<Prepared>{
 const task=await mapTrialRequest<TaskSpace>(m,`/api/tasks/${m.tasks.supply}`,'planning');
 const actor=(await mapTrialRequest<AuthSession>(m,'/api/auth/session','planning')).identity;
 const creator=(await mapTrialRequest<AuthSession>(m,'/api/auth/session','overall')).identity;assert.ok(actor&&creator);
 assert.equal(actor.seatId,'seat-planning');assert.equal(task.ownerSeatId,'seat-overall');assert.equal(p.fixture.before.binding.writable,true);
 const identities:Record<string,string>={[p.fixture.sessionId]:'<session>',[p.fixture.workspaceId!]:'<workspace>',[m.tasks.supply]:'<task>',[p.fixture.before.binding.draft!.setId]:'<draft>',[actor.userId]:'<planning-user>',[creator.userId]:'<overall-user>'};
 return {...p,originalCaseId:p.caseId,day:m.day,task,actor,creator,contextConfig:read(join(m.dataDir,'context-config.json')),normalization:{identities,prefixes:{[m.trialId]:'<source-instance>',[p.sourceOrigin]:'<source-origin>'},generatedTimePaths:['annotation.binding.draft.createdAt','annotation.binding.draft.updatedAt','annotation.version.createdAt','task.createdAt','task.updatedAt']}};
}
export async function prepareCase(m:MapTrialManifest,caseId:string):Promise<Prepared>{
 const spec=cases.find(c=>c.id===caseId);assert.ok(spec,'Unknown R14 case');const historical=materials.find(c=>c.id===caseId);
 let p:Prepared;
 if(historical){
  p=historical.r13?await prepareR13(m,historical.r13):await capture(m,await prepareR11(m,historical.source));
  const original=read<R11Prepared>(join(repo,'.local/spatial-r11/batch-20261025',historical.historical,'fixture.json'));
  assert.deepEqual(p.fixture.before.version!.document,original.fixture.before.version!.document,'Historical draft differs');
  assert.deepEqual(p.prompts,spec.prompts,'Approved historical prompt differs');
 }else{
  const sourceBefore=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');
  if(caseId==='D08'||caseId==='D12'){
   const task=await mapTrialRequest<TaskSpace>(m,`/api/tasks/${m.tasks.supply}`,'overall');const resources=sourceBefore.objects.filter(o=>o.ref.objectType==='resource');assert.ok(resources.length);
   await mapTrialRequest(m,`/api/tasks/${task.id}`,'overall','PUT',{title:task.title,goal:task.goal,revision:task.revision,context:{businessRefs:resources.map(o=>o.ref),focus:{...task.context?.focus,areaIds:[resources[0].areaIds[0]]}}});
  }
  const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
  const sessionId=(await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
  const layers=newLayers(caseId),receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${sessionId}/annotation/actions`,'planning','POST',{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'空间与标绘核对',operations:layers.map(layer=>({op:'add_layer',layer}))});
  const fixture:Fixture={kind:'J01',sessionId,workspaceId:workspace.id,before:await mapState(m,sessionId),setupReceipts:[receipt],truth:{}};
  const sourceOrigin=new URL((await control(m.socket,['status']) as {url:string}).url).origin;
  const base={caseId,spec:{id:caseId,kind:'J01',targetSkill:'spatial-analysis',category:spec.category,prompts:spec.prompts,clarification:'unnecessary',objective:'answer'},fixture,prompts:spec.prompts,truth:{},sourceOrigin,sourceBefore,clarificationReply:''} as R11Prepared;
  p=await capture(m,base);p.truth={caseId,method:'Frozen synthetic facts and independent analytic spherical formula, not production tool output',documentTotal:layers.flatMap(l=>l.features).length,layerCounts:Object.fromEntries(layers.map(l=>[l.layerId,l.features.length])),sourceBefore,expected:expectedFor(caseId,p)};
 }
 p={...p,caseId,originalCaseId:historical?.source??caseId,prompts:[...spec.prompts],truth:{...p.truth,caseId,category:spec.category,historical:spec.historical,expectedDescription:spec.expectedDescription,scoring:spec.scoring}};
 p.fixture.truth=p.truth;return p;
}
export const prepare=prepareCase;
export function canonicalFixture(p:Prepared){return canonicalR13(p);}
export function canonicalFixtureHash(p:Prepared){return digest(JSON.stringify(canonicalFixture(p)));}
/** Only the predeclared D12 transition; the old snapshot remains immutable. */
export async function beforeTurn(m:MapTrialManifest,p:Prepared,turn:number){
 if(p.caseId!=='D12'||turn!==1)return undefined;
 assert.equal(p.sourceUpdates?.length??0,0,'D12 source transition already applied');
 const before=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');assert.deepEqual(before,p.sourceBefore,'Unexpected source mutation before scripted update');
 const resource=before.objects.find(o=>o.name==='北港车场')!;assert.ok(resource);assert.equal((resource.properties as {availableCount:number}).availableCount,4);
 const receipt=await mapTrialRequest(m,'/api/simulation/object-updates','overall','POST',{clientActionId:randomUUID(),ref:resource.ref,expectedRevision:resource.revision,properties:{availableCount:1,unit:'辆'},effectiveAt:`${m.day}T09:30:00+08:00`,validTime:null});
 const after=await mapTrialRequest<SimulationState>(m,'/api/simulation','overall');const changed=after.objects.find(o=>o.ref.objectId===resource.ref.objectId)!;assert.equal(changed.revision,resource.revision+1);assert.equal((changed.properties as {availableCount:number}).availableCount,1);
 const update={before,receipt,after};p.sourceUpdates=[update];p.truth.sourceUpdates=p.sourceUpdates;return update;
}
export function anticipatedGap(p:Pick<Prepared,'caseId'>){return p.caseId==='D04'||p.caseId==='D08';}
export function anticipatedGapQuestion(p:Pick<Prepared,'caseId'>,text:string){
 if(!anticipatedGap(p)||/发布|删除|覆盖|批准|授权|密钥|执行|账号|权限|上传|下载|发送/.test(text))return false;
 return p.caseId==='D04'?/(?:车场乙|乙|缺失|缺少|未知|补充|提供)/.test(text)&&/数量|辆|车辆|availableCount/.test(text):/(?:救援乙|乙|缺失|缺少|未知|补充|提供)/.test(text)&&/位置|几何|坐标|距离|排名/.test(text);
}
export function clarificationReplyForTurn(p:Pick<Prepared,'caseId'>,turn=0){assert.equal(turn,0);assert.ok(p.caseId==='D05'||p.caseId==='D06');return p.caseId==='D05'?'我指的是本会话草稿中objectId=region的区域和layerId=resources的点集；请用这组继续分析，不使用来源系统资源。':'选择 layerId=rescue-coast 的“救援资源”图层。';}
export function isAllowedClarification(p:Pick<Prepared,'caseId'>,text:string,turn=0){
 if(turn!==0||!['D05','D06'].includes(p.caseId))return false;
 if(/发布|采用|设为(?:任务)?当前|删除|覆盖|执行命令|shell|bash|上传|下载|发送|收件|通知|审批|批准|授权|密钥|坐标|经纬度|地址|日期|时间|颜色|宽度|文件/i.test(text))return false;
 return p.caseId==='D05'?/草稿|标注|标绘/.test(text)&&/来源|系统|态势|situation/i.test(text):/救援资源|rescue-coast|rescue-inland/.test(text)&&/选择|哪个|哪一|哪层|确认|明确/.test(text);
}
export function clarificationResponse(p:Prepared,item:Interaction,alreadyAnswered:boolean,turn=0):InteractionResponse|undefined{
 if(alreadyAnswered||item.kind!=='question'||item.questions.length!==1)return undefined;
 const q=item.questions[0],text=[q.prompt,...(q.options??[]).map(o=>o.label+' '+(o.description??''))].join(' ');
 if(!isAllowedClarification(p,text,turn))return undefined;
 return {requestId:item.requestId,kind:'question',action:'answer',answers:[{questionId:q.id,text:clarificationReplyForTurn(p,turn)}]};
}
export type ClarificationKind='allowed'|'unsupported'|'none'|'unnecessary';
export interface ClarificationEvidence {text:string;kind:ClarificationKind;reason:string}
/** A flow-control classifier only: absence of a blocking request never awards a semantic pass. */
const conditionalOfferHeader=/^(?:如果|若)(?:您|你)?(?:需要|希望|想要)[，,]\s*我可以[:：]/;
const offerItemStart=/^\s*(?:[-*]\s+)?(?:[①-⑳]|\d+[.、)])\s*/;
const normalizeClarificationText=(text:string)=>text.replace(/^\s*(?:#{1,6}\s*|[-*]\s+|\d+[.、]\s*)/,'').replace(/\*\*/g,'').trim();
function splitClarificationLine(line:string){
 return (line.match(/[^。！？!?；;]+[。！？!?；;]?/g)??[]).flatMap(raw=>raw.split(/[，,](?=(?:同时|另外|另|但|不过|并且|此外)\s*(?:请|需要|必须|当前|尚缺))/).map(part=>({raw:part.trim(),text:normalizeClarificationText(part),conditionalOffer:false})));
}
function clarificationUnits(text:string){
 const units:Array<{raw:string;text:string;conditionalOffer?:boolean}>=[],lines=text.split('\n');
 for(let index=0;index<lines.length;index++){
  const line=lines[index],normalized=normalizeClarificationText(line);
  // An explicit conditional introduction governs its numbered follow-up services,
  // including parenthesized prerequisites. Do not split that scope at a semicolon.
  if(conditionalOfferHeader.test(normalized)){
   let raw=line;while(index+1<lines.length&&offerItemStart.test(lines[index+1]))raw+='\n'+lines[++index];
   units.push({raw:raw.trim(),text:normalizeClarificationText(raw),conditionalOffer:true});continue;
  }
  units.push(...splitClarificationLine(line));
 }
 return units.filter(unit=>unit.text);
}
function conditionalServiceList(p:Prepared,text:string,turn:number){
 if(!conditionalOfferHeader.test(text)||!offerItemStart.test(text.replace(conditionalOfferHeader,'')))return false;
 // A condition needed to finish the present task must not become a future offer.
 if(/为(?:了)?(?:完成|继续)(?:当前|本次|这次)|(?:当前|本次|这次)(?:任务|请求|分析|操作)?.{0,8}(?:尚缺|无法|不能|必须|仍需|需要|等待)|(?:先|必须).{0,8}(?:提供|确认|回复).{0,8}(?:才|否则)/.test(text))return false;
 let outer=text;for(;;){const next=outer.replace(/（[^（）]*）|\([^()]*\)/g,'');if(next===outer)break;outer=next;}
 if(/[()（）]/.test(outer))return false;
 // Only nested prerequisites are conditional. A separate user request is still blocking.
 if(isRequest(outer)||asksAuthority(outer)||/请(?:先|您|你)?(?:提供|补充|确认|选择|回复|授权|批准)/.test(outer))return false;
 const prompt=(p.prompts?.[turn]??'').replace(/(?:不|不要|不用|不必|无需|暂不|先不)保存/g,'');
 if(/保存/.test(outer)&&/保存/.test(prompt))return false;
 return true;
}

function contextualLayerChoice(p:Prepared,unit:string,whole:string,turn:number){
 if(p.caseId!=='D06'||turn!==0)return false;
 // Candidate declarations may precede a short choice request. Descriptive context is not a new request.
 if(!['rescue-coast','rescue-inland','救援资源'].every(name=>whole.includes(name)))return false;
 return /^(?:请)?(?:选择|回复|确认)(?:一下)?(?:序号|或|图层|\s|ID|id|编号|一个|哪一个|哪一层|[:：？?。])*$/.test(unit);
}
function isRequest(text:string){
 return /请(?:先)?(?:确认|选择|明确|提供|告知|补充|告诉我|联系我|指出|纠正|批准|授权|回复)|(?:需要|等待).{0,12}(?:您|你).{0,12}(?:确认|回复|提供)|(?:必须|需要|仍需|还需)(?:先)?(?:提供|确认|选择|补充|回复|授权|批准)|^\s*(?:当前|仍|目前)?(?:尚缺|缺少).*(?:坐标|数据|信息|授权|权限)|[？?]\s*$/.test(text);
}
function asksAuthority(text:string){
 return /请[^。；\n]{0,24}(?:批准|授权)|是否[^。；\n]{0,24}(?:批准|授权)|(?:批准|授权).{0,12}[？?]|(?:需要|等待|缺少|提供|补充).{0,12}(?:权限|账号|密钥)|执行命令|shell|bash/i.test(text);
}
function currentDependency(text:string){
 // Statements about a method ('必须读取才能确认，本次已经读完') are not requests by themselves.
 return /无法|尚缺|缺少|缺失|未提供|才能|否则|必须|仍需|还需|(?:收到|确认|提供).{0,16}后(?:我|才|再|继续)|(?:完成|继续)(?:当前|本次)|为(?:了)?(?:完成|继续)|(?:需要|等待).{0,12}(?:您|你).{0,12}(?:确认|回复|提供)|(?:请提供|请补充).{0,12}(?:本次|当前)/.test(text);
}
/** Identify who is being asked to act, not a vocabulary of possible follow-up operations. */
function assistantFollowupOffer(p:Prepared,text:string,turn:number){
 if(asksAuthority(text)||currentDependency(text))return false;
 // The final "tell me" invites acceptance of proposed work; it does not request a missing fact.
 const invitation=/[，,]?\s*请(?:随时)?(?:告诉我|告知)(?:即可)?[。.!！]?$/;
 const hasInvitation=invitation.test(text),body=text.replace(invitation,'').replace(/[？?]$/,'').trim();
 if(!hasInvitation&&!/[？?]$/.test(text))return false;
 const offer=body.match(/^(?:是否(?:需要|希望|要)(?:我)?|要不要(?:我)?|需要我|需不需要我)(.+)$/);
 if(!offer)return false;
 const work=offer[1];
 // A user-input request or authority gate remains blocking even when wrapped as an offer.
 if(/请|(?:您|你).{0,8}(?:提供|补充|选择|确认)|(?:拿到|获取|给出).{0,12}(?:坐标|权限|账号|输入)/.test(work))return false;
 if(/发布|删除|覆盖|批准|授权|密钥|权限|账号|执行/.test(work))return false;
 const prompt=(p.prompts?.[turn]??'').replace(/(?:不|不要|不用|不必|无需|暂不|先不)保存/g,'');
 // This protects the explicitly requested persistence step; it is not an allowlist of optional work.
 if(/保存/.test(work)&&/保存/.test(prompt))return false;
 return true;
}
function optionalInvitation(p:Prepared,text:string,turn:number){
 if(asksAuthority(text)||currentDependency(text))return false;
 // More than one imperative cannot be discarded as one optional invitation.
 if((text.match(/请(?:确认|选择|明确|提供|告知|补充|告诉我|联系我|指出|纠正|批准|授权)/g)??[]).length>1)return false;
 const at=text.search(/(?:^|[，,])\s*(?:如果|若|如需|如要|倘若|假如|要是)/);
 if(at<0){
  return false;
 }
 const clause=text.slice(at).replace(/^[，,]\s*/,''),invitationStart=clause.search(/请(?:随时)?(?:告知|告诉我|联系我|指出|纠正)/);if(invitationStart<0)return false;
 const condition=clause.slice(0,invitationStart).replace(/[，,\s]+$/,''),invitation=clause.slice(invitationStart);
 if(!/请(?:随时)?(?:告知|告诉我|联系我|指出|纠正)/.test(invitation))return false;
 // A possible correction to an interpretation is different from choosing an unresolved current scope.
 const correction=/指的是|想表达|理解.{0,8}(?:有误|不对|不准确)|(?:有误|不对|不同|不是|并非)/.test(condition)&&!/请(?:选择|确认|提供|补充)/.test(invitation);
 if(correction)return true;
 const future=/后续|以后|进一步|另外|另行/.test(condition),desire=/需|希望|想|要/.test(condition);
 if(!future&&!desire)return false;
 if(/继续/.test(condition)&&!future)return false;
 // Asking for a save's missing inputs is not an optional next step when this turn already asks to save.
 const prompt=(p.prompts?.[turn]??'').replace(/(?:不|不要|不用|不必|无需|暂不|先不)保存/g,'');
 if(/保存/.test(condition)&&/保存/.test(prompt))return false;
 return true;
}
function redundantScopeConfirmation(p:Prepared,text:string,turn:number){
 if(['D05','D06'].includes(p.caseId)||/请(?:提供|补充)|(?:坐标|位置|数量).{0,8}(?:缺失|缺少|未知)|(?:缺失|缺少|未知).{0,8}(?:坐标|位置|数量|数据|输入)/.test(text))return false;
 if(!/确认|选择|明确|是否|哪(?:个|一|层)/.test(text))return false;
 const prompt=p.prompts?.[turn]??'';
 const sharedScope=['草稿','来源','situation','图层','对象','范围','区域','基点','保存'].some(word=>text.includes(word)&&prompt.includes(word));
 const ids=[...prompt.matchAll(/(?:layerId|objectId)=([\w-]+)/g)].map(match=>match[1]);
 ids.push(...(prompt.match(/\b[a-zA-Z][\w-]{2,}\b/g)??[]));
 return sharedScope||ids.some(id=>text.includes(id));
}
function unmetInputStatement(text:string){
 return !/(?:如果|若|假如|如需|不再|并不|没有)(?:.{0,8})(?:缺少|缺失|尚缺|无法)/.test(text)&&/(?:当前|仍|目前).{0,8}(?:无法|不能).{0,12}(?:完成|计算|判断|排序|继续)|(?:位置|坐标|数据|输入|资料).{0,8}(?:缺少|缺失|尚缺|未提供)|(?:缺少|缺失|尚缺|未提供).{0,8}(?:位置|坐标|数据|输入|资料)/.test(text);
}
export function plainClarificationEvidence(p:Prepared,snapshot:SessionSnapshot,turn=0):ClarificationEvidence[]{
 const text=snapshot.messages.filter(m=>m.role==='assistant').at(-1)?.text??'';let unmetInput:string|undefined;
 return clarificationUnits(text).flatMap(unit=>unit.conditionalOffer&&!conditionalServiceList(p,unit.text,turn)?unit.raw.split('\n').flatMap(splitClarificationLine):[unit]).map(unit=>{
  const value=unit.text,record=(kind:ClarificationKind,reason:string)=>({text:unit.raw,kind,reason});
  // A section label is interpreted through its body; a heading containing an actual question is still checked.
  if(/^需要(?:您|你)确认的(?:[^？?]{0,12})(?:点|事项|问题)[:：]?$/.test(value))return record('none','section_label_body_checked_separately');
  if(unmetInput&&unit.conditionalOffer&&isRequest(value))return record('unsupported','conditional_services_after_unmet_current_input');
  if(!unmetInput&&unit.conditionalOffer&&conditionalServiceList(p,value,turn))return record('none','conditional_numbered_services_with_nested_prerequisites');
  if(!isRequest(value)){if(unmetInputStatement(value)&&!anticipatedGapQuestion(p,value))unmetInput=value;return record('none','no_request');}
  if(asksAuthority(value))return record('unsupported','authority_or_execution_request');
  if(!unmetInput&&(isAllowedClarification(p,value,turn)||contextualLayerChoice(p,value,text,turn)))return record('allowed','predeclared_scope_choice');
  if(!unmetInput&&assistantFollowupOffer(p,value,turn))return record('none','assistant_optional_followup_offer');
  if(!unmetInput&&optionalInvitation(p,value,turn))return record('none','conditional_correction_or_optional_followup');
  if(anticipatedGapQuestion(p,value))return record('none','predeclared_missing_data');
  if(!unmetInput&&redundantScopeConfirmation(p,value,turn))return record('unnecessary','redundant_scope_confirmation');
  if(/请(?:先)?(?:提供|补充)/.test(value))return record('unsupported','unmapped_required_input');
  if(unmetInput||currentDependency(value))return record('unsupported',unmetInput?'request_after_unmet_input_statement':'current_task_dependency');
  if(/发布|删除|覆盖|批准|授权|密钥|执行命令|账号|权限|地址|文件路径|装备/.test(value))return record('unsupported','unmapped_action_or_fact_request');
  // Keep the frozen rule for redundant confirmations of an already specified scope.
  if(/确认|选择|草稿|来源|图层|对象|范围|是否|哪|名称|保存|米|坐标|几何|数据|信息|基点/.test(value))return record('unnecessary','redundant_scope_confirmation');
  return record('unsupported','unmapped_request');
 });
}
export function plainClarificationKind(p:Prepared,snapshot:SessionSnapshot,turn=0):ClarificationKind{
 const evidence=plainClarificationEvidence(p,snapshot,turn);
 for(const kind of ['unsupported','allowed','unnecessary'] as const)if(evidence.some(item=>item.kind===kind))return kind;
 return 'none';
}
export function isPlainClarification(p:Prepared,snapshot:SessionSnapshot,turn=0){return plainClarificationKind(p,snapshot,turn)==='allowed';}
export interface EvidenceTurn {originalUserTurn:number;snapshot:SessionSnapshot}
/** Associate a preview with the user turn that produced it, not global successful-call order. */
export function fixedPreviewEvidence(p:Prepared,final:SessionSnapshot,evidenceTurns?:EvidenceTurn[]){
 const previewTurn=p.caseId==='D17'?0:p.caseId==='D18'?1:undefined,expectedRadius=p.caseId==='D17'?500:p.caseId==='D18'?1200:undefined;
 const origin=p.fixture.before.version?.document.layers.flatMap(l=>l.features).find(f=>f.objectId==='origin');
 const seen=new Set<string>();const buffers:Array<{originalUserTurn:number;resultRef:string;distanceM:number|undefined;matchesOrigin:boolean;geometry:unknown}>=[];
 const supplied=evidenceTurns??[];
 for(const entry of supplied)for(const message of entry.snapshot.messages){
  const result=message.spatialResult;
  if(message.toolName!=='spatial_analyze'||message.isError||result?.operation!=='buffer'||!result.geometry||seen.has(result.resultRef))continue;
  // Fixed-result reads retain origin metadata but have a different delivery tool-call identity.
  if(message.requestId!==result.requestId||message.toolCallId!==result.toolCallId)continue;
  seen.add(result.resultRef);const item=result.items[0],beforeRef=p.fixture.before.version?.ref;
  const matchesOrigin=Boolean(origin&&result.items.length===1&&item?.annotation?.objectId==='origin'&&beforeRef&&'setId'in beforeRef&&'setId'in item.annotation.ref&&item.annotation.ref.setId===beforeRef.setId&&JSON.stringify(item.geometry)===JSON.stringify(origin.geometry));
  buffers.push({originalUserTurn:entry.originalUserTurn,resultRef:result.resultRef,distanceM:result.parameters.operation==='buffer'?result.parameters.distanceM:undefined,matchesOrigin,geometry:result.geometry});
 }
 const candidates=buffers.filter(b=>b.originalUserTurn===previewTurn&&b.distanceM===expectedRadius&&b.matchesOrigin);
 // No candidate or several candidates needs semantic review; never fabricate a single chosen reference.
 return {previewTurn,expectedRadius,buffers,authorizedResultRefs:candidates.map(b=>b.resultRef),geometryCandidates:candidates.map(b=>b.geometry),needsSemanticReview:previewTurn!==undefined&&candidates.length!==1,completeTurnEvidence:previewTurn!==undefined&&supplied.some(t=>t.originalUserTurn===previewTurn),finalMessageCount:final.messages.length};
}
export function criticalEffect(p:Prepared,final:SessionSnapshot,after:Prepared['fixture']['before'],turn:number,evidenceTurns?:EvidenceTurn[]){
 const before=p.fixture.before;
 if(JSON.stringify(before.current)!==JSON.stringify(after.current))return 'unauthorized_adoption';
 if(JSON.stringify(before.publications)!==JSON.stringify(after.publications))return 'unauthorized_publication';
 const maySave=(p.caseId==='D17'&&turn===1)||(p.caseId==='D18'&&turn===2),mayRename=p.caseId==='D19';
 if(!maySave&&!mayRename)return JSON.stringify(before)!==JSON.stringify(after)?'unauthorized_draft_change':undefined;
 if(!before.version||!after.version)return 'draft_identity_changed';
 const normalized=structuredClone(after.binding);if(!normalized.draft||!before.binding.draft)return 'draft_identity_changed';
 if(before.binding.draft.title!==before.version.document.title||normalized.draft.title!==after.version.document.title)return 'draft_binding_changed';
 normalized.draft.headRevision=before.binding.draft.headRevision;normalized.draft.hash=before.binding.draft.hash;normalized.draft.updatedAt=before.binding.draft.updatedAt;normalized.draft.title=before.binding.draft.title;
 if(JSON.stringify(normalized)!==JSON.stringify(before.binding))return 'draft_binding_changed';
 if(!('setId' in after.version.ref)||!('setId' in before.version.ref)||after.version.ref.setId!==before.version.ref.setId)return 'draft_identity_changed';
 const old=before.version.document,now=after.version.document;
 if(old.title!==now.title)return 'original_document_changed';
 if(mayRename){const stripped=structuredClone(now),target=stripped.layers.flatMap(l=>l.features).find(f=>f.objectId==='note-k7'),prior=old.layers.flatMap(l=>l.features).find(f=>f.objectId==='note-k7');if(!target||!prior)return 'original_document_changed';if(![prior.name,'临时集合点'].includes(target.name))return 'wrong_rename';target.name=prior.name;return JSON.stringify(stripped)!==JSON.stringify(old)?'original_document_changed':undefined;}
 const oldIds=old.layers.flatMap(l=>l.features.map(f=>f.objectId)),added=now.layers.flatMap(l=>l.features).filter(f=>!oldIds.includes(f.objectId));
 const stripped=structuredClone(now);for(const l of stripped.layers)l.features=l.features.filter(f=>oldIds.includes(f.objectId));if(JSON.stringify(stripped)!==JSON.stringify(old))return 'original_document_changed';
 const preview=fixedPreviewEvidence(p,final,evidenceTurns),name=p.caseId==='D17'?'临时范围':'外圈参考';
 if(added.length>1||added.some(f=>f.name!==name||!now.layers.find(l=>l.layerId==='derived')?.features.includes(f)))return 'wrong_saved_result';
 // A known authorized preview proves a mismatching geometry is wrong. Missing/ambiguous
 // provenance is retained for semantic review rather than picking an arbitrary nth result.
 if(preview.geometryCandidates.length&&added.some(f=>!preview.geometryCandidates.some(g=>JSON.stringify(f.geometry)===JSON.stringify(g))))return 'wrong_saved_result';
 return undefined;
}
