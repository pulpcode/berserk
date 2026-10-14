import {describe,expect,it} from 'vitest';
import {parseOptions,removeTargetGeometry} from '../scripts/probe-source-annotations.js';

describe('isolated source annotation probe',()=>{
  it('bounds live batches and rejects unrecognized options',()=>{
    expect(parseOptions([])).toEqual({runs:3,port:4339,cases:'all',prepareOnly:false});
    expect(parseOptions(['--runs','1','--cases','special','--port','4341','--prepare-only'])).toEqual({runs:1,port:4341,cases:'special',prepareOnly:true});
    for(const args of [['--runs','0'],['--runs','4'],['--port','0'],['--port','65536'],['--cases','retry'],['--approve-all']])expect(()=>parseOptions(args)).toThrow();
  });
  it('fault injection removes geometry only from the chosen source object without changing original evidence',()=>{
    const body={asOf:'2026-10-14T00:00:00Z',items:[
      {ref:{objectId:'west'},revision:3,geometry:{type:'Polygon',coordinates:[]}},
      {ref:{objectId:'east'},revision:2,geometry:{type:'Point',coordinates:[1,2]}},
    ]};
    const original=structuredClone(body);
    expect(removeTargetGeometry(body,'west')).toEqual({...body,items:[{ref:{objectId:'west'},revision:3},body.items[1]]});
    expect(body).toEqual(original);
    expect(removeTargetGeometry({error:'unavailable'},'west')).toEqual({error:'unavailable'});
    expect(removeTargetGeometry(null,'west')).toBeNull();
  });
});
