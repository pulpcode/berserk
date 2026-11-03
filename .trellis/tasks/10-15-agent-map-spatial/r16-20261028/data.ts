/** Synthetic inputs only; expected answers stay in cases.ts, never in product context. */
import type {AnnotationFeature,AnnotationLayer} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {Position,SituationGeometry} from '../../../../experiments/harness-lab/src/contracts/context.js';
import {newLayers as priorLayers,sourceScene as priorSource,type SourceScene,O,Z,exercisePoint} from '../r15-20261027/data.js';
export {O,Z,exercisePoint};
const point=(objectId:string,name:string,coordinates:Position):AnnotationFeature=>({objectId,name,kind:'point',geometry:{type:'Point',coordinates}});
const layer=(layerId:string,name:string,features:AnnotationFeature[]):AnnotationLayer=>({layerId,name,order:0,defaultVisible:true,features});
const rectangle=(x:number,y:number,w:number,h:number):SituationGeometry=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
const area=(objectId:string,name:string,geometry:SituationGeometry=structuredClone(Z)):AnnotationFeature=>({objectId,name,kind:'polygon',geometry});
const origin=()=>point('origin','基点',O);
export const pageNames=['芦湾','橙塔','泊石','榆桥','白岬','松埠','青汀'];
export const pageIds=['pt-k7','pt-m2','pt-r9','pt-c4','pt-h8','pt-b3','pt-v6'];
export const movedOrigin:Position=[114.01,22.5];
export function newLayers(caseId:string):AnnotationLayer[]{
 if(/^Q(?:0[1-9]|1[0-2])$/.test(caseId))return priorLayers(caseId.replace('Q','P'));
 if(caseId==='Q14')return priorLayers('P01');
 let layers:AnnotationLayer[];
 switch(caseId){
 case 'Q13':layers=[layer('north','北部图层',[area('north-zone','作业区',rectangle(114,22.5,.01,.01))]),layer('south','南部图层',[area('south-zone','作业区',rectangle(114,22.48,.01,.01))]),layer('resources','资源图层',[point('north-a','北岸甲',[114.003,22.503]),point('north-b','北岸乙',[114.007,22.507]),point('south-a','南岸甲',[114.005,22.485])])];break;
 case 'Q15':layers=[layer('reference','参照对象',[area('rsc-k7','临时观察区')]),layer('noise','其他图层',[area('noise-zone','其他区域',rectangle(115,23,.01,.01))])];break;
 case 'Q16':layers=[layer('reference','参照对象',[area('area-a','巡查区'),area('aux-42','泊位区')]),layer('archive','历史图层',[area('arch-b','aux-42')])];break;
 case 'Q17':layers=[layer('reference','参照对象',pageNames.map((n,i)=>point(pageIds[i],n,[114,Number((22.501+i*.001).toFixed(3))])))];break;
 case 'Q18':layers=[layer('reference','参照对象',[origin()]),layer('resources','资源图层',['甲','乙','丙','丁','戊'].map((n,i)=>point(`buoy-${i+1}`,`浮标${n}`,[114,[22.501,22.502,22.504,22.506,22.509][i]])))];break;
 case 'Q19':layers=[layer('reference','参照对象',[origin()]),layer('derived','派生层',[])];break;
 case 'Q20':layers=[layer('reference','参照对象',[origin(),point('center-b','站点乙',[114.05,22.5])]),layer('derived','派生层',[])];break;
 case 'Q21':layers=[layer('reference','参照对象',[{objectId:'turn-line',name:'转向巡查线',kind:'line',geometry:{type:'LineString',coordinates:[[151.20,-33.86],[151.21,-33.86],[151.21,-33.85]]}}])];break;
 case 'Q22':layers=[layer('reference','参照对象',[origin(),point('old-a','旧点甲',[114.02,22.5])])];break;
 case 'Q23':case 'Q24':layers=[];break;
 default:throw new Error(`Unknown R16 case ${caseId}`);
 }
 return structuredClone(layers.map((l,order)=>({...l,order})));
}
export function sourceScene(base:SourceScene,instanceId:string,day:string,caseId:string):SourceScene{
 return priorSource(base,instanceId,day,caseId==='Q14'?'P01':caseId.replace(/^Q/,'P'));
}
