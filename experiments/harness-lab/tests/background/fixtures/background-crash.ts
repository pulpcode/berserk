import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../../../src/access/database.js';
import { AccessStore } from '../../../src/access/store.js';
import { parseBackgroundConfig } from '../../../src/background/config.js';
import { BackgroundService } from '../../../src/background/service.js';
import type { BackgroundExecutor } from '../../../src/background/executor.js';
import { PiLab } from '../../../src/pi/lab.js';
import { createBackgroundExecutor } from '../../../src/pi/background-runner.js';
import { fakeRuntime, testConfig } from '../../pi/fake-runtime.js';

const [dataDir, boundary] = process.argv.slice(2);
const db = await openDatabase(dataDir); const access = new AccessStore(db);
const userId = await access.saveAccount({username: 'a', displayName: 'A', seatId: 'a', seatName: 'A', password: 'test-password-123', createPublicTask: true, manageModelSettings: false});
db.close();
const config = testConfig(dataDir, {seatId: 'a', auth: {secret: 'test-crash-signing-key-at-least-32-characters', sessionMs: 28800000}});
const fake = await fakeRuntime(config, () => {
  appendFileSync(join(dataDir, 'model-calls.log'), 'model\n');
  return {text: 'PERSISTED_NATIVE_ANSWER'};
});
const lab = await PiLab.create(config, fake.runtime);
const background = parseBackgroundConfig({enabled: true, sources: [{sourceId: 'crash-source', name: '崩溃测试来源', credentialRef: 'CRASH_TOKEN', allowedProfileIds: ['material'], allowedRecipientSeatIds: ['a']}],
  profiles: [{id: 'material', goal: '分析输入', tools: ['source_read']}]});
writeFileSync(join(dataDir, 'fixture-config.json'), JSON.stringify(background));
const native = createBackgroundExecutor(lab);

// This gate exists only in the child fixture. IPC is sent before blocking the
// synchronous transaction boundary; the parent kills this exact process.
function stoppedAt(record: object): never {
  process.send!({boundary, ...record});
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  throw new Error('The parent must SIGKILL this fixture');
}
const executor: BackgroundExecutor = {
  async execute(job, input) {
    // An effect counter, not a claimed Docker command. The native Pi reply and
    // history below are real; only its model provider is deterministic.
    appendFileSync(join(input.directory, 'files', 'effect.txt'), 'effect\n');
    const result = await native.execute(job, input);
    if (boundary === 'native_finished') stoppedAt({eventId: job.eventId, jobId: job.id, sessionId: job.sessionId});
    return result;
  },
  read: job => native.read(job),
  cancel: job => native.cancel(job),
};
const service = new BackgroundService(lab, background, executor);
await service.initialize();
service.store.createRule(userId, randomUUID(), {name: '接收测试', sourceId: 'crash-source', profileId: 'material', recipientSeatIds: ['a'], enabled: true});
service.store.setControl('queue', 0, false, userId);

if (boundary === 'before_commit') {
  const exec = lab.access!.db.exec.bind(lab.access!.db);
  lab.access!.db.exec = sql => {
    if (sql === 'COMMIT') {
      const event = service.store.listEvents()[0], job = service.store.listJobs()[0];
      stoppedAt({eventId: event.id, jobId: job.id, uncommittedEvents: 1, acknowledged: false});
    }
    exec(sql);
  };
}
const receipt = await service.accept('crash-source', {sourceMessageId: 'stable-message', title: '崩溃边界', text: '需要分析的原始输入'});
writeFileSync(join(dataDir, 'accepted.json'), JSON.stringify(receipt));
const event = service.store.getEvent(receipt.eventId);
if (boundary === 'queued') stoppedAt({eventId: event.id, jobId: event.initialJobId, acknowledged: true});
if (boundary === 'claimed') {
  const claim = service.store.claimJob.bind(service.store);
  service.store.claimJob = (...args) => {
    const job = claim(...args); stoppedAt({eventId: job.eventId, jobId: job.id, sessionId: job.sessionId});
  };
}
if (boundary === 'succeeded_pending') {
  const finish = service.store.finishJob.bind(service.store);
  service.store.finishJob = (...args) => {
    const job = finish(...args);
    stoppedAt({eventId: job.eventId, jobId: job.id, sessionId: job.sessionId, pending: service.store.listDeliveries().length});
  };
}
service.store.setControl('queue', 1, true, userId);
await service.start();
setInterval(() => {}, 1000);
