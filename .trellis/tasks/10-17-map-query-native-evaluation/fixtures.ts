import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AnnotationAction, AnnotationLayer, AnnotationReceipt, AnnotationSelection} from '../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest, type MapTrialManifest} from '../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {prepareCase} from '../../../experiments/harness-lab/scripts/probe-map-query-cases.js';
import {mapState} from '../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {seedLayers} from '../../../experiments/harness-lab/scripts/probe-desktop-map.js';

export type CaseId = 'F1'|'F2'|'F3';
export const prompts = {
  F1:'请只展示本会话地图“仓储设施”图层按保存顺序的第4～5项摘要，说明这一页有哪些对象。只查看，不修改。',
  F2:'比较引用对象与本会话对应对象的备注，只说明差异，不修改。',
  F3:'请只展示本会话地图“应急补给”图层按保存顺序的第51～52项名称和类型。只查看，不修改。',
  prep:'把本会话集合点乙备注改为“B 保障讨论”，保留其余内容。',
} as const;
export const schedule = Array.from({length:5}, (_,i)=>(['F1','F2','F3'] as const).map(kind=>({id:`T${String(i*3+(['F1','F2','F3'].indexOf(kind))+1).padStart(2,'0')}`,kind,repeat:i+1}))).flat();
export function largeLayers():AnnotationLayer[] {
  return [['lyr-p19','设备巡检',4],['lyr-k72','应急补给',58],['lyr-m43','观察记录',2]].map(([layerId,name,count],order)=>({
    layerId:String(layerId),name:String(name),order,defaultVisible:true,
    features:Array.from({length:Number(count)},(_,i)=>({objectId:`obj-${order}-${String(i+1).padStart(3,'0')}`,kind:'point' as const,
      name:order===1&&i===50?'松林补给点':order===1&&i===51?'湖湾补给点':`${name}${String(i+1).padStart(2,'0')}`,
      geometry:{type:'Point' as const,coordinates:[103.82+order*0.01+i*0.00001,1.30+i*0.00001] as [number,number]},style:{},attributes:{}})),
  }));
}
export type State = Awaited<ReturnType<typeof mapState>>;
export interface Fixture {kind:CaseId;sessionId:string;before:State;otherSessionId?:string;otherBefore?:State;annotationRefs?:AnnotationSelection[];setupReceipts:unknown[];truth:unknown}
export async function prepareFixture(m:MapTrialManifest,kind:CaseId):Promise<Fixture> {
  if(kind==='F1') {
    const prepared=await prepareCase(m,'G02-order');assert.equal(prepared.prompt,prompts.F1);
    return {kind,sessionId:prepared.sessionId,before:prepared.before,setupReceipts:prepared.evaluator.setupReceipts,truth:{names:['东仓','山脚仓'],layerTotal:5,documentTotal:7}};
  }
  const workspace=await mapTrialRequest<{id:string}>(m,`/api/tasks/${m.tasks.supply}/workspace`,'planning','POST',{});
  const session=async()=> (await mapTrialRequest<{id:string}>(m,'/api/sessions','planning','POST',{workspaceId:workspace.id})).id;
  const receipts:AnnotationReceipt[]=[];
  const action=async(id:string,input:AnnotationAction)=>{const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${id}/annotation/actions`,'planning','POST',input);receipts.push(receipt);return receipt;};
  const id=await session();
  if(kind==='F3') {
    await action(id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'补给核对记录',operations:largeLayers().map(layer=>({op:'add_layer',layer}))});
    return {kind,sessionId:id,before:await mapState(m,id),setupReceipts:receipts,truth:{names:['松林补给点','湖湾补给点'],types:['point','point'],layerTotal:58,documentTotal:64}};
  }
  await action(id,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'共同基线',operations:seedLayers().map(layer=>({op:'add_layer',layer}))});
  const baseline=await mapState(m,id);
  const published=await action(id,{action:'publish',clientActionId:randomUUID(),revision:baseline.binding.draft!.headRevision,title:'共同发布基线 P0'});
  assert.ok(published.publication);
  const baseRef={publicationId:published.publication.publicationId};
  const a=await session(),b=await session();
  for(const [sid,title] of [[a,'会话 A 草稿'],[b,'会话 B 草稿']]) {
    const binding=(await mapState(m,sid)).binding;
    await mapTrialRequest(m,`/api/sessions/${sid}/annotation/base`,'planning','PUT',{clientActionId:randomUUID(),expectedBindingRevision:binding.bindingRevision,baseRef});
    await action(sid,{action:'create_draft',clientActionId:randomUUID(),baseRef,title:'共同发布基线 P0'});
    const state=await mapState(m,sid);
    await action(sid,{action:'apply',clientActionId:randomUUID(),expectedRevision:state.binding.draft!.headRevision,operations:[{op:'rename_set',title}]});
  }
  const priorA=await mapState(m,a);
  await action(a,{action:'apply',clientActionId:randomUUID(),expectedRevision:priorA.binding.draft!.headRevision,operations:[{op:'update_object',objectId:'point-a',changes:{note:'A 现场讨论'}}]});
  const otherBefore=await mapState(m,a),before=await mapState(m,b);
  assert.notEqual(before.binding.draft!.setId,otherBefore.binding.draft!.setId);
  return {kind,sessionId:b,before,otherSessionId:a,otherBefore,annotationRefs:[{...otherBefore.version!.ref,objectIds:['point-a']}],setupReceipts:receipts,
    truth:{referenceNote:'A 现场讨论',ownedNote:'基线备注',aStillContainsB:true}};
}
export function preparationState(before:State,after:State):'correct'|'unchanged'|'unexpected' {
  if(JSON.stringify(before)===JSON.stringify(after))return 'unchanged';
  const expected=structuredClone(before.version!.document);
  const target=expected.layers.flatMap(layer=>layer.features).find(item=>item.objectId==='point-b')!;target.note='B 保障讨论';
  const same=JSON.stringify(expected)===JSON.stringify(after.version?.document)
    && JSON.stringify(before.publications)===JSON.stringify(after.publications)
    && JSON.stringify(before.current)===JSON.stringify(after.current)
    && before.binding.draft?.setId===after.binding.draft?.setId
    && before.binding.bindingRevision===after.binding.bindingRevision
    && JSON.stringify(before.binding.baseRef)===JSON.stringify(after.binding.baseRef);
  return same?'correct':'unexpected';
}
