import { describe, expect, it, vi } from 'vitest';
import { COMMAND_POLICY_VERSION, evaluateCommand } from '../../src/execution/command-policy.js';

describe('server bash argument policy (does not execute inputs)', () => {
  it.each([
    'ls /workspace', 'python /workspace/process.py', 'node /workspace/process.js',
    'python /workspace/分析.py',
    "printf '%s' 'rm -rf /workspace'", 'echo "hello world"', "printf '%s' '$(rm a)'",
    'echo a; ls', 'echo a\nls', 'printf a | cat', 'ls || echo missing',
    "printf '%s' ok > /workspace/fixtures/output.txt", 'printf ok > output.txt',
    'printf ok > /tmp/result.txt', 'printf ok > /dev/null', 'echo a 2>&1',
    'env MODE=test python /workspace/process.py', 'MODE=test command ls',
    'env -- MODE=test python /workspace/process.py', "env 'x-y=v' node /workspace/process.js", 'MODE= ls',
    'ls \\\n/workspace', "printf '%s' 'a\\\nb'",
    'echo \\$literal', 'echo \\*', 'echo "*.txt"', 'git -C /workspace status',
    'cd /workspace && ls -la',
    'cd /workspace && ls -la && echo "---HASH---" && md5sum *.md && sha256sum *.md && echo "---WC---" && wc -l -c *.md',
    'cd . && ls *.md', 'cd "/workspace" && wc -c 初稿*.md',
    'ls report-?.md', 'md5sum *.md *.txt', 'sha256sum -- *.md', 'wc -l -- report_*.md',
  ])('allows supported ordinary command: %s', command => {
    expect(evaluateCommand(command)).toMatchObject({ decision: 'allow', version: COMMAND_POLICY_VERSION });
  });
  it.each([
    'rm -- /workspace/fixtures/a.txt', '/bin/rm a', "'rm' a", 'r"m" a', 'r\\m a',
    'MODE=test env /bin/rm a', 'env MODE=test /bin/rm a', 'command rm a', 'command -- rm a',
    'env -- MODE=test rm a', "env 'x-y=v' rm a", 'r\\\nm a', 's\\\nudo ls',
    'A[$(rm a)]=x ls', 'A[1]=x ls',
    ...['rmdir', 'unlink', 'shred', 'truncate', 'chmod', 'chown', 'chgrp'].map(name => `${name} a`),
    'git -C /workspace reset --hard', 'git reset HEAD --hard', 'git -c core.quotePath=false clean -fd',
    'git restore -- a', 'git -C/workspace reset --hard', 'git reset --har',
    'ls && rm a', 'ls || rm a', 'ls; rm a', 'ls\nrm a', 'ls | rm a',
    'echo 中文 && rm /workspace/方案.md', 'echo 中文; r\\\nm /workspace/方案.md',
    'echo "$(rm a)"', '$CMD a', 'for f in *.txt; do rm "$f"; done',
    'python -c "print(1)"', 'python3.12 -c "print(1)"', 'node -e "console.log(1)"',
    'bash -c "ls"', 'sh /workspace/a.sh', '/workspace/a.sh', 'cat <<EOF\na\nEOF',
    'ls &', 'f() { ls; }; f', 'env -u X ls', 'timeout 5 rm a', 'echo "$X"',
    'echo *', 'echo {a,b}', 'echo ~', 'printf ok > /etc/example', 'printf ok > ../outside.txt',
    'printf ok > /tmp/../etc/example', 'printf ok > "$OUT"', 'cd /tmp && printf ok > result.txt',
    'echo "unfinished', '', 'x=a', 'eval "ls"', 'source /workspace/a',
    'cd', 'cd -', 'cd .. && ls', 'cd /workspace/sub && ls *.md', 'cd "$PWD" && ls',
    'cd /workspace /tmp && ls', 'cd -- /workspace && ls', 'pushd /workspace', 'popd',
    'ls ../*.md', 'ls /workspace/*.md', 'ls sub/*.md', 'ls [ab].md', 'ls **/*.md',
    'ls ${FILES}', 'ls $(printf a)', 'ls *.md > *.txt', 'md5sum --tag=*',
    'python *.py', 'node *.js', 'cat *.md', 'env ls *.md',
  ])('requires review: %s', command => expect(evaluateCommand(command).decision).toBe('ask'));
  it.each(['sudo','su','doas','mount','umount','nsenter','chroot'])('denies environment command: %s', name => {
    expect(evaluateCommand(`${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`/usr/bin/${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`ls && ${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`rm a && ${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`env MODE=test command ${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`env -- MODE=test ${name} test`).decision).toBe('deny');
    expect(evaluateCommand(`env 'x-y=v' ${name} test`).decision).toBe('deny');
  });
  it('keeps deny precedence for recognized nested execution, not quoted data', () => {
    expect(evaluateCommand('echo "$(sudo ls)"').decision).toBe('deny');
    expect(evaluateCommand('MODE=$(sudo ls) echo test').decision).toBe('deny');
    expect(evaluateCommand('A[$(sudo ls)]=x ls').decision).toBe('deny');
    expect(evaluateCommand('echo >$(sudo ls)').decision).toBe('deny');
    expect(evaluateCommand('echo > >(sudo ls)').decision).toBe('deny');
    expect(evaluateCommand("printf '%s' 'sudo ls'").decision).toBe('allow');
  });
  it('does not infer a redirect from an unexpected cwd', () => expect(evaluateCommand('echo a > x', '/tmp').decision).toBe('ask'));
  it('checks the whole chain after an accepted cd or filename glob', () => {
    expect(evaluateCommand('cd /workspace && ls *.md && rm original.md')).toMatchObject({ decision: 'ask', ruleId: 'shell.modify' });
    expect(evaluateCommand('cd . && wc -l *.md; sudo ls')).toMatchObject({ decision: 'deny', ruleId: 'shell.environment' });
    expect(evaluateCommand('cd /workspace && ls *.md; printf ok > ../outside')).toMatchObject({ decision: 'ask', ruleId: 'shell.review' });
    expect(evaluateCommand('cd /workspace && ls', '/tmp')).toMatchObject({ decision: 'ask', ruleId: 'shell.review' });
  });
  it('distinguishes an unsupported expression from a matched destructive command', () => {
    expect(evaluateCommand('ls "$FILES"')).toMatchObject({ ruleId: 'shell.review', reason: expect.stringContaining('无法可靠分析') });
    expect(evaluateCommand('rm original.md')).toMatchObject({ ruleId: 'shell.modify', reason: expect.stringContaining('rm') });
  });
  it('does not classify normal file script bodies or pretend allowed means read-only', () => {
    expect(evaluateCommand('python /workspace/deletes-files.py').decision).toBe('allow');
    expect(evaluateCommand('printf overwrite > existing.txt').decision).toBe('allow');
  });
  it('propagates parser failure instead of allowing or asking', async () => {
    const Parser = (await import('tree-sitter')).default;
    const spy = vi.spyOn(Parser.prototype, 'parse').mockImplementationOnce(() => { throw new Error('parser unavailable'); });
    try { expect(() => evaluateCommand('ls')).toThrow('parser unavailable'); } finally { spy.mockRestore(); }
  });
});
