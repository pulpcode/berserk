import { describe, expect, it, vi } from 'vitest';
import { ContextService } from '../src/context/service.js';
import { RequestError } from '../src/contracts/errors.js';
import type { ContextPrincipal } from '../src/contracts/context.js';

const owner='run-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='run-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clock={instanceId:owner,businessNow:'2026-11-03T09:10:00+08:00',revision:1};
const principal:ContextPrincipal={kind:'seat',seatId:'overall',scenarioInstanceId:owner};
function setup(responseOwner=owner, clocked=true, after?:()=>void) {
  let header:string|null=null;
  const transport=vi.fn<typeof fetch>(async (_input,init)=>{
    header=new Headers(init?.headers).get('x-axon-scenario-instance');
    after?.();
    return Response.json({systemId:'intel',asOf:clock.businessNow,items:[],limit:20,nextCursor:null,hasMore:false,timeUnknownCount:0,
      ...(clocked?{snapshotClock:{...clock,instanceId:responseOwner}}:{})});
  });
  const service=new ContextService({systems:[{id:'intel',name:'特情',adapter:'mock-information-http',baseUrl:'http://localhost:9000/intel',tokenEnv:'SOURCE_TOKEN',...(clocked?{scenarioClock:true}:{})}],scopes:[{id:'all',name:'资料',systemIds:['intel'],seatIds:['overall']}]},{SOURCE_TOKEN:'synthetic-token'},{fetch:transport});
  return {service,transport,header:()=>header};
}

describe('host-pinned scenario queries',()=>{
  it('pins the captured owner in HTTP metadata without adding a model-selectable parameter',async()=>{
    const {service,transport,header}=setup();
    const assertWritable=vi.fn();service.scenario={assertWritable};
    const result=await service.query('information_search',{systemId:'intel'},principal);
    expect(header()).toBe(owner);
    expect(result.query).toEqual({systemId:'intel',limit:20});
    expect(assertWritable.mock.calls).toEqual([[owner],[owner]]);
    await expect(service.query('information_search',{systemId:'intel',scenarioInstanceId:other},principal)).rejects.toMatchObject({code:'CONTEXT_INVALID_ARGUMENT'});
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a successful HTTP response that carries another owner',async()=>{
    const {service}=setup(other);
    await expect(service.query('information_search',{systemId:'intel'},principal)).rejects.toMatchObject({code:'CONTEXT_TIME_BASIS_CONFLICT'});
  });
  it('does not expose a response arriving after the original scope closes',async()=>{
    let writable=true;
    const {service,transport}=setup(owner,true,()=>{writable=false;});
    service.scenario={assertWritable:()=>{if(!writable)throw new RequestError('TASK_READ_ONLY','资料只读。',409);}};
    await expect(service.query('information_search',{systemId:'intel'},principal)).rejects.toMatchObject({code:'TASK_READ_ONLY'});
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(service.query('information_search',{systemId:'intel'},principal)).rejects.toMatchObject({code:'TASK_READ_ONLY'});
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('keeps ordinary sources on their existing protocol',async()=>{
    const {service,header}=setup(owner,false);
    await service.query('information_search',{systemId:'intel'},{kind:'seat',seatId:'overall'});
    expect(header()).toBeNull();
  });
});
