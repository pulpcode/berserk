/** Refresh only the copied harness login cache through the existing authentication API. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {realpathSync as realpath} from 'node:fs';
import {restoreTrial} from '../../r13-20261025/closeout-runtime.js';
import {mapTrialAuth} from '../../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import {save} from '../runtime.js';
export async function restoreWithFreshAuth(...args:Parameters<typeof restoreTrial>){
 const trial=await restoreTrial(...args);
 try{
  assert.notEqual(realpath(trial.manifest.dataDir),realpath(args[1].dataDir));
  const path=join(trial.manifest.dataDir,'credentials.json'),before=JSON.parse(readFileSync(path,'utf8')) as {accounts:unknown;sessions:Record<string,unknown>};
  assert.ok(before.accounts&&before.sessions);const cleared=Object.keys(before.sessions);save(path,{...before,sessions:{}});
  await mapTrialAuth(trial.manifest,'planning');await mapTrialAuth(trial.manifest,'overall');
  const after=JSON.parse(readFileSync(path,'utf8')) as typeof before;assert.deepEqual(after.accounts,before.accounts);await trial.verifyOriginal();
  save(join(args[2],'authentication-refresh.json'),{scope:'copied_credentials_sessions_only',discardedCachedSeats:cleared,loggedInSeats:['planning','overall'],accountsUnchanged:true,originalUnchanged:true,modelCalls:0});return trial;
 }catch(error){await trial.stop();throw error;}
}
