import {readFileSync,writeFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=process.env.QUALITY_RUN_ROOT; if(!root)throw Error('QUALITY_RUN_ROOT required');
const config=parseEnv(readFileSync('/Users/lau/.codex/worktrees/agent-result-grounding/berserk/experiments/harness-lab/.env.local','utf8'));
const expectedPublicConfig=JSON.parse(readFileSync(join(root,'public-config.json'),'utf8'));
for(const [k,v] of Object.entries(expectedPublicConfig))if(config[k]!==v)throw Error('Frozen public config changed: '+k);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('LLM_')));
for(const [k,v] of Object.entries(config))if(k.startsWith('LLM_'))env[k]=v;
Object.assign(process.env,env);
const args=process.argv.slice(2);const phase=args[0];
if(!['preflight','old','new','old-variants','new-variants'].includes(phase))throw Error('Expected preflight, old or new');
if(phase==='preflight'){
 const output=join(root,args[1]==='network'?'preflight-network.json':'preflight.json');if(existsSync(output))throw Error('Preflight already exists');
 process.env.PROVIDER_AUDIT_PATH=join(root,'logs',args[1]==='network'?'preflight-network-provider.jsonl':'preflight-provider.jsonl');
 await import(new URL('file://'+join(root,'verify-provider.mjs')));
 try{
 const r=await fetch(env.LLM_BASE_URL+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+env.LLM_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:env.LLM_MODEL,messages:[{role:'user',content:'Reply exactly OK.'}],max_tokens:16,stream:false,thinking:{type:'disabled'}}),signal:AbortSignal.timeout(90000)});
 const d=await r.json();const result={at:new Date().toISOString(),url:r.url,status:r.status,model:d.model,requestedModel:env.LLM_MODEL,reply:d.choices?.[0]?.message?.content,usage:d.usage,errorCode:d.error?.code};result.verified=r.ok&&result.reply?.trim()==='OK';writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.verified)process.exitCode=1;
 }catch(e){writeFileSync(output,JSON.stringify({verified:false,error:String(e),at:new Date().toISOString()}));throw e;}
}else{
 if(!JSON.parse(readFileSync(join(root,'preflight-network.json'))).verified)throw Error('Preflight required');
 const statusPath=join(root,phase+'-status.json');if(existsSync(statusPath))throw Error('Existing attempts retained; no rerun');
 const manifest=JSON.parse(readFileSync(join(root,'manifest.json')));
 const variant=phase.endsWith('-variants');const version=phase.split('-')[0];const runs=(variant?['shared-object'].map(name=>({name:version+'-variant-'+name,fixture:name+'-input.json',status:'planned'})):manifest.runs.filter(n=>n.startsWith(phase+'-')).map(name=>({name,status:'planned'})));
 const save=()=>writeFileSync(statusPath,JSON.stringify(runs,null,2));save();
 for(const run of runs){
  const kind=run.name.split('-')[1];const fixture=run.fixture??(kind==='text'?'multi-task-input.json':'spatial-multi-task-input.json');const script=(kind==='text'||variant)?'probe-continuous-multitask.ts':'probe-continuous-spatial.ts';
  const log=join(root,'logs',run.name+'.log');const audit=join(root,'logs',run.name+'-provider.jsonl');
  run.status='running';run.startedAt=new Date().toISOString();save();
  const fd=openSync(log,'wx',0o600);
  const child=spawn(process.execPath,['--import',join(root,'verify-provider.mjs'),'--import','tsx','scripts/'+script,join(root,'inputs',fixture)],{cwd:join(root,version),env:{...env,PROVIDER_AUDIT_PATH:audit,PROBE_SOURCE_REVISION:version==='old'?manifest.oldRevision:manifest.newDigest},stdio:['ignore',fd,fd]});
  run.exitCode=await new Promise(resolve=>{child.on('exit',resolve);child.on('error',()=>resolve(-1));});closeSync(fd);
  run.status='finished';run.endedAt=new Date().toISOString();
  for(const line of readFileSync(log,'utf8').split('\n')){try{const x=JSON.parse(line);if(x.evidence)run.evidence=x.evidence;}catch{}}
  const requests=existsSync(audit)?readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
  run.requests=requests.length;run.providerFailure=requests.some(x=>x.status!==200);
  save();console.log(JSON.stringify(run));
  if(run.providerFailure){run.stopReason='upstream_failure';save();break;}
 }
}
