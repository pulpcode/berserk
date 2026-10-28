/** Synthetic business inputs only. Never install evaluator prompts or answers beside these data. */
import type {AnnotationFeature,AnnotationLayer} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Position,SituationGeometry,SituationObject,InformationReport} from '../../../../experiments/harness-lab/src/contracts/context.js';
export const O:Position=[114,22.5];
export const exercisePoint:Position=[114,22.51];
export const Z:SituationGeometry={type:'Polygon',coordinates:[[[114,22.5],[114.02,22.5],[114.02,22.52],[114,22.52],[114,22.5]]]};
const point=(objectId:string,name:string,coordinates:Position):AnnotationFeature=>({objectId,name,kind:'point',geometry:{type:'Point',coordinates}});
const area=(objectId:string,name:string):AnnotationFeature=>({objectId,name,kind:'polygon',geometry:structuredClone(Z)});
const layer=(layerId:string,name:string,features:AnnotationFeature[]):AnnotationLayer=>({layerId,name,order:0,defaultVisible:true,features});
const origin=()=>point('origin','基点',O);
export function newLayers(caseId:string):AnnotationLayer[]{
 let layers:AnnotationLayer[];
 switch(caseId){
 case 'P01':case 'P02':layers=[layer('reference','参照对象',[area('harbor','港区')]),layer('resources','资源图层',[point('harbor-a','岸边甲',[114.003,22.503]),point('harbor-b','栈桥乙',[114.007,22.507]),point('harbor-c','码头丙',[114.011,22.511]),point('harbor-d','港池丁',[114.015,22.515]),point('harbor-out','外港戊',[114.03,22.51])])];break;
 case 'P03':layers=[layer('reference','参照对象',[area('patrol-area','巡查区')])];break;
 case 'P04':layers=[];break;
 case 'P05':case 'P06':layers=[layer('reference','参照对象',[origin(),point('reference-a','参照甲',[114.01,22.5]),point('reference-b','参照乙',[114.02,22.51]),point('reference-c','参照丙',[114.03,22.52])])];break;
 case 'P07':layers=[layer('reference','参照对象',[origin()])];break;
 case 'P08':layers=[layer('reference','参照对象',[origin()]),layer('derived','派生层',[point('existing-record','既有记录',[114.04,22.54])])];break;
 case 'P09':case 'P10':layers=[layer('reference','参照对象',[{objectId:'return-line',name:'往返巡查线',kind:'line',geometry:{type:'LineString',coordinates:caseId==='P09'?[[114,22.5],[114,22.510],[114,22.505]]:[[151.21,-33.86],[151.21,-33.85],[151.21,-33.855]]}}])];break;
 case 'P11':layers=[layer('reference','参照对象',[area('observation','观察区')]),layer('resources','资源图层',[point('inside-a','内部甲',[114.005,22.505]),point('inside-b','内部乙',[114.01,22.51]),point('edge-a','边界甲',[114,22.51]),point('edge-b','边界乙',[114.02,22.52]),point('outside','外部甲',[114.03,22.51])])];break;
 case 'P12':layers=[layer('reference','参照对象',[point('old-a','旧点甲',O)])];break;
 default:throw new Error(`Unknown R15 case ${caseId}`);
 }
 return structuredClone(layers.map((item,order)=>({...item,order})));
}
export interface SourceScene {objects:SituationObject[];reports:InformationReport[];asOf:string}
/** Preserve task-linked roads and ordinary areas. Resources and port name are explicitly synthetic. */
export function sourceScene(base:SourceScene,instanceId:string,day:string,caseId:string):SourceScene{
 if(!['P01','P02','P03'].includes(caseId))return base;
 const areaId=`${instanceId}-zone-west`,ref=(id:string)=>({systemId:'situation',objectType:'resource',objectId:`${instanceId}-${id}`});
 const resource=(id:string,name:string,coordinates:Position):SituationObject=>({ref:ref(id),name,revision:1,areaIds:[areaId],effectiveAt:`${day}T09:00:00+08:00`,validTime:null,geometry:{type:'Point',coordinates},properties:{availableCount:1,unit:'辆'}});
 const resources=caseId==='P03'?[resource('vehicles-west-01','巡查车甲',[114.004,22.504]),resource('vehicles-west-02','巡查车乙',[114.012,22.512]),resource('vehicles-west-03','外围车丙',[114.03,22.51])]:[resource('vehicles-west-01','来源港车甲',[114.008,22.508]),resource('vehicles-west-02','来源外港乙',[114.03,22.51])];
 const objects=[...resources,...structuredClone(base.objects.filter(o=>o.ref.objectType!=='resource'))];
 const west=objects.find(o=>o.ref.objectId===areaId);if(!west)throw new Error('Synthetic source requires existing west area');
 west.geometry=structuredClone(Z);if(caseId!=='P03')west.name='港区';
 for(const item of objects)if(item.ref.objectType==='area')item.properties={memberRefs:objects.filter(o=>o.ref.objectType!=='area'&&o.areaIds.includes(item.ref.objectId)).map(o=>o.ref)};
 return {objects,reports:[],asOf:`${day}T09:00:00+08:00`};
}
