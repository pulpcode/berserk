import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {repo,packageRoot,hashes,save,digest,type Runtime as Base} from '../../10-15-agent-map-spatial/r3-20261022/runtime.js';
import {liveEnvironment as originalEnvironment} from '../../10-15-agent-map-spatial/r7-20261023/environment.js';
import type {Group} from './budget.js';
export {repo,packageRoot,hashes,save,digest};
export interface Runtime extends Base {skills:Record<string,{name:string;description:string;hash:string;content:string}>}
export const revisions={A:'ba3fc697e4866aa616ed9f4e2fef5f96d4ab8013',B:'74986e0'};
export const day='2026-10-29';
export const businessContext='草稿点可按用户指定作为空间分析候选，不自动代表真实可用资源。对象个数、属性数量和可用状态分别依据实际数据。“本会话”是上下文线索，不自动指定草稿。来源无法明确且会影响答案时，澄清或分别说明；不默认草稿优先或来源优先。只有明确要求联合统计才合并；不凭同名去重，不能核实身份时分开报告。';
export const liveEnvironment=(env:NodeJS.ProcessEnv)=>{const v:NodeJS.ProcessEnv={...originalEnvironment(env),LLM_MAX_OUTPUT_TOKENS:'32768'};delete v.LLM_REQUEST_TIMEOUT_MS;return v;};
export const offlineEnvironment=()=>liveEnvironment({...process.env,LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:'https://ark.cn-beijing.volces.com/api/plan/v3',LLM_MODEL:'deepseek-v4.1-flash'});
export const gitFile=(g:Group,p:string)=>execFileSync('git',['show',`${revisions[g]}:experiments/harness-lab/${p}`],{cwd:repo,encoding:'utf8'});
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 const target=join(directory,group);await mkdir(target,{recursive:true,mode:0o700});
 const archive=execFileSync('git',['archive','--format=tar',revisions[group],...['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'].map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});assert.equal(gitFile(group,'package-lock.json'),readFileSync(join(packageRoot,'package-lock.json'),'utf8'));
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');await cp(join(packageRoot,'dist'),join(target,'dist'),{recursive:true});
 const before=await hashes(target),probePath=join(target,'scripts/probe-situation-map.ts');let probe=readFileSync(probePath,'utf8');
 const old="const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());";assert.equal(probe.split(old).length,2);probe=probe.replace(old,`const day='${day}';`).replaceAll("name:'西区'","name:env.INTEGRATION_CASE==='S06'?'港区':'西区'");writeFileSync(probePath,probe);
 const fixturePath=join(target,'scripts/mock-context/map-fixtures.ts');let fixture=readFileSync(fixturePath,'utf8');fixture="import {sourceScene} from "+JSON.stringify(fileURLToPath(new URL('../../10-15-agent-map-spatial/r15-20261027/data.ts',import.meta.url)))+";\n"+fixture.replace('export function mapFixtures(','function originalMapFixtures(')+"\nexport function mapFixtures(instanceId:string,day:string){return sourceScene(originalMapFixtures(instanceId,day),instanceId,day,process.env.INTEGRATION_CASE==='S06'?'P01':'');}\n";writeFileSync(fixturePath,fixture);
 const loader=await import(pathToFileURL(join(target,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;name:string;description:string;content:string;hash:string}>>};
 const skills:Runtime['skills']={};for(const s of await loader.loadControlledSkills(['synthesis','review','map-annotations','spatial-analysis'])){assert.equal(s.content,gitFile('A',`fixtures/skills/${s.id}/SKILL.md`));skills[s.id]=s;}
 const after=await hashes(target);assert.deepEqual(Object.keys(after).filter(k=>before[k]!==after[k]).sort(),['scripts/mock-context/map-fixtures.ts','scripts/probe-situation-map.ts']);
 save(join(target,'runtime-integrity.json'),{group,revision:execFileSync('git',['rev-parse',revisions[group]],{cwd:repo,encoding:'utf8'}).trim(),archiveHash:digest(archive),before,after});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,skills,hashes:await hashes(target),start};
}
