import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "probe", Path(__file__).with_name("b2-restore-write-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

VALUES = {"BACKUP_S3_ENDPOINT": "https://s3.eu-central-003.backblazeb2.com",
          "BACKUP_S3_REGION": "eu-central-003", "BACKUP_S3_BUCKET": "leaddrive-prod-backups",
          "AWS_ACCESS_KEY_ID": "synthetic-id", "AWS_SECRET_ACCESS_KEY": "synthetic-private"}


class ProbeTests(unittest.TestCase):
    def test_actual_child_output_is_limited(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload.bin").write_bytes(b"x" * 32)
            binary = root / "aws"
            binary.write_text(f"#!{os.sys.executable}\nimport os, sys\nos.write(2, b'x' * 100000)\nsys.exit(254)\n")
            binary.chmod(0o700)
            self.assertEqual(probe.attempt(str(binary), VALUES, root, "when_supported"), "output_limit")
            self.assertLessEqual((root / "when_supported.stderr").stat().st_size, probe.LIMIT)

    def test_actual_timeout_kills_process_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "payload.bin").write_bytes(b"x" * 32)
            binary = root / "aws"
            binary.write_text(f"#!{os.sys.executable}\n" + '''
import subprocess, sys, time
from pathlib import Path
child=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(15)'])
Path(__file__).with_suffix('.pid').write_text(str(child.pid))
time.sleep(15)
''')
            binary.chmod(0o700)
            started = time.monotonic()
            with patch.object(probe, "WAIT_SECONDS", 0.5):
                self.assertEqual(probe.attempt(str(binary), VALUES, root, "when_supported"), "timeout")
            self.assertLess(time.monotonic() - started, 4)
            child = int(binary.with_suffix('.pid').read_text())
            state = Path(f"/proc/{child}/stat")
            deadline = time.monotonic() + 1
            while state.exists() and state.read_text().split(') ', 1)[1][0] != 'Z' and time.monotonic() < deadline:
                time.sleep(0.01)
            if state.exists():
                self.assertEqual(state.read_text().split(') ', 1)[1][0], 'Z')

    def test_only_explicit_correct_operation_and_status_prove_denial(self):
        prefix = "An error occurred (AccessDenied)"
        suffix = " when calling the PutObject operation: synthetic-private"
        self.assertEqual(probe.classify(254, (prefix + suffix).encode()), "access_denied")
        self.assertEqual(probe.classify(254, (prefix + " (reached max retries: 1)" + suffix).encode()),
                         "access_denied")
        for status, message in ((255, prefix + suffix), (124, prefix + suffix),
                                (254, prefix + suffix.replace("PutObject", "GetObject")),
                                (254, prefix + suffix + "\nsecond line"),
                                (254, prefix + " (reached max retries: 1000)" + suffix)):
            with self.subTest(status=status, message=message):
                self.assertNotEqual(probe.classify(status, message.encode()), "access_denied")

    def test_numeric_and_checksum_errors_remain_failures_without_raw_text(self):
        for code, expected in (("403", "http_403_unspecified"),
                               ("XAmzContentSHA256Mismatch", "checksum_mismatch"),
                               ("PrivateUnknownCode", "service_error_other")):
            message = f"An error occurred ({code}) when calling the PutObject operation: synthetic-private"
            self.assertEqual(probe.classify(254, message.encode()), expected)
        self.assertEqual(probe.classify(0, b"synthetic-private"), "unexpected_write_allowed")
        self.assertEqual(probe.classify(254, b"x" * probe.LIMIT), "output_limit")
        self.assertEqual(probe.classify(255, b"SSL validation failed: synthetic-private"), "tls_failure")

    def test_private_file_authority_and_literal_target(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "restore.env"
            path.write_text("".join(f"{key}={value}\n" for key, value in VALUES.items()))
            path.chmod(0o600)
            self.assertEqual(probe.credentials(path), VALUES)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                probe.credentials(path)
            path.chmod(0o600)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                probe.credentials(link)
            hard = Path(directory) / "hard"
            os.link(path, hard)
            with self.assertRaises(ValueError):
                probe.credentials(path)
            hard.unlink()
            for extra in ("AWS_PROFILE=anything\n", "AWS_SECRET_ACCESS_KEY=duplicate\n"):
                path.write_text("".join(f"{key}={value}\n" for key, value in VALUES.items()) + extra)
                with self.assertRaises(ValueError):
                    probe.credentials(path)
            path.write_text("".join(f"{key}={value}\n" for key, value in VALUES.items()).replace(
                "backblazeb2.com", "backblazeb2.com.example.net"))
            with self.assertRaises(ValueError):
                probe.credentials(path)

    def test_actual_subprocess_is_bounded_isolated_put_only_and_never_exports_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            credential_file = root / "restore.env"
            credential_file.write_text("".join(f"{key}={value}\n" for key, value in VALUES.items()))
            credential_file.chmod(0o600)
            binary = root / "aws"
            binary.write_text(f"#!{os.sys.executable}\n" + '''
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
assert args[args.index('s3api')+1] == 'put-object'
assert not any(value in args for value in ('delete-object','list-objects-v2','get-object'))
key=args[args.index('--key')+1]
assert key.startswith('leaddrive-b2-synthetic-check/restore-denial-')
assert Path(args[args.index('--body')+1]).stat().st_size == 32
assert os.environ['AWS_SECRET_ACCESS_KEY'] == 'synthetic-private'
assert os.environ['AWS_SHARED_CREDENTIALS_FILE'] == '/dev/null'
assert os.environ['AWS_CONFIG_FILE'] == '/dev/null'
assert 'AWS_PROFILE' not in os.environ
mode=os.environ['AWS_REQUEST_CHECKSUM_CALCULATION']
config=json.loads(Path(__file__).with_suffix('.json').read_text())[mode]
print('synthetic-private-stdout')
print(config['message'], file=sys.stderr)
sys.exit(config['status'])
''')
            binary.chmod(0o700)
            scenarios = [
                ((254, "AccessDenied"), (254, "AccessDenied"), 0),
                ((254, "403"), (254, "AccessDenied"), 1),
                ((0, "AccessDenied"), (254, "AccessDenied"), 1),
            ]
            old_umask = os.umask(0o077)
            try:
                for first, second, expected in scenarios:
                    config = {mode: {"status": item[0], "message":
                              f"An error occurred ({item[1]}) when calling the PutObject operation: synthetic-private"}
                              for mode, item in zip(("when_supported", "when_required"), (first, second))}
                    binary.with_suffix('.json').write_text(json.dumps(config))
                    output = io.StringIO()
                    with patch.object(probe.sys, "platform", "darwin"), \
                            patch.object(probe.sys, "argv", ["probe", str(credential_file)]), \
                            patch.object(probe.shutil, "which", return_value=str(binary)), \
                            patch.dict(os.environ, {"AWS_PROFILE": "must-not-inherit"}), \
                            contextlib.redirect_stdout(output):
                        self.assertEqual(probe.main(), expected)
                    self.assertNotIn("synthetic-private", output.getvalue())
                    self.assertIn("mode=when_supported category=", output.getvalue())
                    self.assertIn("mode=when_required category=", output.getvalue())
            finally:
                os.umask(old_umask)


if __name__ == "__main__":
    unittest.main()
