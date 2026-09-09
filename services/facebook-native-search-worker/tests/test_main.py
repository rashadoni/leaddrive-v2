from __future__ import annotations

import pathlib
import sys
import tempfile
import unittest


WORKER_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from collector import CollectionResult, CollectorError  # noqa: E402
from delivery import ApiError, TARGET_BINDING_VERSION, SearchJob, SearchTarget  # noqa: E402
from main import collect_job, deliver_pending, fair_order_jobs, has_safe_memory  # noqa: E402
from state import WorkerState  # noqa: E402


def job(index: int) -> SearchJob:
    return SearchJob(
        job_id=f"fbns_{index:032x}",
        target_binding_version=TARGET_BINDING_VERSION,
        targets=(
            SearchTarget(
                scenario_id=f"scenario-{index}",
                subject_id=f"subject-{index}",
                source_id=f"source-{index}",
            ),
        ),
        query=f"query {index}",
    )


class MainSafetyTests(unittest.TestCase):
    def test_410_retires_binding_while_409_remains_retryable(self) -> None:
        class FailingApi:
            def __init__(self, code: str) -> None:
                self.code = code

            def deliver_results(self, _payload: object) -> None:
                raise ApiError(self.code)

        for code, expected_result, expected_status, expected_pending in (
            ("HTTP_410", (0, 0), "abandoned", 0),
            ("HTTP_409", (0, 1), "collected", 1),
        ):
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                state = WorkerState(pathlib.Path(directory) / "state.sqlite3")
                try:
                    current = job(1)
                    state.begin_run(
                        "run-1",
                        current.job_id,
                        current.target_binding_version,
                        [target.as_request() for target in current.targets],
                        current.query,
                        "2026-07-29T20:00:00.000Z",
                    )
                    state.finalize_blocked_run(
                        "run-1",
                        "TEST_BLOCK",
                    )
                    self.assertEqual(deliver_pending(state, FailingApi(code), 1), expected_result)
                    row = state.connection.execute(
                        """
                        SELECT status, pending_delivery, last_error_code
                        FROM search_runs
                        WHERE run_id = 'run-1'
                        """
                    ).fetchone()
                    self.assertEqual(row["status"], expected_status)
                    self.assertEqual(row["pending_delivery"], expected_pending)
                    self.assertEqual(row["last_error_code"], code)
                finally:
                    state.close()

    def test_memory_gate_fails_closed_below_four_gib(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            meminfo = pathlib.Path(directory) / "meminfo"
            meminfo.write_text(
                "MemTotal:       16777216 kB\nMemAvailable:  4194303 kB\n",
                encoding="ascii",
            )
            self.assertFalse(has_safe_memory(meminfo))
            meminfo.write_text(
                "MemTotal:       16777216 kB\nMemAvailable:  4194304 kB\n",
                encoding="ascii",
            )
            self.assertTrue(has_safe_memory(meminfo))
            self.assertFalse(has_safe_memory(pathlib.Path(directory) / "missing"))

    def test_fair_order_rotates_beyond_cycle_capacity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = WorkerState(pathlib.Path(directory) / "state.sqlite3")
            try:
                jobs = [job(index) for index in range(12)]
                first_cycle = fair_order_jobs(state, jobs)[:1]
                self.assertEqual([item.query for item in first_cycle], ["query 0"])
                for index, current in enumerate(first_cycle):
                    state.begin_run(
                        f"run-{index}",
                        current.job_id,
                        current.target_binding_version,
                        [target.as_request() for target in current.targets],
                        current.query,
                        f"2026-07-29T20:{index:02d}:00.000Z",
                    )
                    state.finalize_blocked_run(
                        f"run-{index}", "TEST_BLOCK", finished_at="2026-07-29T21:00:00.000Z"
                    )
                second_cycle = fair_order_jobs(state, jobs)[:1]
                self.assertEqual(
                    [item.query for item in second_cycle],
                    ["query 1"],
                )
            finally:
                state.close()

    def test_empty_search_anomaly_is_terminal_and_deliverable(self) -> None:
        class EmptyCollector:
            def collect(self, _query: str) -> CollectionResult:
                return CollectionResult(
                    items=[],
                    coverage={
                        "recentPostsVerified": True,
                        "completedScrolls": 8,
                        "articlesObserved": 0,
                        "acceptedPublicItems": 0,
                        "stopReason": "empty_results_anomaly",
                        "deliveryStatus": "PARTIAL",
                        "deliveryReason": "SEARCH_RESULTS_EMPTY_ANOMALY",
                    },
                )

        with tempfile.TemporaryDirectory() as directory:
            state = WorkerState(pathlib.Path(directory) / "state.sqlite3")
            try:
                completed, terminal = collect_job(state, EmptyCollector(), job(1))
                self.assertTrue(completed)
                self.assertTrue(terminal)
                request = state.pending_deliveries(1)[0].as_request()
                self.assertEqual(request["coverage"]["status"], "PARTIAL")
                self.assertEqual(
                    request["coverage"]["reason"],
                    "SEARCH_RESULTS_EMPTY_ANOMALY",
                )
            finally:
                state.close()

    def test_temporary_block_is_terminal(self) -> None:
        class BlockedCollector:
            def collect(self, _query: str) -> CollectionResult:
                raise CollectorError("FACEBOOK_TEMPORARILY_BLOCKED", fatal=True)

        with tempfile.TemporaryDirectory() as directory:
            state = WorkerState(pathlib.Path(directory) / "state.sqlite3")
            try:
                completed, terminal = collect_job(state, BlockedCollector(), job(1))
                self.assertFalse(completed)
                self.assertTrue(terminal)
                request = state.pending_deliveries(1)[0].as_request()
                self.assertEqual(request["coverage"]["status"], "BLOCKED")
                self.assertEqual(
                    request["coverage"]["reason"],
                    "FACEBOOK_TEMPORARILY_BLOCKED",
                )
            finally:
                state.close()


if __name__ == "__main__":
    unittest.main()
