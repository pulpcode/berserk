import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../../src/access/database.js';
import { AccessStore } from '../../src/access/store.js';
import { BackgroundStore } from '../../src/background/store.js';
import { PiLab } from '../../src/pi/lab.js';
import { createApp } from '../../src/server/app.js';
import { fakeRuntime, testConfig } from '../pi/fake-runtime.js';

it('refuses to ignore a durable preparation when background configuration disappears',async () => {
  const dir = await mkdtemp(join(tmpdir(),'axon-background-config-'));
  let lab:PiLab|undefined;
  try {
    const db = await openDatabase(dir), access = new AccessStore(db);
    const userId = await access.saveAccount({username:'a',displayName:'A',seatId:'a',seatName:'A',password:'test-password-123',createPublicTask:true,manageModelSettings:true});
    const task = access.create(access.identity(userId)!,{title:'任务',goal:'验证',visibility:'private',clientActionId:randomUUID()});
    const store = new BackgroundStore(db);
    store.beginAction({userId,seatId:'a',clientActionId:randomUUID(),kind:'analysis',inputHash:'a'.repeat(64),taskSpaceId:task.id,sessionId:randomUUID()});
    db.close();
    const config = testConfig(dir,{seatId:'a',auth:{secret:'test-only-secret-at-least-32-characters',sessionMs:3600000}});
    const fake = await fakeRuntime(config,() => ({text:'done'})); lab = await PiLab.create(config,fake.runtime);
    await expect(createApp(lab)).rejects.toMatchObject({code:'BACKGROUND_CONFIGURATION_REQUIRED'});
    expect(fake.calls).toHaveLength(0);
  } finally {await lab?.close(); await rm(dir,{recursive:true,force:true});}
});
