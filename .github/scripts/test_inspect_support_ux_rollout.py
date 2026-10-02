from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SPEC = importlib.util.spec_from_file_location(
    "inspect_support_ux_rollout", Path(__file__).with_name("inspect_support_ux_rollout.py")
)
assert SPEC is not None and SPEC.loader is not None
DIAGNOSTIC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DIAGNOSTIC
SPEC.loader.exec_module(DIAGNOSTIC)


class RolloutInspectionTests(unittest.TestCase):
    def row(self, features: object, *, active: bool = True, selected: bool = False) -> dict:
        return {"active": active, "features": features, "feature_size_exceeded": False,
                "macro_count": 7 if selected else None,
                "stored_category_entries": 2 if selected else None}

    def test_aggregate_counts_match_live_array_and_legacy_string_semantics(self) -> None:
        rows = [
            self.row([DIAGNOSTIC.FLAG, DIAGNOSTIC.FLAG]),
            self.row(json.dumps([DIAGNOSTIC.FLAG])),
            self.row([DIAGNOSTIC.FLAG], active=False),
            self.row({DIAGNOSTIC.FLAG: True}),
            self.row("not valid JSON"),
        ]
        result = DIAGNOSTIC.summarize_rows(rows, "")
        DIAGNOSTIC.validate_public_output(result, "")
        self.assertEqual((result["tenantCount"], result["activeTenantCount"], result["enabledActiveTenantCount"]), (5, 4, 2))
        self.assertIsNone(result["flagEnabled"])
        self.assertNotIn(DIAGNOSTIC.FLAG, json.dumps(result))

    def test_selected_tenant_reports_bounded_metadata_without_feature_payload(self) -> None:
        result = DIAGNOSTIC.summarize_rows([
            self.row(json.dumps([DIAGNOSTIC.FLAG, "private-feature-detail"]), selected=True)
        ], "internal-support")
        DIAGNOSTIC.validate_public_output(result, "internal-support")
        self.assertTrue(result["tenantFound"])
        self.assertTrue(result["flagEnabled"])
        self.assertEqual(result["featuresFormat"], "encoded-array")
        self.assertEqual((result["macroCount"], result["storedCategoryEntries"]), (7, 2))
        self.assertNotIn("private-feature-detail", json.dumps(result))

    def test_missing_tenant_is_distinct_from_unknown_aggregate_flag(self) -> None:
        selected = DIAGNOSTIC.summarize_rows([], "missing-tenant")
        aggregate = DIAGNOSTIC.summarize_rows([], "")
        DIAGNOSTIC.validate_public_output(selected, "missing-tenant")
        self.assertFalse(selected["tenantFound"])
        self.assertFalse(selected["flagEnabled"])
        self.assertIsNone(aggregate["flagEnabled"])

    def test_malformed_features_fail_closed_without_fabricated_activation(self) -> None:
        result = DIAGNOSTIC.summarize_rows([self.row("[malformed", selected=True)], "internal-support")
        DIAGNOSTIC.validate_public_output(result, "internal-support")
        self.assertFalse(result["flagEnabled"])
        self.assertEqual(result["featuresFormat"], "unsupported")
        self.assertNotIn("activation", json.dumps(result))

    def test_legacy_non_json_constants_match_javascript_fail_closed_semantics(self) -> None:
        for constant in ("NaN", "Infinity", "-Infinity"):
            features = '["' + DIAGNOSTIC.FLAG + '",' + constant + ']'
            result = DIAGNOSTIC.summarize_rows([self.row(features, selected=True)], "internal-support")
            self.assertFalse(result["flagEnabled"])
            self.assertEqual(result["featuresFormat"], "unsupported")

    def test_tenant_limit_and_non_unique_selection_are_failures(self) -> None:
        with self.assertRaisesRegex(DIAGNOSTIC.SafeInspectionError, "TENANT_LIMIT_EXCEEDED"):
            DIAGNOSTIC.summarize_rows([self.row([])] * 1001, "")
        with self.assertRaisesRegex(DIAGNOSTIC.SafeInspectionError, "OUTPUT_INVALID"):
            DIAGNOSTIC.summarize_rows([self.row([], selected=True)] * 2, "internal-support")

    def test_oversized_feature_record_is_not_misreported_as_a_disabled_flag(self) -> None:
        row = self.row(None)
        row["feature_size_exceeded"] = True
        with self.assertRaisesRegex(DIAGNOSTIC.SafeInspectionError, "FEATURE_LIMIT_EXCEEDED"):
            DIAGNOSTIC.summarize_rows([row], "")

    def test_raw_payload_or_non_integer_counts_are_rejected(self) -> None:
        bad = self.row([], selected=True)
        bad["macro_count"] = True
        with self.assertRaises(DIAGNOSTIC.SafeInspectionError):
            DIAGNOSTIC.summarize_rows([bad], "internal-support")
        good = DIAGNOSTIC.summarize_rows([], "")
        for change in ({"password": "never print"}, {"activeTenantCount": True}, {"schemaVersion": True}):
            result = dict(good, **change)
            with self.subTest(change=change), self.assertRaises(DIAGNOSTIC.SafeInspectionError):
                DIAGNOSTIC.validate_public_output(result, "")

    def test_selected_output_must_match_requested_scope_and_counts(self) -> None:
        result = DIAGNOSTIC.summarize_rows([self.row([DIAGNOSTIC.FLAG], selected=True)], "internal-support")
        for change in ({"tenantSlug": "other"}, {"enabledActiveTenantCount": 0}, {"featuresFormat": "unsupported"}):
            with self.subTest(change=change), self.assertRaises(DIAGNOSTIC.SafeInspectionError):
                DIAGNOSTIC.validate_public_output(dict(result, **change), "internal-support")

    def test_slug_injection_is_rejected_before_read_or_connection(self) -> None:
        for slug in ("tenant';SELECT", "$(id)", "a\nb", "a/../b", "-a", "a-", "A", "x" * 81):
            with self.subTest(slug=slug), mock.patch.object(DIAGNOSTIC, "read_database_url") as reader:
                with self.assertRaisesRegex(DIAGNOSTIC.SafeInspectionError, "INVALID_TENANT"):
                    DIAGNOSTIC.inspect(slug)
                reader.assert_not_called()

    def test_connection_preserves_tls_and_fences_read_only_despite_inherited_pg_options(self) -> None:
        with mock.patch.dict(os.environ, {"PGOPTIONS": "-c default_transaction_read_only=off", "PGSERVICE": "untrusted", "PGPASSWORD": "wrong"}):
            env = DIAGNOSTIC.connection_environment(
                "postgresql://operator:p%40ss@db.example.invalid:6432/app?schema=public&sslmode=verify-full&sslrootcert=%2Fetc%2Ftrusted-ca.crt"
            )
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGSSLROOTCERT"], "/etc/trusted-ca.crt")
        self.assertEqual(env["PGPASSWORD"], "p@ss")
        self.assertNotIn("PGSERVICE", env)
        self.assertIn("default_transaction_read_only=on", env["PGOPTIONS"])
        self.assertIn("statement_timeout=5000", env["PGOPTIONS"])

    def test_unsupported_transport_options_or_duplicate_credentials_fail_closed(self) -> None:
        for url in (
            "https://user:pass@db.example.invalid/app",
            "postgresql://user:pass@db.example.invalid:0/app",
            "postgresql://user:pass@db.example.invalid/app?schema=other",
            "postgresql://user:pass@db.example.invalid/app?sslmode=require&sslmode=disable",
            "postgresql://user:pass@db.example.invalid/app?options=-c%20default_transaction_read_only=off",
            "postgresql://user:pass@db.example.invalid/app?sslmode=unsafe",
        ):
            with self.subTest(url=url), self.assertRaises(DIAGNOSTIC.SafeInspectionError):
                DIAGNOSTIC.connection_environment(url)

    def test_static_env_read_does_not_execute_shell_syntax(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "app.env"
            value = "postgresql://user:literal$(id)@db.example.invalid/app"
            path.write_text("IGNORED=secret\nexport DATABASE_URL='" + value + "'\n")
            self.assertEqual(DIAGNOSTIC.read_database_url(path, require_root=False), value)
            path.write_text("DATABASE_URL='one'\nDATABASE_URL='two'\n")
            with self.assertRaisesRegex(DIAGNOSTIC.SafeInspectionError, "APP_ENV_INVALID"):
                DIAGNOSTIC.read_database_url(path, require_root=False)

    def test_query_is_fenced_and_credentials_never_enter_command_arguments(self) -> None:
        row = self.row([DIAGNOSTIC.FLAG], selected=True)
        run_result = subprocess.CompletedProcess([], 0, json.dumps([row]), "")
        with mock.patch.object(DIAGNOSTIC, "read_database_url", return_value="postgresql://user:private-password@db.example.invalid/app"), mock.patch.object(DIAGNOSTIC.subprocess, "run", return_value=run_result) as runner:
            result = DIAGNOSTIC.inspect("internal-support")
        arguments, options = runner.call_args
        self.assertNotIn("private-password", json.dumps(arguments))
        self.assertIn("BEGIN READ ONLY", options["input"])
        self.assertIn("ROLLBACK", options["input"])
        self.assertIn("--set=support_tenant=internal-support", arguments[0])
        self.assertIn("default_transaction_read_only=on", options["env"]["PGOPTIONS"])
        self.assertEqual(options["timeout"], 12)
        self.assertTrue(result["flagEnabled"])

    def test_query_failure_never_emits_database_exception_or_credentials(self) -> None:
        run_result = subprocess.CompletedProcess([], 1, "", "password=private-password customer payload")
        output = io.StringIO()
        with mock.patch.dict(os.environ, {"SUPPORT_UX_TENANT": "internal-support"}), mock.patch.object(sys, "argv", ["inspect"]), mock.patch.object(DIAGNOSTIC, "read_database_url", return_value="postgresql://user:private-password@db.example.invalid/app"), mock.patch.object(DIAGNOSTIC.subprocess, "run", return_value=run_result), contextlib.redirect_stdout(output):
            exit_code = DIAGNOSTIC.main()
        self.assertEqual(exit_code, 1)
        self.assertEqual(json.loads(output.getvalue()), {"schemaVersion": 1, "status": "error", "code": "DATABASE_QUERY_FAILED"})

    def test_validator_never_echoes_untrusted_raw_output(self) -> None:
        output = io.StringIO()
        with mock.patch.dict(os.environ, {"SUPPORT_UX_TENANT": ""}), mock.patch.object(sys, "argv", ["inspect", "--validate-output"]), mock.patch.object(sys, "stdin", io.StringIO('{"password":"private-password"}')), contextlib.redirect_stdout(output):
            exit_code = DIAGNOSTIC.main()
        self.assertEqual(exit_code, 1)
        self.assertNotIn("private-password", output.getvalue())


if __name__ == "__main__":
    unittest.main()
