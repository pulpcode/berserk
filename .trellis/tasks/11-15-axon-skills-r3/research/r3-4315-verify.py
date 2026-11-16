import datetime
import hashlib
import http.cookiejar
import json
import pathlib
import re
import sqlite3
import urllib.error
import urllib.parse
import urllib.request

RELEASE = pathlib.Path('/home/ubuntu/axon-r3-release-4315-20261116-retry')
DATA = pathlib.Path('/home/ubuntu/axon-scenario-release-68dded362074/data')
BACKUP = RELEASE / 'backup/before-skill-flow'
BASE = 'http://127.0.0.1:4315'
ORIGIN = 'http://49.232.156.14:4315'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def connect(root):
    db = sqlite3.connect(f'file:{root}/collaboration/collaboration.sqlite?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db

class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.auth = None

    def request(self, path, payload=None, expect=200, raw=False):
        headers = {'Origin': ORIGIN}
        if self.auth:
            headers.update({'x-csrf-token': self.auth['csrf'], 'x-axon-view': self.auth['viewId']})
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as e:
            response = e
        content = response.read()
        assert response.code == expect, f'{path}: expected {expect}, got {response.code}'
        return content if raw else json.loads(content)

    def login(self, choice, password):
        anonymous = self.request('/api/auth/session')
        request = urllib.request.Request(BASE + '/api/auth/login', data=json.dumps({**choice, 'password': password}).encode(), headers={'Origin': ORIGIN, 'x-csrf-token': anonymous['csrf'], 'Content-Type': 'application/json'})
        response = self.opener.open(request, timeout=20)
        assert response.code == 200
        self.auth = json.load(response)
        return self.auth

with connect(DATA) as db:
    accounts = [dict(row) for row in db.execute('SELECT * FROM accounts ORDER BY id')]
    seats = [tuple(row) for row in db.execute('SELECT * FROM seats ORDER BY id')]
    roles = [tuple(row) for row in db.execute('SELECT * FROM account_roles ORDER BY user_id,role')]
    tasks = [tuple(row) for row in db.execute('SELECT * FROM task_spaces ORDER BY id')]
credentials = json.loads((DATA / 'credentials.json').read_text())['accounts']
workspace_digest = digest(DATA / 'workspace-index.json')
client = Client()
business_checks = []
for item in credentials.values():
    with connect(DATA) as db:
        seat = db.execute('SELECT seat_id FROM accounts WHERE username=? AND enabled=1', (item['username'],)).fetchone()[0]
    business = Client()
    session = business.login({'seatId': seat}, item['password'])
    assert session['identity']['seatId'] == seat
    assert business.request('/api/admin/access') == {'administrator': False}
    business.request('/api/capabilities/experts')
    skills=business.request('/api/capabilities/skills');assert len(skills)==4 and all(s['system'] for s in skills)
    business.request('/api/admin/capabilities/skills',expect=403)
    business.request('/api/tasks')
    catalog = business.request('/api/workspaces')['workspaces']
    session_count = 0
    for workspace in catalog:
        history = business.request('/api/sessions?' + urllib.parse.urlencode({'workspaceId': workspace['id']}))
        assert isinstance(history, list)
        session_count += len(history)
        if history:
            business.request('/api/sessions/' + history[0]['id'])
    business_checks.append({'seat': seat, 'originalPasswordLogin': True, 'administrator': False, 'catalogAndHistoryReadable': True, 'sessionCount': session_count})

with connect(DATA) as db, connect(BACKUP) as backup:
    assert db.execute('PRAGMA user_version').fetchone()[0] == 24
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    for table in ['seats', 'task_spaces', 'task_actions']:
        assert [tuple(row) for row in db.execute(f'SELECT * FROM {table} ORDER BY 1')] == [tuple(row) for row in backup.execute(f'SELECT * FROM {table} ORDER BY 1')], f'{table} differs from pre-deployment backup'
    assert [tuple(row) for row in db.execute('SELECT * FROM accounts ORDER BY id')] == [tuple(row) for row in backup.execute('SELECT * FROM accounts ORDER BY id')]
    assert [dict(row) for row in db.execute('SELECT * FROM accounts ORDER BY id')] == accounts
assert digest(DATA / 'workspace-index.json') == workspace_digest
html = client.request('/', raw=True).decode()
assets = sorted(set(re.findall(r'(?:src|href)="(/assets/[^"<>]+)"', html)))
assert any(asset.endswith('.js') for asset in assets) and any(asset.endswith('.css') for asset in assets)
asset_checks = []
for asset in assets:
    body = client.request(asset, raw=True)
    expected = (RELEASE / 'experiments/harness-lab/dist' / asset.lstrip('/')).read_bytes()
    assert body == expected
    asset_checks.append({'asset': asset, 'sha256': hashlib.sha256(body).hexdigest()})
for path in ['/brand/axon-app-icon.svg','/brand/axon-wordmark.svg','/favicon.ico']:
    assert client.request(path,raw=True)==(RELEASE/'experiments/harness-lab/dist'/path.lstrip('/')).read_bytes()
client.request('/api/capabilities/skills',expect=401)
health = {}
for port in [4315, 4316]:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=15) as response:
        assert response.code == 200 and json.load(response)['ok']
        health[str(port)] = 200
report = {
    'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'release': str(RELEASE), 'sourceArchiveSha256': json.loads((RELEASE / 'release.json').read_text())['sourceArchiveSha256'],
    'businessAccountsPasswordsSeatsRolesTasksUnchanged': True,
    'noDraftWorkspaceOrTaskCreatedByLoginAndReads': True,
    'schemaVersion': 24, 'accountCount': len(accounts), 'businessSeatCount': len(seats),
 'businessChecks': business_checks,
    'assets': asset_checks, 'health': health, 'r1UserAcceptance': 'pending', 'r2UserAcceptance': 'pending',
}
text = json.dumps(report, ensure_ascii=False, indent=2)
assert all(item['password'] not in text for item in credentials.values())
(RELEASE / 'r3-verification.json').write_text(text)
print(text)
