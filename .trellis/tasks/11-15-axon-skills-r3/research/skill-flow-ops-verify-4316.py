from pathlib import Path
import json, sqlite3, urllib.request, urllib.error, urllib.parse, http.cookiejar

root=Path('/home/ubuntu');release=root/'axon-r3-skill-flow-4316-20261116';old=root/'axon-r2-personal-4316-20261114';data=root/'axon-chat-c-preview-20261112/data'
origin='http://49.232.156.14:4316';url='http://127.0.0.1:4316'
def credentials(value):
    found=[]
    if isinstance(value,dict):
        if isinstance(value.get('username'),str) and isinstance(value.get('password'),str):found.append((value['username'],value['password']))
        for child in value.values():found+=credentials(child)
    elif isinstance(value,list):
        for child in value:found+=credentials(child)
    return found
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(opener,path,body=None,csrf=None,view=None):
    headers={'Origin':origin}
    if csrf:headers['x-csrf-token']=csrf
    if view:headers['x-axon-view']=view
    if body is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with opener.open(req,timeout=12) as response:return response.status,json.load(response)
    except urllib.error.HTTPError as error:return error.code,None
def login(username,password):
    opener=client();status,initial=request(opener,'/api/auth/session');assert status==200
    status,session=request(opener,'/api/auth/login',{'username':username,'password':password},initial['csrf']);assert status==200,'Existing credential login failed'
    return opener,session
def counts():
    db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
    result={name:db.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in ['r3_skill_assets','r3_skill_drafts','r3_skill_publications','r2_drafts','r2_trials']};db.close();return result

brand=[]
for path in ['/brand/axon-app-icon.svg','/brand/axon-wordmark.svg','/favicon.ico']:
    with urllib.request.urlopen(url+path,timeout=5) as response:
        content=response.read();kind=response.headers.get('Content-Type','')
        assert response.status==200 and content==(release/'experiments/harness-lab/dist'/path.lstrip('/')).read_bytes()
        assert ('image/svg+xml' in kind if path.endswith('.svg') else 'image/' in kind)
        brand.append({'path':path,'status':200,'contentType':kind,'bytesVerified':True})
before=counts()
admin=credentials(json.loads((old/'administrator-test-credentials.json').read_text()))
admin=[item for item in admin if item[0]=='admin'];assert len(admin)==1,'Existing administrator credential record not found'
business=list(dict.fromkeys(credentials(json.loads((data/'credentials.json').read_text()))));assert len(business)>=4,'Expected existing test accounts'
business=[item for item in business if item[0]!='admin'][:4]
opener,session=login(*admin[0]);assert session['identity']['role']=='administrator'
admin_user_id=session['identity']['userId'];view=session['viewId'];status,managed=request(opener,'/api/admin/capabilities/skills',view=view);assert status==200 and len(managed)>=4
status,catalog=request(opener,'/api/capabilities/skills',view=view);assert status==200 and len(catalog)>=4
db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
assets=[json.loads(row[0]) for row in db.execute('SELECT data FROM r3_skill_assets')]
denied={row[0] for row in db.execute('SELECT expert_id FROM access_rules WHERE principal_id=? AND allowed=0',(admin_user_id,))}
expected={s['skillId'] for s in assets if s.get('currentRevisionId') and s['state']=='enabled' and not s['archived'] and s['skillId'] not in denied}
db.close();assert {s['skillId'] for s in catalog}==expected,'Admin personal catalog does not match available publications'
for skill in catalog:
    path='/api/capabilities/skills/'+urllib.parse.quote(skill['skillId'])+'?'+urllib.parse.urlencode({k:skill[k] for k in ['revisionId','packageDigest']})
    status,detail=request(opener,path,view=view);assert status==200 and detail['trialSummary']['status'] in ['not_tried','prepared','running','succeeded','failed','interrupted','cancelled']
assert request(opener,'/api/admin/capabilities/experts',view=view)[0]==200
assert request(opener,'/api/workspaces',view=view)[0]==200
assert request(opener,'/api/sessions',view=view)[0]==200
assert request(opener,'/api/workbench',view=view)[0]==403
results=[]
for username,password in business:
    user,session=login(username,password);view=session['viewId'];assert session['identity'].get('role')!='administrator'
    status,skills=request(user,'/api/capabilities/skills',view=view);assert status==200 and len(skills)>=4
    assert request(user,'/api/admin/capabilities/skills',view=view)[0]==403
    status,sessions=request(user,'/api/sessions',view=view);assert status==200 and isinstance(sessions,list)
    if sessions:
        assert request(user,'/api/sessions/'+sessions[0]['id'],view=view)[0]==200
        assert request(opener,'/api/sessions/'+sessions[0]['id'])[0]==404
    results.append({'seatId':session['identity'].get('seatId'),'login':200,'skills':len(skills),'managementDenied':403,'existingSessions':len(sessions),'historyReadable':True})
after=counts();assert before==after,'Read-only verification created management records'
assert request(client(),'/api/admin/capabilities/skills')[0]==401
assert request(client(),'/api/capabilities/skills')[0]==401
report={'passed':True,'administrator':{'login':200,'managedSkills':len(managed),'availableSkills':len(catalog),'publishedOrganizationSkills':sum(not s['system'] for s in catalog),'allPublishedSkillDetailsReadable':True,'businessSeatPolicyNotRequired':True,'management':200,'personalWorkspacesAndSessions':200,'businessWorkbenchDenied':403},'businessAccounts':results,'unauthenticatedDenied':401,'managementCountsUnchanged':before,'credentialsChanged':False,'modelsInvoked':0,'testAssetsCreated':0,'brandingAssetsVerified':brand}
(release/'online-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
