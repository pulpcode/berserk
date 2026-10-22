/** Isolated native product runtime. No imports from old evaluation entrypoints/budgets. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {cp,mkdir,readdir,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {startMapTrial} from '../../../../experiments/harness-lab/scripts/probe-situation-map.js';
import type {WorkspaceResources} from '../../../../experiments/harness-lab/src/contracts/index.js';
import type {Case,Group,Loading} from './cases.js';
export const root=fileURLToPath(new URL('.',import.meta.url));
export const repo=resolve(root,'../../../..'),packageRoot=join(repo,'experiments/harness-lab');
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const save=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
export async function hashes(dir:string,prefix=''):Promise<Record<string,string>>{
 const out:Record<string,string>={};for(const e of await readdir(join(dir,prefix),{withFileTypes:true})){
  const p=join(prefix,e.name);if(e.isSymbolicLink())continue;
  if(e.isDirectory())Object.assign(out,await hashes(dir,p));else out[p]=digest(readFileSync(join(dir,p)));
 }return out;
}
function frontmatter(content:string){const match=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);assert.ok(match,'Skill frontmatter required');return match[0];}
export interface Runtime {root:string;hashes:Record<string,string>;start:typeof startMapTrial;skills:Record<string,{content:string;hash:string;description:string}>}
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 const target=join(directory,'runtimes',group);await mkdir(target,{recursive:true,mode:0o700});
 for(const name of ['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'])await cp(join(packageRoot,name),join(target,name),{recursive:true});
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target),skills:Runtime['skills']={};
 const changed=group==='map-only'?'map-annotations':group==='spatial-only'?'spatial-analysis':undefined;
 for(const id of ['map-annotations','spatial-analysis']){
  const path=join('fixtures/skills',id,'SKILL.md'),original=readFileSync(join(target,path),'utf8');
  const candidate=readFileSync(join(root,'skills',group,id,'SKILL.md'),'utf8');
  assert.equal(frontmatter(candidate),frontmatter(original),'Catalog treatment is excluded');
  await cp(join(root,'skills',group,id,'SKILL.md'),join(target,path));skills[id]={content:candidate,hash:digest(candidate),description:''};
 }
 const metadata=await (await import(pathToFileURL(join(target,'src/resources/service.ts')).href)).loadControlledSkills(Object.keys(skills)) as Array<{id:string;description:string}>;
 for(const item of metadata)skills[item.id].description=item.description;
 const after=await hashes(target),diff=Object.keys(before).filter(p=>before[p]!==after[p]);
 assert.deepEqual(diff,changed?[`fixtures/skills/${changed}/SKILL.md`]:[],'Only intended body may differ');
 save(join(target,'runtime-integrity.json'),{group,allowedDiff:diff,before,after});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:typeof startMapTrial}).startMapTrial;
 return {root:target,hashes:await hashes(target),skills,start};
}
export function selectionFor(spec:Case,loading:Loading,catalog:WorkspaceResources){
 const skill=catalog.skills.find(s=>s.id===spec.targetSkill);assert.ok(skill,'Missing catalog skill');
 return loading==='explicit'?{id:skill.id,hash:skill.hash}:undefined;
}
/** Replace all provider values; .env files are never loaded by this preparation driver. */
export function offlineEnvironment():NodeJS.ProcessEnv{return {...process.env,LLM_PROVIDER:'deepseek',LLM_MODEL:'deepseek-v4-pro',LLM_API_KEY:'offline-placeholder',LLM_BASE_URL:'https://api.deepseek.com',LLM_CONTEXT_WINDOW:'1000000',LLM_MAX_OUTPUT_TOKENS:'4096',LLM_REQUEST_TIMEOUT_MS:'60000',LAB_EXECUTION_ENABLED:'false',LAB_LISTEN_HOST:'127.0.0.1',LAB_PUBLIC_ORIGIN:undefined};}
export function loopbackOnly(original:typeof fetch):typeof fetch{return async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),`Offline driver refuses external request: ${url.origin}`);
 return original(input,init);
};}
