import { afterEach, expect, it } from 'vitest';
import { createMockContextServer } from '../scripts/mock-context/server.js';
import { ContextService } from '../src/context/service.js';
import { loadComposerContext, validLoadedContext } from '../src/context/composer.js';
import { composerInputText, decodeComposerInput } from '../src/pi/composer-input.js';
import { randomUUID } from 'node:crypto';
const cleanup: Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function setup(){
  const mock=createMockContextServer({token:'query-token'});const url=await mock.listen();cleanup.push(()=>mock.close());
  const service=new ContextService({systems:[{id:'situation',name:'态势',adapter:'mock-situation-http',baseUrl:`${url}/situation`,tokenEnv:'TOKEN'}],scopes:[{id:'scope',name:'资料',systemIds:['situation'],seatIds:['a']}]},{TOKEN:'query-token'});
  return {service,mock};
}
const ref={systemId:'situation',objectType:'road',objectId:'road-west-01'};
it('loads explicit refs only, deduplicates, and stores actual query data in compatible native composer input',async()=>{
  const {service,mock}=await setup();const context=await loadComposerContext([ref,ref],service,{kind:'seat',seatId:'a'});
  expect(context?.refs).toEqual([ref]);expect(context?.queries).toHaveLength(1);expect(validLoadedContext(context)).toBe(true);expect(mock.requests).toHaveLength(1);
  const workspaceId=randomUUID(),sessionId=randomUUID(),record={workspaceId,sessionId,requestId:randomUUID(),context};
  expect(decodeComposerInput(record,workspaceId,sessionId)).toEqual(record);
  expect(composerInputText({context})).toContain('发送时加载');
  const forged=structuredClone(context!);forged.queries[0]!.mapReferences=[{ref,href:'/evil'}];expect(validLoadedContext(forged)).toBe(false);
  const alteredQuery=structuredClone(context!);alteredQuery.queries[0]!.query={systemId:'situation',mode:'current',limit:100};expect(validLoadedContext(alteredQuery)).toBe(false);
  const alteredTime=structuredClone(context!);alteredTime.queries[0]!.queriedAt='2026-10-11';expect(validLoadedContext(alteredTime)).toBe(false);
});
it('denies scope escalation, missing objects and invalid reference payload before model use',async()=>{
  const {service,mock}=await setup();await expect(loadComposerContext([ref],service,{kind:'seat',seatId:'other'})).rejects.toMatchObject({code:'CONTEXT_FORBIDDEN'});expect(mock.requests).toHaveLength(0);
  await expect(loadComposerContext([{...ref,objectId:'missing'}],service,{kind:'seat',seatId:'a'})).rejects.toMatchObject({code:'CONTEXT_REFERENCE_MISSING'});
  await expect(loadComposerContext([{...ref,scope:'anything'}],service,{kind:'seat',seatId:'a'})).rejects.toThrow();
  await expect(loadComposerContext(Array(21).fill(ref),service,{kind:'seat',seatId:'a'})).rejects.toThrow();
  const abort=new AbortController();abort.abort();await expect(loadComposerContext([ref],service,{kind:'seat',seatId:'a'},abort.signal)).rejects.toThrow();
});
it('loads data before the actual Pi model request and reopens native history without requerying',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {PiLab}=await import('../src/pi/lab.js');const {fakeRuntime,testConfig}=await import('./pi/fake-runtime.js');
  const {service,mock}=await setup();const dir=await mkdtemp(join(tmpdir(),'axon-map-native-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
  const config=testConfig(dir,{seatId:'a'}),fake=await fakeRuntime(config,()=>({text:'根据所选资料回答'}));
  const lab=await PiLab.create(config,fake.runtime);lab.context=service;cleanup.push(()=>lab.close());const session=await lab.createSession();
  await lab.start(session.id,'这条道路情况如何？',{contextRefs:[ref]}).run(()=>{});
  const snapshot=lab.get(session.id);expect(snapshot.lastResult?.status).toBe('succeeded');expect(fake.calls).toHaveLength(1);
  expect(JSON.stringify(fake.calls[0]!.context.messages)).toContain('发送时加载');
  expect(snapshot.messages[0]?.selections?.context?.refs).toEqual([ref]);expect(snapshot.messages.some(message=>message.role==='tool')).toBe(false);
  const count=mock.requests.length;await lab.close();
  const next=await PiLab.create(config,(await fakeRuntime(config,()=>({text:'继续'}))).runtime);cleanup.push(()=>next.close());
  expect(next.get(session.id).messages).toEqual(snapshot.messages);expect(mock.requests.length).toBe(count);
  next.context=service;await next.start(session.id,'读取不存在的对象',{contextRefs:[{...ref,objectId:'missing'}]}).run(()=>{});
  expect(next.get(session.id).lastResult?.status).toBe('failed');
});
it('derives only source-backed spatial links, keeping report revisions separate from object revisions',async()=>{
 const {mapReferences}=await import('../src/context/map-references.js');
 const {service}=await setup();const result=await service.query('situation_query',{systemId:'situation',mode:'current',objectRefs:[ref]},{kind:'seat',seatId:'a'});
 const current=result.data as import('../src/contracts/context.js').SituationCurrent;
 expect(mapReferences(current)).toEqual([]);
 current.items[0]!.geometry={type:'LineString',coordinates:[[110,30],[110.1,30.1]]};
 expect(mapReferences(current)).toEqual([{ref,revision:current.items[0]!.revision,href:`/situation?systemId=situation&objectType=road&objectId=road-west-01&revision=${current.items[0]!.revision}`}]);
 const report:import('../src/contracts/context.js').InformationDetail={systemId:'intel',asOf:result.queriedAt,item:{reportId:'report',subjectId:'subject',revision:99,title:'报告',summary:'摘要',content:'正文',objectRefs:[ref],areaIds:[],observedAt:null,publishedAt:null,validTime:null}};
 expect(mapReferences(report)).toEqual([{ref,href:'/situation?systemId=situation&objectType=road&objectId=road-west-01'}]);
});
