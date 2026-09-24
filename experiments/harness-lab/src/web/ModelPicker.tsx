import { ChevronDown } from 'lucide-react';
import type { ModelChoices } from '../contracts/index';

export function ModelPicker({ models, value, disabled, saving, choose }: {
  models?: ModelChoices; value: string; disabled: boolean; saving: boolean; choose: (id: string) => void;
}) {
  const selected = models?.models.find(model => model.id === value);
  return <div className="model-picker">
    <select aria-label="选择模型" title="仅用于当前对话" value={selected ? value : ''} disabled={disabled || !models} onChange={event => choose(event.target.value)}>
      {!selected && <option value="" disabled>{models ? '请选择可用模型' : '正在读取模型…'}</option>}
      {models?.models.map(model => <option key={model.id} value={model.id} disabled={!model.configured || !model.contextReady}>
        {model.model}{models.models.some(other => other.id !== model.id && other.model === model.model) ? ` · ${model.provider}` : ''}{!model.configured ? '（未配置）' : !model.contextReady ? '（待补齐参数）' : ''}
      </option>)}
    </select>
    <ChevronDown size={13} aria-hidden="true" />
    {saving && <span className="visually-hidden" role="status">正在切换模型…</span>}
  </div>;
}
