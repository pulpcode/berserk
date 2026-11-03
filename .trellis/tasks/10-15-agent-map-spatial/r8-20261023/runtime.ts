/** Reuse frozen R7 runtime with an extra exact committed candidate check. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildRuntime as buildPrior,runtimeSourceFreeze as freezePrior,repo,packageRoot,type RuntimeGroup} from '../r7-20261023/runtime.js';
export {digest,hashes,save,repo,packageRoot,selectionFor,loopbackOnly,baselineRevision,offlineEnvironment} from '../r7-20261023/runtime.js';
export type {Runtime} from '../r7-20261023/runtime.js';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const candidateRevision='c95b3d3';
export function runtimeSourceFreeze(){
 for(const id of ['map-annotations','spatial-analysis']){
  const path=`experiments/harness-lab/fixtures/skills/${id}/SKILL.md`;
  assert.equal(readFileSync(join(packageRoot,'fixtures/skills',id,'SKILL.md'),'utf8'),execFileSync('git',['show',`${candidateRevision}:${path}`],{cwd:repo,encoding:'utf8'}),'Candidate must match approved committed R7 version exactly');
 }
 return {candidateRevision,...freezePrior()};
}
export async function buildRuntime(directory:string,group:RuntimeGroup){const before=runtimeSourceFreeze();const result=await buildPrior(directory,group);assert.deepEqual(runtimeSourceFreeze(),before);return result;}
