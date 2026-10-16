/** Summarize every scheduled denominator. Missing evidence or unreviewed prose never becomes success. */
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spatialCases,spatialSchedule,type SpatialCondition} from './probe-spatial-cases.js';
export interface SpatialReview {reviewer:string;reviewedAt:string;objectScope:boolean;method:boolean;numericGeometry:boolean;claims:boolean;effects:boolean;criticalErrors:string[];evidence:string[]}
interface Score {deterministic:string;criticalFailures:string[];skill:{loaded:boolean;beforeAnalysis:boolean;required:boolean}}
export interface Entry {id:string;caseId:string;condition:SpatialCondition;split:string;status:string;score?:Score;review?:SpatialReview;elapsedMs?:number;providerCalls?:number}
export function spatialEntryStatus(result:{status:string;providerCalls?:number}|undefined,attempted:boolean,sourceDrift=false){
  if(sourceDrift)return 'source_drift';
  if(!result)return attempted?'missing_result':'unrun';
  return result.status==='incomplete'&&result.providerCalls===0?'preparation_failed':result.status;
}
export function reviewedSuccess(entry:Entry):boolean {
  const r=entry.review;return entry.status==='recorded'&&entry.score?.deterministic==='passed'&&entry.score.criticalFailures.length===0&&!!r&&r.reviewer.trim().length>0&&Number.isFinite(Date.parse(r.reviewedAt))&&r.evidence.length>0&&r.criticalErrors.length===0&&[r.objectScope,r.method,r.numericGeometry,r.claims,r.effects].every(value=>value===true);
}
export function summarizeSpatial(entries:Entry[]){
  return Object.fromEntries((['A','B','C'] as const).map(condition=>{
    const group=entries.filter(entry=>entry.condition===condition),run=group.filter(entry=>entry.status!=='unrun'),heldout=group.filter(entry=>entry.split==='heldout'),loadNeeded=group.filter(entry=>spatialCases.find(spec=>spec.id===entry.caseId)?.requiresSkill);
    return [condition,{scheduled:72,executed:run.length,attempted:run.length,modelExecuted:run.filter(entry=>(entry.providerCalls??0)>0).length,modelExecutionUnknown:run.filter(entry=>entry.providerCalls===undefined&&entry.status==='missing_result').length,preparationFailed:run.filter(entry=>entry.status==='preparation_failed').length,missingResults:run.filter(entry=>entry.status==='missing_result').length,preparedOnly:run.filter(entry=>entry.status==='prepared').length,unrun:72-run.length,recorded:group.filter(entry=>entry.status==='recorded').length,
      semanticSuccess:group.filter(reviewedSuccess).length,pendingReview:run.filter(entry=>!entry.review).length,deterministicPassed:group.filter(entry=>entry.score?.deterministic==='passed').length,
      rateDenominator:'attempted entries, including preparation failures and missing outputs',overallRate:run.length?group.filter(reviewedSuccess).length/run.length:null,heldout:{scheduled:18,executed:heldout.filter(entry=>entry.status!=='unrun').length,semanticSuccess:heldout.filter(reviewedSuccess).length},
      skill:{requiredScheduled:loadNeeded.length,loadedBeforeAnalysis:loadNeeded.filter(entry=>entry.score?.skill.beforeAnalysis).length},criticalFailures:group.flatMap(entry=>[...(entry.score?.criticalFailures??[]),...(entry.review?.criticalErrors??[])].map(reason=>({id:entry.id,reason}))),
      categories:Object.fromEntries(['basic','composition','boundary'].map(category=>{const subset=group.filter(entry=>spatialCases.find(spec=>spec.id===entry.caseId)?.category===category);return [category,{scheduled:subset.length,executed:subset.filter(entry=>entry.status!=='unrun').length,semanticSuccess:subset.filter(reviewedSuccess).length}];})),
      failures:group.filter(entry=>entry.status!=='unrun'&&!reviewedSuccess(entry)).map(entry=>({id:entry.id,status:entry.status,deterministic:entry.score?.deterministic,reviewed:!!entry.review}))}];
  }));
}
async function main(){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--input')throw new Error('用法：--input 固定批次目录');const input=resolve(args[1]);
  const read=async<T>(file:string):Promise<T|undefined>=>{try{return JSON.parse(await readFile(file,'utf8')) as T;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}};
  const entries:Entry[]=[];
  const attempts=await read<Array<{id:string}>>(join(input,'attempts.json'))??[];
  for(const scheduled of spatialSchedule()){
    const result=await read<{status:string;elapsedMs:number;providerCalls:number}>(join(input,scheduled.id,'result.json'));
    const directoryExists=await stat(join(input,scheduled.id)).then(value=>value.isDirectory()).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;});
    const sourceDrift=await read<unknown>(join(input,scheduled.id,'source-drift.json'));
    entries.push({...scheduled,status:spatialEntryStatus(result,directoryExists||attempts.some(entry=>entry.id===scheduled.id),sourceDrift!==undefined),score:await read<Score>(join(input,scheduled.id,'score.json')),review:await read<SpatialReview>(join(input,scheduled.id,'manual-review.json')),elapsedMs:result?.elapsedMs,providerCalls:result?.providerCalls});
  }
  const summary={generatedAt:new Date().toISOString(),scheduled:216,groups:summarizeSpatial(entries),entries,note:'Pending manual reviews and unrun entries are not successes. No acceptance claim until every gate is checked.'};
  await writeFile(join(input,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.info(JSON.stringify(summary.groups));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
