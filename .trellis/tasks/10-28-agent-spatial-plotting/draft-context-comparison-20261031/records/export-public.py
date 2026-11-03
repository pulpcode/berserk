"""Export allowlisted public evidence; never export provider reasoning or headers."""
import hashlib
import json
import sys
from pathlib import Path

batch = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parent.parent
schedule = json.loads((root / 'schedule.json').read_text())['slots']
order = sorted(schedule, key=lambda s: hashlib.sha256(('draft-context-review:' + s['slotId']).encode()).hexdigest())
aliases = {s['slotId']: f'V{i:02d}' for i, s in enumerate(order, 1)}
public = root / 'public-transcripts'
blind = root / 'review' / 'blind'
public.mkdir(exist_ok=True)
blind.mkdir(parents=True, exist_ok=True)
manifest = []
for slot in schedule:
    directory = batch / slot['slotId']
    path = directory / 'review.json'
    if not path.exists():
        continue
    r = json.loads(path.read_text())
    calls = {}
    for wire in sorted(directory.glob('provider-*-wire.json')):
        payload = json.loads(wire.read_text())
        for message in payload['messages']:
            if message.get('role') == 'assistant':
                for call in message.get('tool_calls', []):
                    calls.setdefault(call['id'], call)
    messages = [{k: m[k] for k in ['id', 'requestId', 'role', 'text', 'selections', 'toolName', 'toolCallId', 'isError'] if k in m} for m in r['snapshot']['messages']]
    record = dict(caseId=slot['caseId'], messages=messages, toolCalls=list(calls.values()),
                  interactions=r['interactions'], scopeAfterActualReplies=r['scope'],
                  mapBefore=r['fixture']['before'], mapAfter=r['mapState'],
                  sourceBefore=r['fixture']['sourceBefore'], sourceAfter=r['source'],
                  continuationDecisions=[json.loads(p.read_text()) for p in sorted(directory.glob('turn-*-decision.json'))])
    def write(path, value):
        data=json.dumps(value, ensure_ascii=False, indent=2)+'\n'
        if path.exists():
            assert path.read_text() == data, f'Refuse replacing changed evidence: {path}'
        else:
            path.write_text(data)
    write(public/(slot['slotId']+'.json'),dict(slotId=slot['slotId'], **record))
    # Review decisions are evaluator metadata, not user/model conversation.
    # Keep actual questions, scripted replies and resulting scope for adjudication.
    blind_record = dict(record)
    blind_record.pop('continuationDecisions')
    blind_record['interactions'] = [{k: v for k, v in item.items() if k != 'decision'} for item in record['interactions']]
    write(blind/(aliases[slot['slotId']]+'.json'),dict(reviewId=aliases[slot['slotId']], **blind_record))
    manifest.append(dict(slotId=slot['slotId'], reviewId=aliases[slot['slotId']], rawSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
(root/'records'/'public-export-index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'exported':len(manifest),'planned':len(schedule)}))
