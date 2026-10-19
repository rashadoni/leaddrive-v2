#!/usr/bin/env python3
"""Diagnose restore-key PutObject with synthetic bytes and fixed, secret-free output.

No production access. Never treats numeric HTTP/auth/transport failures as ACL proof.
If writing unexpectedly succeeds, the tiny synthetic object remains for lifecycle.
"""
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import uuid
import xml.etree.ElementTree as ET


def classify(data, status):
    if status == 0:
        return "unexpected_write_success"
    if status == 124:
        return "timeout"
    if len(data) > 16384:
        return "oversized_error"
    text = data.decode("utf-8", errors="replace")
    match = re.search(
        r"^An error occurred \(([A-Za-z0-9]+)\) "
        r"(?:\(reached max retries: [0-9]+\) )?when calling (?:the )?PutObject operation:",
        text, re.M,
    )
    if match:
        code = match[1]
        if code == "AccessDenied":
            return "explicit_access_denied"
        if code in {"400", "401", "403", "404", "408", "429", "500", "502", "503", "504"}:
            return "numeric_service_code_" + code
        if code in {"ExpiredToken", "InvalidAccessKeyId", "SignatureDoesNotMatch"}:
            return "credentials_rejected"
        if code in {"InvalidRequest", "InvalidArgument", "MissingContentLength", "NotImplemented", "XAmzContentSHA256Mismatch"}:
            return "request_rejected"
        return "other_service_error"
    if "SSL validation failed" in text:
        return "tls_error"
    if "Could not connect to the endpoint URL" in text:
        return "endpoint_unreachable"
    if "Unable to locate credentials" in text or "Unable to parse config file" in text:
        return "cli_configuration_error"
    if "Traceback (most recent call last):" in text:
        return "cli_internal_error"
    if "Connection was closed before we received a valid response" in text:
        return "connection_closed"
    return "unrecognized_error"


def read_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) not in (0o400, 0o600):
            raise ValueError("unsafe_file")
        source = stream.read(16385)
    if len(source) > 16384:
        raise ValueError("oversized_file")
    required = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET"}
    config = {}
    for line in source.splitlines():
        key, sep, value = line.partition("=")
        if sep and key in required:
            if key in config or not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
                raise ValueError("invalid_file")
            config[key] = value
    if set(config) != required:
        raise ValueError("incomplete_file")
    region = config["BACKUP_S3_REGION"]
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-[0-9]{3}", region) or config["BACKUP_S3_ENDPOINT"] != f"https://s3.{region}.backblazeb2.com":
        raise ValueError("invalid_endpoint")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", config["BACKUP_S3_BUCKET"]):
        raise ValueError("invalid_bucket")
    return config


def service_code(data):
    if len(data) > 16384 or b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        return "unrecognized"
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return "unrecognized"
    if root.tag.split("}")[-1] != "Error":
        return "unrecognized"
    codes = [node.text for node in root if node.tag.split("}")[-1] == "Code"]
    allowed = {"AccessDenied", "UnauthorizedAccess", "InvalidAccessKeyId", "SignatureDoesNotMatch",
               "AuthorizationHeaderMalformed", "InvalidRequest", "ExpiredToken", "NoSuchKey"}
    return codes[0] if len(codes) == 1 and codes[0] in allowed else "unrecognized"


def curl_request(curl, config, method, key, body, scratch):
    output = Path(scratch) / (uuid.uuid4().hex + ".response")
    payload = body.read_bytes() if method == "PUT" else b""
    args = [curl, "--disable", "--silent", "--http1.1", "--proto", "=https", "--config", "-",
            "--aws-sigv4", "aws:amz:" + config["BACKUP_S3_REGION"] + ":s3",
            "--connect-timeout", "10", "--max-time", "30", "--retry", "0", "--max-filesize", "16384",
            "--header", "Expect:", "--header", "Content-Type: application/octet-stream",
            "--header", "x-amz-content-sha256: " + hashlib.sha256(payload).hexdigest(),
            "--request", method, "--output", str(output), "--write-out", "%{http_code}"]
    if method == "PUT":
        args += ["--data-binary", "@" + str(body)]
    args += ["--url", config["BACKUP_S3_ENDPOINT"] + "/" + config["BACKUP_S3_BUCKET"] + "/" + key]
    # curl config comes over stdin; secret never appears in argv or shell source.
    credential = config["AWS_ACCESS_KEY_ID"] + ":" + config["AWS_SECRET_ACCESS_KEY"]
    private_config = 'user = "' + credential.replace('\\', '\\\\').replace('"', '\\"') + '"\n'
    try:
        result = subprocess.run(args, input=private_config.encode(), stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=40,
                                env={"PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin", "LC_ALL": "C"})
    except subprocess.TimeoutExpired:
        return 124, 0, "transport_failure", b""
    except OSError:
        return 126, 0, "client_launch_failed", b""
    http = int(result.stdout) if re.fullmatch(rb"[0-9]{3}", result.stdout) else 0
    if result.returncode:
        return result.returncode, http, "transport_or_client_failure", b""
    try:
        with output.open("rb") as stream:
            data = stream.read(16385)
    except OSError:
        return 126, http, "response_missing", b""
    return 0, http, service_code(data) if http >= 400 else "none", data


def curl_controls(writer_path, restore_path):
    try:
        writer, restore = read_config(writer_path), read_config(restore_path)
        for field in ("BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET"):
            if writer[field] != restore[field]:
                raise ValueError("different_targets")
        if writer["AWS_ACCESS_KEY_ID"] == restore["AWS_ACCESS_KEY_ID"]:
            raise ValueError("same_key")
        curl = shutil.which("curl")
        if not curl:
            raise ValueError("curl_missing")
    except (OSError, ValueError):
        print(json.dumps({"result": "local_configuration_invalid"}))
        return 2
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix="leaddrive-b2-curl-") as scratch:
        body = Path(scratch) / "synthetic.bin"
        payload = os.urandom(1024)
        body.write_bytes(payload)
        key = "leaddrive-b2-synthetic-check/curl-control-" + uuid.uuid4().hex
        for step, config, method, object_key in (
            ("writer_put", writer, "PUT", key), ("restore_get", restore, "GET", key),
            ("restore_put", restore, "PUT", key + "-restore-write"),
        ):
            status, http, code, data = curl_request(curl, config, method, object_key, body, scratch)
            if step == "restore_put":
                passed = status == 0 and http == 403 and code == "AccessDenied"
            else:
                passed = status == 0 and 200 <= http < 300 and (method != "GET" or data == payload)
            print(json.dumps({"step": step, "client_exit": status, "http_status": http,
                              "service_code": code, "passed": passed}), flush=True)
            if not passed:
                print(json.dumps({"result": "curl_controls_unproven_not_activation_evidence"}))
                return 1
    print(json.dumps({"result": "curl_controls_passed_not_activation_evidence"}))
    return 0


def main():
    if len(sys.argv) == 3:
        return curl_controls(sys.argv[1], sys.argv[2])
    if len(sys.argv) != 2:
        print("usage: b2-put-diagnostic.py [writer.env] restore.env", file=sys.stderr)
        return 2
    try:
        config = read_config(sys.argv[1])
        aws = shutil.which("aws")
        if not aws:
            raise ValueError("aws_missing")
    except (OSError, ValueError):
        print(json.dumps({"result": "local_configuration_invalid"}))
        return 2
    os.umask(0o077)
    results = []
    with tempfile.TemporaryDirectory(prefix="leaddrive-b2-put-") as scratch:
        body = Path(scratch) / "synthetic.bin"
        body.write_bytes(os.urandom(1024))
        for mode in ("when_supported", "when_required"):
            env = {
                "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
                "HOME": scratch, "LC_ALL": "C", "AWS_EC2_METADATA_DISABLED": "true",
                "AWS_PAGER": "", "AWS_CONFIG_FILE": "/dev/null", "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
                "AWS_ACCESS_KEY_ID": config["AWS_ACCESS_KEY_ID"],
                "AWS_SECRET_ACCESS_KEY": config["AWS_SECRET_ACCESS_KEY"],
                "AWS_MAX_ATTEMPTS": "1", "AWS_REQUEST_CHECKSUM_CALCULATION": mode,
                "AWS_RESPONSE_CHECKSUM_VALIDATION": mode,
            }
            args = [aws, "--endpoint-url", config["BACKUP_S3_ENDPOINT"], "--region", config["BACKUP_S3_REGION"],
                    "--no-cli-pager", "--cli-connect-timeout", "10", "--cli-read-timeout", "20",
                    "s3api", "put-object", "--bucket", config["BACKUP_S3_BUCKET"], "--key",
                    "leaddrive-b2-synthetic-check/put-diagnostic-" + uuid.uuid4().hex,
                    "--body", str(body)]
            with tempfile.TemporaryFile() as errors:
                try:
                    process = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=errors, start_new_session=True)
                except OSError:
                    print(json.dumps({"checksum_mode": mode, "category": "cli_launch_failed"}))
                    return 2
                try:
                    status = process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                    status = 124
                errors.seek(0)
                category = classify(errors.read(16385), status)
            results.append(category)
            print(json.dumps({"checksum_mode": mode, "exit_code": status, "category": category}), flush=True)
    print(json.dumps({"result": "diagnostic_only_not_activation_evidence"}))
    return 0 if results == ["explicit_access_denied", "explicit_access_denied"] else 1


if __name__ == "__main__":
    sys.exit(main())
