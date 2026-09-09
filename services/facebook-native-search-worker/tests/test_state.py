from __future__ import annotations

import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone


WORKER_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from state import (  # noqa: E402
    MAX_DELIVERY_PAYLOAD_BYTES,
    TARGET_BINDING_VERSION,
    WorkerState,
    delivery_payload_size,
)


JOB_ID = "fbns_" + "a" * 32
TARGETS = [
    {
        "scenarioId": "scenario-1",
        "subjectId": "subject-1",
        "sourceId": "source-1",
    },
    {
        "scenarioId": "scenario-2",
        "subjectId": "subject-2",
        "sourceId": "source-2",
    },
]
START = "2026-07-29T21:30:00.000Z"
FINISH = "2026-07-29T21:31:00.000Z"


def begin_run(state: WorkerState, run_id: str, job_id: str = JOB_ID) -> None:
    state.begin_run(
        run_id,
        job_id,
        TARGET_BINDING_VERSION,
        TARGETS,
        "Araz",
        START,
    )


def item() -> dict[str, object]:
    return {
        "kind": "POST",
        "externalId": "facebook:post:123456789",
        "permalink": "https://www.facebook.com/acme/posts/123456789/",
        "authorName": "Acme",
        "authorUrl": "https://www.facebook.com/acme/",
        "text": "A public post",
        "capturedAt": START,
        "audience": {"kind": "PUBLIC", "evidenceLabel": "Public"},
        "evidence": {
            "articleHtmlSha256": "a" * 64,
            "screenshotSha256": None,
            "parserVersion": "facebook-native-dom-v1",
            "discoveredAtScroll": 2,
            "dateRaw": "1 h",
            "datePrecision": "RELATIVE",
            "mediaKinds": [],
            "outboundLinks": [],
        },
    }


class StateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.db = pathlib.Path(self.temp.name) / "state.sqlite3"
        self.state = WorkerState(self.db)

    def tearDown(self) -> None:
        self.state.close()
        self.temp.cleanup()

    def test_v2_state_is_archived_without_deleting_audit_rows(self) -> None:
        legacy_path = pathlib.Path(self.temp.name) / "legacy.sqlite3"
        connection = sqlite3.connect(legacy_path)
        try:
            connection.executescript(
                """
                CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO schema_metadata(key, value) VALUES ('schema_version', '2');
                CREATE TABLE search_runs (
                    run_id TEXT PRIMARY KEY,
                    pending_delivery INTEGER NOT NULL,
                    last_error_code TEXT
                );
                INSERT INTO search_runs(run_id, pending_delivery, last_error_code)
                VALUES ('legacy-run', 1, NULL);
                """
            )
            connection.commit()
        finally:
            connection.close()

        migrated = WorkerState(legacy_path)
        try:
            legacy = migrated.connection.execute(
                """
                SELECT pending_delivery, last_error_code
                FROM search_runs_legacy_v2
                WHERE run_id = 'legacy-run'
                """
            ).fetchone()
            self.assertEqual(
                (legacy["pending_delivery"], legacy["last_error_code"]),
                (0, "STATE_CONTRACT_MIGRATED"),
            )
            begin_run(migrated, "new-run")
            current = migrated.connection.execute(
                "SELECT target_binding_version, targets_json FROM search_runs"
            ).fetchone()
            self.assertEqual(current["target_binding_version"], TARGET_BINDING_VERSION)
            self.assertEqual(current["targets_json"], json.dumps(
                TARGETS,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ))
        finally:
            migrated.close()

    def test_wal_outbox_and_delivery_contract(self) -> None:
        mode = self.state.connection.execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(str(mode).lower(), "wal")
        begin_run(self.state, "run-1")
        new, duplicates = self.state.finalize_run(
            "run-1",
            {
                "articlesObserved": 4,
                "recentPostsVerified": True,
                "stopReason": "maximum_scrolls",
            },
            [item()],
            FINISH,
        )
        self.assertEqual((new, duplicates), (1, 0))
        pending = self.state.pending_deliveries(
            10, datetime(2026, 7, 30, tzinfo=timezone.utc)
        )
        self.assertEqual(len(pending), 1)
        request = pending[0].as_request()
        self.assertEqual(
            set(request),
            {
                "schemaVersion",
                "jobId",
                "runId",
                "startedAt",
                "finishedAt",
                "targetBindingVersion",
                "targets",
                "query",
                "coverage",
                "items",
            },
        )
        self.assertEqual(request["schemaVersion"], "facebook-native-search-results-v2")
        self.assertEqual(request["targetBindingVersion"], TARGET_BINDING_VERSION)
        self.assertEqual(request["targets"], TARGETS)
        self.assertEqual(
            request["coverage"],
            {
                "status": "COMPLETE",
                "searchedResultCount": 4,
                "recentPostsVerified": True,
                "reason": None,
            },
        )
        self.state.mark_delivery_succeeded("run-1", FINISH)
        self.assertEqual(self.state.pending_delivery_count(), 0)

    def test_dedupe_survives_a_new_run(self) -> None:
        for run_id in ("run-1", "run-2"):
            begin_run(self.state, run_id)
            result = self.state.finalize_run(
                run_id,
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [item()],
                FINISH,
            )
            if run_id == "run-1":
                self.assertEqual(result, (1, 0))
                self.state.mark_delivery_succeeded(run_id, FINISH)
            else:
                self.assertEqual(result, (0, 1))
        pending = self.state.pending_deliveries(
            10, datetime(2026, 7, 30, tzinfo=timezone.utc)
        )
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0].items, [])
        self.assertEqual(pending[0].coverage["duplicateItems"], 1)

    def test_failed_delivery_remains_pending_with_backoff(self) -> None:
        begin_run(self.state, "run-1")
        self.state.finalize_run(
            "run-1",
            {
                "articlesObserved": 0,
                "recentPostsVerified": True,
                "stopReason": "maximum_scrolls",
            },
            [],
            FINISH,
        )
        now = datetime(2026, 7, 29, 21, 32, tzinfo=timezone.utc)
        next_attempt = self.state.mark_delivery_failed("run-1", "HTTP_503", now)
        self.assertGreater(next_attempt, now)
        self.assertEqual(self.state.pending_delivery_count(), 1)

    def test_obsolete_binding_is_retired_and_can_be_collected_again(self) -> None:
        begin_run(self.state, "run-obsolete")
        self.state.finalize_run(
            "run-obsolete",
            {
                "articlesObserved": 1,
                "recentPostsVerified": True,
                "stopReason": "maximum_scrolls",
            },
            [item()],
            FINISH,
        )
        self.state.mark_delivery_obsolete(
            "run-obsolete",
            invalidated_at=FINISH,
        )
        row = self.state.connection.execute(
            """
            SELECT status, pending_delivery, last_error_code
            FROM search_runs
            WHERE run_id = 'run-obsolete'
            """
        ).fetchone()
        self.assertEqual(
            (row["status"], row["pending_delivery"], row["last_error_code"]),
            ("abandoned", 0, "HTTP_410"),
        )
        seen = self.state.connection.execute(
            "SELECT invalidated_at FROM seen_items"
        ).fetchone()
        self.assertEqual(seen["invalidated_at"], FINISH)

        begin_run(self.state, "run-rebound")
        self.assertEqual(
            self.state.finalize_run(
                "run-rebound",
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [item()],
                FINISH,
            ),
            (1, 0),
        )

    def test_blocked_run_creates_safe_empty_report(self) -> None:
        begin_run(self.state, "run-1")
        self.state.finalize_blocked_run("run-1", "FACEBOOK_AUTH_REQUIRED")
        request = self.state.pending_deliveries(1)[0].as_request()
        self.assertEqual(request["items"], [])
        self.assertEqual(
            request["coverage"],
            {
                "status": "BLOCKED",
                "searchedResultCount": 0,
                "recentPostsVerified": False,
                "reason": "FACEBOOK_AUTH_REQUIRED",
            },
        )

    def test_interrupted_running_record_is_recovered(self) -> None:
        begin_run(self.state, "run-1")
        self.assertEqual(self.state.recover_abandoned_runs(), 1)
        row = self.state.connection.execute(
            "SELECT status, pending_delivery FROM search_runs WHERE run_id = 'run-1'"
        ).fetchone()
        self.assertEqual((row["status"], row["pending_delivery"]), ("abandoned", 0))

    def test_worst_case_items_are_bounded_before_entering_outbox(self) -> None:
        oversized_items: list[dict[str, object]] = []
        for index in range(25):
            current = item()
            current["externalId"] = f"facebook:post:{100000000 + index}"
            current["permalink"] = (
                f"https://www.facebook.com/acme/posts/{100000000 + index}/"
            )
            current["text"] = "😀" * 12_000
            current["evidence"] = {
                **current["evidence"],
                "outboundLinks": [
                    "https://example.com/"
                    + ("x" * 1990)
                    + f"?item={index}&link={link_index}"
                    for link_index in range(20)
                ],
            }
            oversized_items.append(current)

        begin_run(self.state, "run-budget")
        queued, duplicates = self.state.finalize_run(
            "run-budget",
            {
                "articlesObserved": 25,
                "recentPostsVerified": True,
                "stopReason": "maximum_scrolls",
            },
            oversized_items,
            FINISH,
        )
        self.assertEqual(duplicates, 0)
        self.assertGreater(queued, 0)
        self.assertLess(queued, 25)
        pending = self.state.pending_deliveries(
            1, datetime(2026, 7, 30, tzinfo=timezone.utc)
        )[0]
        request = pending.as_request()
        self.assertLessEqual(
            delivery_payload_size(request),
            MAX_DELIVERY_PAYLOAD_BYTES,
        )
        self.assertEqual(request["coverage"]["status"], "PARTIAL")
        self.assertEqual(
            request["coverage"]["reason"],
            "LOCAL_PAYLOAD_BUDGET_REACHED",
        )
        seen_count = self.state.connection.execute(
            "SELECT COUNT(*) AS count FROM seen_items"
        ).fetchone()["count"]
        self.assertEqual(seen_count, queued)

    def test_semantic_change_is_queued_once_but_capture_noise_is_not(self) -> None:
        first = item()
        begin_run(self.state, "run-1")
        self.assertEqual(
            self.state.finalize_run(
                "run-1",
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [first],
                FINISH,
            ),
            (1, 0),
        )
        self.state.mark_delivery_succeeded("run-1", FINISH)

        noisy = {
            **first,
            "capturedAt": "2026-07-30T21:30:00.000Z",
            "evidence": {
                **first["evidence"],
                "articleHtmlSha256": "b" * 64,
                "discoveredAtScroll": 9,
                "dateRaw": "2 h",
            },
        }
        begin_run(self.state, "run-2")
        self.assertEqual(
            self.state.finalize_run(
                "run-2",
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [noisy],
                FINISH,
            ),
            (0, 1),
        )
        self.state.mark_delivery_succeeded("run-2", FINISH)

        changed = {**noisy, "text": "The post was edited"}
        begin_run(self.state, "run-3")
        self.assertEqual(
            self.state.finalize_run(
                "run-3",
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [changed],
                FINISH,
            ),
            (1, 0),
        )
        update_request = self.state.pending_deliveries(
            1, datetime(2026, 7, 30, tzinfo=timezone.utc)
        )[0].as_request()
        self.assertEqual(update_request["items"][0]["text"], "The post was edited")
        self.state.mark_delivery_succeeded("run-3", FINISH)

        begin_run(self.state, "run-4")
        self.assertEqual(
            self.state.finalize_run(
                "run-4",
                {
                    "articlesObserved": 1,
                    "recentPostsVerified": True,
                    "stopReason": "maximum_scrolls",
                },
                [changed],
                FINISH,
            ),
            (0, 1),
        )


if __name__ == "__main__":
    unittest.main()
