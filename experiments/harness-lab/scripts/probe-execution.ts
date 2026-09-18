/** Genuine container probe. An unavailable Docker daemon/image is a failure, never a skipped pass. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DockerExecutionService, type RequestSandbox } from '../src/execution/docker.js';

const root = await mkdtemp(join(tmpdir(), 'berserk-execution-probe-'));
const service = new DockerExecutionService({ instanceId: `probe-${randomUUID()}`, image: process.env.EXECUTION_IMAGE || 'berserk-file-runtime:w01-5' });
const checks: string[] = [];
const directories = ['seat-a', 'seat-b', 'logs'];
await Promise.all(directories.map(name => mkdir(join(root, name))));
const scope = (seat: string) => ({ requestId: randomUUID(), workspaceDir: join(root, seat), logsDir: join(root, 'logs') });
async function command(sandbox: RequestSandbox, text: string) {
  const chunks: Buffer[] = [];
  const result = await sandbox.exec(text, '/workspace', { onData: data => chunks.push(data) });
  assert.equal(result.exitCode, 0, Buffer.concat(chunks).toString());
  return Buffer.concat(chunks).toString();
}
try {
  const status = await service.initialize();
  assert.equal(status.available, true, status.reason);
  const a = service.create(scope('seat-a'));
  const b = service.create(scope('seat-a'));
  const otherSeat = service.create(scope('seat-b'));
  await a.writeFile('/workspace/input.csv', 'name,value\n甲,10\n乙,20\n');
  assert.match((await b.readFile('/workspace/input.csv')).toString(), /甲,10/);
  assert.equal(await otherSeat.exists('/workspace/input.csv'), false);
  checks.push('同席位共享文件、不同席位隔离');

  assert.match(await command(a, 'id -u; node --version; python --version'), /Python 3\.12/);
  assert.equal((await command(a, 'id -u')).trim() === '0', false);
  const isolation = await command(a, `python - <<'PY'
import os, socket
assert 'LLM_API_KEY' not in os.environ
assert 'PI_SESSION_FILE' not in os.environ
assert not os.path.exists('/var/run/docker.sock')
try:
    open('/opt/berserk/no-write', 'w')
    raise AssertionError('image writable')
except (PermissionError, OSError):
    pass
s=socket.socket(); s.settimeout(1)
try:
    s.connect(('1.1.1.1', 443))
    raise AssertionError('network available')
except OSError:
    pass
print('isolation-ok')
PY`);
  assert.match(isolation, /isolation-ok/);
  await assert.rejects(a.readFile('/etc/passwd'));
  await command(a, 'ln -s /etc /workspace/escape');
  await assert.rejects(a.readFile('/workspace/escape/passwd'));
  await writeFile(join(root, 'logs', 'previous.log'), 'previous output');
  assert.equal((await a.readFile('/logs/previous.log')).toString(), 'previous output');
  await assert.rejects(a.writeFile('/logs/forbidden', 'no'));
  checks.push('非 root、只读系统、无网络、无凭证、路径与日志范围');

  const formats = `import csv, json
from openpyxl import Workbook, load_workbook
from docx import Document
from reportlab.pdfgen import canvas
from pypdf import PdfReader
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
rows = list(csv.DictReader(open('input.csv')))
total = sum(int(row['value']) for row in rows)
json.dump({'total': total}, open('result.json', 'w'))
w = Workbook(); w.active.append(['总数', total]); w.save('result.xlsx')
assert load_workbook('result.xlsx').active['B1'].value == 30
d = Document(); d.add_paragraph('中文方案：总数30'); d.save('result.docx')
assert '总数30' in Document('result.docx').paragraphs[0].text
p = canvas.Canvas('result.pdf'); p.drawString(40, 750, 'Total 30'); p.save()
assert 'Total 30' in PdfReader('result.pdf').pages[0].extract_text()
font=FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
plt.bar(['A','B'],[10,20]); plt.title('统计图', fontproperties=font); plt.savefig('result.png')
with Image.open('result.png') as im: im.verify()
print('formats-ok')`;
  await a.writeFile('/workspace/analyze.py', formats);
  assert.match(await command(a, 'python analyze.py'), /formats-ok/);
  assert.equal(await a.detectImageMimeType('/workspace/result.png'), 'image/png');
  assert.deepEqual(JSON.parse((await a.readFile('/workspace/result.json')).toString()), { total: 30 });
  assert.ok((await a.glob('*.py', '/workspace', { ignore: ['**/.git/**'], limit: 10 })).includes('analyze.py'));
  checks.push('CSV、JSON、XLSX、DOCX、文本PDF、中文PNG真实读写');

  const large = await command(a, "python -c \"print('长输出' * 40000)\"");
  assert.equal(Buffer.byteLength(large), Buffer.byteLength('长输出'.repeat(40000) + '\n'));
  const failed = await a.exec('echo deliberate-failure; exit 7', '/workspace', { onData() {} });
  assert.equal(failed.exitCode, 7);
  assert.match(await command(a, 'echo recovered'), /recovered/);
  checks.push('真实长输出字节完整、非零退出后可继续');

  await command(a, "setsid sh -c 'while true; do echo running >> /workspace/background.txt; sleep 0.05; done' >/dev/null 2>&1 & sleep 0.2");
  const before = await a.readFile('/workspace/background.txt');
  await command(b, 'sleep 0.3');
  assert.deepEqual(await a.readFile('/workspace/background.txt'), before);
  await a.writeFile('/workspace/daemon.py', `import os, time
if os.fork(): os._exit(0)
os.setsid()
if os.fork(): os._exit(0)
while True:
    with open('/workspace/daemon.txt', 'a') as target: target.write('running\\n')
    time.sleep(0.05)
`);
  await command(a, 'python daemon.py; sleep 0.2');
  const daemonBefore = await a.readFile('/workspace/daemon.txt');
  await command(b, 'sleep 0.3');
  assert.deepEqual(await a.readFile('/workspace/daemon.txt'), daemonBefore);
  checks.push('命令退出后 setsid 及双重 fork 后代进程清理');

  await assert.rejects(a.exec('sleep 100', '/workspace', { timeout: 0.1, onData() {} }), /超过/);
  assert.match(await command(a, 'echo after-timeout'), /after-timeout/);
  checks.push('单命令超时完成清理后可继续');

  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const running = a.exec("echo started > /workspace/cancelled.txt; echo active; while true; do echo running >> /workspace/cancelled.txt; sleep 0.05; done", '/workspace', { onData() { started(); } });
  const rejected = assert.rejects(running, /取消|停止/);
  await start;
  await a.stop();
  await rejected;
  const stoppedBytes = await b.readFile('/workspace/cancelled.txt');
  assert.match(await command(b, 'sleep 0.3; echo other-request-still-active'), /other-request-still-active/);
  assert.deepEqual(await b.readFile('/workspace/cancelled.txt'), stoppedBytes);
  const replacement = service.create(scope('seat-a'));
  assert.deepEqual(JSON.parse((await replacement.readFile('/workspace/result.json')).toString()), { total: 30 });
  checks.push('精确停止请求、不误伤同席位并行容器、工作文件持久保存');

  await replacement.close();
  await b.close();
  await otherSeat.close();
  assert.ok((await readFile(join(root, 'seat-a', 'result.xlsx'))).length > 0);
  const orphan = service.create(scope('seat-a'));
  await orphan.readFile('/workspace/result.json');
  const restartedService = new DockerExecutionService(service.options);
  assert.equal((await restartedService.initialize()).available, true);
  await assert.rejects(orphan.readFile('/workspace/result.json'));
  await restartedService.close();
  checks.push('启动清理本数据实例的残留请求容器');
  console.log(JSON.stringify({ passed: true, image: service.options.image, checks }, null, 2));
} finally {
  await service.close();
  await rm(root, { recursive: true, force: true });
}
