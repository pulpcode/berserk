import { createSpecStreamCompiler, type Spec } from '@json-render/core';
import { resourceUiCatalog, resourceUiComponents } from '../../presentation/resource-ui';

type ResultUiBlock = { id: string; resultRef: string };
type ResultUiSnapshot = {
  source: string;
  closed: boolean;
  block?: ResultUiBlock;
  spec?: Spec;
  status: 'pending' | 'ready' | 'invalid';
  compiled: Partial<Spec>;
  patchCount: number;
  malformed: boolean;
};
export type { ResultUiSnapshot };

const maxContent = 32_768;
const maxPatches = 32;
const maxChildren = 8;
const { stack, metrics, bar } = resourceUiComponents;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function key(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value)
    && !Object.hasOwn(Object.prototype, value) && value !== 'prototype';
}

function decodeBlock(value: unknown): ResultUiBlock | undefined {
  if (!record(value) || Object.keys(value).length !== 3 || !key(value.id) || value.catalog !== resourceUiCatalog
    || typeof value.resultRef !== 'string' || !/^resource:[a-zA-Z0-9_-]+:[^\s:]+$/.test(value.resultRef) || value.resultRef.length > 500) return;
  return { id: value.id, resultRef: value.resultRef };
}

function validPatch(value: unknown): boolean {
  if (!record(value) || Object.keys(value).length !== 3 || (value.op !== 'add' && value.op !== 'replace')) return false;
  const path = value.path;
  if (path === '/root') return key(value.value);
  if (typeof path !== 'string' || !path.startsWith('/elements/') || !key(path.slice('/elements/'.length))) return false;
  const element = value.value;
  if (!record(element) || Object.keys(element).length !== 3 || !record(element.props) || Object.keys(element.props).length
    || !Array.isArray(element.children)) return false;
  if (element.type === metrics || element.type === bar) return element.children.length === 0;
  return element.type === stack && element.children.length <= maxChildren
    && element.children.every(key) && new Set(element.children).size === element.children.length;
}

function renderable(compiled: Partial<Spec>): { spec?: Spec; complete: boolean } {
  const root = compiled.root;
  if (!root || !compiled.elements || !Object.hasOwn(compiled.elements, root)) return { complete: false };
  const element = compiled.elements[root];
  if (element.type !== stack) return { complete: false };
  const children = (element.children ?? []).filter(id => {
    const child = compiled.elements?.[id];
    return child?.type === metrics || child?.type === bar;
  });
  if (!children.length) return { complete: false };
  const elements = Object.fromEntries(children.map(id => [id, compiled.elements![id]]));
  elements[root] = { ...element, children };
  return {
    spec: { root, elements },
    complete: children.length === element.children?.length && Object.keys(compiled.elements).length === children.length + 1,
  };
}

/** A cumulative assistant snapshot can append, repeat, or replace previously observed text. */
export function readResultUiSnapshot(previous: ResultUiSnapshot | undefined, lines: string, closed: boolean): ResultUiSnapshot {
  if (previous?.source === lines && previous.closed === closed) return previous;
  const base = previous && lines.startsWith(previous.source) ? previous : undefined;
  let block = base?.block;
  let compiled = base?.compiled ?? {};
  let patchCount = base?.patchCount ?? 0;
  let malformed = base?.malformed ?? false;
  if (lines.length > maxContent) malformed = true;
  if (!malformed) {
    // The compiler mutates its element table. Copy it so abandoned React renders cannot alter prior snapshots.
    const compiler = createSpecStreamCompiler<Spec>({ ...compiled, elements: { ...compiled.elements } });
    for (const line of lines.slice(base?.source.length ?? 0).split('\n').slice(0, -1)) {
      if (!line.trim()) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!block) {
          block = decodeBlock(value);
          if (!block) throw new Error('Invalid result UI metadata');
        } else {
          if (!validPatch(value) || ++patchCount > maxPatches) throw new Error('Invalid result UI patch');
          const update = compiler.push(line + '\n');
          if (update.newPatches.length !== 1) throw new Error('Result UI patch was ignored');
          compiled = update.result;
        }
      } catch {
        malformed = true;
        break;
      }
    }
  }
  const { spec, complete } = renderable(compiled);
  const status = malformed || (closed && !complete) ? 'invalid' : spec ? 'ready' : 'pending';
  return { source: lines, closed, block, compiled, patchCount, malformed, spec, status };
}
