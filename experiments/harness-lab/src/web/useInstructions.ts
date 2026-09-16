import { useCallback, useRef, useState } from 'react';
import type { InstructionFile, InstructionUpdate } from '../contracts/index';
import { api, ApiFailure } from './api';

interface Editor {
  draft: string;
  base: InstructionFile;
  latest?: InstructionFile;
  canMerge?: boolean;
  review?: 'conflict' | 'uncertain';
  message?: string;
  error?: string;
}
const STORAGE = 'berserk.instructions';
function restore(): Record<string, Editor> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Editor] => {
      const item = entry[1] as Partial<Editor> | null;
      return Boolean(item && typeof item.draft === 'string' && item.base?.fileId === 'workspace' && typeof item.base.content === 'string' && (item.base.hash === null || typeof item.base.hash === 'string'));
    }));
  } catch { return {}; }
}
const reason = (error: unknown) => error instanceof Error ? error.message : '读取失败，请重试。';
const path = (id: string) => `/api/workspaces/${encodeURIComponent(id)}/instructions/workspace`;

export function useInstructions() {
  const [editors, setEditors] = useState(restore);
  const ref = useRef(editors);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const savingRef = useRef(new Set<string>());
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const reads = useRef<Record<string, symbol>>({});
  const update = useCallback((id: string, change: (current: Editor | undefined) => Editor) => {
    ref.current = { ...ref.current, [id]: change(ref.current[id]) };
    setEditors(ref.current);
    try { sessionStorage.setItem(STORAGE, JSON.stringify(ref.current)); } catch { /* Keep unsaved edits in memory. */ }
  }, []);
  const read = useCallback(async (id: string, compare = false) => {
    const token = Symbol(); reads.current[id] = token;
    setLoading(previous => ({ ...previous, [id]: true }));
    try {
      const file = await api<InstructionFile>(path(id));
      if (reads.current[id] !== token) return;
      update(id, current => {
        if (!current) return { draft: file.content, base: file };
        // Reading never rebases a draft. Even a pristine-looking restored editor
        // may hold an older version; only an explicit discard accepts a comparison.
        if (compare || current.review || file.hash !== current.base.hash) return { ...current, latest: file, canMerge: true };
        return current;
      });
      setReadErrors(previous => ({ ...previous, [id]: '' }));
    } catch (error) {
      if (reads.current[id] === token) setReadErrors(previous => ({ ...previous, [id]: reason(error) }));
    } finally {
      if (reads.current[id] === token) setLoading(previous => ({ ...previous, [id]: false }));
    }
  }, [update]);
  const save = useCallback(async (id: string, merge = false) => {
    const editor = ref.current[id];
    if (!editor || savingRef.current.has(id) || (editor.review && !merge) || (merge && (!editor.latest || !editor.canMerge))) return;
    const expectedHash = merge ? editor.latest!.hash : editor.base.hash;
    const content = editor.draft;
    savingRef.current.add(id); setSaving(previous => ({ ...previous, [id]: true }));
    // A GET already in flight cannot bring a pre-save comparison back afterwards.
    reads.current[id] = Symbol(); setLoading(previous => ({ ...previous, [id]: false }));
    update(id, current => ({ ...current!, error: '', message: '' }));
    try {
      const result = await api<InstructionUpdate>(path(id), { content, expectedHash }, 'PUT');
      reads.current[id] = Symbol(); setLoading(previous => ({ ...previous, [id]: false }));
      update(id, current => ({ draft: current!.draft, base: { ...editor.base, content, hash: result.hash },
        message: result.status === 'unchanged' ? '当前文件已是这些内容，下次发送时生效。' : '已保存，下次发送时生效。' }));
    } catch (error) {
      const conflict = error instanceof ApiFailure && error.code === 'INSTRUCTION_CONFLICT';
      const uncertain = !(error instanceof ApiFailure) || error.status >= 500;
      update(id, current => ({ ...current!,
        review: conflict ? 'conflict' : uncertain ? 'uncertain' : current!.review,
        // A failed save invalidates the previously viewed merge version. Keep its
        // text visible, but require another successful read before a new merge.
        latest: current!.latest, canMerge: conflict || uncertain ? false : current!.canMerge,
        error: conflict ? '工作区指令已更新，本次保存未完成，你的修改已保留。' : uncertain ? '保存结果尚未确认，你的修改已保留。请查看最新内容核对后再操作。' : reason(error),
      }));
    } finally { savingRef.current.delete(id); setSaving(previous => ({ ...previous, [id]: false })); }
  }, [update]);
  return { editors, loading, saving, readErrors, read, save,
    edit: (id: string, draft: string) => update(id, current => ({ ...current!, draft, message: '' })),
    discard: (id: string) => {
      const current = ref.current[id];
      if (!current?.latest || savingRef.current.has(id)) return;
      update(id, () => ({ draft: current.latest!.content, base: current.latest!, message: '已放弃草稿，使用已查看的最新内容；未写入文件。' }));
    },
  };
}
