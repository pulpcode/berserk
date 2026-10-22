/** Preparation ONLY. No paid provider or legacy live main is reachable. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapTrialRequest} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import {cases,groups,schedule,prepareCase} from './cases.js';
import {holdoutCases,holdoutSchedule,prepareHoldout,verifyHoldoutFreeze} from './holdout.js';
import {buildRuntime,hashes,loopbackOnly,offlineEnvironment,root,save,selectionFor} from './runtime.js';
export async function prepare(directory:string,port=4508){
 await mkdir(directory,{recursive:false,mode:0o700});const original=globalThis.fetch;
 globalThis.fetch=loopbackOnly(original);
 const rows:Array<Record<string,unknown>>=[];
 try{
  verifyHoldoutFreeze();const frozen=await hashes(root);save(join(directory,'protocol.json'),{status:'prepared-not-live-authorized',schedule:[...schedule,...holdoutSchedule],splits:{development:cases.length,holdout:holdoutCases.length},holdout:'four-compositions-after-freeze-small-diagnostic-only',secondRound:false,sourceHashes:frozen,actualModelCalls:0});
  for(const group of groups){
   const runtime=await buildRuntime(directory,group);
   for(const spec of [...cases,...holdoutCases]){
    const trial=await runtime.start(port,offlineEnvironment(),false,{background:'neutral'});
    try{
    const p=await (spec.id.startsWith('H')?prepareHoldout:prepareCase)(trial.manifest,spec);
    const catalog=await mapTrialRequest<WorkspaceResources>(trial.manifest,`/api/workspaces/${p.fixture.workspaceId}/resources`,'planning');
    for(const [id,s] of Object.entries(runtime.skills))assert.equal(catalog.skills.find(c=>c.id===id)?.hash,s.hash);
    // Truth is written under evaluator output, not the model's workspace/dataDir.
    save(join(directory,`${group}-${spec.id}.json`),{...p,day:trial.manifest.day,selections:{explicit:selectionFor(spec,'explicit',catalog),native:selectionFor(spec,'native',catalog)}});
    rows.push({group,caseId:spec.id,split:spec.id.startsWith('H')?'holdout':'development',status:'prepared',semanticReview:'pending'});
   }finally{await trial.stop();}
   }
  }
  assert.deepEqual(await hashes(root),frozen,'Source changed during preparation');
 }finally{globalThis.fetch=original;save(join(directory,'prepared.json'),rows);}
 return rows;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,directory,port]=process.argv.slice(2);
 assert.ok(mode==='prepare-only'&&directory,'Usage: prepare.ts prepare-only NEW_OUTPUT_DIRECTORY [PORT]; live execution is not implemented or authorized');
 void prepare(resolve(directory),Number(port??4508)).then(rows=>console.info(JSON.stringify({prepared:rows.length,actualModelCalls:0}))).catch(error=>{console.error(error);process.exitCode=1;});
}
