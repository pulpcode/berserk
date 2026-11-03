/** R14 fixes product source/Skills; only evaluation fixtures and transport are adapted. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,packageRoot,hashes,save,digest,type Runtime} from '../r3-20261022/runtime.js';
import {liveEnvironment as originalEnvironment} from '../r7-20261023/environment.js';
import {modelConfiguration,type Group} from './budget.js';
import {businessContext} from '../r12-20261025/source-runtime.js';
export {repo,packageRoot,hashes,save,digest,loopbackOnly} from '../r3-20261022/runtime.js';
export {businessContext};
export type {Runtime};
export const baselineRevision='6a631a42b99b01de334cd2017c07bf0d9d58a560';
export const evaluationFixtureDiff=['scripts/probe-situation-map.ts','scripts/mock-context/map-fixtures.ts'] as const;
export const skillIds=['map-annotations','spatial-analysis'] as const;
export const baselineFile=(path:string)=>execFileSync('git',['show',`${baselineRevision}:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
export function liveEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
 const result:NodeJS.ProcessEnv={...originalEnvironment(env),LLM_MAX_OUTPUT_TOKENS:'32768',LLM_HTTP_IDLE_TIMEOUT_MS:'300000',AGENT_RUN_TIMEOUT_MS:'0'};
 delete result.LLM_REQUEST_TIMEOUT_MS;return result;
}
export function groupEnvironment(env:NodeJS.ProcessEnv,group:Group){return {...env,LLM_MODEL:modelConfiguration[group].requestModel};}
export function offlineEnvironment(){return liveEnvironment({...process.env,LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:'https://ark.cn-beijing.volces.com/api/plan/v3',LLM_MODEL:'deepseek-v4.1-flash'});}
export function runtimeFreeze(){
 const lock=readFileSync(join(packageRoot,'package-lock.json'),'utf8');assert.equal(lock,baselineFile('package-lock.json'),'Installed dependency lock differs from approved archive');
 const installed=join(packageRoot,'node_modules/.package-lock.json');
 const sdk=['node_modules/@earendil-works/pi-ai/package.json','node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js'];
 return {baselineRevision,baselineTree:execFileSync('git',['rev-parse',`${baselineRevision}:experiments/harness-lab`],{cwd:repo,encoding:'utf8'}).trim(),allowedProductDiff:[],allowedEvaluationFixtureDiff:evaluationFixtureDiff,loading:'native_on_demand',commonBusinessHash:digest(businessContext),packageLockHash:digest(lock),installedLockHash:existsSync(installed)?digest(readFileSync(installed)):null,skills:Object.fromEntries(skillIds.map(id=>[id,digest(baselineFile(`fixtures/skills/${id}/SKILL.md`))])),sdk:Object.fromEntries(sdk.map(path=>[path,digest(readFileSync(join(packageRoot,path)))]))};
}
/** Keep frozen R12 builders untouched: this small archive boundary removes all candidate copying. */
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 assert.ok(group==='A'||group==='B'||group==='C');const frozen=runtimeFreeze(),target=join(directory,'runtimes',group);
 await mkdir(join(directory,'runtimes'),{recursive:true,mode:0o700});await mkdir(target,{mode:0o700});
 const archive=execFileSync('git',['archive','--format=tar',baselineRevision,...['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'].map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target);
 // Only test scripts receive a fixed date and declared synthetic fixture injection.
 const probePath=join(target,evaluationFixtureDiff[0]);let probe=readFileSync(probePath,'utf8');
 const oldDay="const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());";
 assert.equal(probe.split(oldDay).length,2,'fixture_day_anchor_changed');
 probe=probe.replace(oldDay,"const day=env.R14_SYNTHETIC_DAY??new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(day))throw new Error('Invalid frozen R14 day');");
 const areas="{id:`${trialId}-zone-east`,name:'东区'}]";assert.equal(probe.split(areas).length,3,'fixture_catalogue_anchor_changed');
 probe=probe.replaceAll(areas,"{id:`${trialId}-zone-east`,name:'东区'},...(env.R14_CASE_ID==='D12'?[{id:`${trialId}-zone-north`,name:'北区'}]:[])]");writeFileSync(probePath,probe);
 const fixturePath=join(target,evaluationFixtureDiff[1]);let fixture=readFileSync(fixturePath,'utf8');
 assert.equal(fixture.split('export function mapFixtures(').length,2,'source_fixture_anchor_changed');
 fixture="import {sourceScene} from "+JSON.stringify(fileURLToPath(new URL('./data.ts',import.meta.url)))+";\n"+fixture.replace('export function mapFixtures(','function originalMapFixtures(')+"\nexport function mapFixtures(instanceId:string,day:string){return sourceScene(originalMapFixtures(instanceId,day),instanceId,day,process.env.R14_CASE_ID??'');}\n";
 writeFileSync(fixturePath,fixture);
 const loader=await import(pathToFileURL(join(target,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;content:string;hash:string;description:string}>>};
 const metadata=await loader.loadControlledSkills(['synthesis','review',...skillIds]),skills:Runtime['skills']={};
 for(const s of metadata){assert.equal(s.content,baselineFile(`fixtures/skills/${s.id}/SKILL.md`));assert.equal(s.hash,digest(s.content));skills[s.id]={content:s.content,hash:s.hash,description:s.description};}
 const after=await hashes(target);const changed=Object.keys(after).filter(k=>after[k]!==before[k]).sort();assert.deepEqual(changed,[...evaluationFixtureDiff].sort(),'Only declared evaluation fixture scripts may change');assert.deepEqual(runtimeFreeze(),frozen);
 save(join(target,'runtime-integrity.json'),{group,baselineRevision,archiveHash:digest(archive),allowedDiff:evaluationFixtureDiff,before,after,freeze:frozen});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,skills,hashes:await hashes(target),start};
}
