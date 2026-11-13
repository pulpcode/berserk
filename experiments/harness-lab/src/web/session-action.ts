import { randomUUID } from './random-uuid';

const pendingActions = new Map<string, Record<string, string>>();

/** Retain an uncertain creation across explicit retries and page refreshes. */
export function sessionAction(storageKey: string, input: object): { id: string; complete: () => void } {
  const fingerprint = JSON.stringify(input);
  let actions: Record<string, string> = pendingActions.get(storageKey) || {};
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) actions = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { /* A blocked storage leaves the current creation usable. */ }
  const id = actions[fingerprint] || randomUUID();
  actions[fingerprint] = id;
  pendingActions.set(storageKey, actions);
  try { sessionStorage.setItem(storageKey, JSON.stringify(actions)); } catch { /* Keep this action ID for the current attempt. */ }
  return { id, complete: () => {
    const pending = pendingActions.get(storageKey);
    if (pending?.[fingerprint] === id) delete pending[fingerprint];
    // Merge with other creations completed while this response was pending.
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Record<string, string>;
      if (value[fingerprint] === id) { delete value[fingerprint]; sessionStorage.setItem(storageKey, JSON.stringify(value)); }
    } catch { /* Successful server receipt remains authoritative. */ }
  } };
}
