"""Hold the existing production environment lock without following symlinks."""
import fcntl
import os
import pathlib
import stat
import subprocess
import sys
import time


def main():
    if os.getuid() != 0 or os.getgid() != 0 or len(sys.argv) != 5:
        raise ValueError()
    lock_path = "/run/lock/leaddrive-app-env.lock"
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o022:
            raise ValueError()
        deadline = time.monotonic() + 15
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ValueError()
                time.sleep(0.1)
        current = os.stat(lock_path, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError()
        script = pathlib.Path(__file__).resolve().with_name("commission-runtime.mjs")
        return subprocess.run(["node", str(script), *sys.argv[1:]], check=False,
                              env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}, timeout=420).returncode
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("IDENTITY_COMMISSION_LOCK_OR_PROCESS_FAILED", file=sys.stderr)
        sys.exit(1)
