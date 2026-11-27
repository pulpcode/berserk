import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ModelChoice, ModelChoices } from '../contracts/index';
import { isUsableModel, modelLabel } from './model-default';
import type { ModelPreferenceControl } from './useModelPreference';

export function ModelPicker({ models, value, disabled, saving, choose, preference }: {
  models?: ModelChoices; value: string; disabled: boolean; saving: boolean; choose: (id: string) => void; preference: ModelPreferenceControl;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const initialFocus = useRef<'selected' | 'first' | 'last'>('selected');
  const panelId = useId();
  const visible = open && !disabled && Boolean(models);
  const selected = models?.models.find(model => model.id === value);
  const personalId = preference.preference?.choice.mode === 'model' ? preference.preference.choice.modelId : undefined;
  const personal = models?.models.find(model => model.id === personalId);
  const personalUnavailable = Boolean(personalId && !isUsableModel(personal));
  const showSearch = (models?.models.length ?? 0) >= 6;
  const showHeader = personalUnavailable || Boolean(preference.error) || showSearch;
  const term = query.trim().toLowerCase();
  const options = new Map<string, ModelChoice[]>();
  for (const model of models?.models ?? []) {
    if (term && ![model.platformName, model.provider, model.displayName, model.model]
      .some(value => value?.toLowerCase().includes(term))) continue;
    const key = model.platformId ?? model.platformName ?? model.provider;
    const group = options.get(key);
    if (group) group.push(model);
    else options.set(key, [model]);
  }

  useLayoutEffect(() => {
    const popover = panel.current;
    const button = trigger.current;
    if (!visible || !popover || !button) return;
    const place = () => {
      const bounds = button.getBoundingClientRect();
      const { clientWidth: viewportWidth, clientHeight: viewportHeight } = document.documentElement;
      const availableWidth = button.closest('.composer-dock, .task-home-composer')?.clientWidth ?? viewportWidth;
      const width = Math.min(392, viewportWidth - 24, Math.max(availableWidth - 24, 280));
      const above = bounds.top - 20;
      const below = viewportHeight - bounds.bottom - 20;
      const upward = above >= 240 || above >= below;
      popover.style.width = `${width}px`;
      popover.style.left = `${Math.max(12, Math.min(bounds.right - width, viewportWidth - width - 12))}px`;
      popover.style.maxHeight = `${Math.max(0, Math.min(440, upward ? above : below))}px`;
      popover.style.top = upward ? 'auto' : `${bounds.bottom + 8}px`;
      popover.style.bottom = upward ? `${viewportHeight - bounds.top + 8}px` : 'auto';
    };
    place();
    popover.showPopover();
    const choices = Array.from(popover.querySelectorAll<HTMLButtonElement>('[data-model-choice]:enabled'));
    const target = initialFocus.current === 'first' ? choices[0] : initialFocus.current === 'last' ? choices.at(-1)
      : search.current ?? choices.find(button => button.getAttribute('aria-pressed') === 'true') ?? choices[0];
    (target ?? popover).focus();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      if (popover.matches(':popover-open')) popover.hidePopover();
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [visible]);

  function dismiss() { setOpen(false); trigger.current?.focus(); }
  function show(focus: typeof initialFocus.current) { initialFocus.current = focus; setQuery(''); setOpen(true); }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const choices = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[data-model-choice]:enabled') ?? []);
    if (!choices.length) return;
    event.preventDefault();
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    choices[index === -1 ? step === 1 ? 0 : choices.length - 1 : (index + step + choices.length) % choices.length]?.focus();
  }

  return <div className="model-picker" ref={root}>
    <button ref={trigger} type="button" className="model-picker-trigger" aria-label="选择模型" data-model-id={selected?.id}
      data-unavailable={models && !isUsableModel(selected) ? 'true' : undefined}
      title={selected ? `${modelLabel(selected)} · 仅用于当前对话` : '仅用于当前对话'} aria-haspopup="dialog"
      aria-expanded={visible} aria-controls={visible ? panelId : undefined} disabled={disabled || !models}
      onClick={() => visible ? dismiss() : show('selected')} onKeyDown={event => {
        if (!visible && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); show(event.key === 'ArrowDown' ? 'first' : 'last');
        }
      }}>
      <span>{selected ? modelLabel(selected) : models ? '请选择可用模型' : '正在读取模型…'}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {saving && <span className="visually-hidden" role="status">正在切换模型…</span>}
    {visible && <div id={panelId} ref={panel} popover="manual" role="dialog" aria-label="选择模型" tabIndex={-1} className="model-picker-popover" onKeyDown={keyboard}>
      {showHeader && <div className="model-picker-header">
        {personalUnavailable && <div className="model-picker-policy">
          <span><small>{personal ? `默认模型「${modelLabel(personal)}」暂不可用` : '原默认模型已删除'}</small></span>
          <button type="button" className="model-picker-default model-picker-reset" aria-disabled={preference.saving || undefined}
            onClick={() => {
              if (preference.saving) return;
              (panel.current?.querySelector<HTMLButtonElement>('[data-model-choice]:enabled') ?? panel.current)?.focus();
              void preference.resetToSystemDefault();
            }}>恢复跟随系统默认</button>
        </div>}
        {preference.error && <p className="resource-error" role="alert">{preference.error}
          {!preference.preference && <button type="button" onClick={() => void preference.refresh()}>重新读取</button>}</p>}
        {showSearch && <div className="model-picker-search-wrap">
          <Search size={14} aria-hidden="true" />
          <input ref={search} className="model-picker-search" type="search" aria-label="搜索模型" placeholder="搜索模型或平台"
            value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
              if (event.key !== 'Enter') return;
              const first = panel.current?.querySelector<HTMLButtonElement>('[data-model-choice]:enabled');
              if (!first) return;
              event.preventDefault();
              first.click();
            }} />
        </div>}
      </div>}
      <div className="model-picker-models">
        {[...options].map(([key, group]) => <div key={key} role="group" aria-label={group[0].platformName || group[0].provider}>
          <h3>{group[0].platformName || group[0].provider}</h3>
          {group.map(model => {
            const label = modelLabel(model);
            const available = isUsableModel(model);
            const current = model.id === value;
            const isPersonal = model.id === personalId;
            const isSystem = model.id === models?.defaultModelId;
            const status = !model.configured ? '未配置' : !model.contextReady ? '待补齐参数' : !available ? '不可用' : '';
            const description = `${panelId}-${model.id}`;
            return <div className="model-picker-row" key={model.id}>
              <button type="button" data-model-choice={model.id} className="model-picker-option" aria-label={label}
                aria-describedby={isSystem || isPersonal || status ? description : undefined} aria-pressed={current} disabled={!available}
                onClick={() => { dismiss(); if (!current) choose(model.id); }}>
                <Check size={14} className={current ? '' : 'model-picker-unselected'} aria-hidden="true" />
                <span className="model-picker-option-label">
                  <span>{model.displayName || model.model || '未配置模型'}</span>
                  {(isSystem || isPersonal || status) && <span id={description} className="model-picker-badges">
                    {isSystem && <span className="model-picker-badge-system">系统默认</span>}
                    {isPersonal && <span className="model-picker-badge-personal">我的默认</span>}
                    {status && <span className="model-picker-badge-status">{status}</span>}
                  </span>}
                </span>
              </button>
              {available && <button type="button" className="model-picker-default" data-active={isPersonal ? 'true' : undefined} disabled={!preference.preference} aria-disabled={preference.saving || undefined}
                aria-label={`${isPersonal ? '取消默认' : '设为默认'} ${label}`}
                onClick={() => { if (!preference.saving) void (isPersonal ? preference.resetToSystemDefault() : preference.setPersonalDefault(model.id)); }}>
                {isPersonal ? '取消默认' : '设为默认'}
              </button>}
            </div>;
          })}
        </div>)}
        {!options.size && <p role="status">{query.trim() ? '没有匹配的模型。' : '暂无模型。'}</p>}
      </div>
    </div>}
  </div>;
}
