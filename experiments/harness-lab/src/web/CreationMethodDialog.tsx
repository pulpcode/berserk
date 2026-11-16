import { BookOpen, PencilLine } from 'lucide-react';
import { Panel } from './Resources';

export function CreationMethodDialog({ kind, assisted, manual, close }: {
  kind: 'expert' | 'skill'; assisted?: () => void; manual: () => void; close: () => void;
}) {
  return <Panel title={`创建${kind === 'expert' ? '专家' : '技能'}`} className="creation-method-panel" close={close}>
    <div className="creation-method-options">
      <button type="button" disabled={!assisted} onClick={assisted}><BookOpen size={21} aria-hidden="true" /><strong>辅助创建</strong></button>
      <button type="button" onClick={manual}><PencilLine size={21} aria-hidden="true" /><strong>手动创建</strong></button>
    </div>
  </Panel>;
}
