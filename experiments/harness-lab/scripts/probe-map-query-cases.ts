/** Frozen test inputs and service preparation, never model guidance or semantic auto-scoring. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AnnotationAction, AnnotationFeature, AnnotationLayer, AnnotationOperation, AnnotationReadInput, AnnotationReceipt, AnnotationRef, AnnotationVersion} from '../src/contracts/annotations.js';
import {projectionLayers, readonlyCases} from './probe-map-result-projection.js';
import {mapState} from './probe-source-annotations.js';
import {mapTrialRequest, type MapTrialManifest} from './probe-situation-map.js';

export const queryCases = [
  ...readonlyCases.map(spec => ({...spec, kind:'business' as const, paired:false})),
  {id:'G02-order', kind:'business', paired:true, prompt:readonlyCases[1].prompt},
  {id:'H01', kind:'business', paired:true, prompt:'东片区还有哪些设施没有完成巡检？按桥梁、泵站分别列出名称和数量，再给总数；只查看。'},
  {id:'H02', kind:'business', paired:true, prompt:'对照“晨检记录”和“交接记录”，说明巡检路线的备注、集合点的位置分别有什么变化，并告诉我两版各有多少个标注对象。只查看。'},
  {id:'H03', kind:'business', paired:false, prompt:'请汇总三个补给点的已保存备注；没有备注的写“未填写”，再根据已有信息列出交接时需要核实的事项。只查看。'},
  {id:'Q01', kind:'diagnostic', paired:true, prompt:'请说明这份结果涉及哪些对象、数量属于什么范围，以及能否据此判断其他图层有无对象。'},
  {id:'Q02', kind:'diagnostic', paired:true, prompt:'请说明本页返回了什么，以及本次已经读取和仍未读取的范围。'},
  {id:'Q03', kind:'diagnostic', paired:false, prompt:'请说明本次返回的名称、类型和样式，以及能否据此判断备注和几何是否为空。'},
] as const;
export type QueryCaseId = typeof queryCases[number]['id'];
export type DiagnosticReadParams = Omit<AnnotationReadInput, 'ref'> & {mode:'draft'};

export function diagnosticParams(id:QueryCaseId):DiagnosticReadParams | undefined {
  switch(id) {
    case 'Q01': return {mode:'draft', layerIds:['repair'], offset:0, limit:50};
    case 'Q02': return {mode:'draft', layerIds:['storage'], offset:3, limit:2};
    case 'Q03': return {mode:'draft', objectIds:['storage-1'], fields:['style']};
    default: return undefined;
  }
}

const point = (objectId:string, name:string, index:number, extra:Partial<AnnotationFeature> = {}):AnnotationFeature => ({
  objectId, name, kind:'point', geometry:{type:'Point', coordinates:[103.8 + index * .001, 1.3]}, ...extra,
});
const layer = (layerId:string, name:string, order:number, features:AnnotationFeature[]):AnnotationLayer => ({layerId, name, order, defaultVisible:true, features});

/** A fresh copy each time; the order variant moves layers without regenerating coordinates. */
export function queryCaseLayers(id:QueryCaseId):AnnotationLayer[] {
  switch(id) {
    case 'G01': case 'G02': case 'G03': case 'Q01': case 'Q02': case 'Q03': return projectionLayers();
    case 'G02-order': return projectionLayers().reverse().map((item, order) => ({...item, order}));
    case 'H01': {
      const facilities = (prefix:string, rows:Array<[string,string,string]>, start:number) => rows.map(([name,area,inspectionStatus], i) =>
        point(`${prefix}-${i + 1}`, name, start + i, {attributes:{area,inspectionStatus}}));
      return [
        layer('bridges','桥梁',0,facilities('bridge',[
          ['河口桥','东片区','未检'],['环城桥','东片区','已完成'],['西湾桥','西片区','未检'],
        ],0)),
        layer('pumps','泵站',1,facilities('pump',[
          ['一号泵站','东片区','进行中'],['二号泵站','东片区','未检'],['三号泵站','东片区','已完成'],['西侧泵站','西片区','未检'],
        ],3)),
      ];
    }
    case 'H02': return [layer('inspection','巡检记录',0,[
      {objectId:'route',name:'巡检路线',kind:'line',geometry:{type:'LineString',coordinates:[[103.79,1.29],[103.81,1.31]]},note:'可通行'},
      point('assembly','集合点',0,{geometry:{type:'Point',coordinates:[103.80,1.30]}}),
      point('observation','观测点',4,{note:'定时观察'}),
    ])];
    case 'H03': return [
      layer('supply','补给点',0,[
        point('supply-1','补给点一',0,{note:'已清点，运输时间待确认'}),
        point('supply-2','补给点二',1,{note:''}),
        point('supply-3','补给点三',2,{note:'入口需与现场协调'}),
      ]),
      layer('patrol','巡查岗',1,[point('patrol-1','巡查岗',3,{note:'记录值守情况'})]),
    ];
  }
}

export interface QueryCaseHistory {
  morning:AnnotationVersion;
  intermediate:AnnotationVersion;
  handover:AnnotationVersion;
  latest:AnnotationVersion;
}
export interface PreparedQueryCase {
  id:QueryCaseId;
  kind:'business'|'diagnostic';
  paired:boolean;
  prompt:string;
  sessionId:string;
  before:Awaited<ReturnType<typeof mapState>>;
  /** Preparation and complete evidence stay outside the model's conversation. */
  evaluator:{setupReceipts:AnnotationReceipt[]; diagnosticParams?:DiagnosticReadParams; history?:QueryCaseHistory};
}

/** Caller supplies a fresh isolated trial per case/condition/repeat; this never calls a model. */
export async function prepareCase(manifest:MapTrialManifest, id:QueryCaseId):Promise<PreparedQueryCase> {
  const spec = queryCases.find(item => item.id === id);
  assert.ok(spec, `Unknown query case: ${id}`);
  const workspace = await mapTrialRequest<{id:string}>(manifest,`/api/tasks/${manifest.tasks.supply}/workspace`,'planning','POST',{});
  const session = await mapTrialRequest<{id:string}>(manifest,'/api/sessions','planning','POST',{workspaceId:workspace.id});
  const setupReceipts:AnnotationReceipt[] = [];
  const action = async(input:AnnotationAction) => {
    const receipt = await mapTrialRequest<AnnotationReceipt>(manifest,`/api/sessions/${session.id}/annotation/actions`,'planning','POST',input);
    setupReceipts.push(receipt);
    return receipt;
  };
  const readVersion = async(ref:AnnotationRef) => mapTrialRequest<AnnotationVersion>(manifest,
    'publicationId' in ref ? `/api/annotation-publications/${ref.publicationId}` : `/api/annotations/${ref.setId}/revisions/${ref.revision}`,'planning');
  const operations:AnnotationOperation[] = queryCaseLayers(id).map(item => ({op:'add_layer',layer:item}));
  let history:QueryCaseHistory | undefined;
  if(id === 'H02') {
    // Obtain every ref/revision from the service; do not synthesize expected successes.
    const created = await action({action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'巡检核对记录'});
    assert.ok(created.ref && 'revision' in created.ref);
    let draftRef = created.ref;
    const apply = async(changes:AnnotationOperation[]) => {
      const receipt = await action({action:'apply',clientActionId:randomUUID(),expectedRevision:draftRef.revision,operations:changes});
      assert.ok(receipt.ref && 'revision' in receipt.ref);
      draftRef = receipt.ref;
      return readVersion(draftRef);
    };
    const publish = async(title:string) => {
      const receipt = await action({action:'publish',clientActionId:randomUUID(),revision:draftRef.revision,title});
      assert.ok(receipt.publication);
      return readVersion({publicationId:receipt.publication.publicationId});
    };
    await apply(operations);
    const morning = await publish('晨检记录');
    const intermediate = await apply([{op:'update_object',objectId:'route',changes:{note:'临时封闭'}}]);
    await apply([
      {op:'update_object',objectId:'route',changes:{note:'限速通行'}},
      {op:'update_object',objectId:'assembly',changes:{geometry:{type:'Point',coordinates:[103.81,1.31]}}},
    ]);
    const handover = await publish('交接记录');
    const latest = await apply([
      {op:'update_object',objectId:'route',changes:{note:'待复查'}},
      {op:'update_object',objectId:'assembly',changes:{geometry:{type:'Point',coordinates:[103.82,1.32]}}},
    ]);
    assert.ok('publicationId' in morning.ref);
    const current = (await mapState(manifest,session.id)).current;
    setupReceipts.push(await mapTrialRequest<AnnotationReceipt>(manifest,`/api/tasks/${manifest.tasks.supply}/annotations/current`,'overall','POST',{
      clientActionId:randomUUID(),publicationId:morning.ref.publicationId,expectedCurrentSequence:current.sequence,
    }));
    history = {morning,intermediate,handover,latest};
  } else {
    await action({action:'create_draft',clientActionId:randomUUID(),baseRef:null,title:'设施核对记录',operations});
  }
  const params = diagnosticParams(id);
  return {...spec,sessionId:session.id,before:await mapState(manifest,session.id),
    evaluator:{setupReceipts,...(params ? {diagnosticParams:params} : {}),...(history ? {history} : {})}};
}
