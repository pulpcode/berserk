import {expect, test} from 'vitest';
import {matchesSourceGroup, sourceGroup} from '../src/background/source-groups.js';
import type {BackgroundConfig} from '../src/background/config.js';

test('history classification follows explicit policy mapping without rewriting identities or guessing source names', () => {
  const source = (sourceId: string, name: string) => ({sourceId, name, credentialRef: 'TEST', systemId: 'intel', allowedProfileIds: ['profile'], allowedRecipientSeatIds: ['seat']});
  const config: BackgroundConfig = {enabled: true, concurrency: 1, modelConcurrency: 1, backlogLimit: 10, profiles: [], sources: [
    {...source('old-debug', '旧调试'), retired: true},
    {...source('intel-current', '情报'), operationPolicies: {scenario: 'intel-current', free_debug: 'old-debug'}},
    source('mock-intel-unrelated', '独立来源'),
  ]};
  const original = structuredClone(config);
  expect(sourceGroup(config, 'old-debug')).toEqual({id: 'intel-current', name: '情报'});
  expect(matchesSourceGroup(config, 'old-debug', 'intel-current')).toBe(true);
  expect(matchesSourceGroup(config, 'intel-current', 'old-debug')).toBe(false);
  expect(matchesSourceGroup(config, 'mock-intel-unrelated', 'intel-current')).toBe(false);
  expect(sourceGroup(config, 'unknown')).toEqual({id: 'unknown', name: 'unknown'});
  expect(config).toEqual(original);
});
