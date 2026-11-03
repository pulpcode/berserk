import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// Review copy: the original executed driver remains unchanged in the runtime root.
const root=process.env.QUALITY_RUN_ROOT;
if(!root)throw Error('Set QUALITY_RUN_ROOT explicitly to a prepared isolated runtime directory; do not execute from the review-copy directory.');
for(const phase of ['new','old-variants','new-variants']){
 console.log('Starting '+phase+' '+new Date().toISOString());
 const child=spawn(process.execPath,[join(root,'run.mjs'),phase],{stdio:'inherit',env:process.env});
 const code=await new Promise(resolve=>{child.on('exit',resolve);child.on('error',()=>resolve(-1));});
 const rows=JSON.parse(readFileSync(join(root,phase+'-status.json'),'utf8'));
 if(code!==0||rows.some(x=>x.providerFailure||x.status!=='finished'))throw Error('Stopped: '+phase);
}
writeFileSync(join(root,'resume-complete.json'),JSON.stringify({endedAt:new Date().toISOString(),phases:3}));
