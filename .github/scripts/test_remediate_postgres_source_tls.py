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
        with self.assertRaises(MAINTENANCE.SafeMaintenanceError):
            MAINTENANCE.read_environment(path, require_production_authority=False)

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


class DecisionTests(unittest.TestCase):
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
            b"PGSSLMODE=verify-full\n"
            b"PGSSLROOTCERT=/etc/leaddrive/managed-postgres-ca.crt\n"
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
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": "/etc/leaddrive/managed-postgres-ca.crt",
                "PGSERVICE": "",
                "PGSERVICEFILE": "",
                "PGPASSWORD": "",
            },
        )

        self.assertEqual(certificate.call_count, 2)
        self.assertEqual(verify_full.call_count, 2)
        self.assertIn(b"PGHOSTADDR=127.0.0.1\n", prepared.environment)
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
    @mock.patch.object(MAINTENANCE, "_read_regular_file")
    def test_pgpass_must_match_new_certificate_identity(
        self, read_file: mock.Mock, get_group: mock.Mock
    ) -> None:
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

        with self.assertRaises(MAINTENANCE.SafeMaintenanceError):
            MAINTENANCE._require_pgpass_match(config, "different.example.internal", 5432)


class OutputTests(unittest.TestCase):
    @mock.patch.object(MAINTENANCE, "apply", return_value="applied")
    def test_success_output_is_fixed_schema(self, _apply: mock.Mock) -> None:
        with mock.patch("builtins.print") as output:
            status = MAINTENANCE.main(["apply"])
        self.assertEqual(status, 0)
        output.assert_called_once_with(
            "source_tls_maintenance operation=apply status=applied "
            "pg_restart=no service_restart=no effective_verify_full=yes "
            "rollback_snapshot=retained"
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
            "rollback_snapshot=unknown",
        )


if __name__ == "__main__":
    unittest.main()
