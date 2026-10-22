/** E0/E1 share the complete R4 baseline; E2 adds only the reviewed execution tool files. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest,hashes,save,repo,packageRoot,type Runtime} from '../r3-20261022/runtime.js';
export {digest,hashes,save,repo,packageRoot,selectionFor,offlineEnvironment,loopbackOnly} from '../r3-20261022/runtime.js';
export type {Runtime};
export type RuntimeGroup='E0'|'E1'|'E2';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const baselineRevision='b56de822cec4ee2519ac8a24eb307a6230cac29d';
/** Minimum backend closure for objectNames + classify_points; no lab/resource/UI changes. */
export const treatmentPaths=[
 'src/contracts/annotations.ts','src/annotations/validation.ts','src/annotations/service.ts',
 'src/pi/annotation-tools.ts','src/pi/annotation-results.ts',
 'src/contracts/spatial.ts','src/spatial/geometry.ts','src/spatial/calculation.ts','src/spatial/service.ts',
 'src/pi/spatial-tools.ts','src/pi/spatial-results.ts','src/pi/skill-method-advice.ts',
] as const;
const skillIds=['map-annotations','spatial-analysis'] as const;
const archiveNames=['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'];
const baseline=(path:string)=>execFileSync('git',['show',`${baselineRevision}:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
const skillPath=(id:string)=>`fixtures/skills/${id}/SKILL.md`;
const candidatePath=(group:'E1'|'E2',id:string)=>join(root,'../r5-20261022/candidates',group,id,'SKILL.md');
function frontmatter(content:string){const match=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);assert.ok(match,'Skill frontmatter required');return match[0];}
/** Pure input hashes: runners retain this beside their full source freeze. */
export function runtimeSourceFreeze(){
 const backend=Object.fromEntries(treatmentPaths.map(path=>[path,digest(readFileSync(join(packageRoot,path)))]));
 const candidates=Object.fromEntries((['E1','E2'] as const).flatMap(group=>skillIds.map(id=>[`${group}/${id}/SKILL.md`,digest(readFileSync(candidatePath(group,id)))])));
 const lock=readFileSync(join(packageRoot,'package-lock.json'),'utf8');assert.equal(lock,baseline('package-lock.json'),'Installed dependencies must match the fixed archive lockfile');
 const installedLock=join(packageRoot,'node_modules/.package-lock.json');
 return {baselineRevision,baselineTree:execFileSync('git',['rev-parse',`${baselineRevision}:experiments/harness-lab`],{cwd:repo,encoding:'utf8'}).trim(),treatmentPaths:[...treatmentPaths],backend,candidates,packageLockHash:digest(lock),installedLockHash:existsSync(installedLock)?digest(readFileSync(installedLock)):null};
}
export async function buildRuntime(directory:string,group:RuntimeGroup):Promise<Runtime>{
 assert.ok(['E0','E1','E2'].includes(group));
 const frozen=runtimeSourceFreeze(),target=join(directory,'runtimes',group);
 await mkdir(join(directory,'runtimes'),{recursive:true,mode:0o700});
 await mkdir(target,{mode:0o700}); // Never silently reuse a partially built runtime.
 const archive=execFileSync('git',['archive','--format=tar',baselineRevision,...archiveNames.map(name=>`experiments/harness-lab/${name}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target);
 if(group!=='E0')for(const id of skillIds){
  const content:string=readFileSync(candidatePath(group,id),'utf8');
  assert.equal(frontmatter(content),frontmatter(baseline(skillPath(id))),'Names and catalog descriptions are not a treatment');
  writeFileSync(join(target,skillPath(id)),content);
 }
 if(group==='E2')for(const path of treatmentPaths)writeFileSync(join(target,path),readFileSync(join(packageRoot,path)));
 const after=await hashes(target),diff=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]).sort();
 const expected=[...(group==='E0'?[]:skillIds.map(skillPath)),...(group==='E2'?treatmentPaths:[])].sort();
 assert.deepEqual(diff,expected,'Runtime differs beyond its explicitly reviewed treatment whitelist');
 for(const path of ['src/pi/lab.ts','src/pi/resource-tools.ts','package.json','package-lock.json','tsconfig.json'])assert.equal(readFileSync(join(target,path),'utf8'),baseline(path),`${path} must remain baseline in all groups`);
 assert.ok(!readFileSync(join(target,'src/pi/lab.ts'),'utf8').includes('skillIds: snapshot.skills'),'Error advice must not be activated by the host');
 const ids=['synthesis','review',...skillIds];
 const metadata=await (await import(pathToFileURL(join(target,'src/resources/service.ts')).href)).loadControlledSkills(ids) as Array<{id:string;description:string;content:string;hash:string}>;
 const skills:Runtime['skills']={};
 for(const item of metadata){
  const original=baseline(skillPath(item.id));assert.equal(frontmatter(item.content),frontmatter(original));
  assert.equal(item.hash,digest(item.content));
  if(group==='E0'||!skillIds.includes(item.id as typeof skillIds[number]))assert.equal(item.content,original);
  skills[item.id]={content:item.content,hash:item.hash,description:item.description};
 }
 assert.deepEqual(runtimeSourceFreeze(),frozen,'Runtime inputs changed while copying');
 save(join(target,'runtime-integrity.json'),{group,baseline:baselineRevision,archiveHash:digest(archive),treatment:group==='E0'?'原始正文和工具':group==='E1'?'只替换两份方法正文':'工具扩展及其必要方法用法映射；不是纯工具因果',allowedDiff:diff,freeze_inputs:frozen,before,after});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,hashes:await hashes(target),start,skills};
}
