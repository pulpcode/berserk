import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceFreeze as baseFreeze,hashes,digest} from '../evaluation-v3/runtime.js';
import {cases,schedule} from '../loading-diagnostic/cases.js';
import {limits} from './budget.js';
export {buildRuntime,liveEnvironment,offlineEnvironment,loopbackOnly,packageRoot,repo,businessContext,hashes,save,digest} from '../evaluation-v3/runtime.js';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const scope={id:'plotting-loading-diagnostic-v1',slots:24,cases,schedule,loading:{A:'native_on_demand',B:'native_explicit_map_annotations_each_message'},automaticRetries:false};
export async function sourceFreeze(){return {driverVersion:'plotting-loading-diagnostic-live-v1',base:await baseFreeze(),diagnostic:await hashes(resolve(root,'../loading-diagnostic')),driver:await hashes(root),protocolHash:digest(readFileSync(resolve(root,'../loading-diagnostic-protocol-20261028.md'))),scope,limits};}
export async function frozenIdentity(){const source=await sourceFreeze();return {source,freezeHash:digest(JSON.stringify(source))};}
