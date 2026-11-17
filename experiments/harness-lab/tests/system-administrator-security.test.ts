import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { openDatabase } from '../src/access/database.js';
import { AccessStore } from '../src/access/store.js';
import { migrateAdministratorAccounts } from '../src/access/administrator-schema.js';
import { SystemRoles } from '../src/access/system-roles.js';
import type { AuthSession } from '../src/contracts/access.js';
import type { ManagedExpertDetail, ExpertDraft, ExpertValidation } from '../src/contracts/capability-management.js';
import type { ExpertTrialRunView } from '../src/contracts/capability-trials.js';
import { PiLab } from '../src/pi/lab.js';
import { createApp } from '../src/server/app.js';
import { fakeRuntime, testConfig } from './pi/fake-runtime.js';

test.each(['revoke', 'disable'] as const)('seatless administrator %s interrupts an active trial and invalidates its login', async action => {
  const dataDir = await mkdtemp(join(tmpdir(), 'axon-admin-security-'));
  const db = await openDatabase(dataDir);
  const access = new AccessStore(db);
  migrateAdministratorAccounts(db);
  await access.saveAdministratorAccount({username:'admin',displayName:'管理员',password:'test-password-123'});
  db.close();
  const config = testConfig(dataDir, {auth:{secret:'test-only-signing-key-at-least-32-characters',sessionMs:3600000}});
  const fake = await fakeRuntime(config, () => ({waitForAbort:true}));
  const lab = await PiLab.create(config, fake.runtime);
  const app = await createApp(lab, false, undefined, undefined, {runtimeFactory:async () => fake.runtime});
  try {
    const first = await app.inject('/api/auth/session');
    const anonymous = first.json<AuthSession>();
    const login = await app.inject({url:'/api/auth/login',method:'POST',headers:{
      cookie:first.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310','x-csrf-token':anonymous.csrf!,
    },payload:{username:'admin',password:'test-password-123'}});
    expect(login.statusCode, login.body).toBe(200);
    const auth = login.json<AuthSession>();
    expect(auth.identity?.role).toBe('administrator');
    const headers = {cookie:login.cookies.map(c => `${c.name}=${c.value}`).join('; '),origin:'http://localhost:4310',
      'x-csrf-token':auth.csrf!,'x-axon-view':auth.viewId!};
    const call = (url:string,payload?:object,method:'POST'|'PUT' = 'POST') => app.inject({url,headers,
      method:payload ? method : 'GET',...(payload ? {payload} : {})});
    const ok = async <T>(url:string,payload?:object,method:'POST'|'PUT' = 'POST') => {
      const response = await call(url,payload,method);expect(response.statusCode,response.body).toBe(200);return response.json<T>();
    };
    const root = '/api/admin/capabilities/experts';
    const detail = await ok<ManagedExpertDetail>(root,{clientActionId:randomUUID()});
    const url = `${root}/${detail.expert.expertId}`;
    const draft = await ok<ExpertDraft>(`${url}/draft`,{expectedDraftRevision:1,content:{name:'合成核对',description:'撤权边界测试',
      instructions:'仅核对合成事实。',skillIds:[],allowedTools:[]}},'PUT');
    const validation = await ok<ExpertValidation>(`${url}/validate`,{expectedDraftRevision:draft.draftRevision});
    const view = await ok<ExpertTrialRunView>(`${url}/trials`,{expectedDraftRevision:draft.draftRevision,
      validationId:validation.validationId,input:'合成事实：计划10件、完成8件。',clientActionId:randomUUID()});
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1),{timeout:10000});
    if (action === 'revoke') new SystemRoles(lab.access!.db).revoke('admin');
    else lab.access!.disable('admin');
    await vi.waitFor(async () => {
      const current = await lab.management!.get(detail.expert.expertId);
      const trial = current.trials.find(item => item.trialId === view.trial.trialId);
      expect(trial?.status).toBe('failed');expect(trial?.evidence?.success).toBe(false);
    },{timeout:10000});
    expect(fake.calls).toHaveLength(1);expect(fake.calls[0].aborted).toBe(true);
    expect((await call('/api/admin/access')).statusCode).toBe(401);
    expect((await call(`${url}/trials/${view.trial.trialId}/confirm`,{approved:true,reason:'过期确认',clientActionId:randomUUID()})).statusCode).toBe(401);
    expect(lab.access!.seats()).toEqual([]);expect(lab.workspaces.listAll()).toEqual([]);
  } finally { await app.close();await rm(dataDir,{recursive:true,force:true}); }
},30000);
