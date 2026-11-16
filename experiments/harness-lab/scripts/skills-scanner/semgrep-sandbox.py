#!/usr/bin/env python3
"""Deployment-owned Semgrep launcher. No package code is executed on the host."""
import os
import pathlib
import subprocess
import sys
import uuid


def main():
    args = sys.argv[1:]
    expected = pathlib.Path(__file__).resolve().parents[2] / 'fixtures/skill-scanning/rules.yaml'
    if not args or args[0] != 'scan' or args.count('--config') != 1:
        raise ValueError('Unsupported scanner invocation')
    config_index = args.index('--config') + 1
    if config_index >= len(args) or pathlib.Path(args[config_index]).resolve() != expected:
        raise ValueError('Scanner configuration must be deployment-owned')
    root = pathlib.Path.cwd().resolve()
    if any(c in str(p) for p in (root, expected.parent) for c in ',\r\n\0'):
        raise ValueError('Scanner mount path is unsupported')
    args[config_index] = '/rules/rules.yaml'
    name = 'axon-skill-scan-' + uuid.uuid4().hex
    # The in-container deadline also bounds a scan if its host caller is killed.
    command = ['docker', 'run', '--rm', '--init', '--pull=never', '--name', name,
               '--label', 'axon.skill-scanner=r3', '--network=none', '--read-only',
               '--user', f'{os.getuid() or 1000}:{os.getgid() or 1000}',
               '--cap-drop=ALL', '--security-opt=no-new-privileges',
               '--cpus=1', '--memory=768m', '--memory-swap=768m', '--pids-limit=96',
               '--tmpfs', '/tmp:rw,nosuid,nodev,size=134217728,mode=1777',
               '--mount', f'type=bind,src={root},dst=/input,readonly',
               '--mount', f'type=bind,src={expected.parent},dst=/rules,readonly',
               '--workdir', '/input', '--env', 'HOME=/tmp', '--env', 'LANG=C.UTF-8',
               '--env', 'SEMGREP_SEND_METRICS=off', '--env', 'SEMGREP_ENABLE_VERSION_CHECK=0',
               'berserk-skill-scanner:r3-semgrep-1.182.0',
               'timeout', '--kill-after=1', '25', 'semgrep', *args]
    env = {key: value for key, value in os.environ.items()
           if key in ('PATH', 'HOME', 'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT',
                      'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
    try:
        return subprocess.call(command, env=env)
    finally:
        subprocess.run(['docker', 'rm', '--force', name], env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError):
        print('Isolated scanner could not start or finish.', file=sys.stderr)
        sys.exit(2)
