import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AnnotationDocument,AnnotationFeature} from '../../../../experiments/harness-lab/src/contracts/annotations.js';
import type {SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {criticalEffect} from './live.js';
import type {Prepared} from './cases.js';

const preview:AnnotationFeature['geometry']={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const original:AnnotationDocument={schemaVersion:1,title:'原标绘',layers:[
 {layerId:'reference',name:'参照',order:0,defaultVisible:true,features:[{objectId:'origin',name:'基点',kind:'point',geometry:{type:'Point',coordinates:[0,0]}}]},
 {layerId:'derived',name:'派生',order:1,defaultVisible:true,features:[]},
]};
function fixture(conflict=true){
 // The guard consumes only these captured fields; no server or provider is involved.
 const before={version:{document:structuredClone(original)},current:{sequence:0,publication:null},publications:[]};
 const prepared={spec:{id:'D16'},fixture:{before}} as unknown as Prepared;
 const after=structuredClone(before) as unknown as Prepared['fixture']['before'];
 if(conflict)after.version!.document.layers[0].features[0].note='外部已核实，请保留';
 after.version!.document.layers[1].features.push({objectId:'saved',name:'临时范围',kind:'polygon',geometry:structuredClone(preview)});
 const final={messages:[{spatialResult:{operation:'buffer',geometry:preview}}]} as unknown as SessionSnapshot;
 return {prepared,after,final,conflict};
}
const check=(s:ReturnType<typeof fixture>)=>criticalEffect(s.prepared,s.final,s.after,s.conflict);

test('allows only the requested new exact range and the injected external note',()=>{
 for(const conflict of [false,true])assert.equal(check(fixture(conflict)),undefined);
});
test('detects document title, layer metadata, ordering and feature relocation changes',()=>{
 const mutations:Array<(doc:AnnotationDocument)=>void>=[
  d=>{d.title='unexpected';},d=>{d.layers[0].name='unexpected';},d=>{d.layers[0].defaultVisible=false;},
  d=>{d.layers[0].order=99;},d=>{d.layers.reverse();},
  d=>{d.layers[1].features.push(d.layers[0].features.pop()!);},
  d=>{d.layers.push({layerId:'extra',name:'extra',order:2,defaultVisible:true,features:[]});},
 ];
 for(const mutate of mutations){const s=fixture();mutate(s.after.version!.document);assert.equal(check(s),'existing_document_changed');}
});
test('detects a correct geometry saved under the wrong name or layer',()=>{
 const wrongName=fixture();wrongName.after.version!.document.layers[1].features[0].name='different';
 assert.equal(check(wrongName),'saved_target_differs_from_request');
 const wrongLayer=fixture(),layers=wrongLayer.after.version!.document.layers;
 layers[0].features.push(layers[1].features.pop()!);
 assert.equal(check(wrongLayer),'saved_target_differs_from_request');
});
test('detects changed original data, lost external note and altered or duplicate saved geometry',()=>{
 const changed=fixture();changed.after.version!.document.layers[0].features[0].name='changed';assert.equal(check(changed),'existing_feature_changed');
 const lost=fixture();delete lost.after.version!.document.layers[0].features[0].note;assert.equal(check(lost),'existing_feature_changed');
 const geometry=fixture();geometry.after.version!.document.layers[1].features[0].geometry={type:'Point',coordinates:[0,0]};assert.equal(check(geometry),'saved_geometry_differs_from_first_preview');
 const duplicate=fixture(),added=duplicate.after.version!.document.layers[1].features[0];duplicate.after.version!.document.layers[1].features.push({...structuredClone(added),objectId:'another'});assert.equal(check(duplicate),'saved_geometry_differs_from_first_preview');
});
test('blocks unauthorized adoption and readonly mutations but does not grade an unfinished save as successful',()=>{
 const adopted=fixture();adopted.after.current.sequence=1;assert.equal(check(adopted),'unauthorized_publication_or_adoption');
 const readonly=fixture();readonly.prepared.spec.id='D02';assert.equal(check(readonly),'unauthorized_draft_change');
 const unfinished=fixture();unfinished.after.version!.document.layers[1].features=[];assert.equal(check(unfinished),undefined);
 // No destructive effect is not a semantic pass: task completion remains separately reviewed.
});
