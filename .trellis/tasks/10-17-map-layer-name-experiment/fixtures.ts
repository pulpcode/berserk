import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AnnotationAction,AnnotationLayer,AnnotationReceipt,AnnotationSelection} from '../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest,type MapTrialManifest} from '../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {prepareFixture as originalFixture,prompts as originalPrompts,type Fixture} from '../10-17-map-query-native-evaluation/fixtures.js';

export const kinds=['F1','F2','F3','N1','N2','N3','N4'] as const;
export const schedule=Array.from({length:2},(_,i)=>kinds.map((kind,j)=>({id:`T${String(i*7+j+1).padStart(2,'0')}`,kind,repeat:i+1}))).flat();
export const prompts={...originalPrompts,
  N1:'请只展示本会话地图“河岸巡查”图层按保存顺序的第2～3项名称和类型。只查看，不修改。',
  N2:'请展示本会话地图“临时停靠”图层按保存顺序的第1项名称和类型。只查看，不修改。',
  N3:'请展示本会话地图“备用观察”图层的对象名称和类型。只查看，不修改。',
  N4:'请展示所引用固定版本中“潮汐观察”图层按保存顺序的第2项名称和类型。只查看，不修改。',
};
const layer=(layerId:string,name:string,order:number,names:string[]):AnnotationLayer=>({layerId,name,order,defaultVisible:true,features:names.map((name,i)=>({objectId:`${layerId}-${i+1}`,name,kind:'point',geometry:{type:'Point',coordinates:[103.8+order*.01+i*.001,1.3]},style:{},attributes:{}}))});
export function newLayers(kind:string):AnnotationLayer[] {
  if(kind==='N1')return [layer('lyr-j31','水位记录',0,['水尺甲']),layer('lyr-x84','河岸巡查',1,['青石岸','柳湾岸','芦苇岸','沙洲岸'])];
  if(kind==='N2')return [layer('lyr-u17','临时停靠',0,['北岸泊位']),layer('lyr-b63','临时停靠',1,['南岸泊位'])];
  if(kind==='N3')return [layer('lyr-e29','日常观察',0,['旧堤观察点']),layer('lyr-v81','备用器材',1,['器材存放点'])];
  if(kind==='N4')return [layer('lyr-h46','潮汐观察',0,['礁石观察点','灯塔观察点','栈桥观察点'])];
  throw new Error('Unknown fixture');
}
export async function prepareFixture(m:MapTrialManifest,kind:string):Promise<Fixture> {
  if(kind==='F1'||kind==='F2'||kind==='F3')return originalFixture(m,kind);
  assert.ok(kinds.includes(kind as typeof kinds[number]));
  const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
  const {id}=await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id});
  const setupReceipts:AnnotationReceipt[]=[];
  const action=async(input:AnnotationAction)=>{const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${id}/annotation/actions`,'planning','POST',input);setupReceipts.push(receipt);return receipt;};
  await action({action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'河岸观察记录',operations:newLayers(kind).map(layer=>({op:'add_layer',layer}))});
  let annotationRefs:AnnotationSelection[]|undefined;
  let history:unknown;
  if(kind==='N4') {
    const old=await mapState(m,id);assert.ok(old.version&&old.binding.draft);
    annotationRefs=[old.version.ref];history=old.version;
    await action({action:'apply',clientActionId:randomUUID(),expectedRevision:old.binding.draft.headRevision,operations:[{op:'update_layer',layerId:'lyr-h46',changes:{name:'夜间潮位'}},{op:'update_object',objectId:'lyr-h46-2',changes:{name:'新灯塔观测位'}}]});
  }
  return {kind:'F1',sessionId:id,before:await mapState(m,id),annotationRefs,setupReceipts,truth:{case:kind,history,
    expected:kind==='N1'?['柳湾岸','芦苇岸']:kind==='N2'?{ambiguous:['lyr-u17','lyr-b63']}:kind==='N3'?{missing:'备用观察'}:['灯塔观察点']}};
}
