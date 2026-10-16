import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { extractSpatialResult, projectSpatialResult, SPATIAL_MODEL_FORMAT, type SpatialResult } from '../contracts/spatial.js';
import { spatialError } from '../spatial/validation.js';
import { RESOURCE_ENTRY, RESULT_ENTRY } from './resource-tools.js';
export function spatialToolResult(result:SpatialResult) {
  return {content:[{type:'text' as const,text:JSON.stringify({format:SPATIAL_MODEL_FORMAT,data:projectSpatialResult(result)})}],details:{spatialResult:result}};
}
/** Authority is an actual original computation in this authorized native branch, never supplied result JSON. */
export function resolveSpatialResult(entries:SessionEntry[],ref:string):SpatialResult {
  let requestId:string|undefined;
  const calls=new Map<string,Record<string,unknown>>();
  let found:SpatialResult|undefined;
  for(const entry of entries) {
    if(entry.type==='custom' && entry.customType===RESOURCE_ENTRY) {requestId=(entry.data as {requestId:string}).requestId;calls.clear();}
    if(entry.type==='custom' && entry.customType===RESULT_ENTRY) {requestId=undefined;calls.clear();}
    if(entry.type!=='message' || !requestId) continue;
    const message=entry.message;
    if(message.role==='assistant') for(const c of message.content) if(c.type==='toolCall' && c.name==='spatial_analyze') calls.set(c.id,c.arguments as Record<string,unknown>);
    if(message.role!=='toolResult' || message.toolName!=='spatial_analyze') continue;
    const args=calls.get(message.toolCallId);calls.delete(message.toolCallId);
    const text=message.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
    const result=extractSpatialResult(message.details,message.toolName,message.isError,text);
    if(!result || result.delivery || result.resultRef!==ref || result.requestId!==requestId || result.toolCallId!==message.toolCallId || !args || args.operation!==result.operation || JSON.stringify(args)!==JSON.stringify(result.parameters)) continue;
    const target='target' in args?args.target:args.operation==='filter' && args.spatial && typeof args.spatial==='object' ? (args.spatial as {target:unknown}).target:undefined;
    if(JSON.stringify(result.scope)!==JSON.stringify([args.input,...(target?[target]:[])])) continue;
    if(found) throw spatialError('RESULT_INVALID','原生历史中分析结果引用不唯一。');
    found=result;
  }
  if(!found) throw spatialError('RESULT_NOT_FOUND','本会话没有可验证的该分析结果；不能采用复制或改写的结果。');
  return found;
}
