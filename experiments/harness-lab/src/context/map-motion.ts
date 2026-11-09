import type { MapMotion, Position } from '../contracts/context.js';
import { contextInteger, contextRecord, contextRef, contextText, contextTimestamp } from './validation.js';

/** Decode optional display metadata separately from ordinary Agent query evidence. */
export function decodeMapMotion(value:unknown):MapMotion {
  const r=contextRecord(value,['serverNow','businessNow','progress','vehicles'],['serverNow','businessNow','progress','vehicles']);
  const p=contextRecord(r.progress,['operationId','stepId','from','to','startedAt','durationMs'],['operationId','stepId','from','to','startedAt','durationMs']);
  const progress={operationId:contextText(p.operationId,64),stepId:contextText(p.stepId,128),from:contextTimestamp(p.from),to:contextTimestamp(p.to),startedAt:contextTimestamp(p.startedAt),durationMs:contextInteger(p.durationMs,1,4000)};
  if(Date.parse(progress.to)<=Date.parse(progress.from)||!Array.isArray(r.vehicles)||r.vehicles.length>24)throw new Error('来源运动数据无效。');
  const number=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new Error('来源运动距离无效。');return value;};
  const vehicles=r.vehicles.map(value=>{
    const v=contextRecord(value,['ref','path','distance','travelled','speed'],['ref','path','distance','travelled','speed']);
    if(!Array.isArray(v.path)||v.path.length<2||v.path.length>4000)throw new Error('来源运动路径无效。');
    const path=v.path.map((value):Position=>{if(!Array.isArray(value)||value.length!==2||value.some(n=>typeof n!=='number'||!Number.isFinite(n))||Math.abs(value[0])>180||Math.abs(value[1])>90)throw new Error('来源运动坐标无效。');return [value[0],value[1]];});
    const distance=number(v.distance),travelled=number(v.travelled);if(travelled>distance)throw new Error('来源运动进度无效。');
    const ref=contextRef(v.ref);if(ref.systemId!=='situation'||ref.objectType!=='resource')throw new Error('来源运动对象无效。');
    return {ref,path,distance,travelled,speed:number(v.speed)};
  });
  return {serverNow:contextTimestamp(r.serverNow),businessNow:contextTimestamp(r.businessNow),progress,vehicles};
}
