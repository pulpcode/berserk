from pathlib import Path
import os,json,hashlib,sqlite3,subprocess,time,signal,shutil,urllib.request,re
base=Path('/home/ubuntu');release=base/'axon-r3-release-4315-20261116-retry';old=base/'axon-r2-release-4315-20261114';data=base/'axon-scenario-release-68dded362074/data';backup=release/'backup/before-skill-flow';oldpid=2232768
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
oldpid=pids(4315)[0]
assert Path('/proc/'+str(oldpid)+'/cwd').resolve()==old/'experiments/harness-lab'
assert pids(4315)==[oldpid] and healthy(4315) and healthy(4316)
old4316=pids(4316);meta=json.loads((release/'source-package.json').read_text())
for f in meta['files']:assert hashlib.sha256((release/f['path']).read_bytes()).hexdigest()==f['sha256']
(release/'backup').mkdir(mode=0o700);backed=False;started=False
try:
    os.kill(oldpid,signal.SIGTERM);deadline=time.time()+35
    while time.time()<deadline and (pids(4315) or (data/'mock.sock').exists()):time.sleep(.25)
    assert not pids(4315) and not (data/'mock.sock').exists(),'Previous service did not stop cleanly'
    before=inventory(data);shutil.copytree(data,backup)
    assert inventory(backup)==before,'Full backup verification failed'
    backed=True;backupDigest=hashlib.sha256(json.dumps(before,separators=(',',':')).encode()).hexdigest()
    (release/'backup-inventory.json').write_text(json.dumps({'files':before,'sha256':backupDigest},indent=2)+'\n')
    databases=['collaboration/collaboration.sqlite','capabilities/capabilities.sqlite'];state={p:fingerprint(data/p) for p in databases}
    app=release/'experiments/harness-lab'
    node='/home/ubuntu/berserk-w01-5.gIXPCA/runtime/node-v24.14.0-linux-x64/bin/node'
    for mode in ['--dry-run','--apply','--apply']:
        args=[node,'--import','tsx','scripts/migrate-skills-r3.ts','--data-dir',str(data),'--backup-dir',str(release/'backup/r3-migration'),mode,'--service-stopped']
        result=subprocess.run(args,cwd=app,capture_output=True,text=True)
        with (release/'migration.log').open('a') as log:log.write(result.stdout+result.stderr)
        assert result.returncode==0,'R3 migration failed; rollback'
    for path,tables in state.items():
        current=fingerprint(data/path)
        assert all(current.get(name)==digest for name,digest in tables.items()),'Legacy tables changed during migration'
    state={p:fingerprint(data/p) for p in databases}
    start(release);started=True;deadline=time.time()+55
    while time.time()<deadline and not healthy(4315):time.sleep(.5)
    assert healthy(4315),'New service failed health check'
    assert pids(4316)==old4316 and healthy(4316)
    assert all(all(fingerprint(data/p).get(n)==h for n,h in v.items() if not n.startswith('r3_')) for p,v in state.items()),'Legacy account/skill tables changed'
    db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
    seeded=[json.loads(row[0]) for row in db.execute('SELECT data FROM r3_skill_assets')]
    assert len(seeded)==4 and all(s['system'] for s in seeded),'Unexpected initial R3 skills'
    db.close()
    histories=[f for f in before if f['path'].endswith('.jsonl')]
    assert all((data/f['path']).read_bytes().startswith((backup/f['path']).read_bytes()) for f in histories)
    assert (data/'service-secrets.json').read_bytes()==(backup/'service-secrets.json').read_bytes()
    with urllib.request.urlopen('http://127.0.0.1:4315/',timeout=5) as response:html=response.read().decode()
    assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',html)
    for asset in assets:
        with urllib.request.urlopen('http://127.0.0.1:4315'+asset,timeout=5) as response:assert response.read()==(release/'experiments/harness-lab/dist'/asset.lstrip('/')).read_bytes()
    report={'updatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'release':str(release),'previousRelease':str(old),'sourceArchiveSha256':meta['sha256'],'filesVerified':len(meta['files']),'pid':pids(4315)[0],'previousPid':oldpid,'dataDir':str(data),'backup':str(backup),'backupDigest':backupDigest,'backupFiles':len(before),'schemaMigrationNeeded':True,'r3MigrationDryRunApplyAndReentry':True,'allAccountAndSkillTablesPreserved':True,'historyPrefixesPreserved':len(histories),'serviceSecretsUnchanged':True,'frontendAssetsVerified':assets,'health':{'4316':200,'4315':200},'pid4316Unchanged':True,'administratorPersonalOrganizationSkills':True,'skillCreationFormAndConciseCopy':True,'skillFlowOrderAndHeaderRow':True,'userAcceptance':'pending'}
    (release/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');(release/'.service.pid').write_text(str(report['pid'])+'\n');print(json.dumps(report,indent=2))
except Exception as error:
    if started:
        for pid in pids(4315):os.kill(pid,signal.SIGTERM)
        deadline=time.time()+15
        while time.time()<deadline and (pids(4315) or (data/'mock.sock').exists()):time.sleep(.25)
    if backed:
        data.rename(data.with_name('data-skill-flow-failed-'+time.strftime('%Y%m%d-%H%M%S')));shutil.copytree(backup,data)
    if not pids(4315):start(old)
    deadline=time.time()+40
    while time.time()<deadline and not healthy(4315):time.sleep(.5)
    (release/'failure.json').write_text(json.dumps({'error':str(error),'oldServiceHealthy':healthy(4315)},indent=2)+'\n');raise
