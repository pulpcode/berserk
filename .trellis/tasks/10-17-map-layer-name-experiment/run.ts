/** Thin evaluation plan: actual native observer and request flow are reused. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {main} from '../10-17-map-query-native-evaluation/run.js';
import {prepareFixture,prompts,schedule} from './fixtures.js';

const repo=resolve(fileURLToPath(new URL('.',import.meta.url)),'../../..');
export function checkFreeze(root:string,expected:Record<string,string>) {
  for(const [path,hash] of Object.entries(expected))assert.equal(createHash('sha256').update(readFileSync(join(root,path))).digest('hex'),hash,`Frozen file changed: ${path}`);
}
async function run() {
  const [arm,...args]=process.argv.slice(2);assert.ok(arm==='A'||arm==='B','Usage: run.ts A|B prepare-only|run BATCH [PORT]');
  const frozen=JSON.parse(readFileSync(join(repo,'.trellis/tasks/10-17-map-layer-name-experiment/frozen.json'),'utf8')) as {arms:Record<string,Record<string,string>>;harness:Record<string,string>;baseline:string};
  assert.equal(process.env.NATIVE_EVAL_MODEL,'deepseek-v4-pro');
  const hashes={...frozen.arms[arm],...frozen.harness};
  await main(args,{schedule,prompts,prepareFixture,interactionCases:['N2'],validateProduct:()=>checkFreeze(repo,hashes),hashes:async()=>hashes,
    protocol:{arm,baseline:frozen.baseline,head:arm==='A'?frozen.baseline:`${frozen.baseline}+layerNames candidate`,plan:'10-17-map-layer-name-experiment',semanticRubric:'review-rubric.md',fixedRepeats:2}});
  checkFreeze(repo,hashes);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void run().catch(error=>{console.error(String(error));process.exitCode=1;});
