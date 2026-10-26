/** R13 isolates one fixed product archive; only the evaluation transport selects thinking. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,packageRoot,hashes,save,digest,type Runtime} from '../r3-20261022/runtime.js';
import {liveEnvironment as originalEnvironment} from '../r7-20261023/environment.js';
import {businessContext} from '../r12-20261025/source-runtime.js';
export {repo,packageRoot,hashes,save,digest,loopbackOnly} from '../r3-20261022/runtime.js';
export {businessContext};
export type {Runtime};
export const baselineRevision='6a631a42b99b01de334cd2017c07bf0d9d58a560';
export const skillIds=['map-annotations','spatial-analysis'] as const;
export const baselineFile=(path:string)=>execFileSync('git',['show',`${baselineRevision}:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
export function liveEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
 const result:NodeJS.ProcessEnv={...originalEnvironment(env),LLM_MAX_OUTPUT_TOKENS:'32768',LLM_HTTP_IDLE_TIMEOUT_MS:'300000',AGENT_RUN_TIMEOUT_MS:'0'};
 delete result.LLM_REQUEST_TIMEOUT_MS;return result;
}
export function offlineEnvironment(){return liveEnvironment({...process.env,LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:'https://ark.cn-beijing.volces.com/api/plan/v3',LLM_MODEL:'deepseek-v4.1-flash'});}
export function runtimeFreeze(){
 const lock=readFileSync(join(packageRoot,'package-lock.json'),'utf8');assert.equal(lock,baselineFile('package-lock.json'),'Installed dependency lock differs from approved archive');
 const installed=join(packageRoot,'node_modules/.package-lock.json');
 const sdk=['node_modules/@earendil-works/pi-ai/package.json','node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'];
 return {baselineRevision,baselineTree:execFileSync('git',['rev-parse',`${baselineRevision}:experiments/harness-lab`],{cwd:repo,encoding:'utf8'}).trim(),allowedProductDiff:[],loading:'native_on_demand',commonBusinessHash:digest(businessContext),packageLockHash:digest(lock),installedLockHash:existsSync(installed)?digest(readFileSync(installed)):null,skills:Object.fromEntries(skillIds.map(id=>[id,digest(baselineFile(`fixtures/skills/${id}/SKILL.md`))])),sdk:Object.fromEntries(sdk.map(path=>[path,digest(readFileSync(join(packageRoot,path)))]))};
}
/** Keep frozen R12 builders untouched: this small archive boundary removes all candidate copying. */
export async function buildRuntime(directory:string,group:'E0'|'E1'):Promise<Runtime>{
 assert.ok(group==='E0'||group==='E1');const frozen=runtimeFreeze(),target=join(directory,'runtimes',group);
 await mkdir(join(directory,'runtimes'),{recursive:true,mode:0o700});await mkdir(target,{mode:0o700});
 const archive=execFileSync('git',['archive','--format=tar',baselineRevision,...['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'].map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target);
 const loader=await import(pathToFileURL(join(target,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;content:string;hash:string;description:string}>>};
 const metadata=await loader.loadControlledSkills(['synthesis','review',...skillIds]),skills:Runtime['skills']={};
 for(const s of metadata){assert.equal(s.content,baselineFile(`fixtures/skills/${s.id}/SKILL.md`));assert.equal(s.hash,digest(s.content));skills[s.id]={content:s.content,hash:s.hash,description:s.description};}
 const after=await hashes(target);assert.deepEqual(after,before,'R13 must not change archived product or Skill files');assert.deepEqual(runtimeFreeze(),frozen);
 save(join(target,'runtime-integrity.json'),{group,baselineRevision,archiveHash:digest(archive),allowedDiff:[],before,after,freeze:frozen});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,skills,hashes:await hashes(target),start};
}
