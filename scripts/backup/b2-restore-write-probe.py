#!/usr/bin/env python3
"""Owner-Mac diagnostic only: two synthetic PUTs, no delete or recovery receipt."""
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import uuid

LIMIT = 16384
WAIT_SECONDS = 45
FIELDS = {"BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET",
          "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}
CODES = {
    "AccessDenied": "access_denied",
    "403": "http_403_unspecified",
    "400": "http_400_unspecified",
    "401": "http_401_unspecified",
    "500": "http_500_unspecified",
    "503": "http_503_unspecified",
    "XAmzContentSHA256Mismatch": "checksum_mismatch",
    "BadDigest": "checksum_mismatch",
    "InvalidRequest": "invalid_request",
    "NotImplemented": "not_implemented",
    "SignatureDoesNotMatch": "signature_mismatch",
    "ExpiredToken": "expired_token",
    "InvalidAccessKeyId": "invalid_access_key",
}


def credentials(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) not in (0o400, 0o600)
                or not 0 < info.st_size <= 8192):
            raise ValueError("unsafe credential file")
        text = os.read(fd, 8193).decode("ascii")
    finally:
        os.close(fd)
    values = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or key not in FIELDS or key in values or not value or any(
                ord(c) < 33 or ord(c) > 126 for c in value):
            raise ValueError("invalid credential file")
        values[key] = value
    if set(values) != FIELDS:
        raise ValueError("incomplete credential file")
    region = values["BACKUP_S3_REGION"]
    if (not re.fullmatch(r"[a-z]{2}-[a-z]+-[0-9]{3}", region)
            or values["BACKUP_S3_ENDPOINT"] != f"https://s3.{region}.backblazeb2.com"
            or values["BACKUP_S3_BUCKET"] != "leaddrive-prod-backups"):
        raise ValueError("unexpected diagnostic target")
    return values


def classify(status, output):
    if status == 0:
        return "unexpected_write_allowed"
    if len(output) >= LIMIT:
        return "output_limit"
    text = output.decode("utf-8", errors="replace").strip()
    match = re.fullmatch(
        r"An error occurred \(([A-Za-z0-9_.-]{1,80})\)"
        r"(?: \(reached max retries: [0-9]{1,3}\))?"
        r" when calling the PutObject operation: [^\r\n]*", text)
    if status == 254 and match:
        return CODES.get(match[1], "service_error_other")
    for prefix, category in (
        ("SSL validation failed", "tls_failure"),
        ("Could not connect to the endpoint URL", "connection_failure"),
        ("Read timeout on endpoint URL", "connection_timeout"),
        ("Error parsing parameter", "cli_argument_error"),
        ("Parameter validation failed", "cli_argument_error"),
        ("Unknown options:", "cli_argument_error"),
    ):
        if text.startswith(prefix):
            return category
    return "unrecognized_failure"


def limit_output():
    resource.setrlimit(resource.RLIMIT_FSIZE, (LIMIT, LIMIT))


def attempt(binary, values, work, mode):
    payload = work / "payload.bin"
    env = {"PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
           "HOME": str(work), "AWS_EC2_METADATA_DISABLED": "true", "AWS_PAGER": "",
           "AWS_CONFIG_FILE": "/dev/null", "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
           "AWS_CLI_AUTO_PROMPT": "off", "AWS_MAX_ATTEMPTS": "1",
           "AWS_RETRY_MODE": "standard",
           "AWS_ACCESS_KEY_ID": values["AWS_ACCESS_KEY_ID"],
           "AWS_SECRET_ACCESS_KEY": values["AWS_SECRET_ACCESS_KEY"],
           "AWS_REQUEST_CHECKSUM_CALCULATION": mode,
           "AWS_RESPONSE_CHECKSUM_VALIDATION": mode}
    args = [binary, "--endpoint-url", values["BACKUP_S3_ENDPOINT"],
            "--region", values["BACKUP_S3_REGION"], "--no-cli-pager",
            "--cli-connect-timeout", "10", "--cli-read-timeout", "15",
            "s3api", "put-object", "--bucket", values["BACKUP_S3_BUCKET"],
            "--key", f"leaddrive-b2-synthetic-check/restore-denial-{uuid.uuid4()}.bin",
            "--body", str(payload)]
    diagnostic = work / f"{mode}.stderr"
    with diagnostic.open("wb") as error:
        with subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=error,
                              start_new_session=True, preexec_fn=limit_output) as process:
            try:
                status = process.wait(timeout=WAIT_SECONDS)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return "timeout"
    with diagnostic.open("rb") as error:
        return classify(status, error.read(LIMIT))


def main():
    if sys.platform != "darwin" or len(sys.argv) != 2:
        print("Run on owner Mac: python3 b2-restore-write-probe.py restore.env")
        return 2
    os.umask(0o077)
    try:
        values = credentials(sys.argv[1])
        binary = shutil.which("aws")
        if not binary:
            raise ValueError("AWS CLI unavailable")
        with tempfile.TemporaryDirectory(prefix="leaddrive-b2-denial-") as directory:
            work = Path(directory)
            (work / "payload.bin").write_bytes(os.urandom(32))
            results = []
            for mode in ("when_supported", "when_required"):
                category = attempt(binary, values, work, mode)
                results.append(category)
                print(f"mode={mode} category={category}")
            print("Synthetic diagnostic only; no delete or recovery receipt.")
            return 0 if all(value == "access_denied" for value in results) else 1
    except (OSError, ValueError, UnicodeError, subprocess.SubprocessError):
        print("Diagnostic failed safely; no private diagnostic emitted.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
