import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {acceptanceCases,acceptanceCase,type CaseId} from './cases.js';
import {buildFixture,materializeSourceUpdate,type AcceptanceFixture} from './fixtures.js';
import {decodeSourceResource,decodeResourceCapability} from '../../../experiments/harness-lab/src/contracts/task-resources.js';
import {situationObject} from '../../../experiments/harness-lab/src/context/validation.js';
import {feature as decodeFeature} from '../../../experiments/harness-lab/src/annotations/validation.js';
import type {SituationGeometry} from '../../../experiments/harness-lab/src/contracts/context.js';

const T0='2030-03-04T05:06:07.000Z';
const oracle=JSON.parse(await readFile(new URL('./oracle.json',import.meta.url),'utf8')) as {byCase:Record<CaseId,Record<string,unknown>>};
const reviewed=await readFile(new URL('./cases.md',import.meta.url),'utf8');
const fixture=(id:CaseId)=>buildFixture(id,'fixture-task',T0);
const features=(f:AcceptanceFixture)=>f.annotationLayers.flatMap(l=>l.features);
const object=(f:AcceptanceFixture,id:string)=>{const o=f.objects.find(o=>o.ref.objectId===id);assert.ok(o,`${f.caseId}/${id}`);return o;};
type GeometryExpected={area:string;interior:string[];boundary:string[];exterior:string[];unclassified?:string[]};
/** Deliberately independent rectangle inequalities, never product geometry or summaries. */
function boxClassify(point:SituationGeometry,region:SituationGeometry):'interior'|'boundary'|'exterior' {
  assert.equal(point.type,'Point');assert.equal(region.type,'Polygon');
  if(point.type!=='Point'||region.type!=='Polygon')throw new Error('unexpected geometry');
  const xs=region.coordinates[0].map(p=>p[0]),ys=region.coordinates[0].map(p=>p[1]);
  const w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys),[x,y]=point.coordinates;
  if(x<w||x>e||y<s||y>n)return 'exterior';
  return x===w||x===e||y===s||y===n?'boundary':'interior';
}

test('exact twelve reviewed cases and exact user text; no copied old-round inputs',()=>{
  assert.deepEqual(acceptanceCases.map(c=>c.id),['P01','P02','P03','P04','N01','N02','N03','N04','N05','N06','N07','N08']);
  assert.deepEqual(Object.keys(oracle.byCase),acceptanceCases.map(c=>c.id));
  for(const c of acceptanceCases){
    const section=reviewed.split(`## ${c.id}：`)[1].split('\n## ')[0];
    const texts=[...section.matchAll(/\*\*(?:用户原文|第一轮用户原文|第二轮用户原文)\*\*：`([^`]+)`/g)].map(m=>m[1]);
    assert.deepEqual(c.turns.map(t=>t.text),texts);
  }
  const copy=acceptanceCase('N08');copy.turns[0].text='mutated';assert.notEqual(acceptanceCase('N08').turns[0].text,'mutated');
});

test('every fixture uses real contract decoders; import intents never fabricate associations',()=>{
  for(const c of acceptanceCases){
    const f=fixture(c.id);assert.deepEqual(f,fixture(c.id));assert.equal(f.t0,T0);
    assert.equal(new Set(f.objects.map(o=>`${o.ref.systemId}/${o.ref.objectId}`)).size,f.objects.length);
    for(const s of f.systems){decodeResourceCapability(s.resourceCapability);assert.equal(s.resourceCapability.taskIdMapping,'identity');assert.equal(s.resourceCapability.supportRule?.id,'explicit-task-relation');}
    for(const o of f.objects){situationObject(o,o.ref.systemId);if(o.resourceData)decodeSourceResource(o.resourceData);assert.deepEqual(o.areaIds,[]);}
    for(const a of features(f)){decodeFeature(a);assert.equal(a.resourceAssociation,undefined);}
    for(const i of f.controlledImports){
      const o=object(f,i.sourceRef.objectId);assert.deepEqual(o.ref,i.sourceRef);assert.ok(o.resourceData?.entityId);assert.equal(o.resourceData.resource.granularity,'individual');
      assert.ok(f.annotationLayers.some(l=>l.layerId===i.layerId));assert.ok(!features(f).some(a=>a.objectId===i.objectId));
    }
    assert.deepEqual(f.businessRefs,[]);
    for(const t of c.turns){
      for(const r of t.contextRefs??[])assert.deepEqual(object(f,r.objectId).ref,r);
      for(const sel of t.annotationSelections??[]){
        assert.ok(Boolean(sel.layerIds)!==Boolean(sel.objectIds));
        for(const id of sel.layerIds??[])assert.ok(f.annotationLayers.some(l=>l.layerId===id));
        for(const id of sel.objectIds??[])assert.ok(features(f).some(a=>a.objectId===id)||f.controlledImports.some(i=>i.objectId===id));
      }
    }
  }
});

test('source rows and annotation names, exact entity IDs and Point coordinates match reviewed tables',()=>{
  for(const c of acceptanceCases){
    const f=fixture(c.id),section=reviewed.split(`## ${c.id}：`)[1].split('\n## ')[0];
    const rows=section.split('\n').filter(l=>l.startsWith('| ')).map(l=>l.split('|').slice(1,-1).map(v=>v.trim()));
    for(const o of f.objects){
      const row=rows.find(r=>r[1]===o.ref.objectId);assert.ok(row,`${c.id}/${o.ref.objectId} is reviewed`);
      assert.equal(o.name,row[3]);assert.equal(o.resourceData?.entityId,row[2]==='—'?undefined:row[2]);
      const coord=row.join(' ').match(/Point\[([\d.]+),([\d.]+)\]/);
      if(coord)assert.deepEqual(o.geometry,{type:'Point',coordinates:[Number(coord[1]),Number(coord[2])]});
      const count=row.join(' ').match(/(\d+)(辆|艘)\/entities\/([a-z\d-]+)/);
      if(count){assert.equal(o.resourceData?.resource.quantity?.value,Number(count[1]));assert.equal(o.resourceData?.resource.quantity?.unit,count[2]);assert.equal(o.resourceData?.resource.quantity?.scope,count[3]);}
    }
    for(const a of features(f)){
      const row=rows.find(r=>r[1]===a.objectId);
      if(!row&&['n01-area','n05-area'].includes(a.objectId)){assert.ok(section.includes(a.objectId)&&section.includes(a.name));continue;}
      assert.ok(row,`${c.id}/${a.objectId} is reviewed`);assert.equal(a.name,row[3]);
      const coord=row.join(' ').match(/Point\[([\d.]+),([\d.]+)\]/);if(coord)assert.deepEqual(a.geometry,{type:'Point',coordinates:[Number(coord[1]),Number(coord[2])]});
    }
  }
});

test('independent geometry oracle verifies interior, boundary, exterior and unusable positions',()=>{
  for(const c of acceptanceCases){
    const f=fixture(c.id);
    for(const g of oracle.byCase[c.id].geometry as GeometryExpected[]??[]){
      const area=features(f).find(o=>o.objectId===g.area);assert.ok(area);
      for(const group of ['interior','boundary','exterior'] as const)for(const id of g[group]){
        const geometry=f.objects.find(o=>o.ref.objectId===id)?.geometry??features(f).find(o=>o.objectId===id)?.geometry;
        assert.ok(geometry);assert.equal(boxClassify(geometry,area.geometry),group,`${c.id}/${id}/${g.area}`);
      }
      for(const id of g.unclassified??[]){const o=object(f,id),p=o.resourceData?.resource.position;assert.ok(!o.geometry||p?.meaning!=='actual'||p?.appliesTo!=='resource');}
    }
  }
});

test('source fact evidence is attached per fact and time shifts with one immutable trial anchor',()=>{
  for(const c of acceptanceCases){
    const f=fixture(c.id),later=buildFixture(c.id,'another-task','2030-03-05T05:06:07.000Z');
    for(const o of f.objects){const r=o.resourceData!.resource;
      for(const fact of [r.quantity,r.availability,r.position,...r.taskRelations??[]])if(fact){
        assert.ok(fact.evidence.some(e=>e.kind==='source'&&JSON.stringify(e.ref)===JSON.stringify(o.ref)&&e.revision===o.revision));
        assert.ok(Date.parse(fact.effectiveAt!)<Date.parse(T0));assert.ok(fact.reportedAt);assert.ok(fact.validUntil);
      }
      const next=object(later,o.ref.objectId);assert.equal(Date.parse(next.effectiveAt!)-Date.parse(o.effectiveAt!),86_400_000);
      for(const relation of next.resourceData!.resource.taskRelations??[])assert.equal(relation.taskId,'another-task');
    }
  }
  assert.throws(()=>buildFixture('N01','task','invalid'));
});

test('N01 and P02 retain terminal business partial; paging requirement is explicit',()=>{
  const f=fixture('N01');assert.equal(f.systems[1].pageLimit,1);assert.deepEqual(f.systems.map(s=>s.coverage.status),['complete','partial']);assert.ok(f.systems[1].coverage.reason);
  assert.equal(f.objects.filter(o=>o.ref.systemId==='n01-qingbu').length,0);assert.equal(f.objects.filter(o=>o.ref.systemId==='n01-liaowan').length,2);
  assert.ok(fixture('P02').systems.every(s=>s.coverage.status==='partial'&&s.coverage.reason));assert.equal(fixture('P04').systems[0].pageLimit,2);
});

test('N02 complete compatible members independently union to five, with readable names and single import',()=>{
  const f=fixture('N02'),groups=f.objects.slice(0,2),members=groups.map(o=>o.resourceData!.coverage!.memberEntityIds!);
  const union=[...new Set(members.flat())],overlap=members[0].filter(id=>members[1].includes(id));
  assert.deepEqual(union,oracle.byCase.N02.members);assert.deepEqual(overlap,oracle.byCase.N02.overlap);assert.equal(union.length,oracle.byCase.N02.quantity);
  assert.deepEqual(union.map(id=>f.objects.find(o=>o.resourceData?.entityId===id)?.name),oracle.byCase.N02.names);
  const keys=f.objects.map(o=>{const r=o.resourceData!.resource,q=r.quantity!;return JSON.stringify([o.ref.systemId,r.category,q.unit,q.meaning,q.scope,q.effectiveAt,q.validUntil,q.conditions]);});assert.equal(new Set(keys).size,1);
  for(const o of groups){assert.equal(o.resourceData!.entityId,undefined);assert.equal(o.resourceData!.coverage!.scope,o.resourceData!.resource.quantity!.scope);assert.ok(o.resourceData!.coverage!.complete);assert.deepEqual(o.properties,{});}
  assert.equal(f.controlledImports.length,1);assert.equal(f.controlledImports[0].sourceRef.objectId,'lq-u');assert.equal(f.objects.length+f.controlledImports.length,oracle.byCase.N02.recordCount);
  assert.equal(acceptanceCase('N02').turns[0].contextRefs?.length,2);assert.equal(acceptanceCase('N03').turns[0].contextRefs?.length,4);
});

test('N03 unknown intersection remains missing, independent boats union exactly five',()=>{
  const f=fixture('N03'),unknown=object(f,'st-unlisted');assert.equal(unknown.resourceData!.coverage!.memberEntityIds,undefined);assert.equal(unknown.resourceData!.coverage!.complete,false);
  const vehicles=f.objects.slice(0,2).map(o=>o.resourceData!.resource.quantity!.value!);
  const expected=oracle.byCase.N03.vehicles as {lower:number;upper:number};assert.equal(Math.max(...vehicles),expected.lower);assert.equal(vehicles.reduce((a,b)=>a+b,0),expected.upper);
  const boats=f.objects.slice(2).flatMap(o=>o.resourceData!.coverage!.memberEntityIds!);assert.equal(new Set(boats).size,5);assert.equal(boats.length,5);
  assert.ok(f.objects.every(o=>o.resourceData!.entityId===undefined&&o.geometry===null&&o.resourceData!.resource.position===undefined));
});

test('N04 expired availability leaves record and relation valid; equal-current opposing facts retained',()=>{
  const f=fixture('N04'),expired=object(f,'jp-expired'),r=expired.resourceData!.resource;
  assert.ok(Date.parse(r.availability!.validUntil!)<Date.parse(T0));assert.ok(Date.parse(expired.validTime!.to!)>Date.parse(T0));assert.ok(Date.parse(r.taskRelations![0].validUntil!)>Date.parse(T0));
  assert.equal(Date.parse(r.availability!.effectiveAt!),Date.parse(T0)-110*60_000);
  const ready=object(f,'jp-dual-ready').resourceData!,fault=object(f,'jp-dual-fault').resourceData!;
  assert.equal(ready.entityId,fault.entityId);assert.equal(ready.resource.availability!.effectiveAt,fault.resource.availability!.effectiveAt);assert.equal(ready.resource.availability!.validUntil,fault.resource.availability!.validUntil);
  assert.deepEqual([ready.resource.availability!.state,fault.resource.availability!.state],['available','unavailable']);
  assert.equal(new Set(f.objects.map(o=>o.resourceData!.entityId)).size,9);assert.equal(f.objects.length,10);
  assert.deepEqual(object(f,'jp-clear').resourceData!.resource.availability!.conditions,[]);assert.equal(f.controlledImports[0].sourceRef.objectId,'jp-clear');
});

test('N05 missing member stays absent and site/estimated coordinates do not repair actual positions',()=>{
  const f=fixture('N05');assert.ok(!f.objects.some(o=>o.resourceData?.entityId==='lt-e81'||o.ref.objectId==='lt-e81'));
  const boat=object(f,'lt-all'),car=object(f,'hk-all');assert.deepEqual(boat.resourceData!.coverage!.memberEntityIds,oracle.byCase.N05.boatMembers);assert.deepEqual(car.resourceData!.coverage!.memberEntityIds,oracle.byCase.N05.vehicleMembers);
  assert.deepEqual(boat.properties,{});assert.deepEqual(car.properties,{});assert.equal(f.objects.filter(o=>o.ref.systemId==='n05-luting'&&o.resourceData?.entityId).length,3);assert.equal(f.objects.filter(o=>o.ref.systemId==='n05-hekai'&&o.resourceData?.entityId).length,4);
  assert.equal(object(f,'lt-est').resourceData!.resource.position!.meaning,'estimated');assert.equal(object(f,'hk-none').geometry,null);
  const times=oracle.byCase.N05.sourceTimeMinutes as Record<string,Record<string,number>>;
  for(const s of f.systems){assert.equal(Date.parse(s.asOf!)-Date.parse(T0),times[s.id].asOf*60_000);for(const o of f.objects.filter(o=>o.ref.systemId===s.id)){const r=o.resourceData!.resource;assert.equal(Date.parse(o.effectiveAt!)-Date.parse(T0),times[s.id].effectiveAt*60_000);for(const fact of [r.quantity,r.position,r.availability,...r.taskRelations??[]])if(fact)assert.equal(Date.parse(fact.reportedAt!)-Date.parse(T0),times[s.id].reportedAt*60_000);}}
});

test('P03/N06 hidden selection only controller-side; N07 comparison has no rescuing choice',()=>{
  for(const id of ['P03','N06'] as const){const c=acceptanceCase(id),f=fixture(id);assert.equal(c.humanFacts.length,1);assert.equal(c.humanFacts[0].objectId,oracle.byCase[id].clarifyRegion);assert.equal(features(f).length,2);assert.equal(features(f)[0].name,features(f)[1].name);assert.ok(c.turns[0].annotationSelections![0].layerIds);assert.equal(c.turns[0].annotationSelections![0].objectIds,undefined);assert.doesNotMatch(JSON.stringify({title:c.taskTitle,goal:c.taskGoal,turns:c.turns}),/西侧|东侧|southwest|n06-east/);}
  assert.deepEqual(acceptanceCase('N07').humanFacts,[]);
});

test('P04 source update uses actual update timestamp without mutating old facts',()=>{
  const f=fixture('P04'),before=JSON.stringify(f),time='2030-03-04T05:12:00.000Z',updated=materializeSourceUpdate(f,time);
  assert.equal(JSON.stringify(f),before);assert.equal(updated.length,4);assert.ok(updated.every(o=>o.revision===2&&o.effectiveAt===time));
  assert.equal(updated[0].name,'雾杉一号车（新牌）');assert.deepEqual(updated[2].geometry,{type:'Point',coordinates:[121.063,31.011]});assert.equal(updated[2].resourceData!.resource.availability!.state,'unavailable');
  assert.deepEqual(f.objects.map(o=>o.name),oracle.byCase.P04.oldNames);assert.equal(f.objects[2].resourceData!.resource.availability!.state,'available');
  assert.throws(()=>materializeSourceUpdate(f,'2029-01-01T00:00:00.000Z'));
});

test('N08 target layer two-turn meanings and positions never include decoy',()=>{
  const f=fixture('N08'),target=f.annotationLayers.find(l=>l.layerId==='n08-target')!;
  assert.deepEqual(target.features.filter(o=>o.resource?.meaning==='actual_resource').map(o=>o.objectId),oracle.byCase.N08.first);assert.deepEqual(target.features.map(o=>o.objectId),oracle.byCase.N08.second);
  for(const a of target.features){assert.equal(a.name,(oracle.byCase.N08.names as Record<string,string>)[a.objectId]);assert.deepEqual(a.geometry,{type:'Point',coordinates:(oracle.byCase.N08.points as Record<string,number[]>)[a.objectId]});}
  assert.deepEqual(acceptanceCase('N08').turns[0].annotationSelections,[{layerIds:['n08-target']}]);assert.equal(acceptanceCase('N08').turns.length,2);
});

test('runtime-visible modules cannot load independent oracle or product summary to derive expected facts',async()=>{
  for(const name of ['cases.ts','fixtures.ts']){const text=await readFile(new URL(name,import.meta.url),'utf8');assert.doesNotMatch(text,/from\s+['"].*(?:oracle|scoring|resource-summary)|readFile|summarizeResources|Date\.now\(/);}
});
