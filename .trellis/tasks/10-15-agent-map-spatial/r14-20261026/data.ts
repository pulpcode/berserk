/** R14 synthetic business facts only. No answers/prompts are installed into the model workspace. */
import assert from 'node:assert/strict';
import type {AnnotationFeature,AnnotationLayer} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {InformationReport,Position,SituationGeometry,SituationObject} from '../../../../experiments/harness-lab/src/contracts/context.js';
export const O:Position=[114,22.5];
export const Z:SituationGeometry={type:'Polygon',coordinates:[[[114,22.5],[114.02,22.5],[114.02,22.52],[114,22.52],[114,22.5]]]};
export const lShape:SituationGeometry={type:'Polygon',coordinates:[[[151.20,-33.86],[151.22,-33.86],[151.22,-33.85],[151.21,-33.85],[151.21,-33.84],[151.20,-33.84],[151.20,-33.86]]]};
export const supplyNames='海榕、青堤、灯塔、石湾、白鹭、南榭、渡口、松岭、潮汐、栈桥、岩隙、北桅、晴川、苇岸、云帆、杉坪、月港、长礁、溪亭、棕榈、星沙、望潮、古渡、银湾、红树、盐田、竹岬、烟墩、蓬莱、蓝滩、听涛、石榴、碧屿、木棉、远帆、芦荻、渔火、琴湾、沙洲、海棠、清涧、东篱、风笛、荷塘、白石、晨曦、墨湾、秋浦、鹿鸣、虹桥、枫港、玉汀、泊云、兰屿、镜湖、苏堤、雁沙、春汛、翠微、沙棘、安澜、潮生、连枝、见山、初晴、霁月、星槎'.split('、');
const point=(objectId:string,name:string,coordinates:Position,attributes?:AnnotationFeature['attributes']):AnnotationFeature=>({objectId,name,kind:'point',geometry:{type:'Point',coordinates},...(attributes?{attributes}:{})});
const polygon=(objectId:string,name:string,geometry:SituationGeometry=Z):AnnotationFeature=>({objectId,name,kind:'polygon',geometry:structuredClone(geometry)});
const layer=(layerId:string,name:string,features:AnnotationFeature[],order=0):AnnotationLayer=>({layerId,name,order,defaultVisible:true,features});
const reference=(extra:AnnotationFeature[]=[])=>layer('reference','参照对象',[point('origin','基点',O),...extra]);
export function newLayers(caseId:string):AnnotationLayer[]{
 let layers:AnnotationLayer[];
 switch(caseId){
  case 'D02':layers=[reference([polygon('draft-zone','草稿统计区')]),layer('planned-points','计划点',[point('planned-a','临时甲',[114.004,22.504]),point('planned-b','临时乙',[114.008,22.508]),point('planned-c','临时丙',[114.02,22.51]),point('planned-out','临时外',[114.03,22.51])])];break;
  case 'D03':layers=[reference([polygon('search-zone','搜索区')]),layer('draft-resources','草稿资源',[point('draft-unrelated','无关草稿点',[114.006,22.506])])];break;
  case 'D04':layers=[layer('vehicle-points','草稿车辆记录',[point('vehicle-a','车场甲',[114.004,22.504],{availableCount:4,unit:'辆'}),point('vehicle-b','车场乙',[114.008,22.508],{unit:'辆'}),point('vehicle-c','车场丙',[114.012,22.512],{availableCount:2,unit:'辆'})])];break;
  case 'D08':case 'D12':case 'D24':layers=[reference()];break;
  case 'D06':layers=[reference(),layer('rescue-coast','救援资源',[point('coast-a','岸边甲',[114.005,22.505]),point('coast-b','岸边乙',[114.01,22.51])]),layer('rescue-inland','救援资源',[point('inland-a','内陆甲',[114.03,22.53])])];break;
  case 'D07':layers=[reference([polygon('dock-zone','码头作业区')]),layer('dock-points','码头补给点',[point('dock-a','栈桥仓',[114.003,22.503]),point('dock-b','堤头仓',[114.008,22.508]),point('dock-out','外港仓',[114.03,22.51])]),layer('other-points','其他点',[point('other-a','备用仓',[114,22.501])])];break;
  case 'D10':layers=[reference(),layer('compare-points','比较点',[point('compare-a','内港点',[114,22.503]),point('compare-b','中港点',[114,22.509]),point('compare-out','外海点',[114,22.52])])];break;
  case 'D11':layers=[reference(),layer('harbor-points','港区资源',[point('harbor-a','港甲',[114,22.503]),point('harbor-b','港乙',[114,22.504]),point('harbor-c','港丙',[114,22.5055])]),layer('other-points','其他资源',[point('backup','备用点',[114,22.501])])];break;
  case 'D14':layers=[layer('reference','参照对象',[{objectId:'return-line',name:'往返巡查线',kind:'line',geometry:{type:'LineString',coordinates:[[114,22.5],[114,22.51],[114,22.505]]}}])];break;
  case 'D15':layers=[layer('reference','参照对象',[{objectId:'coast-line',name:'岸线片段',kind:'line',geometry:{type:'LineString',coordinates:[[114,22.5],[114,22.52]]}},point('vessel-position','观察船位',[114.005,22.51])])];break;
  case 'D16':layers=[layer('reference','参照对象',[polygon('l-zone','L形作业区',lShape)])];break;
  case 'D18':layers=[reference(),layer('derived','派生图层',[point('existing-record','既有记录',[114.04,22.54],{purpose:'原有记录'})])];break;
  case 'D19':layers=[layer('notes','集合点',[{...point('note-k7','旧集合点',[114.006,22.506],{status:'planned',code:'K7'}),note:'保留原备注',style:{color:'#137CBD',size:8,symbol:'square'}},point('same-name','临时集合点',[114.01,22.51],{status:'existing'})])];break;
  case 'D20':layers=[reference(),layer('derived','派生图层',[{...polygon('old-range','临时范围'),note:'任务开始前已有，非本次预览'}])];break;
  case 'D22':layers=[layer('supply-list','应急补给',supplyNames.map((n,i)=>point(`supply-${String(i+1).padStart(2,'0')}`,n,[114+i*.0001,22.5]))),layer('unrelated','无关点',Array.from({length:9},(_,i)=>point(`unrelated-${i+1}`,`无关点${i+1}`,[114.05+i*.0001,22.55])))];break;
  case 'D23':layers=[reference([polygon('Z','Z')]),layer('rescue-stock','救援库存',[
   point('bridge-boat','桥头船',[114.004,22.504],{status:'ready',category:'boat',capacity:4}),point('repair-boat','维修船',[114.008,22.506],{status:'busy',category:'boat',capacity:2}),point('north-truck','北岸车',[114.01,22.51],{status:'ready',category:'truck',capacity:3}),point('edge-boat','边沿船',[114.02,22.51],{status:'ready',category:'boat',capacity:1}),point('outer-boat','外海船',[114.03,22.51],{status:'ready',category:'boat',capacity:9}),point('south-truck','南岸车',[114.012,22.508],{status:'ready',category:'truck',capacity:2})])];break;
  default:throw new Error(`Not a new case: ${caseId}`);
 }
 return layers.map((l,i)=>({...l,order:i}));
}
export interface SourceScene {objects:SituationObject[];reports:InformationReport[];asOf:string}
/** Runs only in the synthetic source fixture builder, before source service starts. */
export function sourceScene(base:SourceScene,instanceId:string,day:string,caseId:string):SourceScene{
 const custom=['D02','D03','D07','D08','D12'];if(!custom.includes(caseId))return base;
 const ref=(objectType:string,id:string)=>({systemId:'situation',objectType,objectId:`${instanceId}-${id}`});
 const area=(zone:string,name:string):SituationObject=>({ref:ref('area',`zone-${zone}`),name,revision:1,areaIds:[`${instanceId}-zone-${zone}`],effectiveAt:`${day}T09:00:00+08:00`,validTime:null,geometry:structuredClone(Z),properties:{}});
 const resource=(id:string,name:string,zone:string,coordinates:Position|undefined,count?:number):SituationObject=>({ref:ref('resource',id),name,revision:1,areaIds:[`${instanceId}-zone-${zone}`],effectiveAt:`${day}T09:00:00+08:00`,validTime:null,...(coordinates?{geometry:{type:'Point' as const,coordinates}}:{}),properties:count===undefined?{}:{availableCount:count,unit:'辆'}});
 let data:SituationObject[];
 switch(caseId){
  case 'D02':data=[area('west','西区'),resource('vehicles-west-01','来源车组甲','west',[114.003,22.503],4),resource('vehicles-west-02','来源车组乙','west',[114.007,22.507],2)];break;
  case 'D03':data=[area('west','西区'),resource('vehicles-west-01','港北车组','west',[114.004,22.506],4),resource('vehicles-west-02','东侧车组','west',[114.02,22.51],2),resource('vehicles-west-03','远端车组','west',[114.03,22.51],1)];break;
  case 'D07':data=[area('west','西区'),resource('vehicles-west-01','来源备用仓','west',[114,22.5005],1)];break;
  case 'D08':data=[area('east','东区'),resource('vehicles-east-01','救援甲','east',[114,22.502],1),resource('vehicles-east-02','救援乙','east',undefined,1)];break;
  case 'D12':data=[area('north','北区'),resource('vehicles-north-01','北港车场','north',[114.01,22.51],4)];break;
  default:throw new Error('Unreachable custom case');
 }
 // Preserve task-linked roads/irrelevant areas so the existing neutral task context stays resolvable.
 // Only declared custom resource objects exist; no undeclared extra resource candidates or location reports.
 const ids=new Set(data.map(o=>o.ref.objectId));
 const extras=base.objects.filter(o=>o.ref.objectType!=='resource'&&!ids.has(o.ref.objectId));
 const all=[...data,...extras];for(const item of all)if(item.ref.objectType==='area')item.properties={memberRefs:all.filter(o=>o.ref.objectType!=='area'&&o.areaIds.includes(item.ref.objectId)).map(o=>o.ref)};
 return {objects:all,reports:[],asOf:`${day}T09:00:00+08:00`};
}
export function validateData(){assert.equal(supplyNames.length,67);assert.equal(new Set(supplyNames).size,67);}
