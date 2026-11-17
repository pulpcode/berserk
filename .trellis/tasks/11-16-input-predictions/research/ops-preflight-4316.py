from pathlib import Path
import json, sqlite3, urllib.request, urllib.error, urllib.parse, http.cookiejar, hashlib

root=Path('/home/ubuntu');release=root/'axon-input-predictions-4316-20261116';old=root/'axon-r2-personal-4316-20261114';data=root/'axon-chat-c-preview-20261112/data'
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
    except urllib.error.HTTPError as error:
        try: detail=json.loads(error.read())
        except Exception: detail={}
        return error.code,{'code':detail.get('code'),'error':detail.get('error')}
def login(username,password):
    opener=client();status,initial=request(opener,'/api/auth/session');assert status==200
    status,session=request(opener,'/api/auth/login',{'username':username,'password':password},initial['csrf']);assert status==200,'Existing credential login failed'
    return opener,session
def counts():
    db=sqlite3.connect('file:'+str(data/'capabilities/capabilities.sqlite')+'?mode=ro',uri=True)
    result={name:db.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in ['r3_skill_assets','r3_skill_drafts','r3_skill_publications','r2_drafts','r2_trials']};db.close();return result


accounts=credentials(json.loads((old/'administrator-test-credentials.json').read_text()))+credentials(json.loads((data/'credentials.json').read_text()))
seen=set();summary=[]
for username,password in accounts:
 if username in seen:continue
 seen.add(username);opener,session=login(username,password)
 status,value=request(opener,'/api/activity',view=session['viewId']);assert status==200
 sessions=value['sessions']
 assert not any(s.get('active') or s.get('backgroundJob') for s in sessions),'Active work exists; do not stop service'
 summary.append({'accountRole':session['identity'].get('role','business'),'sessions':len(sessions),'active':0})
print(json.dumps({'ready':True,'accounts':summary}))
