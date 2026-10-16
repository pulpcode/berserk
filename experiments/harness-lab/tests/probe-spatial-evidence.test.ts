import {describe,it,expect} from 'vitest';
import {spatialCases,spatialCaseLayers,SPATIAL_FIXTURE_VERSION} from '../scripts/probe-spatial-cases.js';
import {scoreSpatialFacts,spatialProtocolEvidence,spatialCancellationReason,type SpatialObservation} from '../scripts/probe-spatial-evaluation.js';
import {spatialEvidenceGraph,pointBufferMatches} from '../scripts/probe-spatial-evidence.js';
import type {SpatialResult,SpatialItem,SpatialInput,SpatialRequest} from '../src/contracts/spatial.js';
const spec=(id:string)=>spatialCases.find(item=>item.id===id)!;
const ref={setId:'set',revision:1};
const select=(ids:string[]):SpatialInput=>({kind:'annotation',ref,objectIds:ids});
function fixture(id='D01'){
  const document={schemaVersion:1 as const,title:'fixed',layers:spatialCaseLayers(spec(id))};
  const before={version:{ref,hash:'before',title:'fixed',createdAt:'2026-10-16T00:00:00Z',document},publications:[],current:{}} as unknown as SpatialObservation['before'];
  return {results:[],messages:[],tools:[],before,after:structuredClone(before),protocolCompleted:true,skillLoaded:false,skillLoadedBeforeAnalysis:false} satisfies SpatialObservation;
}
function items(o:SpatialObservation,ids:string[]):SpatialItem[]{return o.before.version!.document.layers.flatMap(layer=>layer.features.filter(f=>ids.includes(f.objectId)).map(f=>({id:JSON.stringify(['annotation',ref,f.objectId]),name:f.name,geometry:f.geometry,properties:{...f.attributes,name:f.name,kind:f.kind,layerId:layer.layerId},annotation:{ref,objectId:f.objectId}})));}
function result(o:SpatialObservation,id:string,p:Exclude<SpatialRequest,{operation:'read'}>,input:SpatialItem[],target:SpatialItem[]=[],extra:Partial<SpatialResult>={}):SpatialResult{
  void o;
  return {schemaVersion:1,resultRef:`spatial:request:${id}`,requestId:'request',toolCallId:id,operation:p.operation,parameters:p,scope:[p.input,...('target'in p&&p.target?[p.target]:[]),...(p.operation==='filter'&&p.spatial?[p.spatial.target]:[])],createdAt:'2026-10-16T00:00:00Z',completeness:{status:'complete',candidateCount:input.length},items:input,...(target.length?{referenceItems:target}:{}),method:'test',limitations:[],provenance:[],...extra};
}
const flag=(o:SpatialObservation,name:string,id='D01')=>scoreSpatialFacts(spec(id),o).checks.find(check=>check.name===name)?.passed;
const region:NonNullable<SpatialResult['geometry']>={type:'Polygon' as const,coordinates:[[[114,22.5],[114.01,22.5],[114.01,22.51],[114,22.5]]]};
describe('v2 independent spatial scorer',()=>{
  it('binds correct numeric values to exact original objects and metric',()=>{
    const o:SpatialObservation=fixture(),p={operation:'measure' as const,metric:'distance' as const,input:select(['origin']),target:select(['north'])};
    const r=result(o,'distance',p,items(o,['origin']),items(o,['north']),{values:{value:1111.9508,unit:'m'}});o.results=[r];
    expect(scoreSpatialFacts(spec('D01'),o)).toMatchObject({deterministic:'passed',semanticReview:'pending_review',semanticSuccess:null});
    o.results=[{...r,parameters:{...p,input:select(['tie-a']),target:select(['origin'])},scope:[select(['tie-a']),select(['origin'])],items:items(o,['tie-a']),referenceItems:items(o,['origin'])}];
    expect(flag(o,'independent_numeric_oracle')).toBe(false); // Same distance, wrong objects.
    o.results=[{...r,values:{value:999,unit:'m'}}];expect(flag(o,'independent_numeric_oracle')).toBe(false);
  });
  it('compares full annotation identity independent of encoded ref key order but rejects fake IDs',()=>{
    const o:SpatialObservation=fixture(),reverseRef={revision:1,setId:'set'};
    const p={operation:'measure' as const,metric:'distance' as const,input:{kind:'annotation' as const,ref:reverseRef,objectIds:['origin']},target:select(['north'])};
    const origin=items(o,['origin'])[0];origin.id=JSON.stringify(['annotation',reverseRef,'origin']);origin.annotation!.ref=reverseRef;
    o.results=[result(o,'distance',p,[origin],items(o,['north']),{values:{value:1111.95,unit:'m'}})];
    expect(scoreSpatialFacts(spec('D01'),o).deterministic).toBe('passed');
    o.results[0].items[0].id=JSON.stringify(['annotation',reverseRef,'forged']);expect(flag(o,'fixed_identity_version_and_geometry')).toBe(false);
  });
  it('accepts reversed symmetric distance but rejects coordinate and source-identity substitution',()=>{
    const o:SpatialObservation=fixture(),r=result(o,'distance',{operation:'measure',metric:'distance',input:select(['north']),target:select(['origin'])},items(o,['north']),items(o,['origin']),{values:{value:1111.9508,unit:'m'}});o.results=[r];
    expect(flag(o,'independent_numeric_oracle')).toBe(true);
    o.results=[{...r,items:r.items.map(item=>({...item,geometry:{type:'Point',coordinates:[115,22.5]}}))}];expect(flag(o,'fixed_identity_version_and_geometry')).toBe(false);
    const fake:SpatialItem={id:'["system","point","north"]',name:'north',properties:{},geometry:items(o,['north'])[0].geometry,source:{ref:{systemId:'system',objectType:'point',objectId:'north'},revision:1,queriedAt:'2026-10-16T00:00:00Z'}};
    const sourced=result(o,'source',{operation:'buffer',input:{kind:'source',systemId:'system'},distanceM:1},[fake],[],{geometry:region});o.results=[sourced];
    expect(flag(o,'fixed_identity_version_and_geometry')).toBe(false);
    o.sourceSnapshot=[fake];expect(flag(o,'fixed_identity_version_and_geometry')).toBe(true);
    o.results=[{...sourced,items:[{...fake,source:{...fake.source!,ref:{...fake.source!.ref,objectType:'vehicle'}}}]}];expect(flag(o,'fixed_identity_version_and_geometry')).toBe(false);
  });
  it('authenticates generated geometry through intermediate items and rejects changed/self/future origins',()=>{
    const o:SpatialObservation=fixture('D11');
    const buffer=result(o,'buffer',{operation:'buffer',input:select(['origin']),distanceM:1500},items(o,['origin']),[],{geometry:region});
    const derived:SpatialItem={id:buffer.resultRef,name:'分析范围',geometry:region,properties:{}};
    const intermediary=result(o,'intermediate',{operation:'filter',input:{kind:'result',resultRef:buffer.resultRef,geometry:true}},[derived]);
    const candidates=items(o,['r1','r2','r3','edge','outside']);
    const final=result(o,'final',{operation:'filter',input:{kind:'annotation',ref,layerIds:['resources']},spatial:{target:{kind:'result',resultRef:intermediary.resultRef},relation:'contains'}},candidates,[derived],{items:items(o,['r1','r2'])});
    o.results=[buffer,intermediary,final];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(true);expect(flag(o,'reuses_fixed_result','D11')).toBe(true);
    o.results=[final,buffer,intermediary];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(false);
    o.results=[buffer,intermediary,{...final,referenceItems:[{...derived,geometry:{type:'Point',coordinates:[114,22.5]}}]}];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(false);
    o.results=[buffer,buffer,intermediary,final];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(false);
    o.results=[{...buffer,parameters:{operation:'buffer',input:{kind:'result',resultRef:buffer.resultRef,geometry:true},distanceM:1500},scope:[{kind:'result',resultRef:buffer.resultRef,geometry:true}]}];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(false);
  });
  it('rejects final point-distance substitution even if an earlier filter really used the buffer',()=>{
    const o:SpatialObservation=fixture('D11');
    const buffer=result(o,'buffer',{operation:'buffer',input:select(['origin']),distanceM:1500},items(o,['origin']),[],{geometry:region});
    const derived:SpatialItem={id:buffer.resultRef,name:'分析范围',geometry:region,properties:{}};
    const candidates=items(o,['r1','r2','r3','edge','outside']),input={kind:'annotation' as const,ref,layerIds:['resources']};
    const good=result(o,'good',{operation:'filter',input,spatial:{target:{kind:'result',resultRef:buffer.resultRef,geometry:true},relation:'contains'}},candidates,[derived],{items:items(o,['r1','r2'])});
    const substitute=result(o,'substitute',{operation:'filter',input,spatial:{target:{kind:'result',resultRef:buffer.resultRef,geometry:false},distanceM:1500}},candidates,items(o,['origin']),{items:items(o,['r1','r2'])});
    o.results=[buffer,good,substitute];expect(flag(o,'fixed_identity_version_and_geometry','D11')).toBe(true);expect(flag(o,'reuses_fixed_result','D11')).toBe(false);
  });
  it('verifies ranking candidates instead of accepting an unrelated earlier filter',()=>{
    const o:SpatialObservation=fixture('D09'),candidates=items(o,['r1','r2','r3','edge','outside']);
    const unrelated=result(o,'unrelated',{operation:'filter',input:select(['origin'])},items(o,['origin']));
    const ranked=result(o,'rank',{operation:'nearest',input:{kind:'annotation',ref,layerIds:['resources']},target:select(['origin']),count:2},candidates,items(o,['origin']),{items:items(o,['r2','r3'])});
    o.results=[unrelated,ranked];expect(flag(o,'ranking_candidate_scope','D09')).toBe(false);
    const direct=result(o,'direct',{operation:'nearest',input:select(['r2','r3','edge']),target:select(['origin']),count:3},items(o,['r2','r3','edge']),items(o,['origin']));
    o.results=[direct];expect(flag(o,'ranking_candidate_scope','D09')).toBe(true);expect(flag(o,'ranking_count_and_order','D09')).toBe(true);
    // Full sorting followed by taking top N is declared equivalent; prose must still be reviewed.
    expect(scoreSpatialFacts(spec('D09'),o).semanticSuccess).toBeNull();
  });
  it('accepts only a real complete-empty result with the requested candidate and target scopes',()=>{
    const o:SpatialObservation=fixture('D16');expect(flag(o,'exact_selected_objects','D16')).toBe(false);
    const candidates=items(o,['r1','r2','r3','edge','outside']);
    o.results=[result(o,'empty',{operation:'filter',input:{kind:'annotation',ref,layerIds:['resources']},spatial:{target:select(['empty']),relation:'contains'}},candidates,items(o,['empty']),{items:[]})];
    expect(scoreSpatialFacts(spec('D16'),o).deterministic).toBe('passed');
    o.results[0].completeness.candidateCount=0;expect(flag(o,'fixed_identity_version_and_geometry','D16')).toBe(false);
  });
  it('does not let correct structured results automatically approve an erroneous final answer',()=>{
    const o:SpatialObservation=fixture();o.results=[result(o,'distance',{operation:'measure',metric:'distance',input:select(['origin']),target:select(['north'])},items(o,['origin']),items(o,['north']),{values:{value:1111.9508,unit:'m'}})];
    o.messages=[{id:'answer',role:'assistant',text:'距离为 1111.95 米，因此保证一分钟最快到达。'}];
    const score=scoreSpatialFacts(spec('D01'),o);expect(score.deterministic).toBe('passed');expect(score.semanticSuccess).toBeNull();expect(score.automaticCoverage.answerClaims).toBe('not_automatically_scored');
  });
  it('accepts filtering by region then checking actual ready properties without forcing attribute syntax',()=>{
    const o:SpatialObservation=fixture('D08'),all=items(o,['r1','r2','r3','edge','outside']);
    o.results=[result(o,'filter',{operation:'filter',input:{kind:'annotation',ref,layerIds:['resources']},spatial:{target:select(['region']),relation:'contains'}},all,items(o,['region']),{items:items(o,['r1','r2','r3','edge'])})];
    expect(scoreSpatialFacts(spec('D08'),o).deterministic).toBe('passed');
  });
  it('accepts complete per-object relations for region filtering and manual category counts',()=>{
    const o:SpatialObservation=fixture('D06');
    o.results=['r1','r2','r3','edge','outside'].map(id=>result(o,id,{operation:'relate',relation:'contains',input:select(['region']),target:select([id])},items(o,['region']),items(o,[id]),{values:{relation:'contains',matches:id!=='outside'}}));
    expect(flag(o,'exact_selected_objects','D06')).toBe(true);
    o.results.pop();expect(flag(o,'exact_selected_objects','D06')).toBe(false);
    const buffer=result(o,'buffer',{operation:'buffer',input:select(['origin']),distanceM:1500},items(o,['origin']),[],{geometry:region});
    const derived:SpatialItem={id:buffer.resultRef,name:'分析范围',geometry:region,properties:{}};
    o.results=[buffer,...['r1','r2','r3','edge','outside'].map(id=>result(o,id,{operation:'relate',relation:'contains',input:{kind:'result',resultRef:buffer.resultRef,geometry:true},target:select([id])},[derived],items(o,[id]),{values:{relation:'contains',matches:['r1','r2'].includes(id)}}))];
    expect(flag(o,'exact_category_counts','D07')).toBe(true);expect(flag(o,'summary_dependency','D07')).toBe(true);
    o.results.push(result(o,'summary',{operation:'summarize',input:select(['r1','r2']),field:'category'},items(o,['r1','r2']),[],{values:{total:2,groups:[{value:'boat',count:1},{value:'truck',count:1}]}}));expect(flag(o,'summary_dependency','D07')).toBe(true);
    o.results[2].values={relation:'contains',matches:false};expect(flag(o,'summary_dependency','D07')).toBe(false);
  });
  it('rejects unrelated pass-through filters before a numerically correct summary',()=>{
    const o:SpatialObservation=fixture('D07'),selected=items(o,['r1','r2']);
    const unrelated=result(o,'unrelated',{operation:'filter',input:select(['r1','r2'])},selected);
    const summary=result(o,'summary',{operation:'summarize',input:{kind:'result',resultRef:unrelated.resultRef},field:'category'},selected,[],{values:{total:2,groups:[{value:'boat',count:1},{value:'truck',count:1}]}});
    o.results=[unrelated,summary];expect(flag(o,'exact_category_counts','D07')).toBe(true);expect(flag(o,'summary_dependency','D07')).toBe(false);
  });
  it('accepts summary dependency on either of two equivalent correct selections',()=>{
    const o:SpatialObservation=fixture('D07'),all=items(o,['r1','r2','r3','edge','outside']),selected=items(o,['r1','r2']);
    const p={operation:'filter' as const,input:{kind:'annotation' as const,ref,layerIds:['resources']},spatial:{target:select(['origin']),distanceM:1500}};
    const first=result(o,'first',p,all,items(o,['origin']),{items:selected}),second=result(o,'second',p,all,items(o,['origin']),{items:selected});
    const summary=result(o,'summary',{operation:'summarize',input:{kind:'result',resultRef:second.resultRef},field:'category'},selected,[],{values:{total:2,groups:[{value:'boat',count:1},{value:'truck',count:1}]}});
    o.results=[first,second,summary];expect(flag(o,'summary_dependency','D07')).toBe(true);
  });
  it('links result parameters to the actual successful original tool call',()=>{
    const o:SpatialObservation=fixture();const p={operation:'measure' as const,metric:'distance' as const,input:select(['origin']),target:select(['north'])};
    const measured=result(o,'call',p,items(o,['origin']),items(o,['north']),{values:{value:1111.95,unit:'m'}});o.results=[measured];o.toolCallsAuthoritative=true;
    o.tools=[{toolCallId:'call',name:'spatial_analyze',args:p}];o.messages=[{id:'message',role:'tool',toolName:'spatial_analyze',requestId:'request',toolCallId:'call',text:'',spatialResult:measured}];
    expect(flag(o,'fixed_identity_version_and_geometry')).toBe(true);
    o.tools[0].args={...p,input:select(['tie-a'])};expect(flag(o,'fixed_identity_version_and_geometry')).toBe(false);
  });
  it('compares semantic outcomes across reversed distance and relate/filter equivalent methods',()=>{
    const o:SpatialObservation=fixture();const distance=result(o,'distance',{operation:'measure',metric:'distance',input:select(['origin']),target:select(['north'])},items(o,['origin']),items(o,['north']),{values:{value:1111.95,unit:'m'}});
    const reverse=result(o,'reverse',{operation:'measure',metric:'distance',input:select(['north']),target:select(['origin'])},items(o,['north']),items(o,['origin']),{values:{value:1111.95,unit:'m'}});
    o.results=[distance,reverse];expect(scoreSpatialFacts(spec('D01'),o).deterministic).toBe('passed');
    const relate=result(o,'relate',{operation:'relate',relation:'contains',input:select(['region']),target:select(['edge'])},items(o,['region']),items(o,['edge']),{values:{relation:'contains',matches:true}});
    const filter=result(o,'filter',{operation:'filter',input:select(['edge']),spatial:{target:select(['region']),relation:'contains'}},items(o,['edge']),items(o,['region']));
    o.results=[relate,filter];expect(scoreSpatialFacts(spec('D05'),o).deterministic).toBe('passed');
  });
  it('checks exact save arguments and preserves every original layer',()=>{
    const o:SpatialObservation=fixture('D12');const buffer=result(o,'buffer',{operation:'buffer',input:select(['origin']),distanceM:500},items(o,['origin']),[],{geometry:region});o.results=[buffer];
    o.after.version!.document.layers.find(layer=>layer.layerId==='derived')!.features=[{objectId:'saved',name:'临时范围',kind:'polygon',geometry:region as {type:'Polygon';coordinates:[number,number][][]}}];
    o.tools=[{name:'annotation_from_analysis',args:{resultRef:buffer.resultRef,layerId:'derived',objectId:'saved',name:'临时范围'}}];
    expect(flag(o,'trusted_save_tool','D12')).toBe(true);expect(flag(o,'save_preserves_original_document','D12')).toBe(true);
    o.tools[0].args.resultRef=`prefix-${buffer.resultRef}`;expect(flag(o,'trusted_save_tool','D12')).toBe(false);
    o.after.version!.document.layers[0].features[0].name='unrequested';expect(flag(o,'save_preserves_original_document','D12')).toBe(false);
  });
  it('independently rejects incorrect generated point buffer geometry',()=>{
    const o:SpatialObservation=fixture(),origin=items(o,['origin'])[0],radius=1500,rad=Math.PI/180,[lon,lat]=(origin.geometry as {coordinates:[number,number]}).coordinates;
    const ring:Array<[number,number]>=Array.from({length:128},(_,i)=>{const angle=i*2*Math.PI/128,d=radius/6371008.8,phi=Math.asin(Math.sin(lat*rad)*Math.cos(d)+Math.cos(lat*rad)*Math.sin(d)*Math.cos(angle));return [lon+Math.atan2(Math.sin(angle)*Math.sin(d)*Math.cos(lat*rad),Math.cos(d)-Math.sin(lat*rad)*Math.sin(phi))/rad,phi/rad];});ring.push(ring[0]);
    const buffer=result(o,'buffer',{operation:'buffer',input:select(['origin']),distanceM:radius},[origin],[],{geometry:{type:'Polygon',coordinates:[ring]}});
    expect(pointBufferMatches(buffer,origin)).toBe(true);expect(pointBufferMatches({...buffer,geometry:region},origin)).toBe(false);
    const changed=structuredClone(buffer);if(changed.geometry?.type==='Polygon')changed.geometry.coordinates[0][5][0]+=.001;
    expect(pointBufferMatches(changed,origin)).toBe(false);
  });
  it('keeps allowed boundary waits distinct from completion, ordinary refusals and budget failures',()=>{
    expect(spatialProtocolEvidence(spec('D01'),'succeeded',false,'')).toEqual({acceptable:true,completed:true,boundaryWaitingReview:false});
    for(const id of ['D13','D17','H06'])expect(spatialProtocolEvidence(spec(id),'cancelled',true,'unanswered_interaction')).toEqual({acceptable:true,completed:false,boundaryWaitingReview:true});
    expect(spatialProtocolEvidence(spec('D01'),'cancelled',true,'unanswered_interaction').acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('D17'),'cancelled',true,'wall_budget').acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('H06'),'failed',false,'').acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('H06'),'failed',true,'unanswered_interaction').acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('H06'),'succeeded',true,'unanswered_interaction').acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('D17'),'cancelled',true,'unanswered_interaction',true).acceptable).toBe(false);
    expect(spatialProtocolEvidence(spec('D01'),'succeeded',false,'',true).acceptable).toBe(false);
  });
  it('prioritizes simultaneous budget exhaustion over a pending boundary interaction',()=>{
    expect(spatialCancellationReason(599_999,64,true)).toBe('unanswered_interaction');
    expect(spatialCancellationReason(600_000,64,true)).toBe('wall_budget');
    expect(spatialCancellationReason(600_001,65,true)).toBe('wall_budget');
    expect(spatialCancellationReason(599_999,65,true)).toBe('tool_call_budget');
    expect(spatialCancellationReason(599_999,64,false)).toBeUndefined();
    for(const id of ['D13','D17','H06'])for(const [elapsed,calls] of [[600_000,64],[599_999,65]]){
      const reason=spatialCancellationReason(elapsed,calls,true)!;
      expect(spatialProtocolEvidence(spec(id),'cancelled',true,reason).acceptable).toBe(false);
    }
  });
  it('keeps repaired fixtures versioned and makes missing-category coverage real',()=>{
    expect(SPATIAL_FIXTURE_VERSION).toBe('spatial-fixtures.v2');expect(spec('D18').requiresSkill).toBe(false);
    const resources=spatialCaseLayers(spec('H04')).find(layer=>layer.layerId==='resources')!.features;
    expect(resources.some(feature=>!Object.hasOwn(feature.attributes??{},'category'))).toBe(true);
    expect(spatialCaseLayers(spec('D07')).find(layer=>layer.layerId==='resources')!.features.every(feature=>Object.hasOwn(feature.attributes??{},'category'))).toBe(true);
  });
  it('reports missing independent source snapshots as unverifiable rather than verified or fabricated',()=>{
    const o:SpatialObservation=fixture('D14');o.results=[result(o,'source',{operation:'buffer',input:{kind:'source',systemId:'situation'},distanceM:50},[])];
    expect(spatialEvidenceGraph(o).issues).toEqual([{resultRef:'spatial:request:source',reason:'input_snapshot_or_prior_result_unavailable',unverifiable:true}]);
  });
});
