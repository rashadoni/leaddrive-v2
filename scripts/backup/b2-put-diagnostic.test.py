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

    def test_xml_service_codes_are_allowlisted(self):
        for raw, expected in ((b'<Error><Code>AccessDenied</Code><Message>secret</Message></Error>', 'AccessDenied'),
                              (b'<Error><Code>SecretMarker</Code></Error>', 'unrecognized'),
                              (b'<Error><Code>AccessDenied</Code><Code>AccessDenied</Code></Error>', 'unrecognized'),
                              (b'<!DOCTYPE Error><Error><Code>AccessDenied</Code></Error>', 'unrecognized'),
                              (b'<NotError><Code>AccessDenied</Code></NotError>', 'unrecognized'),
                              (b'broken', 'unrecognized')):
            self.assertEqual(diagnostic.service_code(raw), expected)

    def test_curl_controls_require_positive_auth_and_explicit_denial(self):
        for scenario in ('pass', 'connection_closed', 'signature', 'unexpected_write', 'wrong_download', 'wrong_http'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as root:
                folder = Path(root)
                self.run_fake(folder, 'import sys; sys.exit(0)\n')
                restore = folder / 'restore.env'
                writer = folder / 'writer.env'
                writer.write_text(restore.read_text().replace('TEST_ONLY', 'WRITER_ONLY'))
                writer.chmod(0o600)
                curl = folder / 'curl'
                curl.write_text('#!' + sys.executable + '\n' + 'scenario = ' + repr(scenario) + '\nstate = ' + repr(str(folder / 'remote.bin')) + '\n' + '''
import sys
from pathlib import Path
a = sys.argv[1:]
auth = sys.stdin.read()
assert 'DO_NOT_PRINT_THIS' in auth
assert all('DO_NOT_PRINT_THIS' not in arg for arg in a)
assert a[0] == '--disable' and '--location' not in a and '--insecure' not in a
assert '--http1.1' in a and 'Expect:' in a
method = a[a.index('--request') + 1]
out = Path(a[a.index('--output') + 1])
http = 200
data = b''
if method == 'PUT' and 'WRITER_ONLY' in auth:
 Path(state).write_bytes(Path(a[a.index('--data-binary') + 1][1:]).read_bytes())
elif method == 'GET':
 data = Path(state).read_bytes() if scenario != 'wrong_download' else b'wrong'
else:
 if scenario == 'connection_closed': sys.exit(52)
 if scenario == 'unexpected_write': http = 200
 elif scenario == 'signature':
  http = 403
  data = b'<Error><Code>SignatureDoesNotMatch</Code><Message>DO_NOT_PRINT_THIS</Message></Error>'
 else:
  http = 401 if scenario == 'wrong_http' else 403
  data = b'<Error><Code>AccessDenied</Code><Message>DO_NOT_PRINT_THIS</Message></Error>'
out.write_bytes(data)
sys.stdout.write(str(http))
''')
                curl.chmod(0o700)
                env = dict(os.environ, PATH=str(folder) + os.pathsep + os.environ['PATH'], PYTHONDONTWRITEBYTECODE='1')
                result = subprocess.run([sys.executable, str(SCRIPT), str(writer), str(restore)], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0 if scenario == 'pass' else 1, result.stdout + result.stderr)
                self.assertNotIn('DO_NOT_PRINT_THIS', result.stdout + result.stderr)
                self.assertEqual(result.stderr, '')
                if scenario == 'pass':
                    rows = [json.loads(line) for line in result.stdout.splitlines()]
                    self.assertEqual([row['step'] for row in rows[:3]], ['writer_put', 'restore_get', 'restore_put'])
                    self.assertTrue(all(row['passed'] for row in rows[:3]))


if __name__ == '__main__':
    unittest.main()
