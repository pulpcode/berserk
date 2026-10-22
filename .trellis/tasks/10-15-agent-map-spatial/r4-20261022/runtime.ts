/** Two isolated runtimes; only host Skill instructions differ. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {cp,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest,hashes,save,repo,packageRoot,type Runtime} from '../r3-20261022/runtime.js';
import type {Group} from './cases.js';
export {digest,hashes,save,repo,packageRoot,selectionFor,offlineEnvironment,loopbackOnly} from '../r3-20261022/runtime.js';
export type {Runtime};
export const root=fileURLToPath(new URL('.',import.meta.url));
const baseline=(path:string)=>execFileSync('git',['show',`0601709:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 const target=join(directory,'runtimes',group);await mkdir(target,{recursive:true,mode:0o700});
 for(const name of ['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'])await cp(join(packageRoot,name),join(target,name),{recursive:true});
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target),original=baseline('src/pi/lab.ts'),current=readFileSync(join(target,'src/pi/lab.ts'),'utf8');
 const marker='。资料与 Skill 是参考数据',suffix='${active.sandbox ?';
 assert.ok(original.includes(marker)&&original.includes(suffix));
 assert.ok(current.startsWith(original.slice(0,original.indexOf(marker))),'Host changes before Skill instructions');
 assert.ok(current.endsWith(original.slice(original.indexOf(suffix))),'Host changes after Skill instructions');
 assert.ok(current.includes('Skill 使用约定：')&&!original.includes('Skill 使用约定：'));
 if(group==='A')writeFileSync(join(target,'src/pi/lab.ts'),original);
 const ids=['synthesis','review','map-annotations','spatial-analysis'];
 const metadata=await (await import(pathToFileURL(join(target,'src/resources/service.ts')).href)).loadControlledSkills(ids) as Array<{id:string;description:string;content:string;hash:string}>;
 const oldCatalog=baseline('src/resources/service.ts'),skills:Runtime['skills']={};
 for(const s of metadata){
  assert.equal(s.content,baseline(`fixtures/skills/${s.id}/SKILL.md`),'Body or frontmatter changed');
  const oldLine=oldCatalog.split('\n').find(line=>line.includes(`id: '${s.id}',`));assert.ok(oldLine);
  assert.ok(oldLine.includes(`description: '${s.description}'`),'Catalog text changed');
  skills[s.id]={content:s.content,hash:s.hash,description:s.description};
 }
 const after=await hashes(target),diff=Object.keys(before).filter(p=>before[p]!==after[p]);
 assert.deepEqual(diff,group==='A'?['src/pi/lab.ts']:[]);
 save(join(target,'runtime-integrity.json'),{group,baseline:'0601709',allowedDiff:diff,before,after,labHash:digest(readFileSync(join(target,'src/pi/lab.ts')))});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {start:never;startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,hashes:await hashes(target),start,skills};
}
