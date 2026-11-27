import { useId, useState } from 'react';
import type { ModelChoices } from '../contracts/index';
import { LoadingIndicator } from './LoadingIndicator';
import { isUsableModel, modelLabel, resolveBaseDefaultModel } from './model-default';
import type { ModelPreferenceControl } from './useModelPreference';

export function ModelDefaultPreferences({ models, control }: { models?: ModelChoices; control: ModelPreferenceControl }) {
  const titleId = useId();
  const [draft, setDraft] = useState<{ revision: number; value: string }>();
  const [notice, setNotice] = useState('');
  const preference = control.preference;
  const current = preference?.choice.mode === 'model' ? preference.choice.modelId : '';
  const value = draft && draft.revision === preference?.revision ? draft.value : current;
  const system = models?.models.find(model => model.id === models.defaultModelId);
  const available = models?.models.filter(isUsableModel) ?? [];
  const missing = Boolean(models && value && !available.some(model => model.id === value));
  const missingModel = missing ? models?.models.find(model => model.id === value) : undefined;
  const resolution = resolveBaseDefaultModel(models, preference?.choice);

  async function save() {
    const saved = await (value ? control.setPersonalDefault(value) : control.resetToSystemDefault());
    if (saved) { setDraft(undefined); setNotice('个人默认模型已保存，下次新建对话时生效。'); }
  }

  return <section className="expert-default-settings" aria-labelledby={titleId}>
    <h3 id={titleId}>个人默认模型</h3>
    <p className="resource-help">用于新建对话。你也可以在发送前为某次对话单独选择模型。</p>
    {!preference && !control.error && <LoadingIndicator label="正在读取个人默认模型…" />}
    {preference && <>
      <label>默认模型<select value={value} disabled={control.saving} onChange={event => {
        setDraft({ revision: preference.revision, value: event.target.value }); setNotice('');
      }}>
        <option value="">跟随系统默认{system ? `（当前：${modelLabel(system)}）` : ''}</option>
        {missing && <option value={value} disabled>{missingModel ? modelLabel(missingModel) : '当前所选模型'}（不可用）</option>}
        {available.map(model => <option key={model.id} value={model.id}>{modelLabel(model)}</option>)}
      </select></label>
      {resolution.notice && <p className="resource-help" role="status">{resolution.notice}</p>}
      <button type="button" className="primary-action" disabled={control.saving || missing || value === current}
        onClick={() => { setNotice(''); void save(); }}>{control.saving ? '保存中…' : '保存默认模型'}</button>
    </>}
    {control.error && <div className="resource-error" role="alert"><p>{control.error}</p>
      <button type="button" disabled={control.saving} onClick={() => void control.refresh()}>重新读取</button></div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
