/** Archive the entire R4 product; L1 changes only the skill_read candidate schema. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest,hashes,save,repo,packageRoot,type Runtime} from '../r3-20261022/runtime.js';
import type {Group} from './cases.js';
export {digest,hashes,save,repo,packageRoot,selectionFor,offlineEnvironment,loopbackOnly} from '../r3-20261022/runtime.js';
export type {Runtime};
export const root=fileURLToPath(new URL('.',import.meta.url));
export const baselineRevision='b56de822cec4ee2519ac8a24eb307a6230cac29d';
export const candidatePath='src/pi/resource-tools.ts';
const baseline=(path:string)=>execFileSync('git',['show',`${baselineRevision}:experiments/harness-lab/${path}`],{cwd:repo,encoding:'utf8'});
/** Reject accidental error advice / prompt / execution edits in the candidate file. */
export function candidateSource(){
 const before=baseline(candidatePath),current=readFileSync(join(packageRoot,candidatePath),'utf8');
 const expected=before.replace("    defineTool({ name: 'skill_read',","    ...(snapshot.skills.length ? [defineTool({ name: 'skill_read',")
 .replace("parameters: Type.Object({ id: Type.String() }, { additionalProperties: false }), executionMode: 'sequential',\n      execute: (_id, params, signal) => execute(async () => {\n        const skill = snapshotSkill", "parameters: Type.Object({ id: Type.Union(snapshot.skills.map(skill => Type.Literal(skill.id, { description: `${skill.name}：${skill.description}` }))) }, { additionalProperties: false }), executionMode: 'sequential',\n      execute: (_id, params, signal) => execute(async () => {\n        const skill = snapshotSkill")
 .replace('      }, signal, timeouts.skill_read) }),','      }, signal, timeouts.skill_read) })] : []),');
 assert.notEqual(expected,before);assert.equal(current,expected,'L1 may change only the candidate schema and empty-catalog omission');return current;
}
export async function buildRuntime(directory:string,group:Group):Promise<Runtime>{
 const target=join(directory,'runtimes',group);await mkdir(target,{recursive:true,mode:0o700});
 const names=['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'];
 const archive=execFileSync('git',['archive','--format=tar',baselineRevision,...names.map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');
 const before=await hashes(target),candidate=candidateSource();
 assert.equal(readFileSync(join(target,'package-lock.json'),'utf8'),readFileSync(join(packageRoot,'package-lock.json'),'utf8'),'Installed dependencies must match archive lockfile');
 if(group==='B')writeFileSync(join(target,candidatePath),candidate);
 const after=await hashes(target),diff=Object.keys(before).filter(p=>before[p]!==after[p]);
 assert.deepEqual(diff,group==='B'?[candidatePath]:[],'Only candidate schema may differ from R4-B');
 const ids=['synthesis','review','map-annotations','spatial-analysis'];
 const metadata=await (await import(pathToFileURL(join(target,'src/resources/service.ts')).href)).loadControlledSkills(ids) as Array<{id:string;description:string;content:string;hash:string}>;
 const skills:Runtime['skills']={};
 for(const s of metadata){assert.equal(s.content,baseline(`fixtures/skills/${s.id}/SKILL.md`));skills[s.id]={content:s.content,hash:s.hash,description:s.description};}
 save(join(target,'runtime-integrity.json'),{group,label:group==='A'?'L0':'L1',baseline:baselineRevision,archiveHash:digest(archive),candidateHash:digest(candidate),allowedDiff:diff,before,after});
 const start=(await import(pathToFileURL(join(target,'scripts/probe-situation-map.ts')).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,hashes:await hashes(target),start,skills};
}
