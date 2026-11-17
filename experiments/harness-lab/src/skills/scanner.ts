import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative, isAbsolute } from 'node:path';
import type { SkillPackageContent, SkillScanReport } from '../contracts/skills.js';
import { fileHash } from './package.js';
export interface SkillScannerOptions { command:string; rulesPath:string; version:string; rulesDigest:string; timeoutMs?:number; maxOutputBytes?:number }
export type SkillScanner=(content:SkillPackageContent,report:SkillScanReport)=>Promise<SkillScanReport>;
/** Fixed local rules only; package ignore files and suppressions never enter scanner configuration. */
export function semgrepScanner(options:SkillScannerOptions):SkillScanner {
  return async(content,report)=>{
    const started=performance.now();const root=await mkdtemp(join(tmpdir(),'axon-skill-scan-'));
    const finish=(state:SkillScanReport['state'],errors:string[]=[])=>({...report,state,errors,completedAt:new Date().toISOString(),elapsedMs:performance.now()-started});
    try{
      if(fileHash(await readFile(options.rulesPath))!==options.rulesDigest)return finish('failed',['固定扫描规则摘要不匹配。']);
      const targets=content.files.filter(f=>/\.(py|js|mjs|cjs)$/i.test(f.path));
      if(!targets.length)return finish('not_applicable');
      for(const file of targets){const path=join(root,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,Buffer.from(file.contentBase64,'base64'),{mode:0o400});}
      const home=join(root,'.scanner-home');await mkdir(home,{mode:0o700});
      const result=await new Promise<{code:number|null;text:string;error?:string}>(resolve=>{
        let output='',bytes=0,done=false,reason:string|undefined;
        const child=spawn(options.command,['scan','--config',options.rulesPath,'--json','--metrics=off','--disable-version-check','--no-rewrite-rule-ids','--disable-nosem','--no-git-ignore','--max-target-bytes','0','--',...targets.map(f=>f.path)],{cwd:root,env:{PATH:process.env.PATH,HOME:home,LANG:'C.UTF-8',SEMGREP_SEND_METRICS:'off',SEMGREP_ENABLE_VERSION_CHECK:'0'},stdio:['ignore','pipe','pipe'],detached:true});
        const stop=(error:string)=>{reason=error;try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
        const timer=setTimeout(()=>stop('扫描超过时限。'),options.timeoutMs??30000);
        const take=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>(options.maxOutputBytes??2*1024*1024))stop('扫描输出超过限制。');else output+=chunk.toString('utf8');};
        child.stdout.on('data',take);child.stderr.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>(options.maxOutputBytes??2*1024*1024))stop('扫描输出超过限制。');});
        child.once('error',()=>{if(!done){done=true;clearTimeout(timer);resolve({code:null,text:'',error:'扫描器不可用或无法启动。'});}});
        child.once('close',code=>{if(!done){done=true;clearTimeout(timer);resolve({code,text:output,error:reason});}});
      });
      if(result.error)return finish('failed',[result.error]);
      let data:{version?:string;results?:Array<{path:string;start:{line:number};end?:{line:number};check_id:string;extra:{message:string;severity:string}}> ;paths?:{scanned?:string[]};errors?:Array<{type?:unknown;code?:unknown;path?:unknown}>};
      try{data=JSON.parse(result.text);}catch{return finish('failed',['扫描器未返回可解析报告。']);}
      if(data.version!==options.version)return finish('failed',['扫描器版本与冻结配置不一致。']);
      const rel=(path:string)=>isAbsolute(path)?relative(root,path):path.replace(/^\.\//,'');
      const expected=new Set(targets.map(f=>f.path));
      report.scanned=[...new Set((data.paths?.scanned??[]).map(rel))].filter(p=>expected.has(p));
      for(const path of expected)if(!report.scanned.includes(path))report.skipped.push({path,reason:'扫描器未报告该文件已完成扫描。'});
      report.findings=(data.results??[]).filter(r=>expected.has(rel(r.path))).map(r=>({path:rel(r.path),line:r.start.line,endLine:r.end?.line,ruleId:r.check_id,message:r.extra.message,severity:r.extra.severity}));
      const errors=(data.errors??[]).map(error=>{
        const rawType=Array.isArray(error.type)?error.type[0]:error.type;
        const type=typeof rawType==='string'&&/^[A-Za-z][A-Za-z0-9 _-]*$/.test(rawType)?rawType:'SCAN_ERROR';
        const code=typeof error.code==='number'&&Number.isSafeInteger(error.code)?` (${error.code})`:'';
        const path=typeof error.path==='string'?rel(error.path):undefined;
        return `${type}${code}${path&&expected.has(path)?': '+path:''}`;
      });
      return finish(result.code!==0&&result.code!==1?'failed':report.skipped.length||errors.length?'partial':'completed',errors);
    }catch{return finish('failed',['扫描基础设施失败；未执行技能脚本。']);}finally{await rm(root,{recursive:true,force:true});}
  };
}
