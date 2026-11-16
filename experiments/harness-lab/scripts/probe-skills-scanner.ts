import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityService } from '../src/capabilities/service.js';
import { initializeR2Schema } from '../src/capabilities/management.js';
import { SkillService } from '../src/skills/service.js';
import type { SkillActor, SkillScanReport } from '../src/contracts/skills.js';

const command = process.env.LAB_SKILL_SCANNER_COMMAND || 'semgrep';
const manifestRoot = fileURLToPath(new URL('../fixtures/skill-scanning/', import.meta.url));
const manifest = JSON.parse(await readFile(join(manifestRoot,'manifest.json'),'utf8')) as {scannerVersion:string;rulesDigest:string};
const actor:SkillActor = {userId:'isolated-probe-administrator', assertAdministrator:()=>{}};
const principal = {userId:'isolated-business-user',seatId:'business',canCollaborate:true};
const dataDir = await mkdtemp(join(tmpdir(),'axon-r3-real-scan-'));
const cap = await CapabilityService.open(dataDir); initializeR2Schema(cap.db); cap.close();
const service = await SkillService.open(dataDir,{createdNew:true,seats:()=>['business'],scanner:{command,rulesPath:join(manifestRoot,'rules.yaml'),version:manifest.scannerVersion,rulesDigest:manifest.rulesDigest}});
const file=(path:string,content:string)=>({path,contentBase64:Buffer.from(content).toString('base64')});
const method=file('SKILL.md','---\nname: probe-method\ndescription: Isolated scanner fixtures\n---\nUse the supplied data.');
const reports:Array<{name:string;report:SkillScanReport}>=[];
async function waitForScan(skillId:string,packageDigest:string){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    const report=service.scans(actor,skillId).find(s=>s.packageDigest===packageDigest);
    if(report&&!['pending','running'].includes(report.state))return report;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Real scanner did not reach a terminal state');
}
try{
  for(const sample of [
    {name:'method-not-applicable',files:[]},
    {name:'python-javascript-findings',files:[file('scripts/unsafe.py','value=input()\neval(value) # nosemgrep\n'),file('scripts/unsafe.js',"const cp=require('child_process'); function run(cmd){ return cp.spawn(cmd,{shell:true}); }\n"),file('.semgrepignore','scripts/\n')]},
    {name:'python-javascript-no-findings',files:[file('scripts/safe.py','print(sum([1,2,3]))\n'),file('scripts/safe.js','console.log(1+2+3);\n')]},
    {name:'unsupported-language-partial',files:[file('scripts/safe.py','print(1)\n'),file('scripts/uncovered.rb','puts 1\n')]},
    {name:'actual-parse-error',files:[file('scripts/broken.py','eval(\n"unterminated')]},
  ]){
    const created=await service.create(actor,{clientActionId:randomUUID()});
    const id=created.skill.skillId;
    const draft=await service.saveDraft(actor,id,{expectedDraftRevision:1,files:[method,...sample.files]});
    await service.setPolicy(actor,id,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
    // Publication is valid before any successful trial or scan exists.
    const published=await service.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:sample.name,clientActionId:randomUUID()});
    assert.equal((await service.resolve(published,principal)).packageDigest,draft.packageDigest);
    const report=await waitForScan(id,draft.packageDigest);
    reports.push({name:sample.name,report});
    if(sample.name==='method-not-applicable')assert.equal(report.state,'not_applicable');
    if(sample.name==='python-javascript-findings'){
      assert.equal(report.state,'completed');assert.equal(report.scanned.length,2);
      assert(report.findings.some(f=>f.path.endsWith('.py')));assert(report.findings.some(f=>f.path.endsWith('.js')));
      assert(report.findings.every(f=>f.line>0&&!f.ruleId.includes('/')&&!f.ruleId.includes('Users.')));
    }
    if(sample.name==='python-javascript-no-findings'){assert.equal(report.state,'completed');assert.equal(report.findings.length,0);}
    if(sample.name==='unsupported-language-partial'){assert.equal(report.state,'partial');assert(report.skipped.some(s=>s.path.endsWith('.rb')));}
    if(sample.name==='actual-parse-error'){assert(['partial','failed'].includes(report.state));assert(report.errors.length>0);}
  }
}finally{service.close();}

// Missing infrastructure is a real process-start failure, not a fake scan result.
const unavailableDir=await mkdtemp(join(tmpdir(),'axon-r3-missing-scan-'));
const unavailableCap=await CapabilityService.open(unavailableDir);initializeR2Schema(unavailableCap.db);unavailableCap.close();
const unavailable=await SkillService.open(unavailableDir,{createdNew:true,seats:()=>['business'],scanner:{command:join(unavailableDir,'nonexistent-semgrep'),rulesPath:join(manifestRoot,'rules.yaml'),version:manifest.scannerVersion,rulesDigest:manifest.rulesDigest}});
try{
  const created=await unavailable.create(actor,{clientActionId:randomUUID()});
  const draft=await unavailable.saveDraft(actor,created.skill.skillId,{expectedDraftRevision:1,files:[method,file('scripts/safe.py','print(1)')]});
  const deadline=Date.now()+10000;let report:SkillScanReport|undefined;
  while(Date.now()<deadline){report=unavailable.scans(actor,created.skill.skillId).find(s=>s.packageDigest===draft.packageDigest);if(report?.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(report?.state,'failed');reports.push({name:'actual-missing-executable',report:report!});
  await unavailable.setPolicy(actor,created.skill.skillId,{expectedRevision:0,mode:'seats',seatIds:['business'],clientActionId:randomUUID()});
  await unavailable.publish(actor,created.skill.skillId,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'Missing scanner remains report only',clientActionId:randomUUID()});
}finally{unavailable.close();}
const evidence=join(dataDir,'scanner-evidence.json');
await writeFile(evidence,JSON.stringify({passed:true,scannerVersion:manifest.scannerVersion,rulesDigest:manifest.rulesDigest,reports},null,2)+'\n');
console.log(JSON.stringify({passed:true,cases:reports.length,evidence}));
