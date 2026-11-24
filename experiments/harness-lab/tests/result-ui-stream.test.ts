import { describe, expect, it } from 'vitest';
import { resourceUiInstructions } from '../src/presentation/resource-ui';
import { datasetUiCatalog } from '../src/presentation/dataset-ui';
import { readResultUiSnapshot, type ResultUiSnapshot } from '../src/web/result-ui/spec-stream';

const example = resourceUiInstructions.split('\n').filter(line => line.startsWith('{')).map(line => line.replace('resource:从工具结果复制', 'resource:request:call'));
const body = (lines: string[]) => lines.join('\n') + '\n';
const resourceViewPatch = (section: unknown, props = {}, children: string[] = [], id = 'details') => JSON.stringify({
  op: 'add', path: `/elements/${id}`, value: { type: 'ResourceResultView', props: { section, ...props }, children },
});
const withDetails = () => [example[0], example[1], example[2].replace('["metrics","chart"]', '["metrics","chart","details"]'), ...example.slice(3)];

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
    expect(snapshot?.block).toEqual({ id: 'resources', resultRef: 'resource:request:call', catalog: 'resource-v1' });
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

  it.each(['sources', 'details'])('renders the %s disclosure only once its complete patch arrives', section => {
    const open = readResultUiSnapshot(undefined, body(withDetails()), false);
    expect(open.spec?.elements.overview.children).toEqual(['metrics', 'chart']);
    const closed = readResultUiSnapshot(open, open.source + body([resourceViewPatch(section)]), true);
    expect(closed).toMatchObject({
      status: 'ready',
      spec: { elements: { overview: { children: ['metrics', 'chart', 'details'] }, details: { props: { section } } } },
    });
  });

  it.each([
    resourceViewPatch('all'),
    resourceViewPatch(undefined),
    resourceViewPatch('details', { url: '/api/sessions/invalid' }),
    resourceViewPatch('sources', {}, ['chart']),
  ])('rejects an invalid resource disclosure and keeps the overview (%s)', patch => {
    const result = readResultUiSnapshot(undefined, body([...withDetails(), patch]), true);
    expect(result.status).toBe('invalid');
    expect(result.spec?.elements.overview.children).toEqual(['metrics', 'chart']);
  });

  it('limits a resource block to one disclosure', () => {
    const lines = withDetails();
    lines[2] = lines[2].replace('["metrics","chart","details"]', '["metrics","chart","details","sources"]');
    const result = readResultUiSnapshot(undefined, body([...lines, resourceViewPatch('details'), resourceViewPatch('sources', {}, [], 'sources')]), true);
    expect(result.status).toBe('invalid');
    expect(result.spec?.elements.overview.children).toEqual(['metrics', 'chart', 'details']);
  });
});

describe('dataset UI SpecStream', () => {
  const block = { id: 'orders', catalog: datasetUiCatalog, resultRef: 'dataset:request:call' };
  const patch = (path: string, value: unknown) => ({ op: 'add', path, value });
  const base = [
    block, patch('/root', 'overview'),
    patch('/elements/overview', { type: 'Stack', props: {}, children: ['chart', 'table'] }),
    patch('/elements/chart', { type: 'ChartView', props: { kind: 'bar', x: 'team', y: ['orders'] }, children: [] }),
  ];
  const source = (values: unknown[]) => body(values.map(value => JSON.stringify(value)));

  it('renders a complete chart definition before the table and fence finish', () => {
    const open = readResultUiSnapshot(undefined, source(base), false);
    expect(open).toMatchObject({ status: 'ready', block, spec: { elements: { overview: { children: ['chart'] } } } });
    const complete = readResultUiSnapshot(open, source([...base, patch('/elements/table', { type: 'ResultTable', props: {}, children: [] })]), true);
    expect(complete).toMatchObject({ status: 'ready', spec: { elements: { overview: { children: ['chart', 'table'] } } } });
  });

  it.each([
    { type: 'ResourceBar', props: {}, children: [] },
    { type: 'ResourceResultView', props: { section: 'details' }, children: [] },
    { type: 'ChartView', props: { kind: 'bar', x: 'team', y: ['count'], values: [12, 8] }, children: [] },
    { type: 'ChartView', props: { kind: 'line', x: 'time', y: ['count'], horizontal: true }, children: [] },
    { type: 'ChartView', props: { kind: 'line', x: { $state: '/column' }, y: ['count'] }, children: [] },
    { type: 'ChartView', props: { kind: 'radar', x: 'time', y: ['count', 'count'] }, children: [] },
  ])('rejects unknown components, model-supplied values and invalid field selections (%j)', element => {
    const invalid = readResultUiSnapshot(undefined, source([...base.slice(0, -1), patch('/elements/chart', element)]), true);
    expect(invalid.status).toBe('invalid');
    expect(invalid.spec).toBeUndefined();
  });
});
