"""Container-only file operations. Every path component is opened without symlink following."""
import errno
import json
import os
import stat
import subprocess
import sys

DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def path_parts(path, writable=False):
    parts = path.split("/")
    if len(parts) < 2 or parts[0] != "" or parts[1] not in ("workspace", "logs"):
        raise ValueError("仅能访问 /workspace 和只读 /logs。")
    if writable and parts[1] != "workspace":
        raise ValueError("日志目录只读。")
    if any(part in (".", "..") or "\x00" in part for part in parts[2:]):
        raise ValueError("文件路径无效。")
    return "/" + parts[1], [part for part in parts[2:] if part]


def parent(path, writable=False, create=False):
    root, parts = path_parts(path, writable)
    fd = os.open(root, DIRECTORY)
    try:
        for part in parts[:-1]:
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, DIRECTORY, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd, parts[-1] if parts else "."
    except BaseException:
        os.close(fd)
        raise


def opened(path, writable=False, create=False):
    fd, leaf = parent(path, writable, create)
    try:
        flags = (os.O_WRONLY | os.O_CREAT) if writable else os.O_RDONLY
        result = os.open(leaf, flags | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, 0o644, dir_fd=fd)
        mode = os.fstat(result).st_mode
        if not (stat.S_ISREG(mode) or (not writable and stat.S_ISDIR(mode))):
            os.close(result)
            raise ValueError("仅支持普通文件或目录。")
        return result
    finally:
        os.close(fd)


def main():
    operation, path, limit = sys.argv[1:4]
    limit = int(limit)
    if operation == "mkdir":
        fd, leaf = parent(path, writable=True, create=True)
        try:
            try:
                os.mkdir(leaf, 0o755, dir_fd=fd)
            except FileExistsError:
                pass
            check = os.open(leaf, DIRECTORY, dir_fd=fd)
            os.close(check)
        finally:
            os.close(fd)
        return
    try:
        fd = opened(path, writable=operation == "write")
    except FileNotFoundError:
        if operation == "exists":
            sys.stdout.write("false")
            return
        raise
    try:
        info = os.fstat(fd)
        if operation == "exists":
            sys.stdout.write("true")
        elif operation == "stat":
            print(json.dumps({"directory": stat.S_ISDIR(info.st_mode)}))
        elif operation == "ls":
            print(json.dumps(sorted(os.listdir(fd)), ensure_ascii=False))
        elif operation == "write":
            # Validate bytes before truncation. Later failures still may leave a partial file.
            data = sys.stdin.buffer.read(limit + 1)
            if len(data) > limit:
                raise ValueError("文件超过单次读写上限，请使用脚本分块处理。")
            os.ftruncate(fd, 0)
            with os.fdopen(os.dup(fd), "wb") as target:
                target.write(data)
                target.flush()
                os.fsync(target.fileno())
        elif operation in ("read", "image"):
            if not stat.S_ISREG(info.st_mode):
                raise ValueError("请选择普通文件。")
            if info.st_size > limit:
                raise ValueError("文件超过单次读取上限，请使用脚本分块处理。")
            with os.fdopen(os.dup(fd), "rb") as source:
                if operation == "read":
                    data = source.read(limit + 1)
                    if len(data) > limit:
                        raise ValueError("文件超过单次读取上限，请使用脚本分块处理。")
                    sys.stdout.buffer.write(data)
                else:
                    from PIL import Image, UnidentifiedImageError
                    try:
                        with Image.open(source) as image:
                            if image.width * image.height > 20_000_000:
                                raise ValueError("图片像素规模过大，请使用脚本缩小后读取。")
                            image.verify()
                            sys.stdout.write(Image.MIME.get(image.format, ""))
                    except UnidentifiedImageError:
                        pass
        elif operation == "find":
            pattern, options = sys.argv[4:6]
            options = json.loads(options)
            count = max(1, min(int(options["limit"]), 10000))
            args = ["rg", "--files", "--null", "--hidden", "--no-require-git", "--glob", pattern]
            for ignored in options["ignore"]:
                args.extend(["--glob", "!" + ignored])
            # rg does not follow symlinks. The directory descriptor fixes the root against rename.
            process = subprocess.Popen(args, cwd=f"/proc/self/fd/{fd}", pass_fds=(fd,),
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            result = []
            buffer = b""
            try:
                while True:
                    chunk = process.stdout.read1(4096)
                    if not chunk:
                        break
                    buffer += chunk
                    while b"\x00" in buffer:
                        name, buffer = buffer.split(b"\x00", 1)
                        result.append(name.decode("utf-8"))
                        if len(result) >= count:
                            break
                    if len(result) >= count:
                        process.terminate()
                        break
            finally:
                process.communicate()
            if process.returncode not in (0, 1, -15):
                raise ValueError("文件查找失败，请检查目录和 glob 表达式。")
            print(json.dumps(result, ensure_ascii=False))
        else:
            raise ValueError("未知文件操作。")
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        if isinstance(error, OSError):
            messages = {errno.ENOENT: "文件或目录不存在。", errno.ELOOP: "不允许访问符号链接。",
                        errno.ENOTDIR: "目录无效或包含符号链接。", errno.EACCES: "没有文件访问权限。",
                        errno.ENOSPC: "执行环境存储空间不足。", errno.EROFS: "目标位置只读。"}
            message = messages.get(error.errno, "文件操作失败，请检查文件类型和目录。")
        else:
            message = str(error)
        print(message, file=sys.stderr)
        sys.exit(1)
