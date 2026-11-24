import { describe, expect, it } from 'vitest';
import { resourceUiInstructions } from '../src/presentation/resource-ui';
import { readResultUiSnapshot, type ResultUiSnapshot } from '../src/web/result-ui/spec-stream';

const example = resourceUiInstructions.split('\n').filter(line => line.startsWith('{')).map(line => line.replace('resource:从工具结果复制', 'resource:request:call'));
const body = (lines: string[]) => lines.join('\n') + '\n';

describe('resource UI SpecStream', () => {
  it('grows from complete lines, uses one stable block, and ignores identical cumulative snapshots', () => {
    const source = body(example);
    let snapshot: ResultUiSnapshot | undefined;
    for (let end = 1; end <= source.length; end++) {
      const completeLines = source.slice(0, source.lastIndexOf('\n', end - 1) + 1);
      const previous: ResultUiSnapshot | undefined = snapshot;
      snapshot = readResultUiSnapshot(previous, completeLines, false);
      if (previous?.source === completeLines) expect(snapshot).toBe(previous);
      if (completeLines === body(example.slice(0, 4))) {
        expect(snapshot.spec?.elements.overview.children).toEqual(['metrics']);
        expect(snapshot.status).toBe('ready');
      }
    }
    expect(snapshot?.block).toEqual({ id: 'resources', resultRef: 'resource:request:call' });
    expect(snapshot?.spec?.elements.overview.children).toEqual(['metrics', 'chart']);
    expect(readResultUiSnapshot(snapshot, source, true)).toMatchObject({ status: 'ready', patchCount: 4 });
  });

  it('drops old elements when the cumulative assistant message is replaced', () => {
    const original = readResultUiSnapshot(undefined, body(example), false);
    const replacement = body([
      example[0].replace('resource:request:call', 'resource:next:call'),
      example[1],
      example[2].replace('["metrics","chart"]', '["chart"]'),
      example[4],
    ]);
    const next = readResultUiSnapshot(original, replacement, true);
    expect(next).toMatchObject({ status: 'ready', block: { resultRef: 'resource:next:call' } });
    expect(Object.keys(next.spec?.elements ?? {}).sort()).toEqual(['chart', 'overview']);
    expect(original.spec?.elements.overview.children).toEqual(['metrics', 'chart']);
  });

  it.each([
    { op: 'add', path: '/elements/__proto__', value: { type: 'Stack', props: {}, children: [] } },
    { op: 'add', path: '/elements/constructor', value: { type: 'Stack', props: {}, children: [] } },
    { op: 'add', path: '/elements/chart/props', value: { value: 1000 } },
    { op: 'add', path: '/elements/chart', value: { type: 'ResourceBar', props: { value: 1000 }, children: [] } },
    { op: 'add', path: '/elements/chart', value: { type: 'ResourceBar', props: {}, children: [], on: { press: 'write' } } },
  ])('rejects unsafe or unsupported patches and retains valid streamed components (%j)', patch => {
    const first = readResultUiSnapshot(undefined, body(example.slice(0, 4)), false);
    const next = readResultUiSnapshot(first, first.source + body([JSON.stringify(patch)]), true);
    expect(next.status).toBe('invalid');
    expect(next.spec).toEqual(first.spec);
  });

  it('checks the catalog, shape and unresolved nodes at completion', () => {
    const incomplete = body(example.slice(0, 4));
    expect(readResultUiSnapshot(undefined, incomplete, false).status).toBe('ready');
    expect(readResultUiSnapshot(undefined, incomplete, true).status).toBe('invalid');
    expect(readResultUiSnapshot(undefined, body(example).replace('resource-v1', 'resource-v2'), true).spec).toBeUndefined();
    const nested = body(example.slice(0, 4).concat(example[2].replace('/overview', '/chart')));
    expect(readResultUiSnapshot(undefined, nested, true).status).toBe('invalid');
  });
});
