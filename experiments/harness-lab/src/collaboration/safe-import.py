"""Import a fixed private handoff copy into an anchored workspace, without overwrite."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid

spec = importlib.util.spec_from_file_location('safe_fs', Path(__file__).parent.parent / 'files' / 'safe-fs.py')
safe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safe)


def main(a):
    parts = safe.segments(a['path'])
    if not parts:
        raise ValueError('file')
    fd = safe.directory(a['root'], [])
    temp = '.axon-import-' + uuid.uuid4().hex
    source = target = None
    try:
        for part in parts[:-1]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        source = safe.filefd(a['sourceRoot'], 'content')
        target = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        digest, size = hashlib.sha256(), 0
        while True:
            data = os.read(source, 65536)
            if not data:
                break
            size += len(data)
            if size > a['maxBytes']:
                raise OverflowError('size')
            digest.update(data)
            view = memoryview(data)
            while view:
                view = view[os.write(target, view):]
        if digest.hexdigest() != a['expectedHash']:
            raise ValueError('hash')
        os.fsync(target)
        os.close(target)
        target = None
        try:
            os.link(temp, parts[-1], src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            os.fsync(fd)
        except FileExistsError:
            # Read through the retained parent descriptor: no second path traversal.
            existing = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                info = os.fstat(existing)
                import stat
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != size:
                    raise FileExistsError('different file')
                check = hashlib.sha256()
                while True:
                    chunk = os.read(existing, 65536)
                    if not chunk:
                        break
                    check.update(chunk)
                if check.hexdigest() != a['expectedHash']:
                    raise FileExistsError('different file')
            finally:
                os.close(existing)
        return dict(size=size, hash=digest.hexdigest())
    finally:
        if source is not None:
            os.close(source)
        if target is not None:
            os.close(target)
        try:
            os.unlink(temp, dir_fd=fd)
        except FileNotFoundError:
            pass
        os.close(fd)


try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError('arguments')
    print(json.dumps(main(json.loads(raw))))
except BaseException as error:
    code = 'EXISTS' if isinstance(error, FileExistsError) else 'NOT_FOUND' if isinstance(error, FileNotFoundError) else 'TOO_LARGE' if isinstance(error, OverflowError) else 'UNSAFE_FILE'
    print(json.dumps(dict(error=code)))
    sys.exit(1)
