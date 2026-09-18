"""One command, one subreaper. Descendants cannot outlive a successful command result."""
import ctypes
import os
import signal
import subprocess
import sys
import time


def children():
    # Subreaper adopts descendants, including children that call setsid/double-fork.
    with open(f"/proc/self/task/{os.getpid()}/children", encoding="ascii") as source:
        return [int(pid) for pid in source.read().split()]


def cleanup():
    deadline = time.monotonic() + 5
    while True:
        for pid in children():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        while True:
            try:
                if os.waitpid(-1, os.WNOHANG)[0] == 0:
                    break
            except ChildProcessError:
                return
        if time.monotonic() > deadline:
            # Host destroys this request's entire container for codes >= 128.
            raise RuntimeError("命令后代进程清理失败。")
        time.sleep(0.01)


def main():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise RuntimeError("无法启用命令后代进程管理。")
    command = sys.stdin.buffer.read().decode("utf-8")
    timeout = float(sys.argv[1])
    # No host environment, PI_* session paths, shell startup files or API credentials.
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8",
           "PYTHONDONTWRITEBYTECODE": "1", "MPLCONFIGDIR": "/tmp/matplotlib"}
    process = subprocess.Popen(["/bin/bash", "--noprofile", "--norc", "-c", command],
                               cwd="/workspace", env=env, start_new_session=True)
    try:
        code = process.wait(timeout=timeout if timeout > 0 else None)
    except subprocess.TimeoutExpired:
        code = 124
    finally:
        cleanup()
    return code if code >= 0 else 128 + abs(code)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("命令监督进程异常，必须清理本次执行环境。", file=sys.stderr)
        sys.exit(125 + 12)
