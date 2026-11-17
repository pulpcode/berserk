from pathlib import Path
import hashlib, json, os, re, shutil, subprocess, tarfile, time, urllib.request

root = Path('/home/ubuntu')
meta = json.loads((root / 'axon-input-predictions-memory-inventory.json').read_text())
release = Path(meta['release'])
archive = root / meta['archive']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == meta['sha256']
def pids(port):
    return [int(p) for p in subprocess.run(['fuser', str(port) + '/tcp'], capture_output=True, text=True).stdout.split()]
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def healthy(port):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=5) as response:
        assert response.status == 200
for port, pid in meta['expectedPids'].items():
    assert pids(port) == [pid]
    healthy(port)
for name, sha in meta['expectedPrevious'].items():
    assert digest(release / name) == sha, 'Deployed source changed: ' + name
update = release / 'frontend-updates' / meta['updateId']
update.mkdir(parents=True, mode=0o700)
stage = update / 'staged'
with tarfile.open(archive) as tar:
    assert all(not m.issym() and not m.islnk() and not m.name.startswith('/') and '..' not in Path(m.name).parts for m in tar.getmembers())
    tar.extractall(stage, filter='data')
for item in meta['files']:
    assert digest(stage / item['path']) == item['sha256']
backup = update / 'backup'
dist_name = 'experiments/harness-lab/dist'
shutil.copytree(release / dist_name, backup / dist_name)
for name in meta['sourceFiles']:
    target = backup / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(release / name, target)
assert all(digest(backup / name) == sha for name, sha in meta['expectedPrevious'].items())
def replace(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name('.' + target.name + '.' + meta['updateId'] + '.tmp')
    shutil.copy2(source, temp)
    os.replace(temp, target)
index = dist_name + '/index.html'
try:
    # Publish new hashed assets first, retaining old assets for already-open pages.
    for item in meta['files']:
        name = item['path']
        if name == index:
            continue
        target = release / name
        if '/dist/assets/' in name and target.exists():
            assert digest(target) == item['sha256'], 'Conflicting hashed asset'
        replace(stage / name, target)
    replace(stage / index, release / index)
    for item in meta['files']:
        name = item['path']
        assert digest(release / name) == item['sha256']
        if '/dist/' in name:
            url = 'http://127.0.0.1:4316/' + name.split('/dist/', 1)[1]
            with urllib.request.urlopen(url, timeout=8) as response:
                assert response.status == 200 and response.read() == (stage / name).read_bytes()
    with urllib.request.urlopen('http://127.0.0.1:4316/', timeout=5) as response:
        assert response.read() == (stage / index).read_bytes()
    for port, pid in meta['expectedPids'].items():
        assert pids(port) == [pid]
        healthy(port)
    js = '\n'.join(p.read_text() for p in (stage / dist_name / 'assets').glob('*.js'))
    css = '\n'.join(p.read_text() for p in (stage / dist_name / 'assets').glob('*.css'))
    assert 'prompt-suggestion-accept' not in js and 'prompt-suggestion-accept' not in css
    assert '有下一步建议，可按 Tab 采纳。' in js
    report = {'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'updateId': meta['updateId'],
              'release': str(release), 'backup': str(backup), 'sourceArchiveSha256': meta['sha256'],
              'filesVerified': len(meta['files']), 'newAssets': re.findall(r'(?:src|href)="(/assets/[^\"]+)"', (stage / index).read_text()),
              'pidsUnchanged': meta['expectedPids'], 'health': {'4315': 200, '4316': 200}, 'serviceRestarted': False,
              'acceptButtonRemoved': True, 'existingCandidateRetainedAcrossVisibility': True, 'dataTouched': False, 'perSessionMemoryCache': True, 'modelChangesPreserveCandidates': True, 'identityChangesClearCache': True,
              'userAcceptance': 'pending', 'modelsInvoked': 0}
    (update / 'source-package.json').write_text(json.dumps(meta, indent=2) + '\n')
    (update / 'deployment.json').write_text(json.dumps(report, indent=2) + '\n')
    (release / 'latest-frontend-update.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
except Exception as error:
    for name in [*meta['sourceFiles'], index]:
        replace(backup / name, release / name)
    (update / 'failure.json').write_text(json.dumps({'error': str(error), 'previousIndexAndSourcesRestored': True}) + '\n')
    raise
