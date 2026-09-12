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


if __name__ == "__main__":
    unittest.main()
