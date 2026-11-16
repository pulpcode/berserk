from pathlib import Path
import json,base64,uuid,http.cookiejar,urllib.request,urllib.error,sqlite3

base=Path('/home/ubuntu');data=base/'axon-chat-c-preview-20261112/data';release=base/'axon-r3-skill-flow-4316-20261116'
target='skill-4890c079-70d0-48c4-b865-4ce4bf1eb60d';expected='---\nname: new-skill\ndescription: 请填写用途\n---\n\n'.encode()
expectedDigest='773032adb7e49144bfc018c58dd81fd6901d1cc6a7b9048e80468ce19fda706d'
assert (release/'deployment.json').is_file(),'A verified deployment and full backup must exist first'
deployment=json.loads((release/'deployment.json').read_text());assert Path(deployment['backup']).is_dir()
origin='http://49.232.156.14:4316';opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path,body=None,csrf=None,view=None):
    headers={'Origin':origin}
    if csrf:headers['x-csrf-token']=csrf
    if view:headers['x-axon-view']=view
    if body is not None:headers['Content-Type']='application/json'
    with opener.open(urllib.request.Request('http://127.0.0.1:4316'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=12) as response:return json.load(response)
def credentials(value):
    if isinstance(value,dict):
        if value.get('username')=='admin' and isinstance(value.get('password'),str):return {'username':'admin','password':value['password']}
        for child in value.values():
            found=credentials(child)
            if found:return found
    elif isinstance(value,list):
        for child in value:
            found=credentials(child)
            if found:return found
    return None
login=credentials(json.loads((base/'axon-r2-personal-4316-20261114/administrator-test-credentials.json').read_text()));assert login
anonymous=request('/api/auth/session');session=request('/api/auth/login',login,anonymous['csrf']);assert session['identity']['role']=='administrator'
path='/api/admin/capabilities/skills/'+target;before=request(path,view=session['viewId'])
report={'target':target,'backup':deployment['backup'],'archived':False,'deleted':False,'credentialsExported':False}
def untouched(detail):
    draft=detail.get('draft') or {};files=draft.get('files',[])
    return draft.get('draftRevision')==1 and draft.get('packageDigest')==expectedDigest and len(files)==1 and files[0].get('path')=='SKILL.md' and base64.b64decode(files[0].get('contentBase64',''))==expected and not draft.get('requirements') and not detail['publications'] and detail['policy']['revision']==0 and not detail['skill']['revisionId']
assert untouched(before),'Placeholder was edited or published; stop without changing it'
if before['skill']['archived']:
    report.update({'archived':True,'alreadyArchived':True})
else:
    assert before['skill']['stateRevision']==0 and before['skill']['state']=='enabled' and [a['action'] for a in before['audit']]==['created']
    db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
    assert db.execute('SELECT count(*) FROM r3_skill_packages WHERE skill_id=?',(target,)).fetchone()[0]==0;db.close()
    for folder in ['skill-trial-runtime','capability-trials','sessions','subagents']:
        directory=data/folder
        if directory.exists():
            for p in directory.rglob('*'):
                if p.is_file() and p.suffix in ['.json','.jsonl']:assert target.encode() not in p.read_bytes(),'Runtime reference appeared; stop without archiving'
    actionFile=release/'placeholder-archive-action.json'
    if not actionFile.exists():actionFile.write_text(json.dumps({'archive':str(uuid.uuid4()),'restore':str(uuid.uuid4())})+'\n')
    actions=json.loads(actionFile.read_text())
    result=request(path+'/lifecycle',{'action':'archive','expectedStateRevision':0,'clientActionId':actions['archive']},session['csrf'],session['viewId'])
    after=request(path,view=session['viewId'])
    if not untouched(after):
        request(path+'/lifecycle',{'action':'restore','expectedStateRevision':result['stateRevision'],'clientActionId':actions['restore']},session['csrf'],session['viewId'])
        raise RuntimeError('Content changed concurrently; archive restored and retained for review')
    assert after['skill']['archived'] and after['skill']['stateRevision']==1
    assert after['draft']==before['draft'] and after['publications']==before['publications']
    report.update({'archived':True,'stateRevision':after['skill']['stateRevision'],'draftUnchanged':True,'publicationsUnchanged':True,'auditActions':[a['action'] for a in after['audit']],'clientActionId':actions['archive']})
(release/'placeholder-archive.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
