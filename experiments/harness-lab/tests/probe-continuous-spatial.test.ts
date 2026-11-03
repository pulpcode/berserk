import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { createSpatialFixtureSource } from '../scripts/continuous-spatial-source.js';
import { ContextService } from '../src/context/service.js';
import type { InformationReport, SituationObject, SituationCurrent, SituationChanges } from '../src/contracts/context.js';

const fixture = JSON.parse(await readFile(new URL('../../../.trellis/tasks/10-26-continuous-background-analysis/research/spatial-multi-task-input.json',import.meta.url),'utf8')) as {
  objects:SituationObject[];steps:Array<{round:number;businessTime:string;objects?:SituationObject[];report?:InformationReport}>;
};
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function setup() {
  const source=createSpatialFixtureSource('fixture-query-only',fixture.objects);cleanup.push(()=>source.close());
  const url=await source.listen();
  const context=new ContextService({systems:[{id:'intel',name:'报告',adapter:'mock-information-http',baseUrl:`${url}/intel`,tokenEnv:'TOKEN'},
    {id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${url}/situation`,tokenEnv:'TOKEN'}],
    scopes:[{id:'test-scope',name:'隔离',systemIds:['intel','situation'],seatIds:['viewer']}]},{TOKEN:'fixture-query-only'});
  const principal={kind:'service' as const,profileId:'probe',jobId:'probe-job',scope:{scopeId:'test-scope',systemIds:['intel','situation']}};
  return {source,context,principal,url};
}
it('serves all fixed geometry over authenticated HTTP pages and detects stale pagination',async()=>{
  const {source,context,principal,url}=await setup();source.apply(fixture.steps[0]);
  const first=await context.query('situation_query',{systemId:'situation',mode:'current',limit:1},principal);
  const page=first.data as SituationCurrent;expect(page.items).toHaveLength(1);expect(page.hasMore).toBe(true);
  const seen=[...page.items];let cursor=page.nextCursor;
  while(cursor){const next=(await context.query('situation_query',{systemId:'situation',mode:'current',limit:1,cursor},principal)).data as SituationCurrent;seen.push(...next.items);cursor=next.nextCursor;}
  expect(new Set(seen.map(item=>item.ref.objectId)).size).toBe(4);
  expect(seen.find(item=>item.ref.objectId==='r2')!.geometry).toEqual({type:'LineString',coordinates:[[119.99,30.04],[120.03,30.04]]});
  source.apply(fixture.steps[1]);
  await expect(context.query('situation_query',{systemId:'situation',mode:'current',limit:1,cursor:page.nextCursor!},principal)).rejects.toThrow();
  expect((await fetch(`${url}/situation/objects`)).status).toBe(401);
});
it('preserves report revisions and source geometry after late forwarded input',async()=>{
  const {source,context,principal}=await setup();
  for(const step of fixture.steps.filter(s=>s.round<=7)) source.apply(step);
  const latest=await context.query('information_read',{systemId:'intel',reportId:'zone-notice'},principal);
  expect('item' in latest.data && latest.data.item.revision).toBe(5);
  const previous=await context.query('information_read',{systemId:'intel',reportId:'zone-notice',revision:2},principal);
  expect('item' in previous.data && previous.data.item.revision).toBe(2);
  expect('item' in previous.data && previous.data.item.objectRefs).toEqual([{systemId:'situation',objectType:'area',objectId:'zone-z'}]);
  const zone=(await context.query('situation_query',{systemId:'situation',mode:'current',objectRefs:[{systemId:'situation',objectType:'area',objectId:'zone-z'}]},principal)).data as SituationCurrent;
  expect(zone.items[0].revision).toBe(3);
  expect(source.snapshot().reports).toHaveLength(5);
});
it('keeps missing geometry distinct from no match and retains a usable change cursor',async()=>{
  const {source,context,principal}=await setup();source.apply(fixture.steps[0]);
  const initial=(await context.query('situation_query',{systemId:'situation',mode:'current'},principal)).data as SituationCurrent;
  for(const step of fixture.steps.filter(s=>s.round>0&&s.round<=11))source.apply(step);
  const current=(await context.query('situation_query',{systemId:'situation',mode:'current',objectRefs:[{systemId:'situation',objectType:'area',objectId:'zone-z'}]},principal)).data as SituationCurrent;
  expect(current.items).toHaveLength(1);expect(current.items[0].geometry).toBeNull();expect(current.unknownRefs).toEqual([]);
  const changes=(await context.query('situation_query',{systemId:'situation',mode:'changes',after:initial.changeCursor},principal)).data as SituationChanges;
  expect(changes.items.map(c=>c.after.revision)).toEqual([2,3,4]);
  source.apply(fixture.steps[12]);
  const restored=(await context.query('situation_query',{systemId:'situation',mode:'changes',after:changes.nextAfter!},principal)).data as SituationChanges;
  expect(restored.items).toHaveLength(1);expect(restored.items[0].after.revision).toBe(5);
});
