import test from 'node:test';
import assert from 'node:assert/strict';
import {assertEquivalentAnnotationSelections as equal} from './reference-check.js';
const ref={setId:'fixed',revision:1};
const grouped=[{...ref,objectIds:['west','east']}];
test('same fixed object set permits split/reordered attachments without mutating input',()=>{
 const split=[{...ref,objectIds:['east']},{...ref,objectIds:['west']}];const original=structuredClone(split);equal(split,grouped);assert.deepEqual(split,original);
 equal([{...ref,objectIds:['east','east','west']},{...ref,objectIds:['west']}],grouped);
 equal([{...ref,layerIds:['b']},{...ref,layerIds:['a']}],[{...ref,layerIds:['a','b']}]);equal(undefined,[]);
});
for(const [name,actual] of Object.entries({missing:[{...ref,objectIds:['west']}],extra:[{...ref,objectIds:['west','east','extra']}],set:[{...ref,setId:'other',objectIds:['west','east']}],revision:[{...ref,revision:2,objectIds:['west','east']}],publication:[{publicationId:'fixed',objectIds:['west','east']}],layer:[{...ref,layerIds:['west','east']}],whole:[ref],mixed:[{...ref,layerIds:['layer'],objectIds:['west','east']}]}))test('reject '+name,()=>assert.throws(()=>equal(actual,grouped)));
test('mixed filters cannot be flattened across separate selections',()=>assert.throws(()=>equal([{...ref,layerIds:['a'],objectIds:['x']},{...ref,layerIds:['b'],objectIds:['y']}],[{...ref,layerIds:['a','b'],objectIds:['x','y']}])));
for(const bad of [[{...ref,objectIds:[]}],[{...ref,objectIds:['west'],publicationId:'p'}],[{...ref,objectIds:['west'],other:true}],[{...ref,revision:0}],null])test('reject invalid shape '+JSON.stringify(bad),()=>assert.throws(()=>equal(bad,grouped)));
