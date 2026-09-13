from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("remediate_postgres_source_tls.py")
SPEC = importlib.util.spec_from_file_location("remediate_postgres_source_tls", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
MAINTENANCE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MAINTENANCE
SPEC.loader.exec_module(MAINTENANCE)


class EnvironmentTests(unittest.TestCase):
    def write_environment(self, contents: str) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
        self.addCleanup(lambda: os.unlink(handle.name))
        with handle:
            handle.write(contents)
        os.chmod(handle.name, 0o600)
        return Path(handle.name)

    def test_reader_only_returns_allowlisted_connection_keys(self) -> None:
        path = self.write_environment(
            "\n".join(
                (
                    "PGHOST=127.0.0.1",
                    "PGPORT=5432",
                    "PGDATABASE=database_name",
                    "PGUSER=backup_user",
                    "PGPASSFILE=/etc/leaddrive/backup.pgpass",
                    "PGSSLMODE=verify-full",
                    "PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt",
                    "PGPASSWORD=never-return-this",
                    "DATABASE_URL=postgres://user:password@example.invalid/db",
                )
            )
            + "\n"
        )

        _, _, config = MAINTENANCE.read_environment(
            path, require_production_authority=False
        )

        self.assertEqual(
            config,
            {
                "PGHOST": "127.0.0.1",
                "PGHOSTADDR": "",
                "PGPORT": "5432",
                "PGDATABASE": "database_name",
                "PGUSER": "backup_user",
                "PGPASSFILE": "/etc/leaddrive/backup.pgpass",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
                "PGSERVICE": "",
                "PGSERVICEFILE": "",
                "PGPASSWORD": "never-return-this",
            },
        )

    def test_reader_rejects_duplicate_target_keys(self) -> None:
        path = self.write_environment(
            "PGHOST=127.0.0.1\n"
            "PGHOST=127.0.0.2\n"
            "PGDATABASE=database_name\n"
            "PGUSER=backup_user\n"
            "PGPASSFILE=/etc/leaddrive/backup.pgpass\n"
            "PGSSLMODE=verify-full\n"
            "PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n"
        )
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
            MAINTENANCE.read_environment(path, require_production_authority=False)
        self.assertEqual(raised.exception.code, "configuration-read-duplicate")

    def test_reader_accepts_missing_precommission_tls_client_settings(self) -> None:
        path = self.write_environment(
            "PGHOST=127.0.0.1\n"
            "PGDATABASE=database_name\n"
            "PGUSER=backup_user\n"
            "PGPASSFILE=/etc/leaddrive/backup.pgpass\n"
        )
        _, _, config = MAINTENANCE.read_environment(
            path, require_production_authority=False
        )
        self.assertEqual(config["PGSSLMODE"], "")
        self.assertEqual(config["PGSSLROOTCERT"], "")

    def test_reader_classifies_hardlinked_environment_without_reading_values(self) -> None:
        path = self.write_environment(
            "PGHOST=127.0.0.1\n"
            "PGDATABASE=database_name\n"
            "PGUSER=backup_user\n"
            "PGPASSFILE=/etc/leaddrive/backup.pgpass\n"
            "PGSSLMODE=verify-full\n"
            "PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n"
        )
        linked_path = Path(f"{path}.link")
        os.link(path, linked_path)
        self.addCleanup(lambda: linked_path.unlink(missing_ok=True))
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
            MAINTENANCE.read_environment(path, require_production_authority=False)
        self.assertEqual(raised.exception.code, "configuration-read-links")

    def test_rewrite_adds_hostaddr_and_preserves_unrelated_secret_bytes(self) -> None:
        original = (
            b"# source\n"
            b"PGHOST=127.0.0.1\n"
            b"PGSSLMODE=verify-full\n"
            b"PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n"
            b"DATABASE_URL=postgres://user:password@example.invalid/db\n"
        )

        rewritten = MAINTENANCE.rewrite_environment(
            original,
            {
                "PGHOST": "production.example.internal",
                "PGHOSTADDR": "127.0.0.1",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
            },
        )

        self.assertEqual(rewritten.count(b"PGHOSTADDR="), 1)
        self.assertIn(
            b"DATABASE_URL=postgres://user:password@example.invalid/db\n", rewritten
        )
        self.assertNotIn(b"PGHOST=127.0.0.1\n", rewritten)

    def test_rewrite_replaces_existing_hostaddr_without_duplication(self) -> None:
        original = (
            b"PGHOST=old.example.internal\n"
            b"PGHOSTADDR=127.0.0.2\n"
            b"PGSSLMODE=verify-full\n"
            b"PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n"
        )
        rewritten = MAINTENANCE.rewrite_environment(
            original,
            {
                "PGHOST": "production.example.internal",
                "PGHOSTADDR": "127.0.0.1",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
            },
        )
        self.assertEqual(rewritten.count(b"PGHOSTADDR="), 1)
        self.assertIn(b"PGHOSTADDR=127.0.0.1\n", rewritten)

    def test_rewrite_adds_missing_tls_client_settings(self) -> None:
        original = b"PGHOST=127.0.0.1\nUNRELATED=preserved-without-reading\n"
        rewritten = MAINTENANCE.rewrite_environment(
            original,
            {
                "PGHOST": "production.example.internal",
                "PGHOSTADDR": "127.0.0.1",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
            },
        )
        self.assertEqual(rewritten.count(b"PGSSLMODE="), 1)
        self.assertEqual(rewritten.count(b"PGSSLROOTCERT="), 1)
        self.assertIn(b"UNRELATED=preserved-without-reading\n", rewritten)

    def test_rewrite_adds_hostaddr_after_unterminated_host_line(self) -> None:
        rewritten = MAINTENANCE.rewrite_environment(
            b"PGHOST=127.0.0.1",
            {
                "PGHOST": "production.example.internal",
                "PGHOSTADDR": "127.0.0.1",
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
            },
        )
        self.assertIn(
            b"PGHOST=production.example.internal\nPGHOSTADDR=127.0.0.1\n",
            rewritten,
        )


class DecisionTests(unittest.TestCase):
    def test_reviewed_artifact_without_commissioned_unit_is_allowed(self) -> None:
        script = b"reviewed-script"
        authority = MAINTENANCE.FileAuthority(uid=0, gid=0, mode=0o555)
        approved = {MAINTENANCE.hashlib.sha256(script).hexdigest()}
        with (
            mock.patch.object(
                MAINTENANCE,
                "_read_regular_file",
                side_effect=[(script, authority), (None, None)],
            ),
            mock.patch.object(
                MAINTENANCE, "APPROVED_BACKUP_SCRIPT_SHA256", approved
            ),
        ):
            self.assertFalse(MAINTENANCE._require_reviewed_invocation())

    def test_unapproved_reviewed_artifact_reports_only_sanitized_stage(self) -> None:
        authority = MAINTENANCE.FileAuthority(uid=0, gid=0, mode=0o555)
        with mock.patch.object(
            MAINTENANCE,
            "_read_regular_file",
            side_effect=[(b"different-script", authority), (None, None)],
        ):
            with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
                MAINTENANCE._require_reviewed_invocation()
        self.assertEqual(raised.exception.code, "invocation-script-unapproved")

    def test_drifted_unit_is_quarantined_as_uncommissioned(self) -> None:
        script = b"reviewed-script"
        authority = MAINTENANCE.FileAuthority(uid=0, gid=0, mode=0o555)
        approved = {MAINTENANCE.hashlib.sha256(script).hexdigest()}
        with (
            mock.patch.object(
                MAINTENANCE,
                "_read_regular_file",
                side_effect=[(script, authority), (b"different-unit", authority)],
            ),
            mock.patch.object(
                MAINTENANCE, "APPROVED_BACKUP_SCRIPT_SHA256", approved
            ),
        ):
            self.assertFalse(MAINTENANCE._require_reviewed_invocation())

    @mock.patch.object(MAINTENANCE.shutil, "which", return_value="/usr/bin/systemctl")
    @mock.patch.object(MAINTENANCE.subprocess, "run")
    def test_scheduler_gate_requires_inactive_and_disabled_units(
        self, run: mock.Mock, _which: mock.Mock
    ) -> None:
        run.side_effect = [
            MAINTENANCE.subprocess.CompletedProcess([], 1),
            MAINTENANCE.subprocess.CompletedProcess([], 1),
            MAINTENANCE.subprocess.CompletedProcess([], 1),
            MAINTENANCE.subprocess.CompletedProcess([], 1),
        ]
        MAINTENANCE._require_backup_inactive()
        self.assertEqual(run.call_count, 4)

    @mock.patch.object(MAINTENANCE.shutil, "which", return_value="/usr/bin/systemctl")
    @mock.patch.object(MAINTENANCE.subprocess, "run")
    def test_scheduler_gate_rejects_enabled_unit(
        self, run: mock.Mock, _which: mock.Mock
    ) -> None:
        run.side_effect = [
            MAINTENANCE.subprocess.CompletedProcess([], 1),
            MAINTENANCE.subprocess.CompletedProcess([], 1),
            MAINTENANCE.subprocess.CompletedProcess([], 0),
        ]
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError):
            MAINTENANCE._require_backup_inactive()

    @mock.patch.object(MAINTENANCE.os, "open", side_effect=FileNotFoundError)
    def test_precommission_state_does_not_require_backup_lock(
        self, _open: mock.Mock
    ) -> None:
        self.assertIsNone(MAINTENANCE._acquire_backup_lock(required=False))
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError):
            MAINTENANCE._acquire_backup_lock(required=True)

    @mock.patch.object(MAINTENANCE, "_verify_full")
    @mock.patch.object(MAINTENANCE, "_require_pgpass_match")
    @mock.patch.object(
        MAINTENANCE,
        "_production_server_name",
        return_value="production.example.internal",
    )
    @mock.patch.object(
        MAINTENANCE,
        "_certificate_identity",
        return_value=("issuer", "issuer", ["production.example.internal"]),
    )
    @mock.patch.object(
        MAINTENANCE,
        "_postgres_certificate",
        side_effect=[(b"certificate", "127.0.0.1"), (b"certificate", "127.0.0.1")],
    )
    def test_prepare_requires_two_stable_tls_observations(
        self,
        certificate: mock.Mock,
        identity: mock.Mock,
        server_name: mock.Mock,
        pgpass: mock.Mock,
        verify_full: mock.Mock,
    ) -> None:
        environment = (
            b"PGHOST=127.0.0.1\n"
            b"PGSSLMODE=require\n"
            b"PGSSLROOTCERT=/etc/leaddrive/legacy-source-ca.crt\n"
        )
        prepared = MAINTENANCE._prepare(
            environment,
            {
                "PGHOST": "127.0.0.1",
                "PGHOSTADDR": "",
                "PGPORT": "5432",
                "PGDATABASE": "database_name",
                "PGUSER": "backup_user",
                "PGPASSFILE": "/etc/leaddrive/backup.pgpass",
                "PGSSLMODE": "require",
                "PGSSLROOTCERT": "/etc/leaddrive/legacy-source-ca.crt",
                "PGSERVICE": "",
                "PGSERVICEFILE": "",
                "PGPASSWORD": "",
            },
        )

        self.assertEqual(certificate.call_count, 2)
        self.assertEqual(verify_full.call_count, 2)
        self.assertIn(b"PGHOSTADDR=127.0.0.1\n", prepared.environment)
        self.assertIn(b"PGSSLMODE=verify-full\n", prepared.environment)
        self.assertIn(
            b"PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n",
            prepared.environment,
        )
        self.assertNotIn(b"PGHOST=127.0.0.1\n", prepared.environment)
        identity.assert_called()
        server_name.assert_called_once()
        pgpass.assert_called_once()

    @mock.patch.object(
        MAINTENANCE,
        "_postgres_certificate",
        side_effect=[(b"certificate-one", "127.0.0.1"), (b"certificate-two", "127.0.0.1")],
    )
    def test_prepare_fails_when_certificate_changes_mid_window(
        self, _certificate: mock.Mock
    ) -> None:
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError):
            MAINTENANCE._prepare(
                b"PGHOST=127.0.0.1\nPGSSLMODE=verify-full\n"
                b"PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n",
                {
                    "PGHOST": "127.0.0.1",
                    "PGHOSTADDR": "",
                    "PGPORT": "5432",
                    "PGDATABASE": "database_name",
                    "PGUSER": "backup_user",
                    "PGPASSFILE": "/etc/leaddrive/backup.pgpass",
                    "PGSSLMODE": "verify-full",
                    "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
                    "PGSERVICE": "",
                    "PGSERVICEFILE": "",
                    "PGPASSWORD": "",
                },
            )

    def test_pgpass_parser_handles_escaped_separator(self) -> None:
        self.assertEqual(
            MAINTENANCE._split_pgpass_line(
                r"production.example.internal:5432:database:backup:pa\:ss"
            ),
            ["production.example.internal", "5432", "database", "backup", "pa:ss"],
        )

    @mock.patch.object(MAINTENANCE.grp, "getgrnam")
    @mock.patch.object(MAINTENANCE.pwd, "getpwnam")
    @mock.patch.object(MAINTENANCE, "_read_regular_file")
    def test_pgpass_must_match_new_certificate_identity(
        self, read_file: mock.Mock, get_user: mock.Mock, get_group: mock.Mock
    ) -> None:
        get_user.return_value.pw_uid = 990
        get_group.return_value.gr_gid = 991
        read_file.return_value = (
            b"production.example.internal:5432:database_name:backup_user:secret\n",
            MAINTENANCE.FileAuthority(uid=0, gid=991, mode=0o640),
        )
        config = {
            "PGPASSFILE": str(MAINTENANCE.PGPASS_PATH),
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }

        MAINTENANCE._require_pgpass_match(
            config, "production.example.internal", 5432
        )

        with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
            MAINTENANCE._require_pgpass_match(config, "different.example.internal", 5432)
        self.assertEqual(raised.exception.code, "pgpass-match")

    @mock.patch.object(MAINTENANCE.grp, "getgrnam")
    @mock.patch.object(MAINTENANCE.pwd, "getpwnam")
    @mock.patch.object(MAINTENANCE, "_read_regular_file")
    def test_pgpass_accepts_private_service_user_authority(
        self,
        read_file: mock.Mock,
        get_user: mock.Mock,
        get_group: mock.Mock,
    ) -> None:
        get_user.return_value.pw_uid = 990
        get_group.return_value.gr_gid = 991
        read_file.return_value = (
            b"production.example.internal:5432:database_name:backup_user:secret\n",
            MAINTENANCE.FileAuthority(uid=990, gid=991, mode=0o600),
        )
        config = {
            "PGPASSFILE": str(MAINTENANCE.PGPASS_PATH),
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }
        MAINTENANCE._require_pgpass_match(
            config, "production.example.internal", 5432
        )

    @mock.patch.object(MAINTENANCE, "_read_pgpass")
    def test_pgpass_selector_rewrite_preserves_credential_bytes(
        self, read_pgpass: mock.Mock
    ) -> None:
        authority = MAINTENANCE.FileAuthority(uid=990, gid=991, mode=0o600)
        original = (
            b"# retained comment\r\n"
            b"127.0.0.1:5432:database_name:backup_user:pa\\:ss\\\\word\r\n"
            b"other.example.internal:5432:other:other_user:untouched\r\n"
        )
        read_pgpass.return_value = (original, authority)
        config = {
            "PGPASSFILE": str(MAINTENANCE.PGPASS_PATH),
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }

        before, after, observed_authority = (
            MAINTENANCE._replace_pgpass_host_selector(
                config,
                "127.0.0.1",
                "production.example.internal",
                5432,
            )
        )

        self.assertEqual(before, original)
        self.assertEqual(observed_authority, authority)
        self.assertEqual(
            after,
            original.replace(
                b"127.0.0.1:5432:",
                b"production.example.internal:5432:",
                1,
            ),
        )
        self.assertEqual(after.count(b"pa\\:ss\\\\word"), 1)

    @mock.patch.object(MAINTENANCE, "_read_pgpass")
    def test_pgpass_selector_rewrite_requires_one_exact_current_tuple(
        self, read_pgpass: mock.Mock
    ) -> None:
        authority = MAINTENANCE.FileAuthority(uid=990, gid=991, mode=0o600)
        read_pgpass.return_value = (
            b"127.0.0.1:5432:database_name:backup_user:first\n"
            b"127.0.0.1:5432:database_name:backup_user:second\n",
            authority,
        )
        config = {
            "PGPASSFILE": str(MAINTENANCE.PGPASS_PATH),
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }

        with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
            MAINTENANCE._replace_pgpass_host_selector(
                config,
                "127.0.0.1",
                "production.example.internal",
                5432,
            )
        self.assertEqual(raised.exception.code, "pgpass-rewrite")

    @mock.patch.object(MAINTENANCE, "_read_pgpass")
    def test_pgpass_selector_rewrite_is_noop_when_new_tuple_already_matches(
        self, read_pgpass: mock.Mock
    ) -> None:
        authority = MAINTENANCE.FileAuthority(uid=990, gid=991, mode=0o600)
        original = (
            b"production.example.internal:5432:database_name:backup_user:secret\n"
        )
        read_pgpass.return_value = (original, authority)
        config = {
            "PGPASSFILE": str(MAINTENANCE.PGPASS_PATH),
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }

        before, after, observed_authority = (
            MAINTENANCE._replace_pgpass_host_selector(
                config,
                "127.0.0.1",
                "production.example.internal",
                5432,
            )
        )

        self.assertEqual(before, original)
        self.assertIsNone(after)
        self.assertEqual(observed_authority, authority)

    def test_pgpass_requires_canonical_path_without_exposing_it(self) -> None:
        config = {
            "PGPASSFILE": "/different/path",
            "PGDATABASE": "database_name",
            "PGUSER": "backup_user",
        }
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
            MAINTENANCE._require_pgpass_match(
                config, "production.example.internal", 5432
            )
        self.assertEqual(raised.exception.code, "pgpass-path")

    def test_pgpass_classifies_missing_file_without_exposing_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing_path = Path(directory) / "missing"
            config = {
                "PGPASSFILE": str(missing_path),
                "PGDATABASE": "database_name",
                "PGUSER": "backup_user",
            }
            with (
                mock.patch.object(MAINTENANCE, "PGPASS_PATH", missing_path),
                mock.patch.object(
                    MAINTENANCE,
                    "_read_regular_file",
                    side_effect=MAINTENANCE.SafeMaintenanceError(),
                ),
            ):
                with self.assertRaises(MAINTENANCE.SafeMaintenanceError) as raised:
                    MAINTENANCE._require_pgpass_match(
                        config, "production.example.internal", 5432
                    )
        self.assertEqual(raised.exception.code, "pgpass-missing")


class OutputTests(unittest.TestCase):
    @mock.patch.object(MAINTENANCE, "apply", return_value="applied")
    def test_success_output_is_fixed_schema(self, _apply: mock.Mock) -> None:
        with mock.patch("builtins.print") as output:
            status = MAINTENANCE.main(["apply"])
        self.assertEqual(status, 0)
        output.assert_called_once_with(
            "source_tls_maintenance operation=apply status=applied "
            "pg_restart=no service_restart=no effective_verify_full=yes "
            "rollback_snapshot=retained failure_stage=none"
        )

    @mock.patch.object(MAINTENANCE, "apply", return_value="applied")
    def test_separately_confirmed_pgpass_operation_is_fixed_schema(
        self, apply: mock.Mock
    ) -> None:
        with mock.patch("builtins.print") as output:
            status = MAINTENANCE.main(["apply-with-passfile-selector"])
        self.assertEqual(status, 0)
        apply.assert_called_once_with(rewrite_pgpass_selector=True)
        output.assert_called_once_with(
            "source_tls_maintenance operation=apply-with-passfile-selector "
            "status=applied pg_restart=no service_restart=no "
            "effective_verify_full=yes rollback_snapshot=retained "
            "failure_stage=none"
        )

    @mock.patch.object(MAINTENANCE, "apply", side_effect=RuntimeError("secret-host"))
    def test_failure_output_drops_exception_text(self, _apply: mock.Mock) -> None:
        with mock.patch("builtins.print") as output:
            status = MAINTENANCE.main(["apply"])
        self.assertEqual(status, 1)
        rendered = output.call_args.args[0]
        self.assertNotIn("secret-host", rendered)
        self.assertEqual(
            rendered,
            "source_tls_maintenance operation=apply status=failed "
            "pg_restart=no service_restart=no effective_verify_full=unknown "
            "rollback_snapshot=unknown failure_stage=internal",
        )

    @mock.patch.object(
        MAINTENANCE,
        "apply",
        side_effect=MAINTENANCE.SafeMaintenanceError("pgpass"),
    )
    def test_failure_output_exposes_only_allowlisted_stage(self, _apply: mock.Mock) -> None:
        with mock.patch("builtins.print") as output:
            status = MAINTENANCE.main(["apply"])
        self.assertEqual(status, 1)
        output.assert_called_once_with(
            "source_tls_maintenance operation=apply status=failed "
            "pg_restart=no service_restart=no effective_verify_full=unknown "
            "rollback_snapshot=unknown failure_stage=pgpass"
        )


if __name__ == "__main__":
    unittest.main()
