from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("provision_postgres_restore_scratch.py")
SPEC = importlib.util.spec_from_file_location(
    "provision_postgres_restore_scratch", SCRIPT_PATH
)
assert SPEC is not None and SPEC.loader is not None
MAINTENANCE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MAINTENANCE
SPEC.loader.exec_module(MAINTENANCE)


class EnvironmentTests(unittest.TestCase):
    def test_rewrite_preserves_unrelated_secret_bytes(self) -> None:
        original = (
            b"# production backup\n"
            b"PGHOST=source.example.invalid\n"
            b"DATABASE_URL=postgres://user:secret@example.invalid/database\n"
            b"VERIFY_PGPORT=50000\n"
        )

        rewritten = MAINTENANCE.rewrite_environment(
            original, MAINTENANCE.TARGET_ENV
        )

        self.assertIn(
            b"DATABASE_URL=postgres://user:secret@example.invalid/database\n",
            rewritten,
        )
        for key, value in MAINTENANCE.TARGET_ENV.items():
            self.assertEqual(rewritten.count(f"{key}=".encode()), 1)
            self.assertIn(f"{key}={value}\n".encode(), rewritten)

    def test_rewrite_rejects_duplicate_target(self) -> None:
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE.rewrite_environment(
                b"VERIFY_PGHOST=first\nVERIFY_PGHOST=second\n",
                MAINTENANCE.TARGET_ENV,
            )
        self.assertEqual(raised.exception.code, "configuration-rewrite")

    def test_environment_reader_rejects_duplicate_assignments(self) -> None:
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._parse_environment(b"PGHOST=one\nPGHOST=two\n")
        self.assertEqual(raised.exception.code, "configuration-env-duplicate")

    def test_environment_reader_rejects_invalid_utf8_safely(self) -> None:
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._parse_environment(b"PGHOST=source\xff\n")
        self.assertEqual(raised.exception.code, "configuration-env-encoding")

    def test_source_endpoint_cannot_use_scratch_port(self) -> None:
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._source_system_identifier(
                {
                    "PGHOST": "source.example.invalid",
                    "PGPORT": str(MAINTENANCE.SCRATCH_PORT),
                    "PGDATABASE": "source",
                    "PGUSER": "backup",
                    "PGPASSFILE": "/secure/source.pgpass",
                }
            )
        self.assertEqual(raised.exception.code, "source")

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run", return_value=b"1\n")
    def test_source_role_collision_blocks_apply(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        config = {
            "PGHOST": "source.example.invalid",
            "PGPORT": "5432",
            "PGDATABASE": "source",
            "PGUSER": "backup",
            "PGPASSFILE": "/secure/source.pgpass",
        }
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._require_source_role_absent(config)
        self.assertEqual(raised.exception.code, "source-role-present")
        self.assertIn("pg_roles", run.call_args.args[0][-1])


class FileStateTests(unittest.TestCase):
    def test_partial_cluster_cleanup_accepts_expected_owner(self) -> None:
        temporary = tempfile.mkdtemp()
        path = Path(temporary)
        try:
            os.chmod(path, 0o700)
            with mock.patch.object(MAINTENANCE.shutil, "rmtree") as rmtree:
                MAINTENANCE._remove_partial_cluster_path(path, {os.getuid()})
                rmtree.assert_called_once_with(path)
        finally:
            path.rmdir()

    def test_partial_cluster_cleanup_rejects_unexpected_owner(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            os.chmod(path, 0o700)
            with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
                MAINTENANCE._remove_partial_cluster_path(path, {os.getuid() + 1})
        self.assertEqual(raised.exception.code, "rollback")

    def test_cluster_config_accepts_only_postgres_owned_debian_modes(self) -> None:
        self.assertTrue(
            MAINTENANCE._acceptable_cluster_config_file(
                MAINTENANCE.FileState(True, uid=111, gid=222, mode=0o644),
                111,
                222,
                0o644,
            )
        )
        self.assertTrue(
            MAINTENANCE._acceptable_cluster_config_file(
                MAINTENANCE.FileState(True, uid=111, gid=222, mode=0o640),
                111,
                222,
                0o640,
            )
        )

    def test_cluster_config_rejects_other_authority_or_modes(self) -> None:
        for state in (
            MAINTENANCE.FileState(True, uid=0, gid=222, mode=0o644),
            MAINTENANCE.FileState(True, uid=111, gid=0, mode=0o644),
            MAINTENANCE.FileState(True, uid=111, gid=222, mode=0o664),
            MAINTENANCE.FileState(False),
        ):
            self.assertFalse(
                MAINTENANCE._acceptable_cluster_config_file(
                    state, 111, 222, 0o644
                )
            )

    def test_cluster_directory_accepts_only_postgres_owned_safe_modes(self) -> None:
        for mode in (0o700, 0o750, 0o755):
            self.assertTrue(
                MAINTENANCE._acceptable_cluster_config_directory(
                    MAINTENANCE.FileState(True, uid=111, gid=222, mode=mode),
                    111,
                    222,
                )
            )

    def test_cluster_directory_rejects_other_authority_or_writable_modes(self) -> None:
        for state in (
            MAINTENANCE.FileState(True, uid=0, gid=222, mode=0o755),
            MAINTENANCE.FileState(True, uid=111, gid=0, mode=0o755),
            MAINTENANCE.FileState(True, uid=111, gid=222, mode=0o770),
            MAINTENANCE.FileState(True, uid=111, gid=222, mode=0o757),
            MAINTENANCE.FileState(False),
        ):
            self.assertFalse(
                MAINTENANCE._acceptable_cluster_config_directory(
                    state, 111, 222
                )
            )

    def test_start_conf_accepts_debian_comments_and_one_manual_setting(self) -> None:
        self.assertTrue(
            MAINTENANCE._start_conf_is_manual(
                b"# Automatic startup configuration\n\nmanual\n"
            )
        )
        self.assertTrue(MAINTENANCE._start_conf_is_manual(b"manual # selected\n"))

    def test_start_conf_rejects_other_or_multiple_settings(self) -> None:
        for payload in (
            b"auto\n",
            b"disabled\n",
            b"manual\nauto\n",
            b"# manual only\n",
            b"manual\nunknown=value\n",
            b"manual\xff\n",
        ):
            self.assertFalse(MAINTENANCE._start_conf_is_manual(payload))

    def test_root_owned_stale_pgpass_can_be_snapshotted_then_normalized(self) -> None:
        self.assertTrue(
            MAINTENANCE._acceptable_existing_secret_file(
                MAINTENANCE.FileState(True, uid=0, gid=0, mode=0o640), 5678, 1234
            )
        )
        self.assertTrue(
            MAINTENANCE._acceptable_existing_secret_file(
                MAINTENANCE.FileState(True, uid=0, gid=1234, mode=0o440), 5678, 1234
            )
        )

    def test_backup_owned_private_pgpass_can_be_snapshotted_then_normalized(self) -> None:
        for mode in (0o400, 0o600):
            self.assertTrue(
                MAINTENANCE._acceptable_existing_secret_file(
                    MAINTENANCE.FileState(True, uid=5678, gid=1234, mode=mode),
                    5678,
                    1234,
                )
            )

    def test_non_root_or_public_pgpass_is_rejected(self) -> None:
        for state in (
            MAINTENANCE.FileState(True, uid=1000, gid=1234, mode=0o640),
            MAINTENANCE.FileState(True, uid=0, gid=1234, mode=0o644),
            MAINTENANCE.FileState(True, uid=0, gid=9999, mode=0o640),
            MAINTENANCE.FileState(True, uid=5678, gid=9999, mode=0o600),
            MAINTENANCE.FileState(True, uid=5678, gid=1234, mode=0o640),
        ):
            self.assertFalse(
                MAINTENANCE._acceptable_existing_secret_file(state, 5678, 1234)
            )

    def test_file_match_requires_exact_bytes_and_authority(self) -> None:
        with tempfile.NamedTemporaryFile(delete=False) as handle:
            handle.write(b"before")
            path = Path(handle.name)
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        os.chmod(path, 0o600)
        expected = MAINTENANCE.FileState(
            True,
            uid=os.getuid(),
            gid=os.getgid(),
            mode=0o600,
            sha256=MAINTENANCE._sha(b"before"),
        )
        self.assertTrue(MAINTENANCE._file_matches_state(path, expected, 100))
        path.write_bytes(b"after")
        self.assertFalse(MAINTENANCE._file_matches_state(path, expected, 100))

    def test_absent_file_matches_only_absent_state(self) -> None:
        path = Path(tempfile.gettempdir()) / f"missing-{os.getpid()}-scratch"
        path.unlink(missing_ok=True)
        self.assertTrue(
            MAINTENANCE._file_matches_state(
                path, MAINTENANCE.FileState(False), 100
            )
        )


class VerificationTests(unittest.TestCase):
    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_role_creation_is_bound_to_scratch_port_and_identity(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        MAINTENANCE._create_role("A" * 48, "123456789")

        argv = run.call_args.args[0]
        sql = run.call_args.kwargs["input_bytes"]
        self.assertEqual(argv[argv.index("-h") + 1], "/var/run/postgresql")
        self.assertEqual(argv[argv.index("-p") + 1], "55432")
        self.assertIn(b"current_setting('port') <> '55432'", sql)
        self.assertIn(b"system_identifier::text", sql)
        self.assertIn(b"= '123456789'", sql)
        self.assertIn(b"BEGIN;", sql)
        self.assertIn(b"COMMIT;", sql)

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_source_role_cleanup_is_identity_bound_and_dependency_guarded(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        config = {
            "PGHOST": "source.example.invalid",
            "PGPORT": "5432",
            "PGDATABASE": "source",
            "PGUSER": "backup",
            "PGPASSFILE": "/secure/source.pgpass",
        }
        MAINTENANCE._cleanup_accidental_source_role(config, "123456789")

        argv = run.call_args.args[0]
        sql = run.call_args.kwargs["input_bytes"]
        self.assertEqual(argv[argv.index("-h") + 1], "/var/run/postgresql")
        self.assertEqual(argv[argv.index("-p") + 1], "5432")
        self.assertIn(b"current_setting('port') <> '5432'", sql)
        self.assertIn(b"<> '123456789'", sql)
        self.assertIn(b"NOT rolsuper", sql)
        self.assertIn(b"rolcreatedb", sql)
        self.assertIn(b"pg_auth_members", sql)
        self.assertIn(b"pg_db_role_setting", sql)
        self.assertIn(b"pg_shdepend", sql)
        self.assertIn(b"DROP ROLE leaddrive_restore_verifier", sql)

    @mock.patch.object(MAINTENANCE, "_run")
    def test_source_role_cleanup_rejects_scratch_port(
        self, run: mock.Mock
    ) -> None:
        config = {
            "PGHOST": "source.example.invalid",
            "PGPORT": "55432",
            "PGDATABASE": "source",
            "PGUSER": "backup",
            "PGPASSFILE": "/secure/source.pgpass",
        }
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._cleanup_accidental_source_role(config, "123456789")
        self.assertEqual(raised.exception.code, "source-role-cleanup")
        run.assert_not_called()

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_verify_requires_limited_role_tls_and_distinct_identity(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        run.side_effect = [b"0|1|0|0|0\n", b"1|TLSv1.3\n", b"222\n"]
        MAINTENANCE._verify_scratch("111")
        self.assertEqual(run.call_count, 3)

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_verify_rejects_source_system_identifier(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        run.side_effect = [b"0|1|0|0|0\n", b"1|TLSv1.3\n", b"111\n"]
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._verify_scratch("111")
        self.assertEqual(raised.exception.code, "verify-identity")

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_verify_rejects_privileged_role(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        run.return_value = b"1|1|0|0|0\n"
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._verify_scratch("111")
        self.assertEqual(raised.exception.code, "verify-role")

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_verify_rejects_non_tls_session_with_exact_stage(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        run.side_effect = [b"0|1|0|0|0\n", b"0|\n"]
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._verify_scratch("111")
        self.assertEqual(raised.exception.code, "verify-tls")

    @mock.patch.object(MAINTENANCE, "_command", side_effect=lambda name: name)
    @mock.patch.object(MAINTENANCE, "_run")
    def test_verify_subprocess_failure_keeps_exact_stage(
        self, run: mock.Mock, _command: mock.Mock
    ) -> None:
        run.side_effect = MAINTENANCE.MaintenanceError("verify-role")
        with self.assertRaises(MAINTENANCE.MaintenanceError) as raised:
            MAINTENANCE._verify_scratch("111")
        self.assertEqual(raised.exception.code, "verify-role")


class StaticSafetyContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = SCRIPT_PATH.read_text(encoding="utf-8")

    def test_fixed_loopback_and_manual_cluster_contract(self) -> None:
        self.assertIn('SCRATCH_HOST = "127.0.0.1"', self.source)
        self.assertIn("SCRATCH_PORT = 55432", self.source)
        self.assertIn('"--start-conf=manual"', self.source)
        self.assertIn("_start_conf_is_manual(start_payload)", self.source)
        self.assertIn("host all all 0.0.0.0/0 reject", self.source)
        self.assertNotIn("listen_addresses = '*'", self.source)

    def test_does_not_install_packages_or_touch_kafka(self) -> None:
        for forbidden in (
            "apt-get",
            "apt install",
            "docker run",
            "kafka-consumer-groups",
            "systemctl restart postgresql",
        ):
            self.assertNotIn(forbidden, self.source)

    def test_role_and_ca_are_isolated(self) -> None:
        self.assertIn(
            "LOGIN NOSUPERUSER NOINHERIT CREATEDB", self.source
        )
        self.assertIn("NOCREATEROLE NOREPLICATION NOBYPASSRLS", self.source)
        self.assertIn("restore-postgres-ca.crt", self.source)
        self.assertIn("_sha(source_ca) == _sha(ca_payload)", self.source)

    def test_output_is_schema_bounded(self) -> None:
        self.assertIn("source_restart=no backup_run=no restore_run=no kafka_change=no", self.source)
        self.assertIn("failure_stage={stage}", self.source)
        self.assertIn("cause_stage={cause_stage}", self.source)

    def test_rollback_error_preserves_only_bounded_cause(self) -> None:
        error = MAINTENANCE.MaintenanceError(
            "rollback", cause_code="cluster-start"
        )
        self.assertEqual(error.code, "rollback")
        self.assertEqual(error.cause_code, "cluster-start")

        invalid = MAINTENANCE.MaintenanceError(
            "rollback", cause_code="secret-text-must-not-pass"
        )
        self.assertEqual(invalid.cause_code, "internal")


if __name__ == "__main__":
    unittest.main()
