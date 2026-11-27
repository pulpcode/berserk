import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserModelPreference, UserModelPreferenceChoice, UserModelPreferenceUpdate } from '../contracts/index';
import { ApiFailure, useApi } from './api';

const path = '/api/me/preferences/model';
const systemPreference: UserModelPreference = { revision: 0, choice: { mode: 'system' } };

function localPreference(key: string): UserModelPreference {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as UserModelPreference | null;
    if (value && Number.isSafeInteger(value.revision) && value.revision >= 0
      && (value.choice?.mode === 'system' || value.choice?.mode === 'model' && typeof value.choice.modelId === 'string')) return value;
  } catch { /* Invalid or unavailable storage starts with the system default. */ }
  return systemPreference;
}

export function useModelPreference(enabled: boolean, authenticated: boolean) {
  const { api, storageKey } = useApi();
  const key = storageKey('berserk.user-default-model');
  const [preference, setPreference] = useState(() => authenticated ? undefined : localPreference(key));
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const publish = useCallback((next: UserModelPreference) => {
    setPreference(current => !current || next.revision >= current.revision ? next : current);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !authenticated) return;
    try {
      const latest = await api<UserModelPreference>(path);
      publish(latest);
      setLoadError('');
      return latest;
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : '个人默认模型暂时无法读取。');
    }
  }, [api, authenticated, enabled, publish]);

  useEffect(() => {
    if (!enabled) return;
    if (authenticated) {
      const update = () => { void refresh(); };
      update();
      window.addEventListener('focus', update);
      return () => window.removeEventListener('focus', update);
    }
    const update = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === key || event.key === null)) setPreference(localPreference(key));
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, [authenticated, enabled, key, refresh]);

  async function save(choice: UserModelPreferenceChoice) {
    if (!enabled || !preference || saveLock.current) return false;
    saveLock.current = true;
    setSaving(true); setSaveError('');
    try {
      const update: UserModelPreferenceUpdate = { expectedRevision: preference.revision, choice };
      if (authenticated) publish(await api<UserModelPreference>(path, update, 'PUT'));
      else {
        const next: UserModelPreference = { revision: preference.revision + 1, choice };
        try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep the preference in memory. */ }
        publish(next);
      }
      return true;
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.code === 'PREFERENCE_CONFLICT') await refresh();
      setSaveError(reason instanceof Error ? reason.message : '个人默认模型未保存，请重试。');
      return false;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return {
    preference, saving, error: saveError || loadError, readLatest: refresh,
    refresh: () => { setSaveError(''); return refresh(); },
    setPersonalDefault: (modelId: string) => save({ mode: 'model', modelId }),
    resetToSystemDefault: () => save({ mode: 'system' }),
  };
}

export type ModelPreferenceControl = ReturnType<typeof useModelPreference>;
