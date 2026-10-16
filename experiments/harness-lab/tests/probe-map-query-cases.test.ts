import {rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {diagnosticParams, prepareCase, queryCaseLayers, queryCases} from '../scripts/probe-map-query-cases.js';
import {projectionLayers, readonlyCases} from '../scripts/probe-map-result-projection.js';
import {mapTrialRequest, startMapTrial} from '../scripts/probe-situation-map.js';
import type {AnnotationComparison, AnnotationReadResult, AnnotationVersion} from '../src/contracts/annotations.js';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks();});
const allObjects=(version:AnnotationVersion)=>version.document.layers.flatMap(layer=>layer.features);

async function freePort() {
  const server=createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('No test listener address');
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return address.port;
}

describe('frozen map query acceptance cases',()=>{
  it('preserves the original questions and changes only layer order in the independent G02 variant',()=>{
    expect(queryCases.slice(0,3).map(({id,prompt})=>({id,prompt}))).toEqual(readonlyCases);
    expect(queryCases.find(item=>item.id==='G02-order')?.prompt).toBe(readonlyCases[1].prompt);
    expect(queryCases.filter(item=>item.paired).map(item=>item.id)).toEqual(['G02-order','H01','H02','Q01','Q02']);
    for(const id of ['G01','G02','G03'] as const)expect(queryCaseLayers(id)).toEqual(projectionLayers());
    const original=projectionLayers(), reordered=queryCaseLayers('G02-order');
    expect(reordered.map(item=>[item.layerId,item.order])).toEqual([['repair',0],['storage',1]]);
    for(const item of reordered)expect({...item,order:original.find(l=>l.layerId===item.layerId)!.order}).toEqual(original.find(l=>l.layerId===item.layerId));
    expect(reordered.flatMap(l=>l.features).slice(3,5).map(f=>f.name)).toEqual(['南仓','河畔仓']);
    expect(reordered.find(l=>l.layerId==='storage')!.features.slice(3,5).map(f=>f.name)).toEqual(['东仓','山脚仓']);
    reordered[1].features[0].name='mutated outside fixture';
    expect(queryCaseLayers('G02-order')[1].features[0].name).toBe('北仓');
  });

  it('requires real business attributes for H01 and includes in-progress work in the incomplete group',()=>{
    const layers=queryCaseLayers('H01');
    const groups=layers.map(layer=>({name:layer.name,objects:layer.features.filter(f=>f.attributes?.area==='东片区'&&f.attributes?.inspectionStatus!=='已完成')}));
    expect(layers.flatMap(l=>l.features)).toHaveLength(7);
    expect(groups.map(g=>[g.name,g.objects.map(f=>f.name)])).toEqual([['桥梁',['河口桥']],['泵站',['一号泵站','二号泵站']]]);
    expect(groups.reduce((sum,g)=>sum+g.objects.length,0)).toBe(3);
    expect(groups[1].objects[0].attributes?.inspectionStatus).toBe('进行中');
    expect(layers.flatMap(l=>l.features).every(f=>f.geometry&&f.attributes)).toBe(true);
  });

  it('keeps H03 actual empty notes distinct from omitted fields and unrelated objects',()=>{
    const layers=queryCaseLayers('H03');
    expect(layers.map(l=>l.features.length)).toEqual([3,1]);
    expect(layers[0].features.map(f=>f.note)).toEqual(['已清点，运输时间待确认','','入口需与现场协调']);
    expect(Object.hasOwn(layers[0].features[1],'note')).toBe(true);
    expect(layers.flatMap(l=>l.features).every(f=>f.geometry)).toBe(true);
    expect(layers[1].features[0].note).toBeTruthy();
  });

  it('fixes diagnostic parameters without supplying expected counts or hidden fields to the model',()=>{
    expect(diagnosticParams('Q01')).toEqual({mode:'draft',layerIds:['repair'],offset:0,limit:50});
    expect(diagnosticParams('Q02')).toEqual({mode:'draft',layerIds:['storage'],offset:3,limit:2});
    expect(diagnosticParams('Q03')).toEqual({mode:'draft',objectIds:['storage-1'],fields:['style']});
    expect(diagnosticParams('G01')).toBeUndefined();
    const original=queryCaseLayers('Q03')[0].features[0];
    expect(original.note).toBeTruthy();expect(original.geometry).toBeTruthy();
    const params=diagnosticParams('Q03')!;params.fields!.push('note');
    expect(diagnosticParams('Q03')!.fields).toEqual(['style']);
  });

  it('prepares actual H02 publications/current and Q boundaries over authenticated HTTP without provider calls',async()=>{
    const fetch=globalThis.fetch;
    vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(url.hostname!=='127.0.0.1')throw new Error('Fixture preparation attempted external access');
      return fetch(input,init);
    });
    const trial=await startMapTrial(await freePort(),{...process.env,LLM_API_KEY:'',LAB_EXECUTION_ENABLED:'false',LAB_PUBLIC_ORIGIN:undefined,LAB_LISTEN_HOST:'127.0.0.1'},false);
    cleanup.push(async()=>{await trial.stop();await rm(trial.manifest.dataDir,{recursive:true,force:true});});
    const prepared=await prepareCase(trial.manifest,'H02');
    const history=prepared.evaluator.history!;
    expect(prepared.before.publications).toHaveLength(2);
    expect(prepared.before.binding.draft?.headRevision).toBe(5);
    expect(prepared.before.version).toEqual(history.latest);
    for(const version of Object.values(history))expect(allObjects(version)).toHaveLength(3);
    expect(Object.values(history).map(version=>allObjects(version).find(f=>f.objectId==='route')!.note))
      .toEqual(['可通行','临时封闭','限速通行','待复查']);
    expect(Object.values(history).map(version=>allObjects(version).find(f=>f.objectId==='assembly')!.geometry))
      .toEqual([[103.8,1.3],[103.8,1.3],[103.81,1.31],[103.82,1.32]].map(coordinates=>({type:'Point',coordinates})));
    for(const version of Object.values(history))expect(allObjects(version).find(f=>f.objectId==='observation'))
      .toEqual(allObjects(history.morning).find(f=>f.objectId==='observation'));
    expect(history.morning.ref).toEqual({publicationId:prepared.before.current.publication?.publicationId});
    expect(history.handover.ref).not.toEqual(history.morning.ref);
    expect(prepared.before.publications.find(p=>p.metadata.title==='晨检记录')?.version).toEqual(history.morning);
    expect(prepared.before.publications.find(p=>p.metadata.title==='交接记录')?.version).toEqual(history.handover);
    const comparison=await mapTrialRequest<AnnotationComparison>(trial.manifest,`/api/tasks/${trial.manifest.tasks.supply}/annotations/compare`,'planning','POST',{left:history.morning.ref,right:history.handover.ref});
    expect(comparison.counts).toEqual({added:0,removed:0,changed:2});
    expect(comparison.changes.items.map(c=>c.id).sort()).toEqual(['assembly','route']);

    // Reusing a server here tests preparation isolation, not a live-model batch.
    const diagnostic=await prepareCase(trial.manifest,'Q03');
    expect(diagnostic.sessionId).not.toBe(prepared.sessionId);
    for(const id of ['Q01','Q02','Q03'] as const) {
      const params=diagnosticParams(id)!;
      const {mode,...selection}=params;
      expect(mode).toBe('draft');
      const read=await mapTrialRequest<AnnotationReadResult>(trial.manifest,`/api/tasks/${trial.manifest.tasks.supply}/annotations/read`,'planning','POST',{ref:diagnostic.before.version!.ref,...selection});
      if(id==='Q01')expect(read.objects).toMatchObject({total:2,offset:0,hasMore:false});
      if(id==='Q02') {
        expect(read.objects).toMatchObject({total:5,offset:3,limit:2,hasMore:false});
        expect(read.objects.items.map(f=>f.name)).toEqual(['东仓','山脚仓']);
      }
      if(id==='Q03') {
        expect(read.objects.items).toHaveLength(1);
        expect(read.objects.items[0].style).toEqual(queryCaseLayers('Q03')[0].features[0].style);
        expect(read.objects.items[0]).not.toHaveProperty('note');
        expect(read.objects.items[0]).not.toHaveProperty('geometry');
      }
    }
    expect(await mapTrialRequest(trial.manifest,'/api/activity')).toMatchObject({sessions:[]});
  },60_000);
});
