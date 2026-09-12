from __future__ import annotations

import importlib.util
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("inspect_postgres_tls_metadata.py")
SPEC = importlib.util.spec_from_file_location("inspect_postgres_tls_metadata", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
DIAGNOSTIC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIAGNOSTIC
SPEC.loader.exec_module(DIAGNOSTIC)


class StaticConfigTests(unittest.TestCase):
    def write_config(self, contents: str) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
        self.addCleanup(lambda: os.unlink(handle.name))
        with handle:
            handle.write(contents)
        os.chmod(handle.name, 0o600)
        return Path(handle.name)

    def test_reads_only_allowlisted_literals(self) -> None:
        path = self.write_config(
            "\n".join(
                (
                    "PGHOST=127.0.0.1",
                    "PGPORT=5432",
                    "VERIFY_PGHOST=example.aivencloud.com",
                    "VERIFY_PGPORT=6432",
                    "PGUSER=do-not-read",
                    "PGPASSWORD=do-not-read",
                    "DATABASE_URL=https://user:password@example.invalid/db",
                )
            )
        )

        config = DIAGNOSTIC.read_static_config(path, require_root=False)

        self.assertEqual(
            config,
            {
                "PGHOST": "127.0.0.1",
                "PGPORT": "5432",
                "VERIFY_PGHOST": "example.aivencloud.com",
                "VERIFY_PGPORT": "6432",
            },
        )

    def test_rejects_duplicate_allowlisted_keys(self) -> None:
        path = self.write_config("PGHOST=localhost\nPGHOST=127.0.0.1\n")
        with self.assertRaises(DIAGNOSTIC.SafeDiagnosticError):
            DIAGNOSTIC.read_static_config(path, require_root=False)


class ClassificationTests(unittest.TestCase):
    def test_local_address_is_self_hosted(self) -> None:
        result = DIAGNOSTIC.normalize_host("127.0.0.1")
        self.assertEqual((result.address_type, result.provider), ("local", "self-hosted"))

    @mock.patch.object(
        socket,
        "getaddrinfo",
        return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 0)),
        ],
    )
    def test_provider_is_derived_without_returning_domain(self, _getaddrinfo: mock.Mock) -> None:
        result = DIAGNOSTIC.normalize_host("example.aivencloud.com")
        self.assertEqual((result.address_type, result.provider), ("public", "aiven"))

    def test_private_literal_is_classified_without_returning_address(self) -> None:
        result = DIAGNOSTIC.normalize_host("10.20.30.40")
        self.assertEqual((result.address_type, result.provider), ("private", "unknown"))

    def test_only_source_port_has_postgresql_default(self) -> None:
        self.assertEqual(
            DIAGNOSTIC.normalize_port("", allow_default=True), (5432, "5432")
        )
        with self.assertRaises(DIAGNOSTIC.SafeDiagnosticError):
            DIAGNOSTIC.normalize_port("", allow_default=False)

    def test_anonymized_san_match(self) -> None:
        host = DIAGNOSTIC.NormalizedHost(
            "db.example.com", "dns", "public", "unknown"
        )
        self.assertEqual(
            DIAGNOSTIC._endpoint_matches_san(host, ["*.example.com"], []), "yes"
        )

    def test_dns_pattern_match_is_exact_or_single_label_wildcard(self) -> None:
        self.assertTrue(
            DIAGNOSTIC._dns_pattern_matches("db.example.com", "db.example.com")
        )
        self.assertTrue(
            DIAGNOSTIC._dns_pattern_matches("*.example.com", "db.example.com")
        )
        self.assertFalse(
            DIAGNOSTIC._dns_pattern_matches(
                "*.example.com", "nested.db.example.com"
            )
        )

    @mock.patch.object(
        DIAGNOSTIC,
        "_local_interface_addresses",
        return_value={DIAGNOSTIC.ipaddress.ip_address("10.20.30.40")},
    )
    @mock.patch.object(
        socket,
        "getaddrinfo",
        return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.20.30.40", 0)),
        ],
    )
    def test_dns_resolution_is_compared_to_real_local_interfaces(
        self, _getaddrinfo: mock.Mock, _interfaces: mock.Mock
    ) -> None:
        self.assertEqual(DIAGNOSTIC._name_resolves_to_local("db.example.com"), "yes")

    def test_source_remediation_requires_name_resolution_and_verify_full(self) -> None:
        secured = mock.Mock()
        secured.getpeercert.return_value = b"certificate"
        with (
            mock.patch.object(
                DIAGNOSTIC,
                "_postgres_tls_socket",
                return_value=("available", secured),
            ),
            mock.patch.object(
                DIAGNOSTIC,
                "_certificate_dns_sans",
                return_value=["production.example.com"],
            ),
            mock.patch.object(
                DIAGNOSTIC,
                "_production_server_names",
                return_value=["production.example.com"],
            ),
            mock.patch.object(
                DIAGNOSTIC, "_name_resolves_to_local", return_value="yes"
            ),
            mock.patch.object(
                DIAGNOSTIC,
                "_verify_full_with_presented_certificate",
                return_value="yes",
            ) as verify_full,
        ):
            result = DIAGNOSTIC.inspect_source_san(
                {"PGHOST": "127.0.0.1", "PGPORT": "5432"}
            )

        self.assertEqual(result.remediation_without_restart, "proven")
        self.assertEqual(verify_full.call_args.args[0].value, "production.example.com")

    @mock.patch.object(DIAGNOSTIC, "_detect_custom_systemd")
    @mock.patch.object(DIAGNOSTIC, "_compose_definition_exists")
    @mock.patch.object(DIAGNOSTIC, "_detect_docker")
    @mock.patch.object(DIAGNOSTIC, "_detect_postgresql_cluster")
    def test_scratch_launcher_is_classified_without_exposing_definition(
        self,
        cluster: mock.Mock,
        docker: mock.Mock,
        compose: mock.Mock,
        systemd: mock.Mock,
    ) -> None:
        cluster.return_value = (True, "stopped", True)
        docker.return_value = (set(), [], True)
        compose.return_value = (False, True)
        systemd.return_value = (False, "absent", True)

        result = DIAGNOSTIC.inspect_scratch_launch({"VERIFY_PGPORT": "55432"})

        self.assertEqual(
            result,
            DIAGNOSTIC.ScratchLaunchResult(
                port="55432",
                launch_mechanism="separate-postgresql-cluster",
                definition="present",
                runtime_state="stopped",
            ),
        )


class OutputSchemaTests(unittest.TestCase):
    def test_output_contains_only_anonymized_fields(self) -> None:
        result = DIAGNOSTIC.EndpointResult(
            endpoint="restore-scratch",
            address_type="public",
            provider="aiven",
            port="5432",
            tls="available",
            issuer="private-or-untrusted:aiven",
            san_dns="2",
            san_ip="0",
            san_wildcard="1",
            san_endpoint_match="yes",
            fingerprint_prefix="0123456789ab",
        )

        output = DIAGNOSTIC.format_result(result)

        self.assertEqual(
            output,
            "endpoint=restore-scratch address_type=public provider=aiven port=5432 "
            "tls=available issuer=private-or-untrusted:aiven san_dns=2 san_ip=0 "
            "san_wildcard=1 san_endpoint_match=yes fingerprint_sha256_prefix=0123456789ab",
        )
        for forbidden in (
            "example.aivencloud.com",
            "8.8.8.8",
            "https://",
            "user",
            "password",
            "PRIVATE KEY",
        ):
            self.assertNotIn(forbidden, output)

    def test_formatter_rejects_unallowlisted_provider(self) -> None:
        result = DIAGNOSTIC.empty_result("source")
        result = DIAGNOSTIC.EndpointResult(**{**result.__dict__, "provider": "raw-host-value"})
        with self.assertRaises(DIAGNOSTIC.SafeDiagnosticError):
            DIAGNOSTIC.format_result(result)

    def test_san_and_scratch_output_contains_only_allowlisted_states(self) -> None:
        source_output = DIAGNOSTIC.format_source_san_result(
            DIAGNOSTIC.SourceSanResult(
                dns_san_count="1",
                san_matches_server_name="yes",
                san_resolves_local="yes",
                verify_full_with_san="yes",
                remediation_without_restart="proven",
            )
        )
        scratch_output = DIAGNOSTIC.format_scratch_launch_result(
            DIAGNOSTIC.ScratchLaunchResult(
                port="55432",
                launch_mechanism="not-configured",
                definition="absent",
                runtime_state="absent",
            )
        )

        self.assertEqual(
            source_output,
            "source_san dns_san_count=1 san_matches_server_name=yes "
            "san_resolves_local=yes verify_full_with_san=yes "
            "remediation_without_postgres_restart=proven",
        )
        self.assertEqual(
            scratch_output,
            "scratch port=55432 launch_mechanism=not-configured "
            "definition=absent runtime_state=absent",
        )
        for forbidden in (
            "db.example.com",
            "10.20.30.40",
            "https://",
            "user",
            "password",
            "PRIVATE KEY",
        ):
            self.assertNotIn(forbidden, source_output)
            self.assertNotIn(forbidden, scratch_output)


if __name__ == "__main__":
    unittest.main()
