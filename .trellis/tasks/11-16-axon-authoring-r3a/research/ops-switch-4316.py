from pathlib import Path
import os,json,hashlib,sqlite3,subprocess,time,signal,shutil,urllib.request,re
base=Path('/home/ubuntu');release=base/'axon-r3a-preview-4316-20261116';old=base/'axon-r3-skill-flow-4316-20261116';data=base/'axon-chat-c-preview-20261112/data';backup=release/'backup/before-r3a';oldpid=2771458
def pids(port):return [int(p) for p in subprocess.run(['fuser',f'{port}/tcp'],capture_output=True,text=True).stdout.split()]
def healthy(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=2) as r:return r.status==200
    except Exception:return False
def start(root):
    with (root/'service.log').open('ab') as log:
        return subprocess.Popen(['/bin/sh',str(root/'start.sh')],cwd=root/'experiments/harness-lab',stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True).pid
def inventory(root):
    entries=[]
    for p in sorted(root.rglob('*')):
        if p.is_symlink() or not p.is_file() and not p.is_dir():raise RuntimeError('Unexpected special file; preserve source')
        if p.is_file():
            assert p.stat().st_nlink==1
            entries.append({'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    return entries
def fingerprint(path):
    db=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True);db.row_factory=sqlite3.Row;out={}
    for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        name=row['name'];rows=sorted(json.dumps(dict(r),sort_keys=True,default=lambda v:v.hex() if isinstance(v,bytes) else str(v)) for r in db.execute('SELECT * FROM "'+name.replace('"','""')+'"'))
        out[name]=hashlib.sha256(json.dumps(rows).encode()).hexdigest()
    assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok';db.close();return out
assert pids(4316)==[oldpid] and healthy(4316) and healthy(4315)
old4315=pids(4315);meta=json.loads((release/'source-package.json').read_text())
for f in meta['files']:assert hashlib.sha256((release/f['path']).read_bytes()).hexdigest()==f['sha256']
(release/'backup').mkdir(mode=0o700);backed=False;started=False
try:
    os.kill(oldpid,signal.SIGTERM);deadline=time.time()+35
    while time.time()<deadline and (pids(4316) or (data/'mock.sock').exists()):time.sleep(.25)
    assert not pids(4316) and not (data/'mock.sock').exists(),'Previous service did not stop cleanly'
    before=inventory(data);shutil.copytree(data,backup)
    assert inventory(backup)==before,'Full backup verification failed'
    backed=True;backupDigest=hashlib.sha256(json.dumps(before,separators=(',',':')).encode()).hexdigest()
    (release/'backup-inventory.json').write_text(json.dumps({'files':before,'sha256':backupDigest},indent=2)+'\n')
    databases=['collaboration/collaboration.sqlite','capabilities/capabilities.sqlite'];state={p:fingerprint(data/p) for p in databases}
    start(release);started=True;deadline=time.time()+55
    while time.time()<deadline and not healthy(4316):time.sleep(.5)
    assert healthy(4316),'New service failed health check'
    assert pids(4315)==old4315 and healthy(4315)
    assert all(fingerprint(data/p)==v for p,v in state.items()),'Existing account/skill tables changed'
    histories=[f for f in before if f['path'].endswith('.jsonl')]
    assert all((data/f['path']).read_bytes().startswith((backup/f['path']).read_bytes()) for f in histories)
    assert (data/'service-secrets.json').read_bytes()==(backup/'service-secrets.json').read_bytes()
    with urllib.request.urlopen('http://127.0.0.1:4316/',timeout=5) as response:html=response.read().decode()
    assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',html)
    for asset in assets:
        with urllib.request.urlopen('http://127.0.0.1:4316'+asset,timeout=5) as response:assert response.read()==(release/'experiments/harness-lab/dist'/asset.lstrip('/')).read_bytes()
    report={'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'previousRelease':str(old),'sourceArchiveSha256':meta['sha256'],'filesVerified':len(meta['files']),'pid':pids(4316)[0],'previousPid':oldpid,'dataDir':str(data),'backup':str(backup),'backupDigest':backupDigest,'backupFiles':len(before),'schemaMigrationNeeded':False,'allAccountAndSkillTablesPreserved':True,'historyPrefixesPreserved':len(histories),'serviceSecretsUnchanged':True,'frontendAssetsVerified':assets,'health':{'4315':200,'4316':200},'pid4315Unchanged':True,'administratorPersonalOrganizationSkills':True,'skillCreationFormAndConciseCopy':True,'skillFlowOrderAndHeaderRow':True,'conversationalAuthoringR3A':True,'sourceBranch':'codex/axon-r3a','sourceBaseCommit':'6631b48','sourceWorkingTreeUncommitted':True,'userAcceptance':'pending'}
    (release/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');(release/'.service.pid').write_text(str(report['pid'])+'\n');print(json.dumps(report,indent=2))
except Exception as error:
    if started:
        for pid in pids(4316):os.kill(pid,signal.SIGTERM)
        deadline=time.time()+15
        while time.time()<deadline and (pids(4316) or (data/'mock.sock').exists()):time.sleep(.25)
    if backed:
        data.rename(data.with_name('data-r3a-failed-'+time.strftime('%Y%m%d-%H%M%S')));shutil.copytree(backup,data)
    if not pids(4316):start(old)
    deadline=time.time()+40
    while time.time()<deadline and not healthy(4316):time.sleep(.5)
    (release/'failure.json').write_text(json.dumps({'error':str(error),'oldServiceHealthy':healthy(4316)},indent=2)+'\n');raise
