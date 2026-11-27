import { randomUUID } from './random-uuid';

type PendingAction = string | { id: string; modelId: string };
const pendingActions = new Map<string, Record<string, PendingAction>>();

function validAction(value: unknown): value is PendingAction {
  return typeof value === 'string' || Boolean(value && typeof value === 'object'
    && 'id' in value && typeof value.id === 'string' && 'modelId' in value && typeof value.modelId === 'string');
}

function pending(key: string) {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ...Object.fromEntries(Object.entries(value).filter((entry): entry is [string, PendingAction] => validAction(entry[1]))), ...pendingActions.get(key) };
    }
  } catch { /* A blocked storage leaves the current creation usable. */ }
  return { ...pendingActions.get(key) };
}

function persist(key: string, actions: Record<string, PendingAction>) {
  pendingActions.set(key, actions);
  try { sessionStorage.setItem(key, JSON.stringify(actions)); } catch { /* Keep actions in memory. */ }
}

const idOf = (action?: PendingAction) => typeof action === 'string' ? action : action?.id;

/** Retain an uncertain creation across explicit retries and page refreshes. */
export function sessionAction(storageKey: string, input: object) {
  const fingerprint = JSON.stringify(input);
  const actions = pending(storageKey);
  const captured = actions[fingerprint];
  const id = idOf(captured) ?? randomUUID();
  if (!captured) persist(storageKey, { ...actions, [fingerprint]: id });
  return {
    id,
    modelId: typeof captured === 'object' ? captured.modelId : undefined,
    captureModelId: (modelId: string) => {
      const latest = pending(storageKey);
      if (latest[fingerprint] === id) persist(storageKey, { ...latest, [fingerprint]: { id, modelId } });
    },
    complete: () => {
      const latest = pending(storageKey);
      if (idOf(latest[fingerprint]) === id) { delete latest[fingerprint]; persist(storageKey, latest); }
    },
  };
}
