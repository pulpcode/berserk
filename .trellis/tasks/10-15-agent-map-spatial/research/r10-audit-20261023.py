"""Audit frozen raw R10 evidence without model calls or semantic auto-grading."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BATCH = ROOT / '.local/spatial-r10/batch-20261023'
OUT = ROOT / '.trellis/tasks/10-15-agent-map-spatial/research/r10-audit-20261023.json'

def read(path):
    return json.loads(path.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    rows = read(BATCH / 'runs.json')
    attempts = read(BATCH / 'attempts.json')
    protocol = read(BATCH / 'protocol.json')
    assert len(rows) == 24
    assert len({r['id'] for r in rows}) == 24
    assert len({r['caseId'] for r in rows}) == 24
    assert all(r['group'] == 'B' and r['loading'] == 'native' for r in rows)
    assert [r['id'] for r in rows] == [r['id'] for r in protocol['schedule']]
    checked = 0
    output = []
    sessions = []
    for row in rows:
        folder = BATCH / row['id']
        item = {'entryId': row['id'], 'caseId': row['caseId'], 'status': row['status']}
        if (folder / 'evidence-hashes.json').exists():
            for name, expected in read(folder / 'evidence-hashes.json').items():
                assert sha(folder / name) == expected, (row['id'], name)
                checked += 1
        if not (folder / 'review.json').exists():
            item['reviewEvidenceAvailable'] = False
            output.append(item)
            continue
        data = read(folder / 'review.json')
        sessions.append(data['fixture']['sessionId'])
        messages = data['final']['messages']
        assert read(folder / 'resources.json')['selection'] is None
        exposure = [read(f) for f in sorted(folder.glob('provider-*-loading.json'))]
        if exposure:
            first = next((e for e in exposure if e.get('parent')), None)
            if first:
                assert not any(s['bodyPresent'] for s in first['skills'].values())
        wire_count = 0
        for wire_file in folder.glob('provider-*-wire-input.json'):
            wire = read(wire_file)
            original = read(Path(str(wire_file).replace('-wire-input', '-input')))
            assert wire == dict(original, thinking={'type': 'disabled'})
            assert wire['model'] == 'deepseek-v4.1-flash'
            wire_count += 1
        reads = [{'messageIndex': i, 'text': m.get('text'), 'isError': m.get('isError', False)}
                 for i, m in enumerate(messages) if m.get('toolName') in ('skill_read', 'skill.read')]
        before, after = data['fixture']['before'], data['after']
        item.update({
            'reviewEvidenceAvailable': True,
            'transcriptHash': sha(folder / 'review.json'),
            'category': data.get('fixture', {}).get('truth', {}).get('category'),
            'messages': len(messages),
            'visibleMessageIndices': [i for i, m in enumerate(messages) if m['role'] == 'assistant' and m.get('text')],
            'skillReads': reads,
            'bodyExposure': [{'request': e['request'], 'turn': e['turn'],
                              'skills': [key for key, s in e['skills'].items() if s['bodyPresent']]}
                             for e in exposure],
            'providerCalls': wire_count,
            'stateExactlyUnchanged': before == after,
            'draftDocumentUnchanged': before.get('version', {}).get('document') == after.get('version', {}).get('document'),
            'publicationsUnchanged': before.get('publications') == after.get('publications'),
            'currentUnchanged': before.get('current') == after.get('current'),
            'conflictInjected': data.get('conflictInjected', False),
            'interactions': data.get('interactions', []),
        })
        output.append(item)
    assert len(sessions) == len(set(sessions)), 'Sessions must be independent'
    assert len(attempts) == len({a['id'] for a in attempts})
    assert all(a['endpoint'] == 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions' for a in attempts)
    for attempt in attempts:
        if attempt.get('actualModels'):
            assert all(m in ('deepseek-v4.1-flash', 'deepseek-v4-1-flash-261017') for m in attempt['actualModels'])
    totals = {'requests': len(attempts),
              'input': sum(a.get('usage', {}).get('prompt_tokens', 0) for a in attempts),
              'output': sum(a.get('usage', {}).get('completion_tokens', 0) for a in attempts),
              'unknownUsage': sum(not a.get('usage') for a in attempts),
              'tools': sum(r.get('tools', 0) for r in rows)}
    recorded_budget = read(BATCH / 'budget.json')
    for key in ('requests', 'input', 'output', 'unknownUsage'):
        assert totals[key] == recorded_budget[key], key
    report = {'scope': 'Raw evidence integrity and loading audit; semantic and per-case state review separate',
              'batch': str(BATCH.relative_to(ROOT)), 'rawEvidenceFilesVerified': checked,
              'totals': totals, 'responseModels': sorted({m for a in attempts for m in a.get('actualModels', [])}),
              'rows': output}
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'verifiedFiles': checked, 'totals': totals}, ensure_ascii=False))

if __name__ == '__main__':
    main()
