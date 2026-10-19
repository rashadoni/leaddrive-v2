import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("b2-put-diagnostic.py")
spec = importlib.util.spec_from_file_location("diagnostic", SCRIPT)
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class DiagnosticTests(unittest.TestCase):
    def test_service_codes_are_not_arbitrary_permission_proof(self):
        for code, expected in (("AccessDenied", "explicit_access_denied"), ("401", "numeric_service_code_401"),
                               ("403", "numeric_service_code_403"), ("ExpiredToken", "credentials_rejected"),
                               ("SignatureDoesNotMatch", "credentials_rejected"), ("secret_marker", "unrecognized_error"),
                               ("SecretMarker", "other_service_error")):
            with self.subTest(code=code):
                raw = f"An error occurred ({code}) when calling the PutObject operation: DO_NOT_PRINT_THIS".encode()
                self.assertEqual(diagnostic.classify(raw, 254), expected)

    def test_context_status_and_output_bounds(self):
        self.assertEqual(diagnostic.classify(b"An error occurred (AccessDenied) when calling the GetObject operation:", 254), "unrecognized_error")
        self.assertEqual(diagnostic.classify(b"An error occurred (AccessDenied) when calling the PutObject operation:", 0), "unexpected_write_success")
        self.assertEqual(diagnostic.classify(b"", 124), "timeout")
        self.assertEqual(diagnostic.classify(b"x" * 16385, 254), "oversized_error")
        raw = b"An error occurred (AccessDenied) (reached max retries: 0) when calling the PutObject operation: secret"
        self.assertEqual(diagnostic.classify(raw, 254), "explicit_access_denied")

    def test_unrecognized_and_client_errors_stay_unproven(self):
        for raw, expected in ((b"", "unrecognized_error"), (b"Traceback (most recent call last):\nTypeError: secret", "cli_internal_error"),
                              (b"Could not connect to the endpoint URL: secret", "endpoint_unreachable"),
                              (b"SSL validation failed: secret", "tls_error"),
                              (b"Unable to locate credentials secret", "cli_configuration_error")):
            self.assertEqual(diagnostic.classify(raw, 255), expected)

    def run_fake(self, folder, fake):
        binary = folder / "aws"
        binary.write_text("#!" + sys.executable + "\n" + fake)
        binary.chmod(0o700)
        config = folder / "restore.env"
        config.write_text("AWS_ACCESS_KEY_ID=TEST_ONLY\nAWS_SECRET_ACCESS_KEY=DO_NOT_PRINT_THIS\n"
                          "BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com\n"
                          "BACKUP_S3_REGION=eu-central-003\nBACKUP_S3_BUCKET=synthetic-only-bucket\n")
        config.chmod(0o600)
        env = dict(os.environ, PATH=str(folder) + os.pathsep + os.environ["PATH"], PYTHONDONTWRITEBYTECODE="1")
        return subprocess.run([sys.executable, str(SCRIPT), str(config)], env=env, capture_output=True, text=True)

    def test_real_cli_mode_comparison_never_exports_stderr_or_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            result = self.run_fake(Path(root), """import os,sys
mode = os.environ['AWS_REQUEST_CHECKSUM_CALCULATION']
if mode == 'when_supported':
 print('Traceback (most recent call last): DO_NOT_PRINT_THIS', file=sys.stderr)
else:
 print('An error occurred (AccessDenied) when calling the PutObject operation: DO_NOT_PRINT_THIS', file=sys.stderr)
sys.exit(254)
""")
        self.assertEqual(result.returncode, 1)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual([row['category'] for row in rows[:2]], ['cli_internal_error', 'explicit_access_denied'])
        self.assertNotIn('DO_NOT_PRINT_THIS', result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')

    def test_both_explicit_denials_and_unexpected_success(self):
        for status, expected in ((254, 0), (0, 1)):
            with tempfile.TemporaryDirectory() as root:
                result = self.run_fake(Path(root), "import sys\nprint('An error occurred (AccessDenied) when calling the PutObject operation: secret', file=sys.stderr)\nsys.exit(" + str(status) + ")\n")
            self.assertEqual(result.returncode, expected)
            self.assertNotIn('secret', result.stdout + result.stderr)

    def test_private_regular_config_and_exact_endpoint(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            self.run_fake(folder, "import sys; sys.exit(0)\n")
            config = folder / 'restore.env'
            link = folder / 'linked.env'
            link.symlink_to(config)
            with self.assertRaises(OSError):
                diagnostic.read_config(link)
            config.chmod(0o644)
            with self.assertRaises(ValueError):
                diagnostic.read_config(config)
            config.chmod(0o600)
            config.write_text(config.read_text().replace('backblazeb2.com', 'backblazeb2.com.example.net'))
            with self.assertRaises(ValueError):
                diagnostic.read_config(config)


if __name__ == '__main__':
    unittest.main()
