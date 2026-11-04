import { expect, test } from 'vitest';
import type { ContextCatalog, ContextQueryResult, SituationObject } from '../src/contracts/context';
import { mapFixtures } from '../scripts/mock-context/map-fixtures';
import { businessAt, sceneWorld } from '../scripts/mock-context/scenarios/data';
import { mapHref, queryReferences, verifiedReference, messageReferences } from '../src/web/situation/evidence';
import { mergeSituationParts, objectStatus, positionNote, readSituation, resourceTypeLabel, sourceCategory, taskQueries, visibleSourceCategories } from '../src/web/situation/map-data';
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
 expect(taskQueries(catalog,{businessRefs:[{...road.ref,label:'实际运输路线',role:'route'}],focus:{areaIds:['other-area']}})).toEqual([{systemId:'situation',mode:'current',objectRefs:[road.ref]},{systemId:'situation',mode:'current',areaIds:['other-area']}]);
});
test('pagination retries one stale generation without mixing old pages and rejects incomplete cursors',async()=>{
 let calls=0;const result=await readSituation(async params=>{calls++;if(calls===1)return envelope([road],true);if(calls===2)throw Object.assign(new Error('stale'),{code:'CONTEXT_CURSOR_STALE'});expect(params.cursor).toBeUndefined();return envelope([{...road,revision:2}]);},{systemId:'situation',mode:'current'});
 expect(result.items.map(item=>item.revision)).toEqual([2]);expect(calls).toBe(3);
 await expect(readSituation(async()=>({...envelope([road],true),data:{...envelope([road],true).data,nextCursor:null}} as ContextQueryResult),{systemId:'situation',mode:'current'})).rejects.toThrow('分页不完整');
});
test('scene snapshots survive pagination and reject a mixed revision or silent stale-cursor restart',async()=>{
 const clock={instanceId:'run-map',businessNow:businessAt('09:10'),revision:1};
 const page=(hasMore=false,revision=1):ContextQueryResult=>{const result=envelope([road],hasMore);return {...result,data:{...result.data,snapshotClock:{...clock,revision}}};};
 let calls=0;const result=await readSituation(async()=>page(++calls===1),{systemId:'situation',mode:'current'});
 expect(result.snapshotClock).toEqual(clock);expect(result.items).toHaveLength(2);
 calls=0;await expect(readSituation(async()=>page(++calls===1,calls),{systemId:'situation',mode:'current'})).rejects.toThrow('场景在查询期间已推进');
 calls=0;await expect(readSituation(async()=>{if(++calls===1)return page(true);throw Object.assign(new Error('stale'),{code:'CONTEXT_CURSOR_STALE'});},{systemId:'situation',mode:'current'})).rejects.toThrow('场景在查询期间已推进');expect(calls).toBe(2);
 expect(mergeSituationParts([result,result]).snapshotClock).toEqual(clock);
 expect(()=>mergeSituationParts([result,{...result,snapshotClock:{...clock,revision:2}}])).toThrow('场景在查询期间已推进');
 expect(()=>mergeSituationParts([result,{...result,snapshotClock:undefined}])).toThrow('场景在查询期间已推进');
});
test('explicit scene resource fields group all vehicles and preserve source declarations against business time',()=>{
 const objects=sceneWorld('map-test').objects;
 expect(Object.fromEntries(visibleSourceCategories(objects).map(([kind])=>[kind,objects.filter(item=>sourceCategory(item)===kind).length]))).toEqual({road:6,vehicle:24,facility:9,hydrant:8,area:6});
 const vehicles=objects.filter(item=>sourceCategory(item)==='vehicle');
 expect(vehicles.filter(item=>objectStatus(item,businessAt('09:10'))==='来源声明可用')).toHaveLength(17);
 expect(vehicles.filter(item=>objectStatus(item,businessAt('09:10'))==='来源声明不可用')).toHaveLength(5);
 expect(vehicles.filter(item=>objectStatus(item,businessAt('09:10'))==='来源声明：状态待确认')).toHaveLength(2);
 const old=vehicles.find(item=>item.ref.objectId.endsWith('-V24'))!;
 expect(positionNote(old,businessAt('09:10'))).toBe('最后记录08:50，当前位置待确认');expect(old.geometry?.type).toBe('Point');expect(resourceTypeLabel(old)).toBe('泡沫车');
 const maintenance=vehicles.find(item=>item.ref.objectId.endsWith('-V04'))!;
 expect(objectStatus(maintenance,businessAt('09:10'))).toBe('来源声明不可用');expect(objectStatus(maintenance,businessAt('11:01'))).toContain('待确认');
 expect(objectStatus({...old,properties:{availableCount:4,unit:'辆'}})).toBe('可用车辆 4 辆');
 expect(sourceCategory({...old,resourceData:undefined,name:'专业救援车'})).toBe('resource');
});
