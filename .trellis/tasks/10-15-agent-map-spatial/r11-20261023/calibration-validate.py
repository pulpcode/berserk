#!/usr/bin/env python3
"""Read-only evidence integrity checks; no provider requests or generated files."""
import collections
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]

def read(name):
    return json.loads((HERE / name).read_text())['records']

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest = read('calibration-manifest.json')
inputs = {r['id']: r for r in read('calibration-inputs.json')}
proposals = {r['id']: r for r in read('calibration-proposals.json')}
human = {r['id']: r for r in read('calibration-human-labels.json')}
assert len(manifest) == len(inputs) == len(proposals) == len(human) == 24
assert len({r['id'] for r in manifest}) == 24
assert collections.Counter(r['split'] for r in manifest) == {'development': 16, 'validation': 8}
assert len(collections.Counter(r['theme'] for r in manifest)) == 6
assert set(collections.Counter(r['theme'] for r in manifest).values()) == {4}
dev = {r['family'] for r in manifest if r['split'] == 'development'}
val = {r['family'] for r in manifest if r['split'] == 'validation'}
assert not dev & val, 'Scene family leakage'
assert collections.Counter(proposals[r['id']]['proposedVerdict'] for r in manifest if r['split'] == 'validation') == {'pass': 4, 'fail': 4}
for row in manifest:
    i = row['id']
    path = ROOT / row['transcriptPath']
    assert sha(path) == row['transcriptSha256'], (i, 'native evidence drift')
    assert sha(ROOT / row['reviewPath']) == row['reviewSha256'], (i, 'review evidence drift')
    native = [json.loads(line) for line in path.read_text().splitlines()]
    index = row['sourceIndexZeroBased']
    assert row['sourceLine'] == index + 1
    message = native[index]['message']
    assert message['role'] == 'assistant'
    text = '\n'.join(c.get('text', '') for c in message['content'] if c.get('type') == 'text')
    assert row['claim'] in text, (i, 'quote not verbatim')
    assert inputs[i]['claimContext'] == text
    assert inputs[i]['claim'] == row['claim']
    assert hashlib.sha256(json.dumps(inputs[i], ensure_ascii=False, sort_keys=True).encode()).hexdigest() == row['inputSha256']
    assert all(m['sourceLine'] <= row['sourceLine'] for m in inputs[i]['transcriptThroughClaim'])
    assert set(inputs[i]) == {'id', 'unit', 'claim', 'claimContext', 'transcriptThroughClaim', 'stateEvidence', 'evaluationInstructions'}
    # Check authored metadata, not arbitrary words inside verbatim historical tool payloads.
    assert set(inputs[i]['evaluationInstructions']) == {'judgmentUnit', 'contemporaneousEvidence', 'stateEvidenceTiming', 'plansAndConditions'}
    assert set(proposals[i]) == {'id', 'proposedVerdict', 'proposedSeverity', 'reason', 'status'}
    assert human[i]['verdict'] in (None, 'pass', 'fail', 'pending')
print(json.dumps({'records': 24, 'development': 16, 'validation': 8,
    'validationFamilies': len(val), 'validationTraces': len({r['transcriptPath'] for r in manifest if r['split'] == 'validation'}),
    'humanConfirmed': sum(r['verdict'] is not None for r in human.values()),
    'checks': 'original quotes, hashes, split, families, input schema: PASS', 'providerRequests': 0}, ensure_ascii=False))
