/** Offline only: reads archived observations, never starts a lab or calls a model. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {SessionSnapshot} from '../src/contracts/index.js';
import type {SpatialCase} from './probe-spatial-cases.js';
import {scoreSpatialFacts,uniqueSpatialResults,providerToolCalls,type SpatialObservation} from './probe-spatial-evaluation.js';
import {SPATIAL_SCORER_VERSION} from './probe-spatial-evidence.js';
export async function replaySpatial(input:string,output:string){
  input=resolve(input);output=resolve(output);
  if(!relative(input,output).startsWith('..')||!relative(output,input).startsWith('..'))throw new Error('Replay output must be a separate new directory outside the archived input');
  await mkdir(output,{mode:0o700}); // Existing evidence, including previous failed replays, is immutable.
  const entries:Array<{id:string;status:string;condition?:string;oldAutomatic?:string;newAutomatic?:string;differences?:Array<{check:string;before:boolean|null;after:boolean|null}>;score?:ReturnType<typeof scoreSpatialFacts>;historicalReview?:unknown;fixtureNotes?:string[];sourceHashes:Record<string,string>;semanticReview?:string;note?:string;reason?:string}>=[];
  for(const name of (await readdir(input)).filter(name=>/^[DH]\d{2}-[123]-[ABC]$/.test(name)).sort()){
    const hashes:Record<string,string>={};
    async function read<T>(file:string):Promise<T>{const bytes=await readFile(join(input,name,file));hashes[file]=createHash('sha256').update(bytes).digest('hex');return JSON.parse(bytes.toString()) as T;}
    async function optional<T>(file:string):Promise<T|undefined>{try{return await read<T>(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
    try{
      const plan=await read<{spec:SpatialCase;scheduled:{condition:string}}>('plan.json');
      const preparation=await read<{before:SpatialObservation['before'];sourceSnapshot?:SpatialObservation['sourceSnapshot'];sourceAreaIds?:SpatialObservation['sourceAreaIds']}>('preparation.json');
      const final=await read<{snapshot:SessionSnapshot;after:SpatialObservation['after']}>('final-state.json');
      const oldScore=await read<ReturnType<typeof scoreSpatialFacts>>('score.json');
      const historicalReview=await optional<unknown>('manual-review.json');
      const bytes=await readFile(join(input,name,'model-inputs.jsonl'));hashes['model-inputs.jsonl']=createHash('sha256').update(bytes).digest('hex');
      const payloads=bytes.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line).payload);
      const results=uniqueSpatialResults(final.snapshot.messages);
      const tools=providerToolCalls(payloads);
      // Final tool calls may never be sent back to the provider; retain attempted writes from public history.
      for(const message of final.snapshot.messages)if(message.role==='tool'&&message.toolName&&!tools.some(tool=>tool.name===message.toolName))tools.push({name:message.toolName,args:{}});
      const score=scoreSpatialFacts(plan.spec,{...preparation,toolCallsAuthoritative:true,results,messages:final.snapshot.messages,tools,after:final.after,
        protocolCompleted:oldScore.checks.find(check=>check.name==='protocol_completed')?.passed??false,
        skillLoaded:oldScore.skill.loaded,skillLoadedBeforeAnalysis:oldScore.skill.beforeAnalysis});
      const differences=[...new Set([...oldScore.checks,...score.checks].map(check=>check.name))].flatMap(check=>{
        const before=oldScore.checks.find(item=>item.name===check)?.passed,after=score.checks.find(item=>item.name===check)?.passed;
        return before===after?[]:[{check,before:before??null,after:after??null}];
      });
      const entry={id:name,condition:plan.scheduled.condition,status:'rescored',oldAutomatic:oldScore.deterministic,newAutomatic:score.deterministic,differences,score,historicalReview,
        fixtureNotes:[...(plan.spec.id==='D18'?['Historical requiresSkill label preserved; v2 excludes rename-only from loading denominator.']:[]),...(plan.spec.id==='H04'?['Historical fixture lacks the requested missing category; cannot establish missing-field coverage.']:[])],
        sourceHashes:hashes,semanticReview:'pending_review',note:'Historical review retained as evidence only; no new human adjudication or model run.'};
      await writeFile(join(output,`${name}.json`),JSON.stringify(entry,null,2)+'\n',{mode:0o600,flag:'wx'});entries.push(entry);
    }catch(error){entries.push({id:name,status:'unverifiable',reason:String(error),sourceHashes:hashes});}
  }
  const scorerHashes=Object.fromEntries(await Promise.all(['probe-spatial-replay.ts','probe-spatial-evaluation.ts','probe-spatial-evidence.ts','probe-spatial-cases.ts'].map(async file=>[file,createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')])));
  const summary={scorerHashes,scorerVersion:SPATIAL_SCORER_VERSION,input,output,generatedAt:new Date().toISOString(),scheduledObserved:entries.length,
    groups:Object.fromEntries(['A','B','C'].map(condition=>{const group=entries.filter(entry=>entry.id.endsWith(`-${condition}`));return [condition,{observed:group.length,rescored:group.filter(e=>e.status==='rescored').length,oldAutomaticPassed:group.filter(e=>'oldAutomatic'in e&&e.oldAutomatic==='passed').length,newAutomaticPassed:group.filter(e=>'newAutomatic'in e&&e.newAutomatic==='passed').length,passToFail:group.filter(e=>'newAutomatic'in e&&e.newAutomatic==='failed'&&e.oldAutomatic==='passed').length,failToPass:group.filter(e=>'newAutomatic'in e&&e.newAutomatic==='passed'&&e.oldAutomatic==='failed').length}];})),
    entries:entries.map(entry=>({id:entry.id,status:entry.status,...('differences'in entry?{differences:entry.differences}: {reason:entry.reason})})),
    limitations:['Automatic pass is not semantic acceptance. Full visible answers and boundary behavior still require review.','Missing independent source snapshots remain unverifiable; no output-derived replacement is manufactured.','Old H01-H06 were already inspected; they are historical regression data, not a new heldout set.','No original scores, reviews or source files were overwritten.']};
  await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600,flag:'wx'});return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--input'||args[2]!=='--output')throw new Error('Usage: --input archived-batch --output new-separate-directory');
  replaySpatial(args[1],args[3]).then(summary=>console.info(JSON.stringify(summary.groups))).catch(error=>{console.error(String(error));process.exitCode=1;});
}
