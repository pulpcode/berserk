import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticateSource, loadBackgroundConfig, parseBackgroundConfig, validateRuleScope } from '../../src/background/config.js';

const paths: string[] = [];
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, {recursive: true, force: true}); });
const fixture = () => ({
  sources: [{sourceId: 'special-info', name: '特情接入', credentialRef: 'SPECIAL_INFO_TOKEN', allowedProfileIds: ['material'], allowedRecipientSeatIds: ['a', 'b']}],
  profiles: [{id: 'material', goal: '生成资料要点', tools: ['read', 'write', 'bash', 'file_output']}],
});

describe('background deployment catalog', () => {
  it('is absent by default; explicit catalog keeps execution disabled and no credential values', async () => {
    expect(await loadBackgroundConfig({})).toBeUndefined();
    const config = parseBackgroundConfig(fixture());
    expect(config).toMatchObject({enabled: false, concurrency: 1, modelConcurrency: 2, backlogLimit: 100});
    expect(config.profiles[0]).toMatchObject({name: 'material', instructions: '', resources: [], skillIds: [], agentIds: []});
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });
  it('loads a controlled absolute config file and authenticates credentials separately without leaking them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'axon-background-config-')); paths.push(dir); const path = join(dir, 'background.json');
    await writeFile(path, JSON.stringify({...fixture(), enabled: true}), {mode: 0o600});
    const secret = 'not-a-real-token-for-tests-only-123';
    const env = {LAB_BACKGROUND_CONFIG: path, SPECIAL_INFO_TOKEN: secret};
    const config = (await loadBackgroundConfig(env))!;
    expect(authenticateSource(config, 'special-info', `Bearer ${secret}`, env).sourceId).toBe('special-info');
    for (const header of [undefined, secret, 'Bearer wrong', `Bearer ${secret} `]) expect(() => authenticateSource(config, 'special-info', header, env)).toThrow('凭证无效');
    expect(() => authenticateSource(config, 'unknown', `Bearer ${secret}`, env)).toThrow('凭证无效');
    expect(JSON.stringify(config)).not.toContain(secret);
    await expect(loadBackgroundConfig({LAB_BACKGROUND_CONFIG: path})).rejects.toThrow('凭证未配置');
    await expect(loadBackgroundConfig({LAB_BACKGROUND_CONFIG: './relative.json'})).rejects.toThrow('绝对路径');
  });
  it('rejects unknown authority fields, unsafe/unknown tools, duplicate catalogs, foreign profiles and invalid limits', () => {
    expect(() => parseBackgroundConfig({...fixture(), token: 'plaintext'})).toThrow();
    for (const tool of ['ask_user', 'instructions_update', 'work_item_prepare', 'host_exec']) expect(() => parseBackgroundConfig({...fixture(), profiles: [{...fixture().profiles[0], tools: [tool]}]})).toThrow();
    const source = fixture().sources[0];
    expect(() => parseBackgroundConfig({...fixture(), sources: [source, source]})).toThrow();
    expect(() => parseBackgroundConfig({...fixture(), sources: [{...source, allowedProfileIds: ['missing']}]})).toThrow();
    expect(() => parseBackgroundConfig({...fixture(), sources: [{...source, credentialRef: 'raw-key-value'}]})).toThrow();
    for (const concurrency of [0, -1, 1.5, 33, '2']) expect(() => parseBackgroundConfig({...fixture(), concurrency})).toThrow();
    expect(() => parseBackgroundConfig({...fixture(), profiles: [{...fixture().profiles[0], instructions: '中'.repeat(6_000)}]})).toThrow();
  });
  it('validates selected processing and receiving seats within the source capability range', () => {
    const config = parseBackgroundConfig(fixture());
    const rule = {name: '接入', sourceId: 'special-info', profileId: 'material', recipientSeatIds: ['a', 'b'], enabled: true};
    expect(() => validateRuleScope(config, rule)).not.toThrow();
    expect(() => validateRuleScope(config, {...rule, recipientSeatIds: ['outside']})).toThrow('范围');
    expect(() => validateRuleScope(config, {...rule, recipientSeatIds: []})).toThrow('范围');
    expect(() => validateRuleScope(config, {...rule, profileId: 'other'})).toThrow('范围');
  });
});
