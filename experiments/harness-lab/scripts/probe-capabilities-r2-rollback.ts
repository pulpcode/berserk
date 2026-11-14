/** Complete R1 -> R2 -> restored-R1 proof using separate synthetic roots and explicit requests only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { SessionSnapshot, StreamEvent } from '../src/contracts/index.js';
import type { LabConfig } from '../src/server/config.js';
import { PiLab } from '../src/pi/lab.js';
import { migrateCapabilityManagement } from '../src/capabilities/management-migration.js';
import { fakeRuntime, testConfig } from '../tests/pi/fake-runtime.js';

interface RollbackLab {
  createSession():Promise<SessionSnapshot>;
  get(id:string):SessionSnapshot;
  start(id:string,text:string):{run(listener:(event:StreamEvent)=>void):Promise<void>};
  close():Promise<void>;
}
const value=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const baselineRoot=value('--baseline-root'),output=value('--output');
assert(baselineRoot&&isAbsolute(baselineRoot),'--baseline-root ABS repository path is required');
assert(output&&isAbsolute(output),'--output ABS report path is required');
for(const file of ['experiments/harness-lab/src/pi/lab.ts','experiments/harness-lab/src/capabilities/service.ts'])execFileSync('git',['-C',baselineRoot,'diff','--quiet','HEAD','--',file]);
const baselineSha=execFileSync('git',['-C',baselineRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const baseline=await import(pathToFileURL(join(baselineRoot,'experiments/harness-lab/src/pi/lab.ts')).href) as {PiLab:{create(config:LabConfig,runtime:Parameters<typeof PiLab.create>[1]):Promise<RollbackLab>}};
const root=await mkdtemp(join(tmpdir(),'axon-r2-rollback-'));
const source=join(root,'data'),backup=join(root,'before-r2'),restored=join(root,'restored-r1');
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
  const originalFake=await fakeRuntime(originalConfig,()=>({text:'R1原始回答：合成计划10件，已完成8件，剩余2件。'}));
  const originalLab=await baseline.PiLab.create(originalConfig,originalFake.runtime);opened.push(originalLab);
  const session=await originalLab.createSession();const initialRevision=session.expert!.revisionId;
  assert.equal(originalFake.calls.length,0);
  await originalLab.start(session.id,'初始合成任务：计划10件，已完成8件，请核对。').run(()=>{});
  assert.equal(originalFake.calls.length,1);assert.equal(originalLab.get(session.id).lastResult?.status,'succeeded');
  const native=await sessionPath(source,session.id);const initialHistory=await readFile(native);await close(originalLab);
  const sourceBefore=await inventory(source);
  const dryRun=await migrateCapabilityManagement({dataDir:source,backupDir:backup,apply:false,serviceStopped:false});
  assert.deepEqual(await inventory(source),sourceBefore,'Dry run changed the R1 root');
  const applied=await migrateCapabilityManagement({dataDir:source,backupDir:backup,apply:true,serviceStopped:true});
  const backupBefore=await inventory(backup);assert.deepEqual(backupBefore,sourceBefore,'Complete stopped-root backup is not identical');

  const upgradedConfig=testConfig(source);const upgradedFake=await fakeRuntime(upgradedConfig,()=>({text:'R2显式续聊完成：仍依据原始合成输入，剩余2件。'}));
  const upgradedLab=await PiLab.create(upgradedConfig,upgradedFake.runtime);opened.push(upgradedLab);
  const afterUpgrade=upgradedLab.get(session.id);assert.equal(afterUpgrade.expert!.revisionId,initialRevision);assert.equal(upgradedFake.calls.length,0,'Open/GET replayed work');
  assert.deepEqual(await readFile(native),initialHistory,'Open/GET rewrote native history');
  await upgradedLab.start(session.id,'R2显式续聊：请复核原始事实。').run(()=>{});
  assert.equal(upgradedLab.get(session.id).lastResult?.status,'succeeded');assert.equal(upgradedFake.calls.length,1);
  assert(JSON.stringify(upgradedFake.calls[0].context.messages).includes('初始合成任务'));
  const upgradedHistory=await readFile(native);assert(upgradedHistory.subarray(0,initialHistory.length).equals(initialHistory),'R2 lost original native prefix');await close(upgradedLab);

  await cp(backup,restored,{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
  assert.notEqual(restored,source);assert.deepEqual(await inventory(restored),backupBefore);
  const restoredConfig=testConfig(restored);const restoredFake=await fakeRuntime(restoredConfig,()=>({text:'R1恢复后的明确续聊完成：计划10件、完成8件、剩余2件。'}));
  // Old code is opened ONLY against the restored original backup, never against the upgraded root.
  const restoredLab=await baseline.PiLab.create(restoredConfig,restoredFake.runtime);opened.push(restoredLab);
  const rollbackSnapshot=restoredLab.get(session.id);assert.equal(rollbackSnapshot.expert!.revisionId,initialRevision);assert.equal(restoredFake.calls.length,0,'Rollback open/GET replayed work');
  const restoredNative=await sessionPath(restored,session.id);assert.deepEqual(await readFile(restoredNative),initialHistory,'Rollback open/GET rewrote original history');
  assert(!JSON.stringify(rollbackSnapshot.messages).includes('R2显式续聊完成'),'Upgraded-only work leaked into restored baseline');
  await restoredLab.start(session.id,'R1恢复后的显式续聊：仅依据升级前历史核对。').run(()=>{});
  assert.equal(restoredLab.get(session.id).lastResult?.status,'succeeded');assert.equal(restoredFake.calls.length,1);
  assert(JSON.stringify(restoredFake.calls[0].context.messages).includes('初始合成任务'));
  const restoredHistory=await readFile(restoredNative);assert(restoredHistory.subarray(0,initialHistory.length).equals(initialHistory),'Restored R1 lost original prefix');await close(restoredLab);
  assert.deepEqual(await inventory(backup),backupBefore,'The original backup was modified by recovery');
  assert.deepEqual(await readFile(native),upgradedHistory,'Restored R1 modified the upgraded root');
  const result={measuredAt:new Date().toISOString(),baseline:{commit:baselineSha,source:'clean tracked R1 PiLab and capability service'},environment:{node:process.version,model:'deterministic-provider-substitute; real native Pi loop',productionData:false,docker:false},sessionId:session.id,expertRevision:initialRevision,dryRun,applied,checks:{dryRunByteStable:true,completeBackupVerified:true,r2OpenAndGetNoCalls:true,r2ExplicitContinuation:true,oldCodeOpenedOnlyRestoredBackup:true,restoredOpenAndGetNoCalls:true,restoredExplicitContinuation:true,backupOriginalUntouched:true,upgradedRootUntouchedByRollback:true,originalNativePrefixPreserved:true},evidence:{originalHistorySha256:sha(initialHistory),upgradedHistorySha256:sha(upgradedHistory),restoredHistorySha256:sha(restoredHistory),originalBackupInventorySha256:sha(JSON.stringify(backupBefore)),filesInCompleteBackup:backupBefore.length},modelCalls:{initialR1:originalFake.calls.length,explicitR2:upgradedFake.calls.length,restoredR1:restoredFake.calls.length},limits:['Model transport is deterministic; this proves native persistence, complete backup and version-paired rollback rather than live model quality.','Only fresh synthetic data is used. Original backup is copied before old-code recovery and compared byte-for-byte afterward.','Temporary roots are removed after hashes and checks are written.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  await writeFile(join(dirname(output),'rollback-proof-r2-note.md'),`# R2 完整备份与配对回退证明\n\n实际基线为 ${baselineSha}；通过 --baseline-root 指定本地仓库，脚本检查 R1 PiLab 与能力服务源码相对该提交无改动。真实原生 Pi 循环仅替换模型传输，先由 R1 创建合成会话并明确发送一次；停服后 R2 dry-run 保持字节不变，apply 完整备份原数据。R2 打开/GET 不调用模型且不改历史，明确发送才追加一轮。\n\n随后仅复制升级前原备份到独立恢复目录，由实际 R1 代码打开该副本并明确续聊。旧代码从不访问升级后的活动根。验证原修订与历史前缀保留、原备份逐文件摘要不变、升级活动根未被回退修改。环境不含真实业务资料、凭据、网络模型或Docker；这不是生产迁移，也不替代真实模型/Docker验收。\n\n复现：在 experiments/harness-lab 使用 node --import tsx scripts/probe-capabilities-r2-rollback.ts --baseline-root ABS_R1_REPOSITORY --output ABS_REPORT_JSON。结果见 rollback-proof-r2.json。\n`);
  console.log(JSON.stringify({output,baseline:baselineSha,checks:result.checks,modelCalls:result.modelCalls}));
}finally{for(const lab of opened.reverse())await lab.close();await rm(root,{recursive:true,force:true});}
