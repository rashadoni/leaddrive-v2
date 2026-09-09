from __future__ import annotations

import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock
import uuid


ROOT = Path(__file__).resolve().parents[3]
AGI_PATH = ROOT / "scripts" / "pbx" / "fanum-inbound-browser-agi.py"
SPEC = importlib.util.spec_from_file_location("fanum_inbound_browser_agi", AGI_PATH)
assert SPEC and SPEC.loader
agi = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = agi
SPEC.loader.exec_module(agi)

CALL_ID = "d9539247-9f92-4fc5-a926-758535082d04"
CALLER = "+994501234567"
DID = "994125550100"


class FakeClient:
    def __init__(self, *, lifecycle_results=None, ready_results=None):
        self.lifecycle_results = list(lifecycle_results or [agi.SendResult.SENT])
        self.ready_results = list(ready_results or [False])
        self.lifecycle_payloads = []
        self.ready_call_ids = []

    def send_lifecycle(self, payload):
        self.lifecycle_payloads.append(payload)
        if self.lifecycle_results:
            return self.lifecycle_results.pop(0)
        return agi.SendResult.SENT

    def browser_ready(self, call_id):
        self.ready_call_ids.append(call_id)
        if self.ready_results:
            return self.ready_results.pop(0)
        return False


class FakeHttpHandler(BaseHTTPRequestHandler):
    response_mode = "html"
    login_hits = 0

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        if self.path == "/login":
            type(self).login_hits += 1
            self.send_response(200)
            self.send_header("content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"<html>sign in</html>")
            return
        if type(self).response_mode == "preflight":
            if self.path == agi.LIFECYCLE_PATH:
                self.send_response(400)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":"Invalid lifecycle event"}')
                return
            if self.path == agi.READINESS_PATH:
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ready":false}')
                return
        if type(self).response_mode == "redirect":
            self.send_response(307)
            self.send_header("location", "/login")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<html>not lifecycle json</html>")

    def log_message(self, _format, *_arguments):
        return


class InboundBrowserAgiTest(unittest.TestCase):
    def _http_client(self, mode):
        FakeHttpHandler.response_mode = mode
        FakeHttpHandler.login_hits = 0
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeHttpHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        config = agi.RuntimeConfig(
            lifecycle_url=f"http://127.0.0.1:{port}{agi.LIFECYCLE_PATH}",
            readiness_url=f"http://127.0.0.1:{port}{agi.READINESS_PATH}",
            runtime_token="t" * 48,
        )
        return server, agi.HttpLifecycleClient(config)

    def test_parses_only_required_env_values_without_executing_shell_text(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "must-not-exist"
            config_path = Path(temporary) / "coordinator.env"
            config_path.write_text(
                "VOICE_CRM_HUMAN_LIFECYCLE_URL=https://crm.example/api/internal/asterisk/call-lifecycle\n"
                "VOICE_CRM_RUNTIME_TOKEN=runtime-token-with-sufficient-length\n"
                f"UNRELATED=words with spaces; touch {marker}\n",
                encoding="utf-8",
            )

            config = agi.load_runtime_config(config_path)

            self.assertEqual(
                config.lifecycle_url,
                "https://crm.example/api/internal/asterisk/call-lifecycle",
            )
            self.assertEqual(config.runtime_token, "runtime-token-with-sufficient-length")
            self.assertFalse(marker.exists())

    def test_ringing_posts_exact_identity_and_only_returns_a_safe_agi_flag(self):
        client = FakeClient()
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as spool:
            result = agi.run_mode(
                mode="ringing",
                arguments=[CALL_ID, DID],
                agi_variables={"agi_callerid": CALLER, "agi_extension": "s"},
                client=client,
                spool_dir=Path(spool),
                output=output,
            )

        self.assertEqual(result, 0)
        self.assertEqual(output.getvalue(), 'SET VARIABLE FANUM_INBOUND_EVENT_OK "1"\n')
        payload = client.lifecycle_payloads[0]
        self.assertEqual(
            set(payload),
            {"eventId", "callId", "state", "occurredAt", "fromNumber", "toNumber"},
        )
        self.assertEqual(payload["callId"], CALL_ID)
        self.assertEqual(payload["state"], "ringing")
        self.assertEqual(payload["fromNumber"], CALLER)
        self.assertEqual(payload["toNumber"], DID)
        uuid.UUID(payload["eventId"])

    def test_identify_generates_a_canonical_uuid_without_asterisk_func_uuid(self):
        client = FakeClient()
        output = io.StringIO()

        result = agi.run_mode(
            mode="identify",
            arguments=[],
            agi_variables={},
            client=client,
            spool_dir=Path("/unused"),
            output=output,
        )

        self.assertEqual(result, 0)
        prefix = 'SET VARIABLE __FANUM_SAFE_CALL_ID "'
        self.assertTrue(output.getvalue().startswith(prefix))
        call_id = output.getvalue()[len(prefix):-2]
        parsed = uuid.UUID(call_id)
        self.assertEqual(str(parsed), call_id)
        self.assertEqual(parsed.version, 4)
        self.assertEqual(client.lifecycle_payloads, [])
        self.assertEqual(client.ready_call_ids, [])

    def test_main_accepts_identify_as_a_single_agi_argument(self):
        agi_input = io.StringIO("agi_request: inbound-identify\n\n")
        agi_output = io.StringIO()

        with (
            mock.patch.object(agi.sys, "stdin", agi_input),
            mock.patch.object(agi.sys, "stdout", agi_output),
            mock.patch.object(agi, "_client_from_station_config", return_value=FakeClient()),
            mock.patch.object(agi.signal, "signal"),
        ):
            result = agi.main(["identify"])

        self.assertEqual(result, 0)
        self.assertEqual(agi_input.tell(), len(agi_input.getvalue()))
        prefix = 'SET VARIABLE __FANUM_SAFE_CALL_ID "'
        self.assertTrue(agi_output.getvalue().startswith(prefix))
        uuid.UUID(agi_output.getvalue()[len(prefix):-2])

    def test_readiness_waits_for_the_exact_call_and_never_answers_itself(self):
        client = FakeClient(ready_results=[False, False, True])
        output = io.StringIO()
        ticks = iter([0.0, 0.1, 0.2, 0.3])
        sleeps = []

        result = agi.run_mode(
            mode="ready",
            arguments=[CALL_ID],
            agi_variables={},
            client=client,
            spool_dir=Path("/unused"),
            output=output,
            monotonic=lambda: next(ticks),
            sleep=lambda seconds: sleeps.append(seconds),
            ready_timeout_seconds=1.0,
        )

        self.assertEqual(result, 0)
        self.assertEqual(output.getvalue(), 'SET VARIABLE FANUM_BROWSER_READY "1"\n')
        self.assertEqual(client.ready_call_ids, [CALL_ID, CALL_ID, CALL_ID])
        self.assertEqual(sleeps, [agi.READY_POLL_SECONDS, agi.READY_POLL_SECONDS])

    def test_lifecycle_rejects_a_200_html_login_page(self):
        server, client = self._http_client("html")
        try:
            result = client.send_lifecycle(agi._event("answered", CALL_ID))
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(result, agi.SendResult.REJECTED)

    def test_lifecycle_does_not_follow_a_middleware_redirect(self):
        server, client = self._http_client("redirect")
        try:
            result = client.send_lifecycle(agi._event("answered", CALL_ID))
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(result, agi.SendResult.REJECTED)
        self.assertEqual(FakeHttpHandler.login_hits, 0)

    def test_preflight_proves_both_authenticated_routes_without_mutation(self):
        server, client = self._http_client("preflight")
        try:
            result = client.preflight()
        finally:
            server.shutdown()
            server.server_close()

        self.assertTrue(result)

    def test_retryable_ringing_is_spooled_locally_before_the_call_is_rejected(self):
        client = FakeClient(lifecycle_results=[agi.SendResult.RETRY])
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            result = agi.run_mode(
                mode="ringing",
                arguments=[CALL_ID, DID],
                agi_variables={"agi_callerid": CALLER},
                client=client,
                spool_dir=spool,
                output=output,
            )
            queued = list(spool.glob("*.json"))

            self.assertEqual(result, 1)
            self.assertEqual(output.getvalue(), 'SET VARIABLE FANUM_INBOUND_EVENT_OK "0"\n')
            self.assertEqual(len(queued), 1)
            self.assertEqual(oct(queued[0].stat().st_mode & 0o777), "0o600")
            payload = json.loads(queued[0].read_text(encoding="utf-8"))
            self.assertEqual(payload["state"], "ringing")
            self.assertEqual(payload["fromNumber"], CALLER)
            self.assertEqual(payload["toNumber"], DID)
            self.assertNotIn("runtime-token", queued[0].read_text(encoding="utf-8"))

    def test_spool_delivers_ringing_before_its_terminal_missed_call(self):
        failing = FakeClient(lifecycle_results=[agi.SendResult.RETRY])
        succeeding = FakeClient(
            lifecycle_results=[agi.SendResult.SENT, agi.SendResult.SENT],
        )
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            agi.run_mode(
                mode="ringing",
                arguments=[CALL_ID, DID],
                agi_variables={"agi_callerid": CALLER},
                client=failing,
                spool_dir=spool,
                output=io.StringIO(),
            )
            agi.run_mode(
                mode="terminal",
                arguments=[CALL_ID, "no_answer", "0"],
                agi_variables={},
                client=failing,
                spool_dir=spool,
                output=io.StringIO(),
            )

            self.assertEqual(agi.drain_spool(succeeding, spool), (2, 0))
            self.assertEqual(
                [payload["state"] for payload in succeeding.lifecycle_payloads],
                ["ringing", "no_answer"],
            )

    def test_spool_order_does_not_depend_on_wall_clock(self):
        failing = FakeClient(lifecycle_results=[agi.SendResult.RETRY])
        succeeding = FakeClient(
            lifecycle_results=[agi.SendResult.SENT, agi.SendResult.SENT],
        )
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            with mock.patch.object(agi.time, "time_ns", side_effect=[2, 1]):
                agi.run_mode(
                    mode="ringing",
                    arguments=[CALL_ID, DID],
                    agi_variables={"agi_callerid": CALLER},
                    client=failing,
                    spool_dir=spool,
                    output=io.StringIO(),
                )
                agi.run_mode(
                    mode="terminal",
                    arguments=[CALL_ID, "no_answer", "0"],
                    agi_variables={},
                    client=failing,
                    spool_dir=spool,
                    output=io.StringIO(),
                )

            self.assertEqual(agi.drain_spool(succeeding, spool), (2, 0))
            self.assertEqual(
                [payload["state"] for payload in succeeding.lifecycle_payloads],
                ["ringing", "no_answer"],
            )

    def test_spool_entry_is_published_with_one_atomic_replace(self):
        payload = agi._event("answered", CALL_ID)
        real_replace = os.replace
        publications = []

        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)

            def inspect_then_replace(source, destination):
                source_path = Path(source)
                destination_path = Path(destination)
                self.assertEqual(source_path.parent, spool)
                self.assertEqual(destination_path.parent, spool)
                self.assertFalse(source_path.name.endswith(".json"))
                self.assertTrue(destination_path.name.endswith(".json"))
                self.assertFalse(destination_path.exists())
                self.assertEqual(
                    json.loads(source_path.read_text(encoding="utf-8")),
                    payload,
                )
                publications.append((source_path, destination_path))
                real_replace(source_path, destination_path)

            with mock.patch.object(agi.os, "replace", side_effect=inspect_then_replace):
                queued = agi._queue_payload(payload, spool)

            self.assertIsNotNone(queued)
            self.assertEqual(len(publications), 1)
            self.assertEqual(queued, publications[0][1])
            self.assertEqual(list(spool.glob("*.tmp")), [])
            self.assertEqual(json.loads(queued.read_text(encoding="utf-8")), payload)

    def test_terminal_is_spooled_without_network_customer_or_secret_data(self):
        client = FakeClient(lifecycle_results=[agi.SendResult.SENT])
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            result = agi.run_mode(
                mode="terminal",
                arguments=[CALL_ID, "connected", "27"],
                agi_variables={},
                client=client,
                spool_dir=spool,
                output=output,
            )
            queued = list(spool.glob("*.json"))

            self.assertEqual(result, 0)
            self.assertEqual(output.getvalue(), 'SET VARIABLE FANUM_INBOUND_EVENT_OK "1"\n')
            self.assertEqual(client.lifecycle_payloads, [])
            self.assertEqual(len(queued), 1)
            self.assertEqual(oct(queued[0].stat().st_mode & 0o777), "0o600")
            raw = queued[0].read_text(encoding="utf-8")
            self.assertNotIn(CALLER, raw)
            self.assertNotIn("runtime-token", raw)
            payload = json.loads(raw)
            self.assertEqual(payload["callId"], CALL_ID)
            self.assertEqual(payload["state"], "connected")
            self.assertEqual(payload["durationSeconds"], 27)

    def test_spool_drain_retries_the_same_event_id_then_removes_the_file(self):
        local_only = FakeClient(lifecycle_results=[agi.SendResult.REJECTED])
        succeeding = FakeClient(lifecycle_results=[agi.SendResult.SENT])
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            agi.run_mode(
                mode="answered",
                arguments=[CALL_ID],
                agi_variables={},
                client=local_only,
                spool_dir=spool,
                output=io.StringIO(),
            )
            queued = list(spool.glob("*.json"))
            self.assertEqual(len(queued), 1)
            self.assertEqual(local_only.lifecycle_payloads, [])
            original_event_id = json.loads(queued[0].read_text(encoding="utf-8"))["eventId"]

            self.assertEqual(agi.drain_spool(succeeding, spool), (1, 0))
            self.assertEqual(list(spool.glob("*.json")), [])
            self.assertEqual(
                succeeding.lifecycle_payloads[0]["eventId"],
                original_event_id,
            )

    def test_invalid_terminal_is_not_spooled(self):
        client = FakeClient()
        with tempfile.TemporaryDirectory() as temporary:
            spool = Path(temporary)
            result = agi.run_mode(
                mode="terminal",
                arguments=[CALL_ID, "invented_state", "0"],
                agi_variables={},
                client=client,
                spool_dir=spool,
                output=io.StringIO(),
            )

            self.assertEqual(result, 1)
            self.assertEqual(list(spool.glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
