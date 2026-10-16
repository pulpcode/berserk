import { Worker } from 'node:worker_threads';
import { RequestError } from '../contracts/errors.js';
import { LIMITS, spatialError } from './validation.js';
import type { Calculation } from './calculation.js';
import type { SpatialResult } from '../contracts/spatial.js';
let activeWorkers=0;
/** One bounded calculation, no queue or durable runtime. TSX is the application's existing source runtime. */
export async function runCalculation(payload:Calculation,signal:AbortSignal):Promise<SpatialResult> {
  signal.throwIfAborted();
  if(activeWorkers>=4) throw spatialError('BUSY','当前已有 4 项空间计算，请稍后重新分析。');
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');
    import('tsx/esm/api').then(({tsImport})=>tsImport(workerData.module,workerData.parent))
      .then(m=>m.run(workerData.payload))
      .then(value=>parentPort.postMessage({value}),error=>parentPort.postMessage({error:{code:error.code||'SPATIAL_CALCULATION_FAILED',message:error.message||'空间计算失败。'}}));`,
    {eval:true,workerData:{module:new URL('./calculation.ts',import.meta.url).href,parent:import.meta.url,payload},resourceLimits:{maxOldGenerationSizeMb:128}});
  activeWorkers++;
  return await new Promise<SpatialResult>((resolve,reject)=>{
    let settled=false;
    const finish=(error?:unknown,value?:SpatialResult)=>{
      if(settled) return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      // Settle cancellation only after the worker actually stops executing synchronous geometry code.
      void worker.terminate().then(()=>{activeWorkers--;if(error) reject(error);else resolve(value!);},failure=>{activeWorkers--;reject(failure);});
    };
    const abort=()=>finish(signal.reason??spatialError('CANCELLED','分析已取消。'));
    const timer=setTimeout(()=>finish(spatialError('LIMIT','计算超过 3 秒预算，计算线程已终止；未输出部分结论。')),LIMITS.milliseconds);
    worker.once('message',(message:{value?:SpatialResult;error?:{code:string;message:string}})=>finish(message.error?new RequestError(message.error.code,message.error.message):undefined,message.value));
    worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(spatialError('CALCULATION_FAILED',`计算线程提前退出 (${code})。`));});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
