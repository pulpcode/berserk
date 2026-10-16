import {describe,expect,it} from 'vitest';
import type {PublicMessage} from '../src/contracts/index';
import {projectionLayers,projectionOptions,readonlyCases,scopeObservations} from '../scripts/probe-map-result-projection';

describe('readonly result projection probe',()=>{
  it('fixes three independent readonly inputs and rejects retries/case selection',()=>{
    expect(readonlyCases.map(c=>c.id)).toEqual(['G01','G02','G03']);
    expect(projectionOptions(['--prepare-only','--port','4372'])).toEqual({prepareOnly:true,port:4372});
    for(const args of [['--retry'],['--runs','2'],['--case','G01'],['--port','80']])expect(()=>projectionOptions(args)).toThrow();
    const layers=projectionLayers();expect(layers.map(l=>l.features.length)).toEqual([5,2]);
    expect(layers.flatMap(l=>l.features).every(f=>f.note&&f.geometry&&f.style)).toBe(true);
  });
  it('does not mistake old/error/malformed results or unpaged reads for boundary coverage',()=>{
    const message=(data:unknown,extra:Partial<PublicMessage>={}):PublicMessage=>({id:'t',role:'tool',toolName:'annotation_read',text:JSON.stringify(data),...extra});
    const page={query:{layerIds:['storage']},objects:{items:[],offset:3,limit:2,total:5,hasMore:false}};
    const wrapped={format:'annotation.model-result.v1',data:page};
    expect(scopeObservations([message(wrapped)]).partialLastPageObserved).toBe(true);
    for(const item of [message(page),message(wrapped,{isError:true}),message(wrapped,{resultMissing:true}),message(wrapped,{role:'assistant'}),message({...wrapped,data:{...page,objects:{...page.objects,offset:0}}})])expect(scopeObservations([item]).partialLastPageObserved).toBe(false);
    expect(scopeObservations([message(wrapped)]).semanticReview).toBe('pending_review');
    expect(scopeObservations([message(wrapped,{toolName:'annotation_action',isError:true})]).writeToolAttempted).toBe(true);
  });
});
