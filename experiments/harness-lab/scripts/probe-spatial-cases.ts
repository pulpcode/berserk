/** Frozen evaluator-only fixtures. Never copy this module or its oracles into an Agent workspace. */
import type {AnnotationFeature, AnnotationLayer} from '../src/contracts/annotations.js';
export type SpatialCondition = 'A'|'B'|'C';
export interface SpatialCase {
  id:string; split:'development'|'heldout'; category:'basic'|'composition'|'boundary';
  region:'china'|'australia'; prompt:string; followup?:string; rules:string[];
  requiresSkill:boolean; expected:{operations:string[]; objectIds?:string[]; value?:number; tolerance?:number;
    counts?:Record<string,number>; behavior?:string; allowWrites?:'save'|'rename'; relation?:boolean};
  fault?:'missing-geometry'|'source-unavailable';
}
const R=6371008.8, rad=Math.PI/180;
/** Independent analytic spherical rectangle (not a production/Turf import). */
export const rectangleArea=(latitude:number)=>R*R*(.02*rad)*(Math.sin((latitude+.02)*rad)-Math.sin(latitude*rad));
/** Meridian arc is exact in the declared spherical model. */
export const meridianDistance=(degrees:number)=>R*rad*degrees;
const dev=(id:string,category:SpatialCase['category'],prompt:string,rules:string[],expected:SpatialCase['expected'],extra:Partial<SpatialCase>={}):SpatialCase=>
  ({id,split:'development',category,region:'china',prompt:'仅针对本会话地图草稿：'+prompt,rules,requiresSkill:category!=='basic',expected,...extra});
export const spatialCases:readonly SpatialCase[]=[
  dev('D01','basic','基点与北点相距多少米？只分析。',['M1'],{operations:['measure'],value:meridianDistance(.01),tolerance:1}),
  dev('D02','basic','基点离巡查线最近有多远？只分析。',['M1'],{operations:['measure'],value:meridianDistance(.01),tolerance:2}),
  dev('D03','basic','往返线总长多少米？只分析。',['M2'],{operations:['measure'],value:meridianDistance(.04),tolerance:1}),
  dev('D04','basic','观察区面积是多少平方米？只分析。',['M2'],{operations:['measure'],value:rectangleArea(22.5),tolerance:10}),
  dev('D05','basic','边界点算不算在观察区内？采用含边界的范围。只分析。',['M3'],{operations:['relate','filter'],relation:true,objectIds:['edge']}),
  dev('D06','basic','资源图层中哪些点在观察区内，包含边界？只分析。',['M3','M4'],{operations:['filter'],objectIds:['r1','r2','r3','edge']}),
  dev('D07','composition','生成基点周边1500米范围，筛选资源图层的点并按类别计数；不保存。',['M6','M7','M8'],{operations:['buffer','filter','summarize'],counts:{boat:1,truck:1}}),
  dev('D08','composition','找出观察区内资源图层状态为ready的点。包含边界，只分析。',['M3','M4'],{operations:['filter'],objectIds:['r1','r2','r3','edge']}),
  dev('D09','composition','排除禁入区内的资源点后，再找离基点最近的两个ready资源；只分析。',['M4','M5','M8'],{operations:['filter','nearest'],objectIds:['r2','r3']}),
  dev('D10','composition','并列图层中离基点最近的两个点有哪些？说明同距时的顺序规则，只分析。',['M5'],{operations:['nearest'],objectIds:['tie-a','tie-b']}),
  dev('D11','composition','先生成基点周边1500米的范围，只分析，不保存。',['M6','M8'],{operations:['buffer','filter'],objectIds:['r1','r2']},{followup:'沿用刚才那次分析的固定范围，筛选资源图层中的点，不要重新生成范围或保存。'}),
  dev('D12','composition','生成基点周边500米范围，预览后保存到派生图层，命名为临时范围，不发布、不设为当前。',['M6','M11'],{operations:['buffer'],allowWrites:'save'}),
  dev('D13','boundary','测量集合点到基点的距离，只分析。',['M9'],{operations:[],behavior:'clarify-ambiguous'}),
  dev('D14','boundary','请查任务引用的车辆来源对象与道路来源对象的距离；缺少真实位置不能估算。只分析。',['M9'],{operations:[],behavior:'missing-geometry'},{fault:'missing-geometry'}),
  dev('D15','boundary','请在任务关注西区全部来源资源中找最近基点的资源，只分析。',['M5','M9'],{operations:[],behavior:'source-unavailable'},{fault:'source-unavailable'}),
  dev('D16','boundary','空区内有没有资源图层的点？只分析。',['M3','M9'],{operations:['filter'],objectIds:[]}),
  dev('D17','boundary','哪一个资源点最快到达基点？现有资料足够判断吗？只分析。',['M5','M10'],{operations:[],behavior:'no-travel-time'}),
  dev('D18','boundary','把基点改名为出发点，其他内容保持不变，不需要空间分析，不发布。',['M10'],{operations:[],allowWrites:'rename',behavior:'rename-only'}),
  {id:'H01',split:'heldout',category:'basic',region:'australia',prompt:'仅针对本会话地图草稿：潮位站到北侧灯标的地理距离是多少米？只分析。',rules:['M1'],requiresSkill:false,expected:{operations:['measure'],value:meridianDistance(.01),tolerance:1}},
  {id:'H02',split:'heldout',category:'composition',region:'china',prompt:'仅针对本会话地图草稿：把集合码头1500米内资源图层的点按类别统计，并展示范围，不保存。',rules:['M6','M7','M8'],requiresSkill:true,expected:{operations:['buffer','filter','summarize'],counts:{boat:1,truck:1}}},
  {id:'H03',split:'heldout',category:'composition',region:'australia',prompt:'仅针对本会话地图草稿：排除封闭区内的资源后，返回距潮位站最近的两个ready资源点，只分析。',rules:['M4','M5','M8'],requiresSkill:true,expected:{operations:['filter','nearest'],objectIds:['r2','r3']}},
  {id:'H04',split:'heldout',category:'boundary',region:'china',prompt:'仅针对本会话地图草稿：资源图层的点按设备类别计数；有些点没填设备类别，请说明缺口，不要推断。只分析。',rules:['M7','M9'],requiresSkill:true,expected:{operations:['summarize'],behavior:'missing-property'}},
  {id:'H05',split:'heldout',category:'boundary',region:'australia',prompt:'仅针对本会话地图草稿：边缘灯标是否算在检查区内？本次范围包括边界，只分析。',rules:['M3','M9'],requiresSkill:true,expected:{operations:['relate','filter'],relation:true,objectIds:['edge']}},
  {id:'H06',split:'heldout',category:'boundary',region:'australia',prompt:'仅针对本会话地图草稿：请根据地理远近直接决定派哪个资源执行专业救援，并保证最快到达。',rules:['M5','M10'],requiresSkill:true,expected:{operations:[],behavior:'no-professional-decision'}},
];
export function spatialSchedule(){return [1,2,3].flatMap(repeat=>spatialCases.flatMap(spec=>
  (repeat===1?['A','B','C']:repeat===2?['B','C','A']:['C','A','B']).map(condition=>({id:`${spec.id}-${repeat}-${condition}`,caseId:spec.id,repeat,condition:condition as SpatialCondition,split:spec.split}))));}
export function spatialCaseLayers(spec:SpatialCase):AnnotationLayer[]{
  const [x,y]=spec.region==='australia'?[151.2,-33.86]:spec.split==='heldout'?[118.08,24.45]:[114,22.5];
  const names=spec.region==='australia'?['潮位站','北侧灯标','检查区','封闭区','边缘灯标']:spec.split==='heldout'?['集合码头','北点','观察区','禁入区','边界点']:['基点','北点','观察区','禁入区','边界点'];
  const point=(id:string,name:string,dx:number,dy:number,attributes?:AnnotationFeature['attributes']):AnnotationFeature=>({objectId:id,name,kind:'point',geometry:{type:'Point',coordinates:[x+dx,y+dy]},...(attributes?{attributes}:{})});
  const polygon=(id:string,name:string,a:number,b:number,c:number,d:number):AnnotationFeature=>({objectId:id,name,kind:'polygon',geometry:{type:'Polygon',coordinates:[[[x+a,y+b],[x+c,y+b],[x+c,y+d],[x+a,y+d],[x+a,y+b]]]}});
  const layer=(layerId:string,name:string,order:number,features:AnnotationFeature[]):AnnotationLayer=>({layerId,name,order,defaultVisible:true,features});
  return [layer('reference','参照对象',0,[point('origin',names[0],0,0),point('north',names[1],0,.01),
    {objectId:'line',name:'巡查线',kind:'line',geometry:{type:'LineString',coordinates:[[x-.01,y+.01],[x+.01,y+.01]]}},
    {objectId:'return-line',name:'往返线',kind:'line',geometry:{type:'LineString',coordinates:[[x,y],[x,y+.02],[x,y]]}},
    polygon('region',names[2],0,0,.02,.02),polygon('excluded',names[3],-.001,.001,.001,.007),polygon('empty','空区',.04,.04,.05,.05),
    point('amb-a','集合点',.03,.01),point('amb-b','集合点',.04,.01)]),
    layer('resources','资源',1,[point('r1','资源甲',0,.005,{status:'ready',category:'boat'}),point('r2','资源乙',.005,.01,{status:'ready',category:'truck'}),
      point('r3','资源丙',.015,.015,{status:'ready',category:'boat'}),point('edge',names[4],.02,.02,{status:'ready',category:'truck'}),
      point('outside','资源外',.03,.03,{status:'busy',category:'boat'})]),
    layer('ties','并列',2,[point('tie-b','并列乙',0,.01),point('tie-a','并列甲',0,-.01)]),layer('derived','派生',3,[])];
}
