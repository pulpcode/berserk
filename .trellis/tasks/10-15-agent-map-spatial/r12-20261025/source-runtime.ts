/** R12 archives the reviewed current product; B1 changes only source instructions. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,packageRoot,hashes,save,digest,type Runtime} from '../r3-20261022/runtime.js';
export {repo,packageRoot,hashes,save,digest,loopbackOnly} from '../r3-20261022/runtime.js';
export type {Runtime};
export const baselineRevision='6a631a4';
export const skillIds=['map-annotations','spatial-analysis'] as const;
export const treatmentPaths=['fixtures/skills/map-annotations/SKILL.md','fixtures/skills/spatial-analysis/SKILL.md','src/pi/resource-tools.ts'] as const;
export const businessContext='草稿点可按用户指定作为空间分析候选，不自动代表真实可用资源。对象个数、属性数量和可用状态分别依据实际数据。“本会话”是上下文线索，不自动指定草稿。来源无法唯一确定且会影响答案时，澄清或分别说明；不默认草稿优先或来源优先。只有明确要求联合统计才合并；不凭同名去重，不能核实身份时分开报告。';
export const baselineFile=(path:string)=>execFileSync('git',['show',`${baselineRevision}:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
function frontmatter(content:string){const m=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);assert.ok(m);return m[0];}
export function runtimeFreeze(){
 assert.equal(readFileSync(join(packageRoot,'package-lock.json'),'utf8'),baselineFile('package-lock.json'));
 return {baselineRevision,baselineTree:execFileSync('git',['rev-parse',`${baselineRevision}:experiments/harness-lab`],{cwd:repo,encoding:'utf8'}).trim(),treatmentPaths,baseline:Object.fromEntries(treatmentPaths.map(p=>[p,digest(baselineFile(p))])),candidate:Object.fromEntries(treatmentPaths.map(p=>[p,digest(readFileSync(join(packageRoot,p)))])),commonBusinessHash:digest(businessContext),packageLockHash:digest(baselineFile('package-lock.json'))};
}
export async function buildRuntime(directory:string,group:'B0'|'B1'):Promise<Runtime>{
 const frozen=runtimeFreeze(),target=join(directory,'runtimes',group);await mkdir(join(directory,'runtimes'),{recursive:true,mode:0o700});await mkdir(target,{mode:0o700});
 const names=['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'];
 const archive=execFileSync('git',['archive','--format=tar',baselineRevision,...names.map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target);
 if(group==='B1')for(const path of treatmentPaths)writeFileSync(join(target,path),readFileSync(join(packageRoot,path)));
 const after=await hashes(target),diff=Object.keys(before).filter(p=>before[p]!==after[p]).sort();assert.deepEqual(diff,group==='B1'?[...treatmentPaths].sort():[]);
 const loader=await import(pathToFileURL(join(target,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;content:string;hash:string;description:string}>>};
 const metadata=await loader.loadControlledSkills(['synthesis','review',...skillIds]);const skills=Object.fromEntries(metadata.map(s=>[s.id,{content:s.content,hash:s.hash,description:s.description}]));
 for(const s of metadata){assert.equal(frontmatter(s.content),frontmatter(baselineFile(`fixtures/skills/${s.id}/SKILL.md`)));assert.equal(s.hash,digest(s.content));}
 assert.deepEqual(runtimeFreeze(),frozen);save(join(target,'runtime-integrity.json'),{group,baselineRevision,archiveHash:digest(archive),allowedDiff:diff,before,after,freeze:frozen});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,skills,hashes:await hashes(target),start};
}
