import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {acceptanceCases,acceptanceCase,type CaseId} from './cases.js';
import {buildFixture,businessTime} from './fixtures.js';
import {decodeSourceResource,decodeTaskResource,decodeResourceCapability} from '../../../experiments/harness-lab/src/contracts/task-resources.js';
import {situationObject} from '../../../experiments/harness-lab/src/context/validation.js';
import {feature as decodeFeature} from '../../../experiments/harness-lab/src/annotations/validation.js';
import type {SituationGeometry} from '../../../experiments/harness-lab/src/contracts/context.js';

// This test alone reads the sealed oracle. Runtime entrypoints may never import it.
const oracle=JSON.parse(await readFile(new URL('./oracle.json',import.meta.url),'utf8')) as {byCase:Record<string,Record<string,unknown>>};
type GeometryExpected={area:string;interior:string[];boundary:string[];exterior:string[];unclassified?:string[]};
/** Independent rectangular oracle. No product geometry/statistics function is imported. */
function boxClassify(point:SituationGeometry,region:SituationGeometry):'interior'|'boundary'|'exterior' {
 assert.equal(point.type,'Point');assert.equal(region.type,'Polygon');
 if(point.type!=='Point'||region.type!=='Polygon')throw new Error('unexpected geometry');
 const xs=region.coordinates[0].map(p=>p[0]),ys=region.coordinates[0].map(p=>p[1]);
 const west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys),[x,y]=point.coordinates;
 if(x<west||x>east||y<south||y>north)return 'exterior';
 return x===west||x===east||y===south||y===north?'boundary':'interior';
}
function checkGeometry(id:CaseId,wanted:GeometryExpected){
 const f=buildFixture(id,'fixture-task');const region=f.objects.find(o=>o.ref.objectId===wanted.area)?.geometry;assert.ok(region);
 for(const relation of ['interior','boundary','exterior'] as const)for(const objectId of wanted[relation]){
  const geometry=f.objects.find(o=>o.ref.objectId===objectId)?.geometry??[...f.draftFeatures,...f.publishedFeatures].find(o=>o.objectId===objectId)?.geometry;
  assert.ok(geometry,`${id} ${objectId} missing`);assert.equal(boxClassify(geometry,region),relation,`${id} ${objectId}`);
 }
 for(const objectId of wanted.unclassified??[]){const o=f.objects.find(o=>o.ref.objectId===objectId);assert.ok(o);assert.ok(!o.geometry||o.resourceData?.resource.position?.meaning!=='actual'||o.resourceData.resource.position.appliesTo!=='resource');}
}
test('12 independent cases, two immutable A07 turns, exact frozen case coverage',()=>{
 assert.deepEqual(acceptanceCases.map(c=>c.id),['P01','P02','P03','P04','A01','A02','A03','A04','A05','A06','A07','A08']);
 assert.deepEqual(Object.keys(oracle.byCase),acceptanceCases.map(c=>c.id));assert.equal(acceptanceCase('A07').turns.length,2);
 const copy=acceptanceCase('A07');copy.turns[1].text='changed';assert.notEqual(acceptanceCase('A07').turns[1].text,'changed');
});
test('business data validates with actual resource and annotation boundary decoders',()=>{
 for(const c of acceptanceCases){
  const f=buildFixture(c.id,'fixture-task');assert.deepEqual(f,buildFixture(c.id,'fixture-task'));
  assert.equal(new Set(f.objects.map(o=>`${o.ref.systemId}/${o.ref.objectId}`)).size,f.objects.length);
  for(const s of f.systems)if(s.resourceCapability)decodeResourceCapability(s.resourceCapability);
  for(const o of f.objects){situationObject(o,o.ref.systemId);if(o.resourceData)decodeSourceResource(o.resourceData);}
  for(const o of [...f.draftFeatures,...f.publishedFeatures])decodeFeature(o);
  for(const i of f.controlledImports){const source=f.objects.find(o=>JSON.stringify(o.ref)===JSON.stringify(i.sourceRef));assert.ok(source?.resourceData?.entityId);assert.ok(!f.draftFeatures.some(o=>o.objectId===i.objectId));if(i.resourceOverride)decodeTaskResource(i.resourceOverride);}
  for(const r of f.businessRefs)assert.ok(f.objects.find(o=>JSON.stringify(o.ref)===JSON.stringify(r)));
  for(const t of c.turns)if(t.areaObjectId)assert.ok(f.objects.find(o=>o.ref.objectId===t.areaObjectId&&o.ref.objectType==='area'));
 }
});
test('literal geometric expectations cross-check independently against fresh coordinates',()=>{
 for(const id of ['P01','P02','A05','A08'] as const)checkGeometry(id,oracle.byCase[id].geometry as GeometryExpected);
 for(const turn of ['turn1','turn2'])checkGeometry('A07',(oracle.byCase.A07[turn] as {geometry:GeometryExpected}).geometry);
});
test('A03 identity evidence establishes only the controlled pair; names do not merge',()=>{
 const f=buildFixture('A03','fixture-task');assert.equal(f.objects[0].name,f.objects[1].name);
 assert.notEqual(f.objects[0].resourceData!.entityId,f.objects[1].resourceData!.entityId);
 assert.equal(f.controlledImports.length,1);assert.deepEqual(f.controlledImports[0].sourceRef,f.objects[0].ref);
 assert.equal(f.draftFeatures.length,1);assert.equal(f.draftFeatures[0].resourceAssociation,undefined);
 assert.equal(f.objects.length+f.draftFeatures.length+f.controlledImports.length,oracle.byCase.A03.recordCount);
 assert.equal(new Set(f.objects.map(o=>o.resourceData!.entityId)).size,oracle.byCase.A03.knownEntityCount);
});
test('A05 independent quantities and disjoint aggregate membership retain units',()=>{
 const f=buildFixture('A05','fixture-task'),rows=f.objects.filter(o=>o.resourceData);assert.equal(rows.length,8);
 const group=rows.find(o=>o.resourceData!.resource.granularity==='aggregate')!;
 assert.equal(group.resourceData!.resource.quantity!.value,4);assert.equal(group.resourceData!.resource.quantity!.unit,'艘');
 const entities=rows.flatMap(o=>o.resourceData!.entityId?[o.resourceData!.entityId!]:[]),members=group.resourceData!.coverage!.memberEntityIds!;
 assert.equal(new Set([...entities,...members]).size,entities.length+members.length);assert.equal(members.length,4);
 const expected=oracle.byCase.A05.geometry as GeometryExpected;const totals=new Map<string,number>();
 for(const id of expected.interior){const q=rows.find(o=>o.ref.objectId===id)!.resourceData!.resource.quantity!;totals.set(q.unit,(totals.get(q.unit)??0)+q.value!);}
 assert.deepEqual(Object.fromEntries(totals),{'辆':2,'艘':4});
});
test('A06 complete zero and terminal partial are separate factual inputs',()=>{
 const f=buildFixture('A06','fixture-task');assert.deepEqual(f.systems.map(s=>s.coverage.status),['complete','partial']);
 assert.ok(f.systems[1].coverage.reason);assert.equal(f.objects.filter(o=>o.ref.systemId==='situation'&&o.ref.objectType==='resource'&&o.areaIds.includes('a06-elm')).length,0);
 const partial=f.objects.filter(o=>o.ref.systemId==='patrol');assert.equal(partial.length,1);assert.equal(partial[0].resourceData!.resource.taskRelations,undefined);
});
test('A08 has genuine unresolved region ambiguity without initial user intent leakage',()=>{
 const f=buildFixture('A08','fixture-task'),c=acceptanceCase('A08'),areas=f.objects.filter(o=>o.ref.objectType==='area');
 assert.equal(areas.length,2);assert.ok(areas.every(o=>o.name.startsWith('北区（')));assert.notDeepEqual(areas[0].geometry,areas[1].geometry);
 assert.equal(f.businessRefs.length,0);assert.equal(c.turns.length,1);assert.equal(c.turns[0].areaObjectId,undefined);
 assert.doesNotMatch(JSON.stringify({title:c.taskTitle,goal:c.taskGoal,turns:c.turns}),/港口|harbor/);
 const available=f.objects.filter(o=>o.resourceData?.resource.availability?.state==='available');
 const hits=areas.map(a=>available.filter(o=>boxClassify(o.geometry!,a.geometry!)==='interior').map(o=>o.ref.objectId));assert.notDeepEqual(hits[0],hits[1]);
 assert.equal(c.humanFacts.length,1);assert.equal(c.humanFacts[0].objectId,oracle.byCase.A08.clarifyRegion);
});
test('P04 update changes actual source facts while frozen first snapshot remains untouched',()=>{
 const f=buildFixture('P04','fixture-task'),raw=JSON.stringify(f.objects);assert.equal(f.objects.length,23);assert.equal(f.sourceUpdate!.length,24);
 assert.ok(f.objects.every(o=>o.revision===1));assert.ok(f.sourceUpdate!.slice(0,23).every(o=>o.revision===2));assert.equal(JSON.stringify(f.objects),raw);
});
test('A02 prior user statement retains real selected source and independent publication',()=>{
 const f=buildFixture('A02','fixture-task');assert.equal(f.priorUserReport!.sourceRefs.length,1);assert.deepEqual(f.priorUserReport!.sourceRefs[0],f.objects[0].ref);
 assert.match(f.priorUserReport!.text,/电话报告.*没有回填/);assert.equal(f.objects[0].resourceData!.resource.availability!.state,'unknown');
 assert.ok(f.draftFeatures.length);assert.ok(f.publishedFeatures.length);assert.ok(f.publishedFeatures.every(p=>!f.draftFeatures.some(d=>d.objectId===p.objectId)));
});
test('repeat semantics remain stable after fixed evidence time; only declared past expiration exists',()=>{
 for(const c of acceptanceCases){const f=buildFixture(c.id,'fixture-task');
  const declarations=[...f.objects.flatMap(o=>o.resourceData?[o.resourceData.resource]:[]),...f.draftFeatures.flatMap(o=>o.resource?[o.resource]:[]),...f.publishedFeatures.flatMap(o=>o.resource?[o.resource]:[]),...f.controlledImports.flatMap(o=>o.resourceOverride?[o.resourceOverride]:[])];
  for(const d of declarations)for(const fact of [d.quantity,d.position,d.availability,...d.taskRelations??[]])if(fact){if(fact.effectiveAt)assert.ok(Date.parse(fact.effectiveAt)<=Date.parse(businessTime));if(fact.validUntil)assert.ok(Date.parse(fact.validUntil)<Date.parse(businessTime));}
 }
});
test('model-visible modules never import review oracle or expected-answer functions',async()=>{
 for(const name of ['cases.ts','fixtures.ts']){const text=await readFile(new URL(name,import.meta.url),'utf8');assert.doesNotMatch(text,/from\s+['"].*(?:oracle|scoring)|readFile|summarizeResources|classifyPoint/);}
});
