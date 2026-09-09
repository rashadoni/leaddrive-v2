from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile
import unittest


WORKER_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from config import ConfigurationError, RuntimeLimits, WorkerConfig  # noqa: E402


class ConfigTests(unittest.TestCase):
    def test_safe_defaults_and_remote_tightening(self) -> None:
        limits = RuntimeLimits()
        self.assertEqual(limits.min_scrolls, 8)
        self.assertEqual(limits.max_scrolls, 8)
        self.assertEqual(limits.query_delay_seconds, 1800)
        self.assertEqual(limits.query_jitter_seconds, 120)
        self.assertEqual(limits.max_queries_per_cycle, 1)
        self.assertEqual(limits.max_queries_per_hour, 2)
        self.assertEqual(limits.max_queries_per_day, 8)
        self.assertEqual(limits.max_items_per_query, 25)
        tightened = limits.tightened_by({"maxJobs": 2, "maxBatchItems": 25})
        self.assertEqual(tightened.max_queries_per_cycle, 1)
        self.assertEqual(tightened.max_items_per_query, 25)

    def test_unsafe_limits_are_rejected(self) -> None:
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"queryDelaySeconds": 1799})
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"maxScrolls": 9})
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"maxQueriesPerCycle": 2})
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"maxQueriesPerHour": 3})
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"maxQueriesPerDay": 9})
        with self.assertRaises(ConfigurationError):
            RuntimeLimits.from_mapping({"scrollWaitSeconds": 1})

    def test_config_enforces_exact_loopback_cdp_and_private_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            token = root / "token"
            token.write_text("dedicated-token", encoding="utf-8")
            os.chmod(token, 0o600)
            config_path = root / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "cdpUrl": "http://127.0.0.1:9222",
                        "jobsUrl": "http://127.0.0.1:8080/jobs",
                        "resultsUrl": "http://127.0.0.1:8080/results",
                        "apiTokenFile": "token",
                        "stateDatabase": "state.sqlite3",
                        "lockFile": "worker.lock",
                        "allowInsecureLocalhostApi": True,
                    }
                ),
                encoding="utf-8",
            )
            config = WorkerConfig.from_file(config_path)
            self.assertEqual(config.read_api_token(), "dedicated-token")
            raw = json.loads(config_path.read_text(encoding="utf-8"))
            raw["cdpUrl"] = "http://localhost:9222"
            config_path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                WorkerConfig.from_file(config_path)
            os.chmod(token, 0o644)
            raw["cdpUrl"] = "http://127.0.0.1:9222"
            config_path.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaises(ConfigurationError):
                WorkerConfig.from_file(config_path).read_api_token()


if __name__ == "__main__":
    unittest.main()
