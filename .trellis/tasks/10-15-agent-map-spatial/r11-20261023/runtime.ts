/** Reuse R7 archive builder; S0 is R10's B Skill, S1 is the reviewed working candidate. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildRuntime as buildPrior,runtimeSourceFreeze as priorFreeze,repo,packageRoot,hashes,save,digest,type Runtime} from '../r7-20261023/runtime.js';
export {repo,packageRoot,hashes,save,digest};
export type {Runtime};
export const skillIds=['map-annotations','spatial-analysis'] as const;
export const baselineRevision='af13107',oldSkillRevision='c95b3d3';
export const businessContext='草稿点可按用户指定作为空间分析候选，不自动代表真实可用资源。对象个数、属性数量和可用状态分别依据实际数据。“本会话”是上下文线索，不自动指定草稿。来源无法唯一确定且会影响答案时，澄清或分别说明；不默认草稿优先或来源优先。只有明确要求联合统计才合并；不凭同名去重，不能核实身份时分开报告。';
export function runtimeFreeze(){return {...priorFreeze(),oldSkillRevision,oldBodies:Object.fromEntries(skillIds.map(id=>[id,digest(oldBody(id))])),commonBusinessHash:digest(businessContext),commonToolPatch:[]};}
function oldBody(id:string){return execFileSync('git',['show',`${oldSkillRevision}:experiments/harness-lab/fixtures/skills/${id}/SKILL.md`],{cwd:repo,encoding:'utf8'});}
export async function buildRuntime(directory:string,version:'S0'|'S1'):Promise<Runtime>{
 const before=runtimeFreeze(),runtime=await buildPrior(join(directory,version),'B');
 if(version==='S0')for(const id of skillIds)writeFileSync(join(runtime.root,'fixtures/skills',id,'SKILL.md'),oldBody(id));
 const loader=await import(pathToFileURL(join(runtime.root,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;content:string;hash:string;description:string}>>};
 const entries=await loader.loadControlledSkills(['synthesis','review',...skillIds]);runtime.skills=Object.fromEntries(entries.map(s=>[s.id,{content:s.content,hash:s.hash,description:s.description}]));
 for(const id of skillIds)assert.equal(runtime.skills[id].content,version==='S0'?oldBody(id):readFileSync(join(packageRoot,'fixtures/skills',id,'SKILL.md'),'utf8'));
 save(join(runtime.root,'r11-integrity.json'),{version,baselineRevision,oldSkillRevision,freeze:before,skills:Object.fromEntries(entries.map(s=>[s.id,s.hash]))});runtime.hashes=await hashes(runtime.root);assert.deepEqual(runtimeFreeze(),before);return runtime;
}
