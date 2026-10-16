/** Evaluator-only identity/dependency checks. Never loaded into the Agent workspace. */
import {isDeepStrictEqual as same} from 'node:util';
import type {SpatialInput,SpatialItem,SpatialResult} from '../src/contracts/spatial.js';
import type {SpatialObservation} from './probe-spatial-evaluation.js';
import type {SpatialCase} from './probe-spatial-cases.js';
export const SPATIAL_SCORER_VERSION='spatial-facts.v2';
export function itemIdentity(item:SpatialItem):string {
  if(item.annotation)return JSON.stringify(['annotation','setId'in item.annotation.ref?[item.annotation.ref.setId,item.annotation.ref.revision]:[item.annotation.ref.publicationId],item.annotation.objectId]);
  if(item.source)return JSON.stringify([item.source.ref.systemId,item.source.ref.objectType,item.source.ref.objectId]);
  return item.id;
}
const withoutDistance=({distanceM,...rest}:SpatialItem)=>{void distanceM;return rest;};
const equalItem=(a:SpatialItem,b:SpatialItem)=>{
  const validIdentity=(item:SpatialItem)=>{try{if(item.annotation)return same(JSON.parse(item.id),['annotation',item.annotation.ref,item.annotation.objectId]);if(item.source)return same(JSON.parse(item.id),[item.source.ref.systemId,item.source.ref.objectType,item.source.ref.objectId]);return true;}catch{return false;}};
  if(!validIdentity(a)||!validIdentity(b))return false;
  const normalize=(item:SpatialItem)=>{const value={...withoutDistance(item),id:itemIdentity(item)};if(value.source){const {queriedAt,...source}=value.source;void queriedAt;return {...value,source};}return value;};
  return same(normalize(a),normalize(b));
};
export function spatialEvidenceGraph(observation:SpatialObservation){
  const original=observation.before.version;
  const annotations:SpatialItem[]=original?.document?.layers.flatMap(layer=>layer.features.map(feature=>({
    id:JSON.stringify(['annotation',original.ref,feature.objectId]),name:feature.name,geometry:feature.geometry,
    properties:{...feature.attributes,name:feature.name,kind:feature.kind,layerId:layer.layerId},annotation:{ref:original.ref,objectId:feature.objectId},
  })))??[];
  const verified=new Map<string,SpatialResult>(),selectedInputs=new Map<string,SpatialItem[]>(),targets=new Map<string,SpatialItem[]>();
  const dependencies=new Map<string,Set<string>>(),issues:Array<{resultRef:string;reason:string;unverifiable?:boolean}>=[];
  function select(input:SpatialInput):SpatialItem[]|undefined {
    if(input.kind==='annotation'){
      if(!original||!same(input.ref,original.ref))return;
      const items=annotations.filter(item=>(!input.layerIds||input.layerIds.includes(String(item.properties.layerId)))&&(!input.objectIds||input.objectIds.includes(item.annotation!.objectId)));
      if(input.objectIds?.some(id=>!items.some(item=>item.annotation!.objectId===id)))return;
      return items;
    }
    if(input.kind==='source'){
      if(!observation.sourceSnapshot)return;
      // Area membership must be independently captured; do not infer it from output properties.
      if(input.areaIds?.length&&!observation.sourceAreaIds)return;
      return observation.sourceSnapshot.filter(item=>item.source?.ref.systemId===input.systemId&&(!input.areaIds||input.areaIds.some(id=>observation.sourceAreaIds?.[itemIdentity(item)]?.includes(id)))&&(!input.objectRefs||input.objectRefs.some(ref=>same(ref,item.source!.ref)))&&(!input.revisions||input.revisions.every(value=>!same(value.ref,item.source!.ref)||value.revision===item.source!.revision)));
    }
    const prior=verified.get(input.resultRef);if(!prior)return;
    if(input.geometry===true)return prior.geometry?[{id:prior.resultRef,name:prior.operation,geometry:prior.geometry,properties:{}}]:undefined;
    // Frozen v1 omitted geometry meant original items; preserve that historical interpretation.
    const items=prior.items.filter(item=>!input.itemIds||input.itemIds.includes(item.id));
    if(input.itemIds?.some(id=>!items.some(item=>item.id===id)))return;
    return items;
  }
  const equivalent=(item:SpatialItem,candidate:SpatialItem)=>{
    // Generated names are display labels, while original identities/properties remain exact.
    if(!item.annotation&&!item.source&&!candidate.annotation&&!candidate.source)return item.id===candidate.id&&same(item.geometry,candidate.geometry)&&same(item.properties,candidate.properties);
    return equalItem(item,candidate);
  };
  for(const result of observation.results){
    const reject=(reason:string,unverifiable=false)=>issues.push({resultRef:result.resultRef,reason,...(unverifiable?{unverifiable:true}:{})});
    if(verified.has(result.resultRef)||observation.results.filter(r=>r.resultRef===result.resultRef).length!==1){reject('duplicate_result_origin');continue;}
    if(result.resultRef!==`spatial:${result.requestId}:${encodeURIComponent(result.toolCallId)}`||result.parameters.operation!==result.operation){reject('result_origin_or_operation_mismatch');continue;}
    if(observation.toolCallsAuthoritative){
      const call=observation.tools.find(tool=>tool.toolCallId===result.toolCallId&&tool.name==='spatial_analyze');
      if(!call){reject('original_tool_call_unavailable',true);continue;}
      if(!same(call.args,result.parameters)){reject('original_tool_arguments_mismatch');continue;}
      const message=observation.messages.find(message=>message.role==='tool'&&message.toolName==='spatial_analyze'&&message.requestId===result.requestId&&message.toolCallId===result.toolCallId&&!message.isError&&!message.resultMissing&&message.spatialResult?.resultRef===result.resultRef);
      if(!message){reject('original_tool_delivery_unavailable',true);continue;}
    }
    const p=result.parameters, selectors=[p.input,...('target'in p&&p.target?[p.target]:[]),...(p.operation==='filter'&&p.spatial?[p.spatial.target]:[])];
    if(!same(selectors,result.scope)){reject('scope_parameters_mismatch');continue;}
    const selections=selectors.map(select);
    if(selections.some(items=>!items)){reject('input_snapshot_or_prior_result_unavailable',selectors.some(input=>input.kind==='source'));continue;}
    const input=selections[0]!,target=selections.slice(1).flatMap(items=>items!);
    if(result.completeness.candidateCount!==input.length){reject('candidate_count_mismatch');continue;}
    if(new Set(result.items.map(itemIdentity)).size!==result.items.length||result.items.some(item=>!input.some(candidate=>equivalent(item,candidate)))){reject('output_identity_geometry_or_properties_mismatch');continue;}
    if(!same((result.referenceItems??[]).map(itemIdentity).sort(),target.map(itemIdentity).sort())||(result.referenceItems??[]).some(item=>!target.some(candidate=>equivalent(item,candidate)))){reject('target_identity_geometry_or_properties_mismatch');continue;}
    if(['measure','relate','buffer','summarize'].includes(result.operation)&&!same(result.items.map(itemIdentity).sort(),input.map(itemIdentity).sort())){reject('operation_dropped_inputs');continue;}
    const deps=new Set<string>();for(const selector of selectors)if(selector.kind==='result'){deps.add(selector.resultRef);for(const ref of dependencies.get(selector.resultRef)??[])deps.add(ref);}
    dependencies.set(result.resultRef,deps);selectedInputs.set(result.resultRef,input);targets.set(result.resultRef,target);verified.set(result.resultRef,result);
  }
  return {verified,selectedInputs,targets,dependencies,issues,select,annotations};
}
export function spatialCoreChecks(spec:SpatialCase,observation:SpatialObservation){
  const graph=spatialEvidenceGraph(observation),checks:Array<{name:string;passed:boolean;critical?:boolean}>=[];
  const add=(name:string,passed:boolean,critical=false)=>checks.push({name,passed,...(critical?{critical:true}:{})});
  add('fixed_identity_version_and_geometry',graph.issues.length===0,graph.issues.some(issue=>!issue.unverifiable));
  const results=[...graph.verified.values()],ids=(items:SpatialItem[]|undefined)=>items?.map(item=>item.annotation?.objectId??itemIdentity(item));
  const equalIds=(items:SpatialItem[]|undefined,expected:string[],ordered=false)=>{
    const actual=ids(items);return !!actual&&same(ordered?actual:[...actual].sort(),ordered?expected:[...expected].sort());
  };
  const inputIs=(r:SpatialResult,expected:string[])=>equalIds(graph.selectedInputs.get(r.resultRef),expected);
  const targetIs=(r:SpatialResult,expected:string[])=>equalIds(graph.targets.get(r.resultRef),expected);
  const expected=spec.expected;
  const measurement:Record<string,{metric:string;input:string[];target?:string[]}>= {
    D01:{metric:'distance',input:['origin'],target:['north']},D02:{metric:'point_to_line',input:['origin'],target:['line']},
    D03:{metric:'length',input:['return-line']},D04:{metric:'area',input:['region']},H01:{metric:'distance',input:['origin'],target:['north']},
  };
  let relevant:SpatialResult|undefined;
  const relevantRefs=new Set<string>();
  // All eligible outputs are retained; disagreeing answers cannot be hidden by picking the last call.
  const choose=(candidates:SpatialResult[],outcome:(result:SpatialResult)=>unknown=result=>({items:result.items.map(itemIdentity),values:result.values}))=>{for(const candidate of candidates)relevantRefs.add(candidate.resultRef);if(candidates.length>1)add('consistent_relevant_outputs',candidates.every(candidate=>same(outcome(candidate),outcome(candidates[0]))));return candidates[0];};
  const resourceIds=['r1','r2','r3','edge','outside'];
  function perObjectRelations(targetId:string,accepted:string[]){
    const candidates=results.filter(r=>r.parameters.operation==='relate'&&r.parameters.relation==='contains'&&inputIs(r,[targetId])&&graph.targets.get(r.resultRef)?.length===1&&resourceIds.includes(ids(graph.targets.get(r.resultRef))![0]));
    const complete=resourceIds.every(id=>candidates.some(r=>targetIs(r,[id])&&r.values&&'matches'in r.values&&r.values.matches===accepted.includes(id)));
    if(complete)for(const candidate of candidates)relevantRefs.add(candidate.resultRef);
    return complete&&candidates.every(r=>r.values&&'matches'in r.values&&r.values.matches===accepted.includes(ids(graph.targets.get(r.resultRef))![0]));
  }

  if(expected.value!==undefined){
    const oracle=measurement[spec.id];
    if(!oracle){add('independent_numeric_oracle_unavailable',false);return {checks,graph,relevantResultRef:null,relevantResultRefs:[],toolPathCoverage:[]};}
    relevant=choose(results.filter(r=>r.operation==='measure'&&r.parameters.operation==='measure'&&r.parameters.metric===oracle?.metric&&((inputIs(r,oracle.input)&&(!oracle.target||targetIs(r,oracle.target)))||(oracle.metric==='distance'&&inputIs(r,oracle.target!)&&targetIs(r,oracle.input)))),r=>r.values);
    add('independent_numeric_oracle',!!relevant?.values&&'value'in relevant.values&&relevant.values.unit===(oracle.metric==='area'?'m²':'m')&&Math.abs(relevant.values.value-expected.value)<=expected.tolerance!);
  }
  if(expected.relation!==undefined){
    relevant=choose(results.filter(r=>(r.operation==='relate'&&r.parameters.operation==='relate'&&r.parameters.relation==='contains'&&inputIs(r,['region'])&&targetIs(r,['edge']))||(r.operation==='filter'&&ids(graph.selectedInputs.get(r.resultRef))?.includes('edge')&&targetIs(r,['region'])&&r.parameters.operation==='filter'&&r.parameters.spatial&&'relation'in r.parameters.spatial&&r.parameters.spatial.relation==='contains')),r=>r.values&&'matches'in r.values?r.values.matches:ids(r.items)?.includes('edge')===true);
    add('boundary_included',!!relevant&&(relevant.values&&'matches'in relevant.values?relevant.values.matches===expected.relation:ids(relevant.items)?.includes('edge')===true));
  }
  if(expected.objectIds&&!expected.relation){
    const nearest=['D09','D10','H03'].includes(spec.id);
    relevant=choose(results.filter(r=>nearest?r.operation==='nearest'&&targetIs(r,['origin']):r.operation==='filter'&&(targetIs(r,[spec.id==='D16'?'empty':'region'])||spec.id==='D11'&&inputIs(r,resourceIds)&&r.parameters.operation==='filter'&&!!r.parameters.spatial)),r=>(nearest?r.items.slice(0,2):r.items).map(itemIdentity));
    const perObject=!nearest&&['D06','D08','D16'].includes(spec.id)&&perObjectRelations(spec.id==='D16'?'empty':'region',expected.objectIds);
    add('exact_selected_objects',perObject||!!relevant&&equalIds(nearest?relevant.items.slice(0,2):relevant.items,expected.objectIds,nearest));
    if(nearest){
      const allowed=spec.id==='D10'?['tie-a','tie-b']:['r2','r3','edge'];
      add('ranking_candidate_scope',!!relevant&&inputIs(relevant,allowed));
      // An independently selected complete candidate set is equivalent to a chained filter.
      // The full final answer (including manual top N of a full sort) remains reviewable separately.
      add('ranking_count_and_order',!!relevant&&relevant.parameters.operation==='nearest'&&relevant.parameters.count>=2&&equalIds(relevant.items.slice(0,2),expected.objectIds,true));
    }else if(relevant&&spec.id!=='D11'){
      add('candidate_scope',inputIs(relevant,['r1','r2','r3','edge','outside']));
      add('filter_relation',relevant.parameters.operation==='filter'&&!!relevant.parameters.spatial&&'relation'in relevant.parameters.spatial&&['contains','intersects'].includes(relevant.parameters.spatial.relation));
      if(spec.id==='D08')add('attribute_condition',relevant.items.every(item=>item.properties.status==='ready'));
    }
  }
  if(expected.counts){
    const summary=choose(results.filter(r=>r.operation==='summarize'&&r.parameters.operation==='summarize'&&r.parameters.field==='category'));
    const selections=results.filter(r=>r.operation==='filter'&&inputIs(r,resourceIds)&&equalIds(r.items,['r1','r2'])&&r.parameters.operation==='filter'&&!!r.parameters.spatial&&(
      ('distanceM'in r.parameters.spatial&&r.parameters.spatial.distanceM===1500&&targetIs(r,['origin']))||
      ('relation'in r.parameters.spatial&&r.parameters.spatial.relation==='contains'&&graph.targets.get(r.resultRef)?.some(item=>results.some(buffer=>buffer.operation==='buffer'&&buffer.resultRef===item.id&&inputIs(buffer,['origin'])&&buffer.parameters.operation==='buffer'&&buffer.parameters.distanceM===1500)))
    ));
    // Declared equivalent: classify the complete selected set's actual properties in the answer.
    // The wording/count actually reported is still independently reviewed.
    const selected=choose(selections);
    const perPoint=results.filter(r=>r.parameters.operation==='relate'&&r.parameters.relation==='contains'&&graph.selectedInputs.get(r.resultRef)?.some(item=>results.some(buffer=>buffer.operation==='buffer'&&buffer.resultRef===item.id&&buffer.parameters.operation==='buffer'&&buffer.parameters.distanceM===1500&&inputIs(buffer,['origin'])))&&graph.targets.get(r.resultRef)?.length===1);
    const perPointComplete=resourceIds.every(id=>perPoint.some(r=>targetIs(r,[id])&&r.values&&'matches'in r.values&&r.values.matches===['r1','r2'].includes(id)))&&perPoint.every(r=>r.values&&'matches'in r.values&&r.values.matches===['r1','r2'].includes(ids(graph.targets.get(r.resultRef))![0]));
    if(perPointComplete)for(const point of perPoint)relevantRefs.add(point.resultRef);
    const selectedItems=selected?.items??(perPointComplete?graph.annotations.filter(item=>['r1','r2'].includes(item.annotation!.objectId)):undefined);

    const groups=summary?.values&&'groups'in summary.values?summary.values.groups:undefined;
    const actual=groups?Object.fromEntries(groups.map(group=>[String(group.value),group.count])):selectedItems?Object.fromEntries([...new Set(selectedItems.map(item=>String(item.properties.category)))].map(category=>[category,selectedItems.filter(item=>String(item.properties.category)===category).length])):undefined;
    add('exact_category_counts',!!actual&&same(actual,expected.counts)&&(!summary?.values||!('total'in summary.values)||summary.values.total===Object.values(expected.counts).reduce((a,b)=>a+b,0))&&(!summary||inputIs(summary,['r1','r2'])));
    add('summary_dependency',perPointComplete&&(!summary||inputIs(summary,['r1','r2'])&&perPoint.every(point=>results.indexOf(point)<results.indexOf(summary)))||!!selected&&(!summary||selections.some(selection=>graph.dependencies.get(summary.resultRef)?.has(selection.resultRef)===true)));
    relevant=summary??selected;
  }
  if(['D07','H02','D11','D12'].includes(spec.id)){
    const buffers=results.filter(r=>r.operation==='buffer'&&inputIs(r,['origin'])&&r.parameters.operation==='buffer'&&r.parameters.distanceM===(spec.id==='D12'?500:1500)&&!!r.geometry);
    add('requested_buffer_origin_and_radius',buffers.length>0);
    add('independent_buffer_geometry',buffers.length>0&&buffers.every(buffer=>pointBufferMatches(buffer,graph.selectedInputs.get(buffer.resultRef)![0])));
    if(spec.followup){
      const first=buffers[0],target=relevant?graph.targets.get(relevant.resultRef):undefined;
      add('reuses_fixed_result',observation.results.filter(r=>r.operation==='buffer').length===1&&!!first&&!!relevant&&equalIds(graph.selectedInputs.get(relevant.resultRef),['r1','r2','r3','edge','outside'])&&!!target?.some(item=>item.id===first.resultRef&&same(item.geometry,first.geometry))&&!!graph.dependencies.get(relevant.resultRef)?.has(first.resultRef)&&results.filter(r=>r.operation==='filter'&&inputIs(r,resourceIds)&&r.parameters.operation==='filter'&&!!r.parameters.spatial).every(r=>graph.targets.get(r.resultRef)?.some(item=>item.id===first.resultRef&&same(item.geometry,first.geometry))));
    }
  }
  const paths=expected.operations.map(operation=>({operation,observed:results.some(r=>r.operation===operation)}));
  return {checks,graph,relevantResultRef:relevant?.resultRef??null,relevantResultRefs:[...relevantRefs],toolPathCoverage:paths};
}

/** Independent spherical radial oracle for the point buffers used by these fixtures. */
export function pointBufferMatches(result:SpatialResult,origin:SpatialItem){
  if(result.parameters.operation!=='buffer'||origin.geometry.type!=='Point'||result.geometry?.type!=='Polygon'||result.geometry.coordinates.length!==1)return false;
  const ring=result.geometry.coordinates[0],radius=result.parameters.distanceM,rad=Math.PI/180;
  if(ring.length<65||!same(ring[0],ring.at(-1)))return false;
  const [lon,lat]=origin.geometry.coordinates,angles:number[]=[];
  for(const [x,y] of ring.slice(0,-1)){
    const a=Math.sin((y-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(y*rad)*Math.sin((x-lon)*rad/2)**2;
    if(Math.abs(2*6371008.8*Math.asin(Math.sqrt(a))-radius)>1)return false;
    angles.push(Math.atan2(Math.sin((x-lon)*rad)*Math.cos(y*rad),Math.cos(lat*rad)*Math.sin(y*rad)-Math.sin(lat*rad)*Math.cos(y*rad)*Math.cos((x-lon)*rad)));
  }
  angles.sort((a,b)=>a-b);return angles.every((angle,index)=>((angles[(index+1)%angles.length]-angle+2*Math.PI)%(2*Math.PI))<.11);
}
