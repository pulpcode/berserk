"""Preserve raw native histories and extract evidence, not semantic grades."""
import hashlib
import json
import shutil
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
roots = {'A': repo / '.local/map-layer-name-A/.local/map-query-native/layer-name-A-live',
         'B': repo / '.local/map-query-native/layer-name-B-live'}
records = []
dialogue = ['# A/B 实际对话与调用证据', '', '直接抽取实际记录；不作为自动语义评分。', '']
for arm, root in roots.items():
    if not (root / 'runs.json').exists():
        continue
    attempts = json.loads((root / 'attempts.json').read_text())
    for run in json.loads((root / 'runs.json').read_text()):
        directory = root / run['id']
        if not (directory / 'query.json').exists() and not (directory / 'preparation.json').exists():
            records.append({'arm': arm, **run})
            continue
        manifest = json.loads((directory / 'manifest.json').read_text())
        native = directory / 'native-sessions'
        for source in Path(manifest['dataDir']).rglob('*.jsonl'):
            dest = native / source.relative_to(manifest['dataDir'])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists():
                shutil.copy2(source, dest)
        dialogue += [f"## {arm}-{run['id']} / {run['kind']}", '']
        fixture = json.loads((directory / 'fixture.json').read_text())
        dialogue += ['测试真值（未发送给模型）：', '```json', json.dumps(fixture['truth'], ensure_ascii=False), '```', '']
        entry = {'arm': arm, **run, 'phases': []}
        for phase in ['preparation', 'query']:
            path = directory / f'{phase}.json'
            if not path.exists():
                continue
            record = json.loads(path.read_text())
            phase_attempts = [a for a in attempts if a['trialId'] == run['id'] and a['phase'] == ('prepare' if phase == 'preparation' else 'readonly')]
            phase_record = {'phase': phase, 'prompt': record['prompt'], 'elapsedMs': record['elapsedMs'],
                'requestId': record['requestId'], 'failure': record.get('failure'), 'interactions': record['interactions'],
                'calls': [t for a in phase_attempts for t in a['tools']],
                'messages': [m for m in record['snapshot']['messages'] if m['requestId'] == record['requestId']],
                'errors': [m for m in record['toolResults'] if m.get('isError')]}
            entry['phases'].append(phase_record)
            dialogue += [f'### {phase}', '', f"用户：{record['prompt']}", '']
            for a in phase_attempts:
                for t in a['tools']:
                    dialogue += [f"调用 {t['name']}", '```json', t['arguments'], '```']
            for m in phase_record['messages']:
                if m['role'] == 'assistant':
                    dialogue += ['助手：', '', m.get('text', ''), '']
                elif m['role'] == 'tool':
                    dialogue += [f"工具 {m.get('toolName')}（isError={m.get('isError')}）：", '```text', m.get('text', ''), '```', '']
            if record['interactions']:
                dialogue += ['交互：', '```json', json.dumps(record['interactions'], ensure_ascii=False), '```', '']
        records.append(entry)
(task / 'observations.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
(task / 'dialogues.md').write_text('\n'.join(dialogue).rstrip() + '\n')
index = {'roots': {arm: str(root) for arm, root in roots.items()}, 'files': []}
for arm, root in roots.items():
    if not root.exists():
        continue
    for path in sorted(root.rglob('*')):
        if path.is_file():
            index['files'].append({'arm': arm, 'path': str(path.relative_to(root)), 'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(task / 'evidence-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'trials': len(records), 'indexedFiles': len(index['files'])}))
