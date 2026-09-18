"""Fixed host filesystem operations; never executes uploaded/user code.

Directory descriptors and O_NOFOLLOW keep every untrusted component anchored,
including when a sandbox concurrently renames directories or replaces symlinks.
"""
import hashlib
import json
import os
import stat
import sys


def segments(path):
    if not isinstance(path, str) or path.startswith('/') or '\\' in path or any(ord(c) < 32 for c in path):
        raise ValueError('path')
    parts = path.split('/') if path else []
    if any(p in ('', '.', '..') for p in parts):
        raise ValueError('path')
    return parts


def directory(root, parts):
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def filefd(root, path):
    parts = segments(path)
    if not parts:
        raise ValueError('file')
    parent = directory(root, parts[:-1])
    try:
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd)
            raise ValueError('regular file')
        return fd
    finally:
        os.close(parent)


def main(a):
    verb, root = a['verb'], a['root']
    if verb == 'list':
        fd = directory(root, segments(a['path']))
        try:
            entries = []
            for name in os.listdir(fd):
                if a['search'].casefold() not in name.casefold():
                    continue
                try:
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if stat.S_ISDIR(info.st_mode) or (stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
                    entries.append(dict(name=name, path='/'.join(filter(None, [a['path'], name])), kind='directory' if stat.S_ISDIR(info.st_mode) else 'file', size=info.st_size))
            entries.sort(key=lambda e: (e['kind'] != 'directory', e['name']))
            return dict(path=a['path'], entries=entries[a['offset']:a['offset'] + a['limit']], total=len(entries), offset=a['offset'], limit=a['limit'])
        finally:
            os.close(fd)
    if verb == 'install':
        if len(segments(a['path'])) != 1:
            raise ValueError('root upload')
        fd = directory(root, [])
        try:
            os.link(a['source'], a['path'], dst_dir_fd=fd, follow_symlinks=False)
            os.fsync(fd)
            return dict(installed=True)
        finally:
            os.close(fd)
    if verb in ('copy', 'hash'):
        fd = filefd(root, a['path'])
        dest = None
        try:
            if os.fstat(fd).st_size > a['maxBytes']:
                raise OverflowError('size')
            if verb == 'copy':
                dest = os.open(a['destination'], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            digest, size = hashlib.sha256(), 0
            while True:
                chunk = os.read(fd, 64 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > a['maxBytes']:
                    raise OverflowError('size')
                digest.update(chunk)
                if dest is not None:
                    view = memoryview(chunk)
                    while view:
                        view = view[os.write(dest, view):]
            if dest is not None:
                os.fsync(dest)
            return dict(size=size, hash=digest.hexdigest())
        finally:
            os.close(fd)
            if dest is not None:
                os.close(dest)
    raise ValueError('verb')


try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise ValueError('arguments')
    result = main(json.loads(raw))
    print(json.dumps(result, ensure_ascii=False))
except BaseException as error:
    code = 'EXISTS' if isinstance(error, FileExistsError) else 'NOT_FOUND' if isinstance(error, FileNotFoundError) else 'TOO_LARGE' if isinstance(error, OverflowError) else 'UNSAFE_FILE'
    print(json.dumps(dict(error=code)))
    sys.exit(1)
