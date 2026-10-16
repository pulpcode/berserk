/** Frozen development diagnostics only. No production experiment flag, retry or best-of selection. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spatialEvidenceHashes} from './probe-spatial-batch.js';

export const remediationCaseIds=['D01','D05','D07','D09','D10','D11','D12','D13','D14','D17','D18','H04'] as const;
export const remediationVariants=['V0','V1','V2','V3','V4'] as const;
export type RemediationVariant=typeof remediationVariants[number];
export interface RemediationRuntime {id:RemediationVariant;packageRoot:string}
interface RuntimePlan {version:1;runtimes:RemediationRuntime[]}
type SourceHashes=Awaited<ReturnType<typeof spatialEvidenceHashes>>;
export function remediationSchedule(repeats:2|3=3){
  assert.ok(repeats===2||repeats===3,'Diagnostics require 2 or 3 predeclared repeats');
  return Array.from({length:repeats},(_,i)=>i+1).flatMap(repeat=>remediationCaseIds.flatMap((caseId,caseIndex)=>
    remediationVariants.map((_,offset)=>{
      const variant=remediationVariants[(offset+repeat-1+caseIndex)%remediationVariants.length];
      return {id:`${caseId}-${repeat}-${variant}`,caseId,repeat,variant,
        condition:variant==='V3'?'C' as const:'B' as const,
        background:variant==='V4'?'neutral' as const:'original' as const};
    })));
}
export function parseRemediationRuntimes(value:unknown):RuntimePlan {
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'Missing runtime manifest');
  const candidate=value as Record<string,unknown>;
  assert.equal(candidate.version,1);assert.ok(Array.isArray(candidate.runtimes));
  const runtimes=candidate.runtimes.map((raw:unknown)=>{
    assert.ok(raw&&typeof raw==='object'&&!Array.isArray(raw));const item=raw as Record<string,unknown>;
    assert.ok(remediationVariants.includes(item.id as RemediationVariant));
    assert.ok(typeof item.packageRoot==='string'&&item.packageRoot.length>0);
    return {id:item.id as RemediationVariant,packageRoot:resolve(item.packageRoot)};
  });
  assert.equal(runtimes.length,5);assert.equal(new Set(runtimes.map(item=>item.id)).size,5);
  return {version:1,runtimes};
}
export function validateRemediationSources(hashes:Record<RemediationVariant,SourceHashes>){
  const changes=(left:RemediationVariant,right:RemediationVariant)=>{
    const a=new Map(hashes[left].map(item=>[item.file,item.sha256]));
    const b=new Map(hashes[right].map(item=>[item.file,item.sha256]));
    assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort(),'Variants must have identical source inventory');
    return [...a.keys()].filter(file=>a.get(file)!==b.get(file));
  };
  const tools=changes('V0','V1');
  const allowed=new Set(['src/pi/spatial-tools.ts','src/spatial/service.ts','src/spatial/geometry.ts']);
  assert.ok(tools.length>0&&tools.every(file=>allowed.has(file)),'V0/V1 may differ only in reviewed P2 files');
  const skill=['fixtures/skills/spatial-analysis/SKILL.md','src/resources/service.ts'];
  assert.deepEqual(changes('V1','V2'),skill,'V1/V2 must isolate Skill content and its controlled catalog description');
  assert.deepEqual(changes('V2','V3'),[],'V3 differs through native loading only');
  assert.deepEqual(changes('V2','V4'),[],'V4 differs through synthetic preparation only');
  return {tools,skill};
}
async function main(){
  const args=process.argv.slice(2);let manifest='',output='',prepareOnly=false,port=4391,repeats:2|3=3;
  for(let i=0;i<args.length;i++){
    const arg=args[i],value=args[i+1];
    if(arg==='--prepare-only')prepareOnly=true;
    else if(arg==='--repeats'&&(value==='2'||value==='3')){repeats=Number(value) as 2|3;i++;}
    else if(arg==='--runtimes'&&value){manifest=resolve(value);i++;}
    else if(arg==='--output'&&value){output=resolve(value);i++;}
    else if(arg==='--port'&&/^\d+$/.test(value??'')&&Number(value)>1023&&Number(value)<65536){port=Number(value);i++;}
    else throw new Error('用法：--runtimes 固定快照清单 --output 新目录 [--port 4391] [--prepare-only] [--repeats 2|3]；禁止重试/覆盖');
  }
  assert.ok(manifest&&output,'Missing runtime manifest or output');
  const plan=parseRemediationRuntimes(JSON.parse(await readFile(manifest,'utf8')));
  const roots=Object.fromEntries(plan.runtimes.map(item=>[item.id,item.packageRoot])) as Record<RemediationVariant,string>;
  const hashes=Object.fromEntries(await Promise.all(remediationVariants.map(async id=>[id,await spatialEvidenceHashes(roots[id])])) as Array<[RemediationVariant,SourceHashes]>) as Record<RemediationVariant,SourceHashes>;
  const differences=validateRemediationSources(hashes),schedule=remediationSchedule(repeats);
  // Separate no-model preflight: every runtime plus missing-geometry/missing-property fixtures.
  const entries=prepareOnly?schedule.filter(entry=>entry.repeat===1&&(entry.caseId===remediationCaseIds[0]||entry.variant==='V2'&&['D14','H04'].includes(entry.caseId))):schedule;
  await mkdir(output,{mode:0o700});
  const save=(name:string,value:unknown)=>writeFile(join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await save('schedule.json',{version:1,kind:'remediation-development',prepareOnly,repeats,scheduled:entries.length,
    fullDiagnosticScheduled:schedule.length,schedule:entries,runtimes:plan.runtimes,hashes,differences,
    startedAt:new Date().toISOString(),semanticReview:'pending_review',modelAcceptancePassed:false,
    backgroundAblation:{changed:['synthetic task title','synthetic task goal','seat responsibility text'],preserved:['businessRefs','focus areas/time/topics','access and data'],claim:'Narrative-background ablation only, not removal of all task context.'},
    stoppingRule:'Stop on source drift, spawn failure/missing result, or three consecutive incomplete entries with zero provider calls; recorded model failures remain in the batch, no automatic retries.'});
  const outcomes:Array<{id:string;variant:RemediationVariant;status:string;exitCode:number|null;providerCalls:number|null}>=[];
  const attempts:Array<{id:string;startedAt:string}>=[];let stopReason='',preparationFailures=0;
  const unchanged=async()=>{
    for(const id of remediationVariants)if(JSON.stringify(await spatialEvidenceHashes(roots[id]))!==JSON.stringify(hashes[id]))return false;
    return true;
  };
  for(const entry of entries){
    if(!await unchanged()){stopReason='source_drift';break;}
    attempts.push({id:entry.id,startedAt:new Date().toISOString()});await save('attempts.json',attempts);
    const trialOutput=join(output,entry.id),root=roots[entry.variant];
    const exitCode=await new Promise<number|null>(resolveExit=>{
      const child=spawn(process.execPath,['--import','tsx',join(root,'scripts/probe-spatial-evaluation.ts'),
        '--entry',`${entry.caseId}-${entry.repeat}-${entry.condition}`,'--output',trialOutput,
        '--port',String(port),'--background',entry.background,...(prepareOnly?['--prepare-only']:[])],
        {cwd:root,env:process.env,stdio:'inherit'});
      child.once('error',()=>resolveExit(null));child.once('exit',resolveExit);
    });
    let status='missing_result',providerCalls:number|null=null;
    try{
      const result=JSON.parse(await readFile(join(trialOutput,'result.json'),'utf8')) as {status:string;providerCalls?:number};
      status=result.status;providerCalls=result.providerCalls??null;
    }catch{/* Missing evidence remains explicit, never infer a successful run. */}
    if(!await unchanged()){status='source_drift';stopReason='source_drift';await save(`${entry.id}-source-drift.json`,{id:entry.id,detectedAt:new Date().toISOString()});}
    outcomes.push({id:entry.id,variant:entry.variant,status,exitCode,providerCalls});
    preparationFailures=status==='incomplete'&&providerCalls===0?preparationFailures+1:0;
    if(exitCode===null||status==='missing_result')stopReason ||= 'runner_failure';
    if(preparationFailures>=3)stopReason ||= 'repeated_preparation_failure';
    await save('progress.json',{scheduled:entries.length,executed:outcomes.length,outcomes,stopReason,semanticReview:'pending_review'});
    console.info(JSON.stringify({completed:outcomes.length,scheduled:entries.length,entry:entry.id,status,stopReason}));
    if(stopReason)break;
  }
  await save('batch-result.json',{scheduled:entries.length,executed:outcomes.length,unrun:entries.slice(outcomes.length),
    outcomes,stopReason,semanticReview:'pending_review',modelAcceptancePassed:false});
  if(stopReason||outcomes.some(entry=>entry.exitCode!==0))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
