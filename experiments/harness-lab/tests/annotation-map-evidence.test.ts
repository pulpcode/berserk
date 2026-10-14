import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceMapLinks } from '../src/web/situation/MapContext';
import { expect, test } from 'vitest';
import type { PublicMessage } from '../src/contracts';
import { annotationMapEntries, messageReferences, requestMapEvidence } from '../src/web/situation/evidence';
const setId='00000000-0000-4000-8000-000000000001';
const publicationId='00000000-0000-4000-8000-000000000002';
const receipt={clientActionId:'00000000-0000-4000-8000-000000000003',taskId:'00000000-0000-4000-8000-000000000004',committedAt:'2026-10-14T01:00:00Z',action:'apply',ref:{setId,revision:2}};
const message=(value:unknown,fields:Partial<PublicMessage>={}):PublicMessage=>({id:'tool',requestId:'request-a',role:'tool',toolName:'annotation_action',text:JSON.stringify(value),...fields});
test('fixed targets merge duplicate objects by version, preserving legacy whole versions and publications',()=>{
 const messages=[message({...receipt,objectIds:['a','b']}),message({...receipt,objectIds:['b','c']}),message({...receipt,ref:{setId,revision:3},objectIds:['a']}),message({...receipt,action:'publish',ref:{publicationId}})];
 expect(annotationMapEntries(messages)).toEqual([
  {selection:{setId,revision:2,objectIds:['a','b','c']},original:false,publication:false},
  {selection:{setId,revision:3,objectIds:['a']},original:false,publication:false},
  {selection:{publicationId},original:false,publication:true},
 ]);
 expect(annotationMapEntries([...messages,message(receipt)])[0]?.selection).toEqual({setId,revision:2});
});
test('legacy single source and batch source receipts project exact object selections',()=>{
 const fromSource={mode:'add',objectId:'legacy',layerId:'points',sourceRef:{systemId:'situation',objectType:'road',objectId:'road'},sourceRevision:1,queriedAt:'2026-10-14T01:00:00Z'};
 expect(annotationMapEntries([message({...receipt,action:'from_source',fromSource},{toolName:'annotation_from_source'})])[0]?.selection).toEqual({setId,revision:2,objectIds:['legacy']});
 expect(annotationMapEntries([message({...receipt,action:'from_source',fromSources:[{...fromSource,objectId:'a'},{...fromSource,objectId:'b'}]},{toolName:'annotation_from_source'})])[0]?.selection.objectIds).toEqual(['a','b']);
});
test('receipt queries and replayed results are explicitly original actions, never new writes',()=>{
 expect(annotationMapEntries([message(receipt,{toolName:'annotation_read'})])[0]?.original).toBe(true);
 expect(annotationMapEntries([message({...receipt,replayed:true})])[0]?.original).toBe(true);
 expect(annotationMapEntries([message({ref:receipt.ref,objects:[]},{toolName:'annotation_read'})])).toEqual([]);
});
test('malformed, missing and error payloads cannot manufacture successful map writes',()=>{
 const malformed=[null,{}, {...receipt,clientActionId:'bad'}, {...receipt,committedAt:'bad'}, {...receipt,action:'unknown'}, {...receipt,ref:{setId,revision:0}}, {...receipt,ref:{setId,revision:2,publicationId}}, {...receipt,afterRef:{setId,revision:3}}, {...receipt,objectIds:[1]}, {...receipt,objectIds:Array.from({length:501},(_,i)=>String(i))}, {...receipt,action:'publish'}, {...receipt,replayed:'true'}, {...receipt,action:'from_source',fromSources:[]}];
 for(const value of malformed)expect(annotationMapEntries([message(value)])).toEqual([]);
 for(const flags of [{isError:true},{resultMissing:true as const},{role:'assistant' as const},{toolName:'situation_query'}])expect(annotationMapEntries([message(receipt,flags)])).toEqual([]);
 expect(messageReferences([message({data:{items:[null,1,{after:null}]}},{toolName:'situation_query'})])).toEqual([]);
});
test('final answer collects only its own request; missing request IDs never borrow history',()=>{
 const first=message(receipt), second=message({...receipt,ref:{setId,revision:3}},{requestId:'request-b'});
 const answer:PublicMessage={id:'answer',role:'assistant',requestId:'request-b',text:'已完成'};
 expect(requestMapEvidence(answer,[first,second])).toEqual([second]);
 expect(requestMapEvidence({...answer,requestId:undefined},[first,second])).toEqual([]);
 expect(annotationMapEntries(requestMapEvidence(answer,[first]))).toEqual([]);
});

test('many results collapse into bounded accessible disclosure; old receipts retain their label',()=>{
 const messages=Array.from({length:104},(_,i)=>message({...receipt,ref:{setId,revision:i+1}}));
 const html=renderToStaticMarkup(createElement(EvidenceMapLinks,{messages}));
 expect(html).toContain('<summary>另有 101 个地图入口</summary>');
 expect(html.match(/<button/g)).toHaveLength(100);
 expect(html).toContain('仅显示前 100 个入口');
 expect(html).not.toContain('<details class="evidence-map-more" open');
 const old=renderToStaticMarkup(createElement(EvidenceMapLinks,{messages:[message(receipt,{toolName:'annotation_read'})]}));
 expect(old).toContain('查看原动作结果');expect(old).not.toContain('查看本次标注');
});
