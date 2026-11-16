/** Complete R2 -> R3 -> restored-R2 proof using separate synthetic roots and explicit requests only. */
import assert from 'node:assert/strict';
import { SkillService } from '../src/skills/service.js';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { ComposerSelection, SessionSnapshot, StreamEvent } from '../src/contracts/index.js';
import type { LabConfig } from '../src/server/config.js';
import { PiLab } from '../src/pi/lab.js';
import { migrateSkillsR3 } from '../src/skills/migration.js';
import { fakeRuntime, testConfig } from '../tests/pi/fake-runtime.js';

interface RollbackLab {
  createSession():Promise<SessionSnapshot>;
  get(id:string):SessionSnapshot;
  start(id:string,text:string,input?:ComposerSelection):{run(listener:(event:StreamEvent)=>void):Promise<void>};
  close():Promise<void>;
}
const value=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const baselineRoot=value('--baseline-root'),output=value('--output');
assert(baselineRoot&&isAbsolute(baselineRoot),'--baseline-root ABS repository path is required');
assert(output&&isAbsolute(output),'--output ABS report path is required');
const baselineSha='5969069f565d28c753962daca1fe8bf3de17885c';
const repository=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const paths=execFileSync('git',['-C',repository,'ls-tree','-r','-z','--name-only',baselineSha,'--','experiments/harness-lab'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert(paths.length>0);
for(const file of paths){const expected=execFileSync('git',['show',`${baselineSha}:${file}`],{maxBuffer:32*1024*1024});assert.deepEqual(await readFile(join(baselineRoot,file)),expected,`Actual R2 baseline file mismatch: ${file}`);}
const baseline=await import(pathToFileURL(join(baselineRoot,'experiments/harness-lab/src/pi/lab.ts')).href) as {PiLab:{create(config:LabConfig,runtime:Parameters<typeof PiLab.create>[1]):Promise<RollbackLab>}};
const root=await mkdtemp(join(tmpdir(),'axon-r3-rollback-'));
const source=join(root,'data'),backup=join(root,'before-r3'),restored=join(root,'restored-r2');
const sha=(body:Uint8Array|string)=>createHash('sha256').update(body).digest('hex');
async function inventory(directory:string,prefix=''):Promise<Array<{path:string;digest:string}>>{
  const files:Array<{path:string;digest:string}>=[];
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix?`${prefix}/${entry.name}`:entry.name;const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await inventory(path,name));else{assert(entry.isFile(),'Unexpected nonregular file');files.push({path:name,digest:sha(await readFile(path))});}
  }
  return files;
}
async function sessionPath(directory:string,id:string){const names=await readdir(join(directory,'sessions'));const name=names.find(item=>item.endsWith(`_${id}.jsonl`));assert(name,'Native history missing');return join(directory,'sessions',name);}
const opened:Array<RollbackLab>=[];
const close=async(lab:RollbackLab)=>{await lab.close();opened.splice(opened.indexOf(lab),1);};
try{
  const originalConfig=testConfig(source);
  const originalFake=await fakeRuntime(originalConfig,()=>({text:'R2原始回答：合成计划10件，已完成8件，剩余2件。'}));
  const originalLab=await baseline.PiLab.create(originalConfig,originalFake.runtime);opened.push(originalLab);
  const session=await originalLab.createSession();const initialRevision=session.expert!.revisionId;
  assert.equal(originalFake.calls.length,0);
  const legacyMethod=await readFile(join(baselineRoot,'experiments/harness-lab/fixtures/skills/review/SKILL.md'));
  await originalLab.start(session.id,'初始合成任务：计划10件，已完成8件，请核对。',{skill:{id:'review',hash:sha(legacyMethod)}}).run(()=>{});
  assert.equal(originalFake.calls.length,1);assert.equal(originalLab.get(session.id).lastResult?.status,'succeeded');
  const native=await sessionPath(source,session.id);const initialHistory=await readFile(native);await close(originalLab);
  const sourceBefore=await inventory(source);
  const dryRun=await migrateSkillsR3({dataDir:source,backupDir:backup,apply:false,serviceStopped:false});
  assert.deepEqual(await inventory(source),sourceBefore,'Dry run changed the R2 root');
  const applied=await migrateSkillsR3({dataDir:source,backupDir:backup,apply:true,serviceStopped:true});
  const backupBefore=await inventory(backup);assert.deepEqual(backupBefore,sourceBefore,'Complete stopped-root backup is not identical');

  const upgradedConfig=testConfig(source);const upgradedFake=await fakeRuntime(upgradedConfig,()=>({text:'R3显式续聊完成：仍依据原始合成输入，剩余2件。'}));
  const upgradedLab=await PiLab.create(upgradedConfig,upgradedFake.runtime);opened.push(upgradedLab);
  const afterUpgrade=upgradedLab.get(session.id);assert.equal(afterUpgrade.expert!.revisionId,initialRevision);assert.equal(upgradedFake.calls.length,0,'Open/GET replayed work');
  assert.deepEqual(await readFile(native),initialHistory,'Open/GET rewrote native history');
  await upgradedLab.start(session.id,'R3显式续聊：请复核原始事实。').run(()=>{});
  assert.equal(upgradedLab.get(session.id).lastResult?.status,'succeeded');assert.equal(upgradedFake.calls.length,1);
  assert(JSON.stringify(upgradedFake.calls[0].context.messages).includes('初始合成任务'));
  let upgradedHistory=await readFile(native);assert(upgradedHistory.subarray(0,initialHistory.length).equals(initialHistory),'R3 lost original native prefix');await close(upgradedLab);

  // Fixture-only core actor: this is persistence evidence, not HTTP authorization evidence.
  const skillService=await SkillService.open(source);let publication;let methodHash='';
  try{const actor={userId:'synthetic-admin',assertAdministrator:()=>{}};const made=await skillService.create(actor,{clientActionId:randomUUID()});const id=made.skill.skillId;
    const draft=await skillService.saveDraft(actor,id,{expectedDraftRevision:1,files:[{path:'SKILL.md',contentBase64:Buffer.from('---\nname: rollback-method\ndescription: Synthetic rollback fixture\n---\nR3方法固定核对合成输入的数量。\n').toString('base64')}]});
    await skillService.setPolicy(actor,id,{expectedRevision:0,mode:'all',seatIds:[],clientActionId:randomUUID()});
    publication=await skillService.publish(actor,id,{expectedDraftRevision:draft.draftRevision,expectedCurrentRevisionId:null,releaseNotes:'合成回退证据',clientActionId:randomUUID()});methodHash=skillService.methodHash(publication);
  }finally{skillService.close();}
  const packageFake=await fakeRuntime(upgradedConfig,()=>({text:'R3新技能明确选择完成：剩余2件。'}));const packageLab=await PiLab.create(upgradedConfig,packageFake.runtime);opened.push(packageLab);
  assert.equal(packageFake.calls.length,0);await packageLab.start(session.id,'R3明确选用新技能核对相同合成输入。',{skill:{id:publication.skillId,revisionId:publication.revisionId,packageDigest:publication.packageDigest,hash:methodHash}}).run(()=>{});
  assert.equal(packageLab.get(session.id).lastResult?.status,'succeeded');assert.equal(packageFake.calls.length,1);assert(JSON.stringify(packageFake.calls[0].context.messages).includes('R3方法固定核对合成输入的数量'));
  upgradedHistory=await readFile(native);assert(upgradedHistory.subarray(0,initialHistory.length).equals(initialHistory));await close(packageLab);const upgradedInventory=await inventory(source);

  await cp(backup,restored,{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
  assert.notEqual(restored,source);assert.deepEqual(await inventory(restored),backupBefore);
  const restoredConfig=testConfig(restored);const restoredFake=await fakeRuntime(restoredConfig,()=>({text:'R2恢复后的明确续聊完成：计划10件、完成8件、剩余2件。'}));
  // Old code is opened ONLY against the restored original backup, never against the upgraded root.
  const restoredLab=await baseline.PiLab.create(restoredConfig,restoredFake.runtime);opened.push(restoredLab);
  const rollbackSnapshot=restoredLab.get(session.id);assert.equal(rollbackSnapshot.expert!.revisionId,initialRevision);assert.equal(restoredFake.calls.length,0,'Rollback open/GET replayed work');
  const restoredNative=await sessionPath(restored,session.id);assert.deepEqual(await readFile(restoredNative),initialHistory,'Rollback open/GET rewrote original history');
  assert(!JSON.stringify(rollbackSnapshot.messages).includes('R3显式续聊完成'),'Upgraded-only work leaked into restored baseline');
  await restoredLab.start(session.id,'R2恢复后的显式续聊：仅依据升级前历史核对。').run(()=>{});
  assert.equal(restoredLab.get(session.id).lastResult?.status,'succeeded');assert.equal(restoredFake.calls.length,1);
  assert(JSON.stringify(restoredFake.calls[0].context.messages).includes('初始合成任务'));
  const restoredHistory=await readFile(restoredNative);assert(restoredHistory.subarray(0,initialHistory.length).equals(initialHistory),'Restored R2 lost original prefix');await close(restoredLab);
  assert.deepEqual(await inventory(backup),backupBefore,'The original backup was modified by recovery');
  assert.deepEqual(await readFile(native),upgradedHistory,'Restored R2 modified the upgraded root');assert.deepEqual(await inventory(source),upgradedInventory,'Rollback modified active R3 root');
  const result={passed:true,measuredAt:new Date().toISOString(),baseline:{commit:baselineSha,source:'actual fixed R2 git archive; every tracked app file verified against git object',verifiedFileCount:paths.length},environment:{node:process.version,model:'deterministic-provider-substitute; real native Pi loop',productionData:false,docker:false},sessionId:session.id,expertRevision:initialRevision,dryRun,applied,checks:{dryRunByteStable:true,completeBackupVerified:true,r3OpenAndGetNoCalls:true,r3ExplicitContinuation:true,r3NewSkillPublishedAndUsed:true,legacySkillComposerHistoryReadable:true,oldCodeOpenedOnlyRestoredBackup:true,restoredOpenAndGetNoCalls:true,restoredExplicitContinuation:true,backupOriginalUntouched:true,upgradedRootUntouchedByRollback:true,originalNativePrefixPreserved:true},evidence:{originalHistorySha256:sha(initialHistory),upgradedHistorySha256:sha(upgradedHistory),restoredHistorySha256:sha(restoredHistory),originalBackupInventorySha256:sha(JSON.stringify(backupBefore)),filesInCompleteBackup:backupBefore.length},modelCalls:{initialR2:originalFake.calls.length,explicitR3:upgradedFake.calls.length,newR3Skill:packageFake.calls.length,restoredR2:restoredFake.calls.length},limits:['Model transport is deterministic; this proves native persistence, complete backup and version-paired rollback rather than live model quality.','Only fresh synthetic data is used. Original backup is copied before old-code recovery and compared byte-for-byte afterward.','Temporary roots are removed after hashes and checks are written.','Skill publication uses a synthetic core actor; this is not HTTP authentication evidence.','No assertion that old R2 automatically rejects additive R3 database metadata; old code opens only a separate restored backup copy.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  await writeFile(join(dirname(output),'rollback-proof-r3-note.md'),`# R3 完整备份与配对回退证明（确定性模型）\n\n实际基线为 ${baselineSha}；通过 --baseline-root 指定本地仓库，脚本逐文件核对归档中全部受跟踪应用文件与该实际Git对象完全一致。真实原生 Pi 循环仅替换模型传输，先由 R2 创建合成会话并明确发送一次；停服后 R3 dry-run 保持字节不变，apply 完整备份原数据。R3 打开/GET 不调用模型且不改历史，明确发送才追加一轮；随后以合成core管理员fixture发布新的方法包，并在实际Pi会话中明确选择使用，固定正文进入provider输入。该fixture不是HTTP认证或真实模型证据。\n\n随后仅复制升级前原备份到独立恢复目录，由实际 R2 代码打开该副本并明确续聊。旧代码从不访问升级后的活动根。验证原修订与历史前缀保留、原备份逐文件摘要不变、升级活动根未被回退修改。旧R2仅打开独立恢复副本，不宣称其必然拒绝R3新增表。环境不含真实业务资料、凭据、网络模型或Docker；这不是生产迁移，也不替代真实模型/Docker验收。\n\n复现：在 experiments/harness-lab 使用 node --import tsx scripts/probe-skills-r3-rollback.ts --baseline-root ABS_R2_REPOSITORY --output ABS_REPORT_JSON。结果见 rollback-proof-r3.json。\n`);
  console.log(JSON.stringify({output,baseline:baselineSha,checks:result.checks,modelCalls:result.modelCalls}));
}finally{for(const lab of opened.reverse())await lab.close();await rm(root,{recursive:true,force:true});}
