import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {mkdir,symlink,cp} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,packageRoot,hashes,save,digest,type Runtime as Base} from '../../10-15-agent-map-spatial/r3-20261022/runtime.js';
import {fixture,sourceScene} from './data.js';
export {repo,packageRoot,hashes,save,digest};
export const revision='925314f995f1e05f136818bcc18a6bd99c7e9614';
export interface Runtime extends Base {skills:Record<string,{name:string;description:string;hash:string;content:string}>}
export async function buildRuntime(directory:string,id:string):Promise<Runtime>{
 const target=join(directory,id);await mkdir(target,{recursive:true,mode:0o700});
 const archive=execFileSync('git',['archive','--format=tar',revision,...['src','scripts','fixtures','package.json','package-lock.json','tsconfig.json'].map(n=>`experiments/harness-lab/${n}`)],{cwd:repo,maxBuffer:64*1024*1024});
 execFileSync('tar',['-xf','-','--strip-components=2','-C',target],{input:archive});assert.equal(readFileSync(join(target,'package-lock.json'),'utf8'),readFileSync(join(packageRoot,'package-lock.json'),'utf8'));
 await symlink(join(packageRoot,'node_modules'),join(target,'node_modules'),'dir');await cp(join(packageRoot,'dist'),join(target,'dist'),{recursive:true});
 const before=await hashes(target),f=fixture(id),scene=sourceScene(id);const region=scene.objects.find(o=>o.ref.objectType==='area')!;
 // The isolated mock exposes exactly the supplied facts. No oracle or expected result enters the archive.
 writeFileSync(join(target,'scripts/mock-context/map-fixtures.ts'),`export function mapFixtures(_instanceId:string,_day:string){return ${JSON.stringify(scene)};}\n`);
 const path=join(target,'scripts/probe-situation-map.ts');let s=readFileSync(path,'utf8');
 const replace=(old:string,value:string)=>{assert.equal(s.split(old).length,2,'fixture adapter anchor drift: '+old.slice(0,60));s=s.replace(old,value);};
 replace("const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());","const day='2026-10-30';");
 const start=s.indexOf('    const context=parseContextConfig('),end=s.indexOf('    const background=parseBackgroundConfig',start);assert.ok(start>0&&end>start);
 s=s.slice(0,start)+`    const context=parseContextConfig({systems:[{id:'intel',name:'空白资料系统',adapter:'mock-information-http',baseUrl:mockUrl+'/intel',tokenEnv:'MOCK_CONTEXT_API_TOKEN',areas:[]},{id:'situation',name:'来源系统',adapter:'mock-situation-http',baseUrl:mockUrl+'/situation',tokenEnv:'MOCK_CONTEXT_API_TOKEN',areas:[${JSON.stringify({id:region.ref.objectId,name:region.name})}]}],scopes:[{id:'demo-context',name:'本轮资料',systemIds:['intel','situation'],seatIds:seats.map(seat=>'seat-'+seat)}],simulation:{enabled:true,baseUrl:mockUrl,tokenEnv:'MOCK_CONTEXT_CONTROL_TOKEN',sources:[{systemId:'intel',sourceId:'mock-intel-source'},{systemId:'situation',sourceId:'mock-situation-source'}]}});\n`+s.slice(end);
 const a=s.indexOf('          context:{businessRefs:'),b=s.indexOf('}).id;',a);assert.ok(a>0&&b>a);s=s.slice(0,a)+"          context:{businessRefs:[],focus:{areaIds:[],topics:[]}}"+s.slice(b);
 const x=s.indexOf('      objects:{road:'),y=s.indexOf(';',x);assert.ok(x>0&&y>x);const ref=scene.objects.find(o=>o.ref.objectType==='resource')!.ref;
 s=s.slice(0,x)+`      objects:{road:${JSON.stringify(region.ref)},resource:${JSON.stringify(ref)}}}`+s.slice(y);writeFileSync(path,s);
 const loader=await import(pathToFileURL(join(target,'src/resources/service.ts')).href) as {loadControlledSkills:(ids:string[])=>Promise<Array<{id:string;name:string;description:string;content:string;hash:string}>>};
 const skills:Runtime['skills']={};for(const skill of await loader.loadControlledSkills(['synthesis','review','map-annotations','spatial-analysis']))skills[skill.id]=skill;
 const after=await hashes(target);assert.deepEqual(Object.keys(after).filter(k=>before[k]!==after[k]).sort(),['scripts/mock-context/map-fixtures.ts','scripts/probe-situation-map.ts']);
 save(join(target,'runtime-integrity.json'),{revision,archiveHash:digest(archive),fixture:id,sourceMapping:{[f.logical_source_system_id]:'situation'},before,after,productSourceUnchanged:true});
 const startTrial=(await import(pathToFileURL(path).href) as {startMapTrial:Runtime['start']}).startMapTrial;
 return {root:target,skills,hashes:await hashes(target),start:startTrial};
}
