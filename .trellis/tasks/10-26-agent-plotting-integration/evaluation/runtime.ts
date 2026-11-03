import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {cp,mkdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest,hashes,save,loopbackOnly,type Runtime} from '../../10-15-agent-map-spatial/r3-20261022/runtime.js';
import {liveEnvironment as existingEnvironment} from '../../10-15-agent-map-spatial/r7-20261023/environment.js';
import {cases,schedule} from './cases.js';
import {limits,pairReserve,maxTokens,responseModel} from './budget.js';
export {digest,hashes,save,loopbackOnly};export type {Runtime};
export const root=fileURLToPath(new URL('.',import.meta.url)),repo=resolve(root,'../../../..'),packageRoot=join(repo,'experiments/harness-lab');
export const businessContext='草稿点可按用户指定作为空间分析候选，不自动代表真实可用资源。对象个数、属性数量和可用状态分别依据实际数据。“本会话”是上下文线索，不自动指定草稿。来源无法唯一确定且会影响答案时，澄清或分别说明；不默认草稿优先或来源优先。只有明确要求联合统计才合并；不凭同名去重，不能核实身份时分开报告。';
export function liveEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{const result={...existingEnvironment(env),LLM_MAX_OUTPUT_TOKENS:String(maxTokens),LLM_REQUEST_TIMEOUT_MS:undefined};return result;}
export function offlineEnvironment(){return liveEnvironment({...process.env,LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:'https://ark.cn-beijing.volces.com/api/plan/v3',LLM_MODEL:'deepseek-v4.1-flash'});}
const productNames=['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'];
/** Hash every local helper dependency, including fixture-generation code, without floating worktrees. */
export async function sourceFreeze(){
 const product:Record<string,unknown>={};for(const name of productNames)product[name]=name.includes('.')?digest(readFileSync(join(packageRoot,name))):await hashes(join(packageRoot,name));
 const helpers:Record<string,unknown>={};for(const dir of ['r3-20261022','r7-20261023','r10-20261023','r11-20261023','round1-20261017'])helpers[dir]=await hashes(resolve(root,'../../10-15-agent-map-spatial',dir));
 helpers.query=await hashes(resolve(root,'../../10-17-map-query-native-evaluation'));
 return {schemaVersion:1,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),product,helpers,driver:await hashes(root),cases,schedule,limits,pairReserve,model:{request:'deepseek-v4.1-flash',response:responseModel,thinking:'disabled',maxTokens,topP:1,temperature:'absent',reasoningEffort:'absent'},businessContext,loading:'native_on_demand',automaticRetries:false};
}
/** Product files only. Evaluation expected values and question answers cannot enter this runtime. */
export async function buildRuntime(directory:string):Promise<Runtime>{
 await mkdir(directory,{mode:0o700});
 for(const name of productNames)await cp(join(packageRoot,name),join(directory,name),{recursive:true});
 await symlink(join(packageRoot,'node_modules'),join(directory,'node_modules'),'dir');
 const loader=await import(pathToFileURL(join(directory,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;content:string;hash:string;description:string}>>};
 const metadata=await loader.loadControlledSkills(['synthesis','review','map-annotations','spatial-analysis']),skills:Runtime['skills']={};
 for(const s of metadata)skills[s.id]={content:s.content,hash:s.hash,description:s.description};
 const start=(await import(pathToFileURL(join(directory,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:directory,hashes:await hashes(directory),skills,start};
}
