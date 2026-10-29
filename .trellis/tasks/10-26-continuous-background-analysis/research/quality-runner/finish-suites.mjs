import {readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=process.env.QUALITY_RUN_ROOT??dirname(fileURLToPath(import.meta.url));
const states=phase=>JSON.parse(readFileSync(join(root,phase+'-status.json'),'utf8'));
const completed=phase=>{const rows=states(phase);if(rows.some(x=>x.providerFailure||x.stopReason==='upstream_failure'))throw Error('Stopped after upstream failure in '+phase);return rows.every(x=>x.status==='finished');};
const deadline=Date.now()+4*60*60*1000;
while(!completed('new')){if(Date.now()>deadline)throw Error('Original suite did not finish before bounded wait deadline');await new Promise(resolve=>setTimeout(resolve,5000));}
for(const phase of ['old-variants','new-variants']){
 if(existsSync(join(root,phase+'-status.json')))throw Error('Existing attempts retained: '+phase);
 console.log('Starting authorized frozen phase '+phase+' at '+new Date().toISOString());
 const child=spawn(process.execPath,[join(root,'run.mjs'),phase],{stdio:'inherit',env:process.env});
 const code=await new Promise(resolve=>{child.on('exit',resolve);child.on('error',()=>resolve(-1));});
 if(code!==0||!completed(phase))throw Error('Phase incomplete; no subsequent paid runs: '+phase);
}
console.log('All fixed suites finished at '+new Date().toISOString());
