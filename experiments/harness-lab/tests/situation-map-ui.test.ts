import { expect, test } from 'vitest';
import type { ContextCatalog, ContextQueryResult, SituationObject } from '../src/contracts/context';
import { mapFixtures } from '../scripts/mock-context/map-fixtures';
import { mapHref, queryReferences, verifiedReference, messageReferences } from '../src/web/situation/evidence';
import { readSituation, taskQueries } from '../src/web/situation/map-data';
const fixture=mapFixtures('ui','2026-10-11');const road=fixture.objects[0]!;
const envelope=(items:SituationObject[],hasMore=false):ContextQueryResult=>({systemId:'situation',query:{systemId:'situation',mode:'current'},queriedAt:'2026-10-11T01:00:00Z',data:{systemId:'situation',asOf:'2026-10-11T01:00:00Z',items,limit:100,hasMore,nextCursor:hasMore?'page2':null,timeUnknownCount:0,unknownRefs:[],changeCursor:'c'}});
test('only exact observed object and revision links are clickable; report revision is not object revision',()=>{
 const refs=queryReferences(envelope([road]));expect(verifiedReference(mapHref(road.ref,1),refs)?.ref).toEqual(road.ref);
 for(const href of [mapHref(road.ref,2),mapHref({...road.ref,systemId:'other'},1),mapHref(road.ref,1)+'&revision=1',mapHref(road.ref,1)+'#x','https://example.com'+mapHref(road.ref,1)])expect(verifiedReference(href,refs)).toBeUndefined();
 expect(queryReferences(envelope([{...road,geometry:null}]))).toEqual([]);
 const changes={...envelope([]),data:{...envelope([]).data,items:[{cursor:'x',effectiveAt:null,before:road,after:{...road,revision:2}}]}} as ContextQueryResult;
 expect(queryReferences(changes).map(item=>item.revision)).toEqual([1,2]);
 const named={...road,ref:{...road.ref,objectId:'道路:甲'}};expect(verifiedReference(mapHref(named.ref,1),queryReferences(envelope([named])))?.ref).toEqual(named.ref);
 const report={systemId:'intel',query:{systemId:'intel',reportId:'report'},queriedAt:'now',data:{systemId:'intel',asOf:'now',item:{...fixture.reports[0]!,revision:8}}} as ContextQueryResult;
 expect(queryReferences(report)[0]?.revision).toBeUndefined();expect(verifiedReference(mapHref(road.ref,8),queryReferences(report))).toBeUndefined();
 expect(messageReferences([{id:'assistant',role:'assistant',text:JSON.stringify(envelope([road]))}])).toEqual([]);
 expect(messageReferences([{id:'tool',role:'tool',toolName:'situation_query',isError:true,text:JSON.stringify(envelope([road]))}])).toEqual([]);
});
test('task refs and focus areas remain separate queries (union, not intersection)',()=>{
 const catalog:ContextCatalog={systems:[{id:'situation',name:'态势',objectTypes:['road'],capabilities:['situation_current'],areas:[]}]};
 expect(taskQueries(catalog,{businessRefs:[road.ref],focus:{areaIds:['other-area']}})).toEqual([{systemId:'situation',mode:'current',objectRefs:[road.ref]},{systemId:'situation',mode:'current',areaIds:['other-area']}]);
});
test('pagination retries one stale generation without mixing old pages and rejects incomplete cursors',async()=>{
 let calls=0;const result=await readSituation(async params=>{calls++;if(calls===1)return envelope([road],true);if(calls===2)throw Object.assign(new Error('stale'),{code:'CONTEXT_CURSOR_STALE'});expect(params.cursor).toBeUndefined();return envelope([{...road,revision:2}]);},{systemId:'situation',mode:'current'});
 expect(result.items.map(item=>item.revision)).toEqual([2]);expect(calls).toBe(3);
 await expect(readSituation(async()=>({...envelope([road],true),data:{...envelope([road],true).data,nextCursor:null}} as ContextQueryResult),{systemId:'situation',mode:'current'})).rejects.toThrow('分页不完整');
});
