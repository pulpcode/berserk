import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Budget,limits,selectionFor,allowedTool,modelConfig,effectCheck} from './run.js';
import {schedule,kinds,layersFor,oracle,distance,type Fixture} from './cases.js';
import type {WorkspaceResources,SessionSnapshot} from '../../../../experiments/harness-lab/src/contracts/index.js';
test('exact first-round 48 balanced entries, no second-round or outcome-dependent schedule',()=>{
 assert.equal(schedule.length,48);assert.equal(new Set(schedule.map(e=>e.id)).size,48);
 for(const kind of kinds){const entries=schedule.filter(e=>e.kind===kind);assert.equal(entries.length,4);assert.equal(new Set(entries.map(e=>`${e.model}-${e.condition}`)).size,4);assert.ok(entries.every(e=>e.round===1));}
 for(const model of ['deepseek-flash','deepseek-v4-pro'])for(const condition of ['B','C']){assert.equal(schedule.filter(e=>e.model===model&&e.condition===condition).length,12);for(let position=0;position<4;position++)assert.equal(schedule.filter((e,i)=>i%4===position&&e.model===model&&e.condition===condition).length,3);}
});
test('B selects actual controlled catalog hash; C leaves body to native read',()=>{
 const catalog={skills:[{id:'spatial-analysis',hash:'actual-body-hash'}]} as WorkspaceResources;
 assert.deepEqual(selectionFor('B',catalog),{id:'spatial-analysis',hash:'actual-body-hash'});assert.equal(selectionFor('C',catalog),undefined);
 assert.throws(()=>selectionFor('B',{skills:[]} as unknown as WorkspaceResources));assert.equal(modelConfig.outputLimit,4096);assert.equal(modelConfig.thinking,'disabled');
});
test('budget counts cached prompt once and enforces per trial/global/output/input limits',()=>{
 const b=new Budget();b.begin();b.finish({prompt_tokens:100,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,completion_tokens:10});assert.equal(b.input,100);
 b.finish({prompt_cache_hit_tokens:30,prompt_cache_miss_tokens:10,completion_tokens:5});assert.equal(b.input,140);
 for(let i=0;i<24;i++)b.reserve();assert.throws(()=>b.reserve(),/trial_budget/);b.begin();b.total=1152;assert.throws(()=>b.reserve(),/batch_budget/);
 const output=new Budget();output.begin();output.output=limits.output-4095;assert.throws(()=>output.reserve(),/batch_budget/);
 const input=new Budget();input.begin();input.input=limits.input;assert.throws(()=>input.reserve(),/batch_budget/);
 const timed=new Budget();timed.begin();assert.throws(()=>timed.reserve(timed.started+600000),/trial_budget/);
 const missing=new Budget();missing.finish(undefined);assert.equal(missing.fatal,'missing_provider_usage');assert.throws(()=>missing.reserve());
});
test('fixtures have real ambiguity, missing attrs, page totals and independent oracle',()=>{
 assert.equal(layersFor('J09').filter(l=>l.name==='资源').length,2);
 assert.equal(layersFor('J12').find(l=>l.layerId==='resources')!.features.filter(f=>f.attributes?.category===undefined).length,1);
 assert.equal(layersFor('J02').flatMap(l=>l.features).length,64);assert.equal(oracle('J02').layerTotal,58);
 assert.deepEqual(oracle('J12').category,{boat:3,truck:1});assert.ok(Math.abs(distance([114,22.5],[114,22.51])-1111.950802335)<.000001);
});
test('readonly and precise action gates reject unauthorized writes, while domain clarification allowed',()=>{
 const fixture={before:{version:{document:{layers:layersFor('J06')}}}} as unknown as Fixture;
 const j6=schedule.find(e=>e.kind==='J06')!,j7=schedule.find(e=>e.kind==='J07')!;
 assert.equal(allowedTool('ask_user',{},j6,0,fixture,new Set()),true);
 assert.equal(allowedTool('annotation_action',{action:'publish'},j6,1,fixture,new Set()),false);
 assert.equal(allowedTool('annotation_action',{action:'apply',operations:[{op:'update_object',objectId:'origin',changes:{name:'出发点'}}]},j6,1,fixture,new Set()),true);
 assert.equal(allowedTool('annotation_action',{action:'apply',operations:[{op:'update_object',objectId:'origin',changes:{name:'别名'}}]},j6,1,fixture,new Set()),false);
 assert.equal(allowedTool('annotation_from_analysis',{resultRef:'real',layerId:'derived',name:'临时范围'},j7,1,fixture,new Set(['real'])),true);
 assert.equal(allowedTool('annotation_from_analysis',{resultRef:'fake',layerId:'derived',name:'临时范围'},j7,1,fixture,new Set(['real'])),false);
 assert.equal(allowedTool('bash',{command:'x'},j6,0,fixture,new Set()),false);
});
test('actual geometry and complete original document matter, successful tool call is insufficient',()=>{
 const state={version:{document:{layers:layersFor('J07')}},publications:[],current:{sequence:0}} as unknown as Fixture['before'];
 const f={kind:'J07',before:state} as Fixture;const after=structuredClone(state);
 after.version!.document.layers.find(l=>l.layerId==='derived')!.features.push({objectId:'saved',kind:'point',name:'临时范围',geometry:{type:'Point',coordinates:[114,22.5]}});
 const checks=effectCheck(f,after,1,{messages:[]} as unknown as SessionSnapshot);assert.equal(checks.exactSavedGeometry,false);assert.equal(checks.expectedDocument,true);
 after.version!.document.layers[0].features[0].name='unrequested';assert.equal(effectCheck(f,after,1,{messages:[]} as unknown as SessionSnapshot).expectedDocument,false);
});
