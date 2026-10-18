/** Evaluation-only variants. Oracle is never installed into the runtime workspace. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AnnotationAction, AnnotationReceipt} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import {mapTrialRequest,type MapTrialManifest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {mapState} from '../../../../experiments/harness-lab/scripts/probe-source-annotations.js';
import {prepareFixture as originalPrepare,prompts as originalPrompts,kinds as originalKinds,distance,type Kind,type Fixture} from '../round1-20261017/cases.js';
export type Group='baseline'|'map-only'|'spatial-only';
export type CaseId=Kind|'V02'|'V04'|'V09'|'V12';
export interface Entry {id:string;caseId:CaseId;kind:Kind;model:'deepseek-v4-pro';condition:'B';round:1;group:Group;selectedSkill:'map-annotations'|'spatial-analysis'}
export const groups:Group[]=['baseline','map-only','spatial-only'];
export const cases:CaseId[]=[...originalKinds,'V02','V04','V09','V12'];
export const schedule:Entry[]=cases.flatMap((caseId,i)=>groups.map((_,j)=>{const group=groups[(i+j)%3],kind=caseId.replace('V','J') as Kind;return {id:`${caseId}-${group}`,caseId,kind,model:'deepseek-v4-pro',condition:'B',round:1,group,selectedSkill:['J02','J03','J08','J09','J10'].includes(kind)?'map-annotations':'spatial-analysis'};}));
export function promptsFor(entry:Entry):string[]{
 if(entry.caseId==='V02')return ['请查看本会话地图“沿岸补给”图层按保存顺序的第51～52项名称和类型，并说明这个图层一共有多少项。只查看，不修改。'];
 if(entry.caseId==='V09')return ['仅针对本会话地图草稿：保障资源图层中离基点最近的点是哪一个？只分析，不修改。'];
 return originalPrompts[entry.kind];
}
export async function prepareFixture(m:MapTrialManifest,entry:Entry):Promise<Fixture>{
 const fixture=await originalPrepare(m,entry.kind);
 if(!entry.caseId.startsWith('V')){if(entry.kind==='J09')fixture.truth.behavior='clarify-or-complete-separate-conditional-answers-no-union';return fixture;}
 const layers=structuredClone(fixture.before.version!.document.layers);
 if(entry.caseId==='V02'){
  const layer=layers.find(l=>l.layerId==='lyr-k72')!;layer.name='沿岸补给';
  for(const [i,f] of layer.features.entries())f.name=i===50?'桦林补给站':i===51?'石湾补给站':`沿岸补给${String(i+1).padStart(2,'0')}`;
  fixture.truth={...fixture.truth,names:['桦林补给站','石湾补给站'],types:['point','point'],layerTotal:58,documentTotal:64};
 }
 if(entry.caseId==='V04'){
  const shift=(v:unknown):unknown=>Array.isArray(v)&&typeof v[0]==='number'?[Number(v[0])-30,Number(v[1])+55]:(v as unknown[]).map(shift);
  for(const layer of layers)for(const f of layer.features){f.geometry.coordinates=shift(f.geometry.coordinates) as typeof f.geometry.coordinates;if(layer.layerId==='resources')f.name=`迁移${f.name}`;}
  fixture.truth={...fixture.truth,inside:['r1','r2','r3','edge'],insideCount:4,layerTotal:5,translation:[-30,55]};
 }
 if(entry.caseId==='V09'){
  const other=layers.find(l=>l.layerId==='resources-other')!,primary=layers.find(l=>l.layerId==='resources')!;
  other.name=primary.name='保障资源';other.features[0].name='远岸备勤点';other.features[0].geometry={type:'Point',coordinates:[114,22.55]};
  const a=layers.indexOf(primary),b=layers.indexOf(other);[layers[a],layers[b]]=[layers[b],layers[a]];
  layers.forEach((l,i)=>l.order=i);
  fixture.truth={...fixture.truth,behavior:'clarify-or-complete-separate-conditional-answers-no-union',candidates:['resources-other','resources'],perLayerNearest:{resources:'r1','resources-other':'other-point'}};
 }
 if(entry.caseId==='V12'){
  for(const layer of layers)for(const f of layer.features)if(layer.layerId==='resources'){
   f.name=`海湾${f.name}`;
   if(f.attributes?.category==='boat')f.attributes.category='sensor';
   if(f.attributes?.category==='truck')f.attributes.category='supply';
  }
  fixture.truth={...fixture.truth,category:{sensor:3,supply:1},missingCategory:['r2'],missingCount:1};
 }
 const operations:Extract<AnnotationAction,{action:'apply'}>['operations']=[];
 if(entry.caseId==='V09'){
  // The service keeps insertion order separately from layer.order: rebuild only this synthetic draft.
  for(const layer of fixture.before.version!.document.layers)operations.push({op:'delete_layer',layerId:layer.layerId});
  for(const layer of layers)operations.push({op:'add_layer',layer});
 }else for(const layer of layers){operations.push({op:'update_layer',layerId:layer.layerId,changes:{name:layer.name,order:layer.order}});for(const f of layer.features)operations.push({op:'update_object',objectId:f.objectId,layerId:layer.layerId,changes:{name:f.name,geometry:f.geometry,...(f.attributes?{attributes:f.attributes}:{})}});}
 const receipt=await mapTrialRequest<AnnotationReceipt>(m,`/api/sessions/${fixture.sessionId}/annotation/actions`,'planning','POST',{action:'apply',clientActionId:randomUUID(),expectedRevision:fixture.before.binding.draft!.headRevision,operations});
 fixture.setupReceipts.push(receipt);fixture.before=await mapState(m,fixture.sessionId);
 const actual=fixture.before.version!.document.layers,fs=actual.flatMap(l=>l.features),origin=fs.find(f=>f.objectId==='origin');
 fixture.truth.distancesM=origin?Object.fromEntries(fs.filter(f=>f.geometry.type==='Point').map(f=>[f.objectId,distance(origin.geometry.coordinates as number[],f.geometry.coordinates as number[])])):{};
 fixture.truth.variant=entry.caseId;
 if(entry.caseId==='V09')assert.ok(actual.findIndex(l=>l.layerId==='resources-other')<actual.findIndex(l=>l.layerId==='resources'));
 return fixture;
}
