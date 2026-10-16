/** Execute the frozen schedule once; stop on source drift, never overwrite or rerun a failed entry. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spatialSchedule} from './probe-spatial-cases.js';
export const spatialEvidenceFiles=['package.json','package-lock.json','tsconfig.json'];
const root=fileURLToPath(new URL('../',import.meta.url));
export async function spatialEvidenceHashes(){
  const files=[...spatialEvidenceFiles];
  const walk=async(directory:string):Promise<void>=>{
    for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
      const file=directory+'/'+entry.name;
      if(entry.isDirectory())await walk(file);
      else if(entry.isFile())files.push(file);
      else throw new Error(`Non-regular evaluation source: ${file}`);
    }
  };
  // Include actual HTTP/auth/Pi/transitive helper code and every controlled model-visible fixture.
  for(const directory of ['src','fixtures','scripts'])await walk(directory);
  return Promise.all(files.sort().map(async file=>({file,sha256:createHash('sha256').update(await readFile(join(root,file))).digest('hex')})));
}
async function main(){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw new Error('用法：--output 新目录；执行冻结216试次，无重试/覆盖');
  const output=resolve(args[1]);await mkdir(output,{mode:0o700});const schedule=spatialSchedule(),hashes=await spatialEvidenceHashes();
  const save=(file:string,value:unknown)=>writeFile(join(output,file),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  const outcomes:Array<{id:string;exitCode:number|null;status:string}>=[],attempts:Array<{id:string;status:string}>=[];let drift=false;
  await save('schedule.json',{scheduled:216,schedule,hashes,startedAt:new Date().toISOString()});
  for(const entry of schedule){
    if(JSON.stringify(await spatialEvidenceHashes())!==JSON.stringify(hashes)){drift=true;break;}
    attempts.push({id:entry.id,status:'started'});await save('attempts.json',attempts);
    const code=await new Promise<number|null>((resolveExit)=>{
      const child=spawn(process.execPath,['--import','tsx',join(root,'scripts/probe-spatial-evaluation.ts'),'--entry',entry.id,'--output',join(output,entry.id)],{cwd:root,env:process.env,stdio:'inherit'});
      child.once('error',()=>resolveExit(null));child.once('exit',resolveExit);
    });
    let status='missing_result';try{status=(JSON.parse(await readFile(join(output,entry.id,'result.json'),'utf8')) as {status:string}).status;}catch{/* Missing output remains a failed scheduled entry. */}
    const afterHashes=await spatialEvidenceHashes();
    if(JSON.stringify(afterHashes)!==JSON.stringify(hashes)){
      drift=true;status='source_drift';
      await writeFile(join(output,entry.id,'source-drift.json'),JSON.stringify({before:hashes,after:afterHashes})+'\n',{mode:0o600});
    }
    attempts[attempts.length-1].status=status;await save('attempts.json',attempts);
    outcomes.push({id:entry.id,exitCode:code,status});await save('progress.json',{scheduled:216,executed:outcomes.length,remaining:216-outcomes.length,outcomes,semanticReview:'pending_review'});
    console.info(JSON.stringify({completed:outcomes.length,scheduled:216,entry:entry.id,status}));
    if(drift)break;
  }
  await save('batch-result.json',{scheduled:216,executed:outcomes.length,unrun:schedule.slice(outcomes.length),outcomes,sourceDrift:drift,semanticReview:'pending_review',semanticSuccess:null});
  if(drift||outcomes.some(item=>item.exitCode!==0))process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(String(error));process.exitCode=1;});
