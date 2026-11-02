/** Fresh synthetic business facts authored after product freeze 12e1cc9.
 * This module supplies source records and annotation declarations only. */
import type {AnnotationFeature} from '../../../experiments/harness-lab/src/contracts/annotations.js';
import type {ContextRef,Position,SituationObject,SituationResourceCoverage} from '../../../experiments/harness-lab/src/contracts/context.js';
import type {ResourceSourceCapability,TaskResource} from '../../../experiments/harness-lab/src/contracts/task-resources.js';
import type {CaseId} from './cases.js';
export const businessTime='2026-11-02T06:00:00.000Z';
export const evidenceTime='2026-11-02T05:40:00.000Z';
export const layerId='business-layer';
export interface FixtureSystem {id:string;name:string;resourceCapability?:ResourceSourceCapability;coverage:SituationResourceCoverage}
export interface AcceptanceFixture {
  caseId:CaseId; taskId:string; systems:FixtureSystem[]; objects:SituationObject[]; businessRefs:ContextRef[];
  draftFeatures:AnnotationFeature[]; publishedFeatures:AnnotationFeature[];
  controlledImports:Array<{objectId:string;sourceRef:ContextRef;resourceOverride?:TaskResource}>;
  sourceUpdate?:SituationObject[]; contextAreas:Array<{id:string;name:string}>;
  priorUserReport?:{text:string;sourceRefs:ContextRef[]};
}
const basis=(note:string)=>({evidence:[{kind:'declaration' as const,note}],reportedAt:evidenceTime,effectiveAt:'2026-11-02T05:00:00.000Z'});
const capability=(systemId:string):ResourceSourceCapability=>({systemId,categories:['vehicle','fire_engine','vessel','rescue_boat','facility','hydrant'],units:['辆','艘','处','个'],relations:['assigned','related','potential_support','unconfirmed'],filters:['category','task','relation'],taskIdMapping:'identity',supportRule:{id:'explicit-task-relation',description:'只发现本来源明确登记且关联本任务的支援记录'},pagination:'cursor',snapshot:'fixed_revision'});
const system=(id:string,name:string,taskApi=false,coverage:SituationResourceCoverage={status:'complete'}):FixtureSystem=>({id,name,...(taskApi?{resourceCapability:capability(id)}:{}),coverage});
function declaration(id:string,taskId:string,options:Partial<TaskResource>={}):TaskResource {
 return {meaning:'actual_resource',category:'fire_engine',granularity:'individual',quantity:{value:1,unit:'辆',meaning:'entities',scope:'澄湾演练独立清册',...basis(`数量登记 ${id}`)},taskRelations:[{taskId,relation:'assigned',...basis(`调配单 ${id}，本任务有效至撤销（当前无撤销记录）`)}],availability:{state:'available',...basis(`班前检查 ${id}，设备和人员均可用`)},position:{meaning:'actual',appliesTo:'resource',...basis(`定位回报 ${id}，现场实际位置`)},...options};
}
function resource(systemId:string,id:string,name:string,xy:Position|null,taskId:string,options:Partial<TaskResource>={},entityId=id):SituationObject {
 return {ref:{systemId,objectType:'resource',objectId:id},name,revision:1,areaIds:[],effectiveAt:evidenceTime,validTime:null,geometry:xy?{type:'Point',coordinates:xy}:null,properties:{},resourceData:{entityId,resource:declaration(id,taskId,options)}};
}
function area(systemId:string,id:string,name:string,west:number,south:number,width=.04,height=.03):SituationObject {
 const east=Number((west+width).toFixed(6)),north=Number((south+height).toFixed(6));
 return {ref:{systemId,objectType:'area',objectId:id},name,revision:1,areaIds:[id],effectiveAt:evidenceTime,validTime:null,geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},properties:{memberRefs:[]}};
}
function point(id:string,name:string,xy:Position,resource?:TaskResource):AnnotationFeature {return {objectId:id,kind:'point',name,geometry:{type:'Point',coordinates:xy},...(resource?{resource}:{})};}
const relation=(taskId:string,value:'assigned'|'related'|'potential_support',note:string)=>[{taskId,relation:value,...basis(note)}];
export function buildFixture(caseId:CaseId,taskId:string):AcceptanceFixture {
 const f:AcceptanceFixture={caseId,taskId,systems:[],objects:[],businessRefs:[],draftFeatures:[],publishedFeatures:[],controlledImports:[],contextAreas:[]};
 switch(caseId){
 case 'P01': {
  f.systems=[system('situation','柳堤地图源')];f.objects=[area('situation','p01-quay','柳堤区',118.11,24.41)];
  f.publishedFeatures=[point('p01-pump','柳堤泵车',[118.12,24.42],declaration('柳堤泵车',taskId)),point('p01-boat','柳堤岸舟',[118.11,24.43],declaration('柳堤岸舟',taskId,{category:'rescue_boat',quantity:{value:1,unit:'艘',meaning:'entities',scope:'柳堤舟册',...basis('舟只台账')}})),point('p01-pin','柳堤会合点',[118.13,24.42])];break;
 }
 case 'P02': {
  f.systems=[system('situation','芦汀勤务源',true)];f.objects=[area('situation','p02-reed','芦汀勤务区',118.21,24.51),resource('situation','p02-amber','琥珀勤务车',[118.22,24.52],taskId),resource('situation','p02-cobalt','钴蓝勤务车',[118.25,24.52],taskId),resource('situation','p02-jade','玉色勤务车',[118.27,24.52],taskId),resource('situation','p02-silver','银纹勤务车',null,taskId)];break;
 }
 case 'P03': {
  f.systems=[system('situation','北区演练源',true)];f.objects=[area('situation','p03-hill','北区（坡地侧）',118.31,24.61),area('situation','p03-bank','北区（堤岸侧）',118.39,24.61),resource('situation','p03-acorn','橡实车',[118.32,24.62],taskId),resource('situation','p03-reedboat','苇叶舟',[118.4,24.62],taskId)];break;
 }
 case 'P04': {
  f.systems=[system('situation','巡检清册源',true)];
  f.objects=Array.from({length:23},(_,i)=>resource('situation',`p04-roster-${String(i+1).padStart(2,'0')}`,`海棠巡检车 ${String(i+1).padStart(2,'0')}`,[119.01+i*.001,25.02],taskId));
  f.sourceUpdate=f.objects.map(o=>({...structuredClone(o),revision:2,name:o.name+'（换班后）'}));f.sourceUpdate.push(resource('situation','p04-roster-24','海棠巡检车 24',[119.034,25.02],taskId));break;
 }
 case 'A01': {
  f.systems=[system('situation','澄湾物资簿'),system('mutual','邻站协作登记',true)];
  const direct=resource('situation','a01-lantern','灯塔补给车',[120.13,26.21],taskId,{taskRelations:undefined,availability:{state:'unknown',...basis('物资簿未载当前班次状态')}});
  f.objects=[direct,resource('mutual','a01-petrel','海燕协作艇',[120.15,26.22],taskId,{category:'rescue_boat',quantity:{value:1,unit:'艘',meaning:'entities',scope:'协作舟册',...basis('协作登记一艘')},taskRelations:relation(taskId,'potential_support','协作联络单 M-71：可支援本任务，尚未调配')}),resource('situation','a01-orchid','兰亭维修车',[120.14,26.22],'unrelated-orchid')];f.businessRefs=[direct.ref];break;
 }
 case 'A02': {
  f.systems=[system('situation','堤口设备簿')];const reported=resource('situation','a02-bay','湾口泵车',[120.31,26.32],taskId,{taskRelations:undefined,availability:{state:'unknown',...basis('设备簿没有班次可用报告')}});f.objects=[reported];f.businessRefs=[reported.ref];
  f.draftFeatures=[point('a02-watch','堤口值守车',[120.32,26.33],declaration('值守签收单 W-38',taskId)),{...point('a02-plan','潮门预备部署位',[120.33,26.33],declaration('预案 P-26',taskId,{meaning:'planned_location',position:{meaning:'planned',appliesTo:'site',...basis('预案拟部署位置')}})),informationRole:'plan'},point('a02-guide','转弯指引',[120.34,26.33]),{...point('a02-legacy','旧图舟形标记',[120.35,26.33]),style:{symbolId:'app.rescue-inflatable-boat'},note:'旧图迁入，原始对象说明缺失。'}];
  f.publishedFeatures=[point('a02-fixed','南闸值守艇',[120.36,26.34],declaration('固定版交接单 S-92',taskId,{category:'rescue_boat',quantity:{value:1,unit:'艘',meaning:'entities',scope:'南闸艇册',...basis('南闸交接一艘')},availability:{state:'unavailable',...basis('南闸交接记录：动力系统故障')}}))];
  f.priorUserReport={text:'我补充一下所引用的湾口泵车：05:50 驾驶员电话说轮胎漏气，当前不能出车。这是电话报告，还没有回填设备簿。先记住这条补充。',sourceRefs:[reported.ref]};break;
 }
 case 'A03': {
  f.systems=[system('situation','联运车辆源',true)];const first=resource('situation','a03-record-41','松桥泵车',[120.51,26.41],taskId,{},'chassis-M41');const second=resource('situation','a03-record-57','松桥泵车',[120.52,26.42],taskId,{},'chassis-M57');f.objects=[first,second];f.businessRefs=[first.ref,second.ref];
  f.controlledImports=[{objectId:'a03-import-41',sourceRef:first.ref}];f.draftFeatures=[point('a03-hand-copy','松桥泵车',[120.5101,26.4101],declaration('手绘人员记录：未记车架号，不能确认与来源对象是否同一辆',taskId,{availability:{state:'unknown',...basis('手绘人员未核实状态')}}))];break;
 }
 case 'A04': {
  f.systems=[system('situation','东埠班次登记',true)];
  const ready=resource('situation','a04-cedar','雪松作业车',[120.71,26.51],taskId);
  const related=resource('situation','a04-fir','冷杉作业车',[120.72,26.51],taskId,{taskRelations:relation(taskId,'related','联络资料相关，未收到分配单')});
  const support=resource('situation','a04-cypress','柏木支援车',[120.73,26.51],taskId,{taskRelations:relation(taskId,'potential_support','协作名单 Q-19：尚未分配'),availability:{state:'available',...basis('需桥梁检查放行后方可支援，尚无放行回执'),conditions:['通行检查放行，当前未收到放行回执']}});
  const broken=resource('situation','a04-ash','白蜡作业车',[120.74,26.51],taskId,{availability:{state:'unavailable',...basis('检修单 K-62：液压故障')}});
  const unknown=resource('situation','a04-maple','枫木作业车',[120.75,26.51],taskId,{availability:{state:'available',...basis('上班次检查，已过有效期'),validUntil:'2026-11-02T05:30:00.000Z'}});
  const conflict=resource('situation','a04-larch','落叶松作业车',[120.76,26.51],taskId);
  f.objects=[ready,related,support,broken,unknown,conflict];f.controlledImports=[{objectId:'a04-conflicting-report',sourceRef:conflict.ref,resourceOverride:declaration('现场签报 C-83',taskId,{availability:{state:'unavailable',...basis('现场签报 C-83：电路故障；与班前检查同时有效')}})}];break;
 }
 case 'A05': {
  f.systems=[system('situation','青沙资源清册',true)];f.objects=[area('situation','a05-sand','青沙作业区',121.01,27.01),resource('situation','a05-a','青沙一车',[121.02,27.02],taskId),resource('situation','a05-b','青沙二车',[121.03,27.025],taskId),resource('situation','a05-edge','青沙沿线车',[121.01,27.02],taskId),resource('situation','a05-far','青沙外勤车',[121.07,27.02],taskId),resource('situation','a05-site','青沙登记车',[121.02,27.02],taskId,{position:{meaning:'actual',appliesTo:'site',...basis('几何为登记站址，车辆实际位置未上报')}}),resource('situation','a05-plan','青沙待调车',[121.03,27.03],taskId,{position:{meaning:'planned',appliesTo:'resource',...basis('拟调度位置，不是现场回报')}}),resource('situation','a05-missing','青沙失联车',null,taskId)];
  const group=resource('situation','a05-boats','青沙舟组',[121.04,27.02],taskId,{category:'rescue_boat',granularity:'aggregate',quantity:{value:4,unit:'艘',meaning:'entities',scope:'青沙舟组全体，无其他成员记录',...basis('舟组点名：独立四艘，成员 QSB-31至34')}});delete group.resourceData!.entityId;group.resourceData!.coverage={scope:'青沙舟组全体，无其他成员记录',memberEntityIds:['QSB-31','QSB-32','QSB-33','QSB-34'],complete:true};f.objects.push(group);break;
 }
 case 'A06': {
  f.systems=[system('situation','清澜登记源'),system('patrol','白榆巡查源',false,{status:'partial',reason:'仅回传巡查段一，段二尚未联网；该接口无后续游标。'})];f.objects=[area('situation','a06-elm','榆岸区',121.21,27.21),resource('situation','a06-outside','清澜外站车',[121.29,27.22],taskId,{taskRelations:undefined}),resource('patrol','a06-known','榆岸巡查车',[121.22,27.22],taskId,{taskRelations:undefined})];break;
 }
 case 'A07': {
  f.systems=[system('situation','桦堤地图'),system('other','邻区公开清册',true)];f.objects=[area('situation','a07-birch','桦堤区',121.41,27.41),resource('other','a07-decoy','邻区公开车',[121.42,27.42],taskId)];
  const unlinked=(id:string)=>declaration(id,taskId,{taskRelations:undefined});
  f.publishedFeatures=[point('a07-r1','桦堤一车',[121.42,27.42],unlinked('桦堤一车')),point('a07-r2','桦堤二车',[121.43,27.43],unlinked('桦堤二车')),point('a07-re','桦堤边线车',[121.45,27.42],unlinked('桦堤边线车')),point('a07-ro','桦堤外勤车',[121.47,27.42],unlinked('桦堤外勤车')),point('a07-marker','桦堤会合点',[121.425,27.425]),point('a07-marker-edge','桦堤界桩',[121.41,27.42]),point('a07-plan','桦堤预设驻点',[121.435,27.425],declaration('桦堤预案',taskId,{meaning:'planned_location',position:{meaning:'planned',appliesTo:'site',...basis('预设驻点')}})),point('a07-marker-out','桦堤路牌',[121.49,27.42])];break;
 }
 case 'A08': {
  f.systems=[system('situation','区域资源登记',true)];
  // Equal names and neutral ordering: neither region is selected or privileged in task context.
  f.objects=[area('situation','a08-ridge','北区（山麓侧）',121.61,27.61,.05,.02),area('situation','a08-harbor','北区（港口侧）',121.73,27.61,.03,.04),resource('situation','a08-alder','赤杨作业车',[121.62,27.62],taskId),resource('situation','a08-willow','垂柳作业车',[121.74,27.62],taskId),resource('situation','a08-poplar','白杨作业车',[121.73,27.63],taskId),resource('situation','a08-broken','榉木作业车',[121.75,27.63],taskId,{availability:{state:'unavailable',...basis('榉木车检修单：不可用')}})];break;
 }
 }
 f.contextAreas=f.objects.filter(o=>o.ref.objectType==='area').map(o=>({id:o.ref.objectId,name:o.name}));
 // Geographic tags are source registry membership, deliberately not inferred from geometry.
 // All explicit area queries still require actual-position classification for the user question.
 if(caseId==='A06') {f.objects.find(o=>o.ref.objectId==='a06-known')!.areaIds=['a06-elm'];}
 else for(const object of f.objects.filter(o=>o.ref.objectType==='resource'))object.areaIds=f.contextAreas.map(a=>a.id);
 return structuredClone(f);
}
