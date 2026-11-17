from pathlib import Path
import json,hashlib,tarfile,shutil,sqlite3
base=Path('/home/ubuntu');old=base/'axon-r2-release-4315-20261114';release=base/'axon-r3-release-4315-20261116-retry';data=base/'axon-scenario-release-68dded362074/data'
archive=base/'axon-r3-skill-flow-deploy-4316-20261116.tar.gz';meta=json.loads((base/'axon-r3-skill-flow-deploy-inventory.json').read_text())
assert hashlib.sha256(archive.read_bytes()).hexdigest()==meta['sha256']

db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'
assert db.execute('PRAGMA user_version').fetchone()[0]==2
db.close();release.mkdir(mode=0o700)
with tarfile.open(archive) as tar:
    assert all(not m.issym() and not m.islnk() and not m.name.startswith('/') and '..' not in Path(m.name).parts for m in tar.getmembers())
    tar.extractall(release,filter='data')
for row in meta['files']:assert hashlib.sha256((release/row['path']).read_bytes()).hexdigest()==row['sha256']
deps=release/'experiments/harness-lab/node_modules';deps.mkdir()
for entry in (base/'axon-r3-skill-flow-4316-20261116/experiments/harness-lab/node_modules').iterdir():
    if entry.name in ['yaml','yauzl','pend']:shutil.copytree(entry,deps/entry.name,symlinks=True)
    else:(deps/entry.name).symlink_to(entry.resolve(),target_is_directory=entry.is_dir())
for name in ['launch.mts','release.json']:shutil.copyfile(old/name,release/name);(release/name).chmod(0o600)
start=(old/'start.sh').read_text();assert start.count(str(old))==3
(release/'start.sh').write_text(start.replace(str(old),str(release)));(release/'start.sh').chmod(0o700)
(release/'experiments/harness-lab/scripts/skills-scanner/semgrep-sandbox.py').chmod(0o755)
(release/'source-package.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps({'release':str(release),'filesVerified':len(meta['files']),'existingLaunchAndConfigurationReusedOnServer':True,'schemaMigrationNeeded':False,'sourceArchiveSha256':meta['sha256']}))

p=release/'launch.mts';p.write_text("process.env.LAB_EXECUTION_IMAGE = 'berserk-skill-runtime:r3-4bcd42bb3a7a';\n"+p.read_text());p.chmod(0o600)
