/** Synthetic service-backed fixtures. Never pass evaluator truth to the provider. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {openDatabase} from '../../../experiments/harness-lab/src/access/database.ts';
import {WorkspaceStore} from '../../../experiments/harness-lab/src/workspaces/store.ts';
import {AnnotationService} from '../../../experiments/harness-lab/src/annotations/service.ts';
import {projectAnnotationResult} from '../../../experiments/harness-lab/src/contracts/annotation-results.ts';

const point=(id,name,extra={})=>({objectId:id,name,kind:'point',geometry:{type:'Point',coordinates:[103.8,1.3]},...extra});
const layer=(id,features,order=0)=>({layerId:id,name:id,order,defaultVisible:true,features});
export const cases=[
 {id:'N1',prompt:'对照所选的阀门北、阀门南，说明各自保存的压力以及相差多少 MPa。只查看，不修改。',
  layers:[layer('valves',[point('north','阀门北',{attributes:{pressureMPa:0.72}}),point('south','阀门南',{attributes:{pressureMPa:0.48}}),point('east','阀门东',{attributes:{pressureMPa:0.61}})]),layer('reserve',[point('reserve-valve','备用阀门',{attributes:{pressureMPa:0.80}})],1)],
  selectors:{layerIds:['valves'],objectIds:['north','south'],fields:['attributes']},
  truth:{north:0.72,south:0.48,difference:0.24,selected:2,whole:4}},
 {id:'N2',prompt:'查看设施登记图层 offset=12、limit=3 这一页，告诉我本页有哪些对象，以及这一图层共匹配多少项。只查看，不修改。',
  layers:[layer('facilities',Array.from({length:8},(_,i)=>point(`facility-${i+1}`,`设施${i+1}`)))],
  selectors:{layerIds:['facilities'],offset:12,limit:3},truth:{returned:0,total:8,hasMore:false}},
 {id:'N3',prompt:'告诉我所选巡检点保存的样式和备注。只查看，不修改。',
  layers:[layer('inspection',[point('inspection-point','巡检点',{style:{color:'#336699',size:12},note:'西侧入口每周三检查'})])],
  selectors:{objectIds:['inspection-point'],fields:['style']},truth:{style:{color:'#336699',size:12},note:'西侧入口每周三检查',requiresRead:'note'}},
];
export async function prepareFixtures(output,template){
 const originalFetch=globalThis.fetch; globalThis.fetch=()=>{throw new Error('prepare_provider_forbidden');};
 try {
  const result={};
  for(const spec of cases){
   const dir=join(output,'fixtures',spec.id),db=await openDatabase(dir);
   try {
    const workspaces=await WorkspaceStore.open(dir,'synthetic-evaluator'),workspace=workspaces.get(),session=randomUUID();
    await workspaces.bind(session,workspace.id);
    const service=new AnnotationService(db,workspaces),actor=service.actorForSeat('synthetic-evaluator');
    const receipt=service.action(actor,session,{action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'范围证据测试',operations:spec.layers.map(layer=>({op:'add_layer',layer}))});
    const params={mode:'read',ref:receipt.ref,...spec.selectors};
    const actual=service.read(actor,workspace.taskSpaceId,{ref:receipt.ref,...spec.selectors});
    const query=Object.fromEntries(['objectIds','layerIds','fields'].filter(k=>params[k]!==undefined).map(k=>[k,params[k]]));
    const content=JSON.stringify({format:'annotation.model-result.v1',data:{...projectAnnotationResult(actual),query}});
    const payload={...structuredClone(template),messages:[structuredClone(template.messages[0]),{role:'user',content:spec.prompt},{role:'assistant',content:'',tool_calls:[{id:`driver-${spec.id}`,type:'function',function:{name:'annotation_read',arguments:JSON.stringify(params)}}]},{role:'tool',tool_call_id:`driver-${spec.id}`,content}]};
    assert.equal(actual.objects.total,spec.id==='N1'?2:spec.id==='N2'?8:1);
    assert.equal(actual.objects.items.length,spec.id==='N1'?2:spec.id==='N2'?0:1);
    if(spec.id==='N3')assert.ok(!content.includes(spec.truth.note)&&!('note' in actual.objects.items[0]));
    result[spec.id]={payload,evaluator:{identityMode:'isolated test identity; no production data',driverIssuedRead:true,actor,taskId:workspace.taskSpaceId,session,params,actual,receipt,document:service.version(actor,workspace.taskSpaceId,receipt.ref).document,truth:spec.truth}};
   } finally {db.close();}
  }
  return result;
 } finally {globalThis.fetch=originalFetch;}
}
