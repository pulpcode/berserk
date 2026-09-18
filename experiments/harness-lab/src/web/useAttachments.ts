import { useCallback, useRef, useState } from 'react';
import type { Upload } from '../contracts/files';
import { api, checkResponse } from './api';

export interface DraftAttachment {
  id: string; workspaceId: string; name: string; originalName?: string; size: number; path?: string; uploadId?: string;
  status: 'uploading' | 'ready' | 'failed'; progress: number; error?: string;
}
type AttachmentMap = Record<string, DraftAttachment[]>;
const KEY = 'berserk.attachments';
const SENT = 'berserk.submitted-attachments';
function load(key: string): AttachmentMap {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '{}') as AttachmentMap;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, items]) => Array.isArray(items)).map(([owner, items]) => [owner, items.filter(item => item && typeof item.id === 'string' && typeof item.workspaceId === 'string' && typeof item.name === 'string' && typeof item.size === 'number').map(item => item.status === 'ready' && item.path ? item : { ...item, status: 'failed', error: '传输未完成，请重新选择文件；可先核对上传状态。' })]));
  } catch { return {}; }
}
function save(key: string, state: AttachmentMap) { try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* In-memory drafts remain available. */ } }
const endpoint = (workspaceId: string, uploadId?: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/uploads${uploadId ? `/${encodeURIComponent(uploadId)}` : ''}`;
const message = (error: unknown) => error instanceof Error ? error.message : '上传失败，请重试或移除此引用。';

export function useAttachments() {
  const [all, setAll] = useState(() => load(KEY));
  const state = useRef(all);
  const submitted = useRef(load(SENT));
  const localFiles = useRef(new Map<string, File>());
  const transfers = useRef(new Map<string, { cancelled: boolean; xhr?: XMLHttpRequest }>());
  const [notice, setNotice] = useState<Record<string, string>>({});
  const update = useCallback((change: (current: AttachmentMap) => AttachmentMap) => {
    state.current = change(state.current); setAll(state.current); save(KEY, state.current);
  }, []);
  // Locate by stable attachment ID: a first-session creation can move its owner while transfer is pending.
  const patch = useCallback((id: string, change: Partial<DraftAttachment>) => update(current => Object.fromEntries(Object.entries(current).map(([key, items]) => [key, items.map(item => item.id === id ? { ...item, ...change } : item)]))), [update]);
  const transfer = useCallback(async (item: DraftAttachment) => {
    if (transfers.current.has(item.id)) return;
    const control: { cancelled: boolean; xhr?: XMLHttpRequest } = { cancelled: false };
    transfers.current.set(item.id, control);
    let uploadId = item.uploadId;
    patch(item.id, { status: 'uploading', error: undefined, progress: 0 });
    try {
      let record: Upload | undefined;
      if (uploadId) record = await api<Upload>(endpoint(item.workspaceId, uploadId));
      if (record?.status === 'uploading') throw new Error('服务端仍在处理该上传，请稍后核对状态，不会重复传输。');
      if (record?.status !== 'completed') {
        const file = localFiles.current.get(item.id);
        if (!file) throw new Error('请先核对工作区文件，再重新选择本地文件。');
        if (control.cancelled) return;
        if (!record || record.status === 'failed' || record.status === 'cancelled') {
          record = await api<Upload>(endpoint(item.workspaceId), { name: file.name, size: file.size });
          uploadId = record.uploadId; patch(item.id, { uploadId });
        }
        if (control.cancelled) {
          await checkResponse(await fetch(endpoint(item.workspaceId, uploadId), { method: 'DELETE' })); return;
        }
        record = await new Promise<Upload>((resolve, reject) => {
          const xhr = new XMLHttpRequest(); control.xhr = xhr;
          xhr.open('PUT', `${endpoint(item.workspaceId, uploadId)}/content`);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.upload.onprogress = event => { if (event.lengthComputable) patch(item.id, { progress: Math.round(event.loaded / event.total * 100) }); };
          xhr.onload = () => {
            try {
              const body = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(body as Upload);
              else reject(new Error(body?.error?.message || '上传未完成，请核对状态后重试。'));
            } catch { reject(new Error('上传结果不明确，请核对状态后重试。')); }
          };
          xhr.onerror = () => reject(new Error('上传连接中断，请核对状态后重试。'));
          xhr.onabort = () => reject(new Error('上传已停止。'));
          xhr.send(file);
        });
      }
      if (record.status !== 'completed' || !record.path) throw new Error('文件尚未保存完成，请核对上传状态。');
      patch(item.id, { status: 'ready', name: record.name || item.name, originalName: record.originalName, path: record.path, uploadId: record.uploadId, progress: 100, error: undefined });
      localFiles.current.delete(item.id);
    } catch (error) { if (!control.cancelled) patch(item.id, { status: 'failed', error: message(error) }); }
    finally { transfers.current.delete(item.id); }
  }, [patch]);
  const add = useCallback((owner: string, workspaceId: string, files: File[], limits: { maxAttachments: number; maxFileBytes: number }) => {
    const count = state.current[owner]?.length || 0;
    if (count + files.length > limits.maxAttachments) { setNotice(previous => ({ ...previous, [owner]: `每条消息最多关联 ${limits.maxAttachments} 个文件。` })); return; }
    setNotice(previous => ({ ...previous, [owner]: '' }));
    const items: DraftAttachment[] = files.map(file => ({ id: crypto.randomUUID(), workspaceId, name: file.name, size: file.size, status: file.size > limits.maxFileBytes ? 'failed' : 'uploading', progress: 0, ...(file.size > limits.maxFileBytes ? { error: `文件超过 ${(limits.maxFileBytes / 1024 / 1024).toFixed(0)} MiB 上限，请移除此引用并选择较小文件。` } : {}) }));
    update(current => ({ ...current, [owner]: [...(current[owner] || []), ...items] }));
    items.forEach((item, index) => { if (item.status !== 'failed') { localFiles.current.set(item.id, files[index]!); void transfer(item); } });
  }, [transfer, update]);
  const remove = useCallback(async (owner: string, item: DraftAttachment) => {
    const control = transfers.current.get(item.id); if (control) { control.cancelled = true; control.xhr?.abort(); }
    try {
      if (item.uploadId && item.status !== 'ready') await checkResponse(await fetch(endpoint(item.workspaceId, item.uploadId), { method: 'DELETE' }));
      update(current => Object.fromEntries(Object.entries(current).map(([key, items]) => [key, items.filter(value => value.id !== item.id)])));
      localFiles.current.delete(item.id);
      setNotice(previous => ({ ...previous, [owner]: '已移除附件引用；已保存的文件仍保留在工作区。' }));
    } catch (error) { patch(item.id, { status: 'failed', error: `取消结果未确认：${message(error)} 请核对后再移除。` }); }
  }, [patch, update]);
  const move = useCallback((from: string, to: string) => update(current => ({ ...current, [to]: [...(current[to] || []), ...(current[from] || [])], [from]: [] })), [update]);
  const consume = useCallback((owner: string, items: DraftAttachment[]) => {
    submitted.current = { ...submitted.current, [owner]: items }; save(SENT, submitted.current);
    update(current => ({ ...current, [owner]: (current[owner] || []).filter(item => !items.some(sent => sent.id === item.id)) }));
  }, [update]);
  const recover = useCallback((owner: string) => {
    update(current => ({ ...current, [owner]: [...(current[owner] || []), ...(submitted.current[owner] || []).filter(item => !(current[owner] || []).some(existing => existing.id === item.id))] }));
    submitted.current = { ...submitted.current, [owner]: [] }; save(SENT, submitted.current);
  }, [update]);
  const clearSubmitted = useCallback((owner: string) => { submitted.current = { ...submitted.current, [owner]: [] }; save(SENT, submitted.current); }, []);
  const reference = useCallback((owner: string, workspaceId: string, file: { name: string; path: string; size?: number }, maxAttachments: number) => {
    if (state.current[owner]?.some(item => item.path === file.path && item.workspaceId === workspaceId)) { setNotice(previous => ({ ...previous, [owner]: '此文件已关联到当前消息。' })); return true; }
    if ((state.current[owner]?.length || 0) >= maxAttachments) { setNotice(previous => ({ ...previous, [owner]: `每条消息最多关联 ${maxAttachments} 个文件。` })); return false; }
    update(current => ({ ...current, [owner]: [...(current[owner] || []), { id: crypto.randomUUID(), workspaceId, name: file.name, path: file.path, size: file.size || 0, status: 'ready', progress: 100 }] })); return true;
  }, [update]);
  return { all, notice, add, remove, retry: transfer, move, consume, recover, clearSubmitted, reference, current: (owner: string) => state.current[owner] || [] };
}
