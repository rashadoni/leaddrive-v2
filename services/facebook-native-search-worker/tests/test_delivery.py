from __future__ import annotations

import json
import pathlib
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


WORKER_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER_DIR))

from delivery import (  # noqa: E402
    ApiError,
    LeadDriveApi,
    RESULTS_SCHEMA_VERSION,
    TARGET_BINDING_VERSION,
    SearchTarget,
    compute_job_id,
    parse_jobs_response,
)


TARGETS = (
    SearchTarget("scenario-1", "subject-1", "source-1"),
    SearchTarget("scenario-2", "subject-2", "source-2"),
)
QUERY = "Araz supermarket"
JOB_ID = compute_job_id(QUERY, TARGETS)


def job_payload() -> dict[str, object]:
    return {
        "jobId": JOB_ID,
        "targetBindingVersion": TARGET_BINDING_VERSION,
        "targets": [target.as_request() for target in TARGETS],
        "query": QUERY,
    }


class DeliveryTests(unittest.TestCase):
    def test_job_id_matches_server_cross_language_vector(self) -> None:
        targets = (
            SearchTarget("scenario-1", "subject-1", "source-1"),
            SearchTarget("scenario-1", "subject-1", "source-other"),
        )
        self.assertEqual(
            compute_job_id("Lead Drive", targets),
            "fbns_5d553f58c9de296eb3597b0038fe3fb2",
        )

    def test_parse_jobs_requires_schema_and_job_id(self) -> None:
        batch = parse_jobs_response(
            {
                "success": True,
                "data": {
                    "schemaVersion": "facebook-native-search-jobs-v2",
                    "limits": {"maxJobs": 5, "maxBatchItems": 25},
                    "jobs": [job_payload()],
                },
            }
        )
        self.assertEqual(batch.jobs[0].job_id, JOB_ID)
        self.assertEqual(batch.jobs[0].targets, TARGETS)
        self.assertEqual(batch.jobs[0].query, QUERY)
        with self.assertRaises(ApiError):
            parse_jobs_response(
                {
                    "success": True,
                    "data": {"schemaVersion": "wrong", "limits": {}, "jobs": []},
                }
            )

    def test_parse_jobs_rejects_binding_drift_and_unsorted_targets(self) -> None:
        for invalid_job in (
            {**job_payload(), "targetBindingVersion": "wrong"},
            {**job_payload(), "targets": list(reversed(job_payload()["targets"]))},
            {**job_payload(), "jobId": "fbns_" + "b" * 32},
            {
                **job_payload(),
                "jobId": "fbns_d9d85d6fafb0efe4c5cfda0bd3c57985",
                "query": "Araz\0supermarket",
            },
        ):
            with self.subTest(invalid_job=invalid_job):
                with self.assertRaises(ApiError):
                    parse_jobs_response(
                        {
                            "success": True,
                            "data": {
                                "schemaVersion": "facebook-native-search-jobs-v2",
                                "limits": {},
                                "jobs": [invalid_job],
                            },
                        }
                    )

    def test_authenticated_get_and_post(self) -> None:
        observed: dict[str, object] = {}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_GET(self) -> None:
                observed["get_auth"] = self.headers.get("Authorization")
                body = json.dumps(
                    {
                        "success": True,
                        "data": {
                            "schemaVersion": "facebook-native-search-jobs-v2",
                            "limits": {},
                            "jobs": [],
                        },
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                observed["post_auth"] = self.headers.get("Authorization")
                length = int(self.headers.get("Content-Length", "0"))
                observed["payload"] = json.loads(self.rfile.read(length))
                body = b'{"success":true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            api = LeadDriveApi(base + "/jobs", base + "/results", "secret", 5, "test")
            self.assertEqual(api.fetch_jobs().jobs, [])
            payload = {"schemaVersion": RESULTS_SCHEMA_VERSION}
            api.deliver_results(payload)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(observed["get_auth"], "Bearer secret")
        self.assertEqual(observed["post_auth"], "Bearer secret")
        self.assertEqual(observed["payload"], payload)
        self.assertIn("token=<redacted>", repr(api))
        self.assertNotIn("secret", repr(api))

    def test_http_410_is_classified_for_obsolete_binding(self) -> None:
        class GoneHandler(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_POST(self) -> None:
                self.send_response(410)
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", 0), GoneHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            api = LeadDriveApi(
                "http://127.0.0.1/unused",
                f"http://127.0.0.1:{server.server_port}/results",
                "secret",
                5,
                "test",
            )
            with self.assertRaises(ApiError) as context:
                api.deliver_results({"schemaVersion": RESULTS_SCHEMA_VERSION})
            self.assertEqual(context.exception.code, "HTTP_410")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
