"""Freeze source inputs and copy identical evaluation files to the baseline archive."""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[3]
task = Path('.trellis/tasks/10-17-map-layer-name-experiment')
previous = Path('.trellis/tasks/10-17-map-query-native-evaluation')
archive = root / '.local/map-layer-name-A'
assert archive.is_dir(), 'Prepare ae7236c source archive first'
target = root / task / 'frozen.json'
assert not target.exists(), 'Refuse replacing a frozen experiment'
inputs = subprocess.check_output(['git', 'ls-files', '-z',
    'experiments/harness-lab/src', 'experiments/harness-lab/fixtures',
    'experiments/harness-lab/scripts', 'experiments/harness-lab/package.json',
    'experiments/harness-lab/package-lock.json'], cwd=root).decode().split('\0')
inputs = [p for p in inputs if p]
harness = [previous / p for p in ['run.ts', 'fixtures.ts', 'package.json', 'review-rubric.md']]
harness += [task / p for p in ['run.ts', 'fixtures.ts', 'package.json', 'review-rubric.md', 'prd.md', 'design.md', 'freeze.py']]
for path in harness:
    (archive / path).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / path, archive / path)

def hashes(base, paths):
    return {str(p): hashlib.sha256((base / p).read_bytes()).hexdigest() for p in paths}

arms = {'A': hashes(archive, inputs), 'B': hashes(root, inputs)}
changed = [p for p in inputs if arms['A'][p] != arms['B'][p]]
assert set(changed) == {'experiments/harness-lab/' + p for p in [
    'src/contracts/annotations.ts', 'src/annotations/validation.ts', 'src/annotations/service.ts',
    'src/pi/annotation-tools.ts', 'src/pi/annotation-results.ts']}, changed
result = {'baseline': 'ae7236c', 'arms': arms, 'harness': hashes(root, harness), 'changedProductFiles': changed}
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
shutil.copy2(target, archive / task / 'frozen.json')
print(json.dumps({'productInputs': len(inputs), 'harnessInputs': len(harness), 'changed': changed}, ensure_ascii=False))
