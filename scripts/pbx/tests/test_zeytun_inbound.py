import ast
import importlib.util
import os
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge_module = load("zeytun_bridge", ROOT / "fanum-zeytun-inbound.py")
builder = load("zeytun_builder", ROOT / "build-zeytun-inbound-core.py")
CALL = "aaaaaaaa-1111-4111-8111-111111111111"
URL = "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config"


def result():
    return {"mode": "owner_inbound_preview", "customerVerified": False, "canQuote": False,
            "canSubmitTo1c": False, "canResolveIdentity": False, "requiresOperatorReview": True,
            "candidateCount": 1, "candidates": [{"externalId": CALL, "itemCode": "TEST-1",
                "name": "Medicine 10 mg", "nameAz": None, "identityVerified": False,
                "price": 999, "stock": 999}], "privateCustomer": "not-for-model"}


def event(key="lookup-1", args=None):
    return {"toolCall": {"functionCalls": [{"id": key, "name": "search_pharmacy_catalog",
        "args": args if args is not None else {"text": "Medicine"}}]}}


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.requests, self.sent = [], []
        self.gate = threading.Event()
        self.finished = threading.Event()
        self.block = False
        self.current = True

        def request(body):
            self.requests.append(body)
            if body["action"] == "session":
                return {"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Test rules",
                    "opening": "Test greeting", "maxSeconds": 60}
            if self.block:
                self.gate.wait(2)
            return result()

        self.bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, request, lambda: self.now)
        self.bridge.open()

    def tearDown(self):
        self.gate.set()
        # Wait only for the bounded test workers, never a real network operation.
        until = time.monotonic() + 2
        while self.bridge.pending and time.monotonic() < until:
            time.sleep(0.005)

    def send(self, payload):
        body = payload() if callable(payload) else payload
        if body is not None:
            self.sent.append(body)
        self.finished.set()
        return body is not None

    def handle(self, body):
        return self.bridge.handle(body, self.send, lambda: self.current)

    def test_tools_and_result_are_narrow_and_bounded(self):
        declaration = self.bridge.tools()[0]["functionDeclarations"][0]
        self.assertEqual(declaration["name"], "search_pharmacy_catalog")
        self.assertNotIn("customerGuid", declaration["parameters"]["properties"])
        self.handle(event())
        self.assertTrue(self.finished.wait(2))
        response = self.sent[0]["toolResponse"]["functionResponses"][0]
        self.assertEqual(response["id"], "lookup-1")
        self.assertEqual(response["response"]["candidates"][0]["name"], "Medicine 10 mg")
        self.assertNotIn("999", str(response))
        self.assertNotIn("not-for-model", str(response))
        self.assertEqual(self.requests[-1], {"action": "search", "callId": CALL, "query": {"text": "Medicine"}})

    def test_transcription_pins_azerbaijani_with_order_vocabulary_only(self):
        config = self.bridge.transcription()
        self.assertEqual(set(config), {"languageCodes", "customVocabulary"})
        self.assertEqual(config["languageCodes"], ["az-AZ"])
        vocabulary = config["customVocabulary"]
        self.assertTrue({"qutu", "ədəd", "ampula", "şam", "tablet", "milliqram"} <= set(vocabulary))
        self.assertEqual(len(vocabulary), len(set(vocabulary)))
        self.assertTrue(all(isinstance(word, str) and 0 < len(word) <= 32 for word in vocabulary))
        # A fresh list per session: one call cannot mutate the next call's hint.
        config["customVocabulary"].append("mutated")
        self.assertNotIn("mutated", self.bridge.transcription()["customVocabulary"])

    def test_list_price_passes_only_in_its_exact_shape(self):
        good = {"amount": "1.33", "currency": "AZN", "per": "qutu", "asOf": "2026-10-22T11:14:56.587Z"}
        data = result(); data["candidates"][0]["listPrice"] = dict(good)
        self.assertEqual(self.bridge.safe_result(data)["candidates"][0]["listPrice"], good)
        for bad in [{**good, "amount": "1,33"}, {**good, "amount": "0"}, {**good, "amount": 1.33},
                    {**good, "currency": "USD"}, {**good, "per": "тюб"}, {**good, "asOf": "yesterday"},
                    {**good, "stock": 100}, "1.33", None]:
            data = result(); data["candidates"][0]["listPrice"] = bad
            candidate = self.bridge.safe_result(data)["candidates"][0]
            # A malformed price is dropped, the product itself stays.
            self.assertNotIn("listPrice", candidate, bad)
            self.assertEqual(candidate["itemCode"], "TEST-1")
        self.assertNotIn("listPrice", self.bridge.safe_result(result())["candidates"][0])

    def test_agent_voice_is_pinned_to_azerbaijani(self):
        self.assertEqual(self.bridge.speech_language(), "az-AZ")

    def test_bad_args_never_start_network(self):
        for index, args in enumerate([{}, {"text": "x", "customerGuid": CALL}, {"url": "http://bad.test"},
                {"text": "x" * 241}, {"text": 1}, {"externalId": "bad"}]):
            self.handle(event(str(index), args))
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(len(self.sent), 6)

    def test_cancelled_result_is_dropped_and_cancel_does_not_free_worker_capacity(self):
        self.block = True
        self.handle(event("one")); self.handle(event("two"))
        self.handle({"toolCallCancellation": {"ids": ["one", "two"]}})
        self.handle(event("three"))
        self.assertEqual(self.sent[0]["toolResponse"]["functionResponses"][0]["response"]["status"], "search_busy")
        self.assertEqual(len(self.requests), 3)
        self.gate.set()
        # Both work slots must return before asserting no late result.
        self.assertTrue(self.bridge.workers.acquire(timeout=2))
        self.assertTrue(self.bridge.workers.acquire(timeout=2))
        self.assertEqual(len(self.sent), 1)
        self.bridge.workers.release(); self.bridge.workers.release()

    def test_socket_replacement_hangup_interruption_and_expiry_drop_inflight_result(self):
        for reason in ["socket-or-hangup", "interrupted", "expired"]:
            with self.subTest(reason=reason):
                self.current = True; self.now = 100; self.block = True; self.gate.clear()
                self.handle(event(reason))
                if reason == "socket-or-hangup": self.current = False
                elif reason == "interrupted": self.handle({"serverContent": {"interrupted": True}})
                else: self.now = 1000
                self.gate.set()
                self.assertTrue(self.bridge.workers.acquire(timeout=2))
                self.assertTrue(self.bridge.workers.acquire(timeout=2))
                self.assertEqual(self.sent, [])
                self.bridge.workers.release(); self.bridge.workers.release()

    def test_duplicate_id_never_repeats_search(self):
        self.block = True
        self.handle(event()); self.handle(event())
        self.gate.set(); self.assertTrue(self.finished.wait(2))
        self.handle(event())
        self.assertEqual(len(self.requests), 2)

    def test_only_explicit_disabled_response_allows_normal_fallback(self):
        self.bridge.request = lambda _: {"enabled": False}
        self.assertIsNone(self.bridge.open())
        self.bridge.request = lambda _: {"enabled": False, "error": "pilot_unavailable"}
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable): self.bridge.open()

    def test_answered_spool_delay_uses_one_media_observation_then_reauthorizes(self):
        announced, sessions = [], []
        replies = iter([{"enabled": False, "status": "awaiting_answered"},
            {"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Test rules", "opening": "Test greeting", "maxSeconds": 60}])
        self.bridge.request = lambda body: sessions.append(body) or next(replies)
        self.bridge._post_json = lambda url, body: announced.append((url, body)) or {"success": True}
        self.assertEqual(self.bridge.open()["opening"], "Test greeting")
        self.assertEqual(len(sessions), 2)
        self.assertEqual(len(announced), 1)
        url, body = announced[0]
        self.assertEqual(url, "https://app.leaddrivecrm.org/api/internal/asterisk/call-lifecycle")
        self.assertEqual(body["callId"], CALL)
        self.assertEqual(body["state"], "answered")
        self.assertEqual(set(body), {"eventId", "callId", "state", "occurredAt"})

    def test_failed_answer_ack_and_revocation_never_fall_back_to_aac_or_loop(self):
        pending = {"enabled": False, "status": "awaiting_answered"}
        for after in [pending, {"enabled": False}, {"enabled": False, "error": "pilot_unavailable"}]:
            replies, announced = iter([pending, after]), []
            self.bridge.request = lambda _: next(replies)
            self.bridge.announce_answered = lambda: announced.append(True) or True
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable): self.bridge.open()
            self.assertEqual(len(announced), 1)
        self.bridge.request = lambda _: pending
        self.bridge.announce_answered = lambda: False
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable): self.bridge.open()

    def test_transport_errors_are_masked(self):
        def broken(_): raise ValueError("private password")
        self.bridge.request = broken
        with self.assertRaisesRegex(bridge_module.ZeytunPilotUnavailable, "^pilot_session_unavailable$"):
            self.bridge.open()
        self.handle(event()); self.assertTrue(self.finished.wait(2))
        self.assertNotIn("private password", str(self.sent))

    def test_endpoint_and_redirects_are_fixed(self):
        for url in [URL.replace("https:", "http:"), URL.replace("app.leaddrivecrm.org", "other.example"), URL + "?url=other", URL.replace("runtime-config", "other")]:
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
                bridge_module.ZeytunInboundBridge(url, "t" * 48, CALL)
        self.assertIsNone(bridge_module.ZeytunNoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example"))

    def test_cold_session_deadline_does_not_extend_search_or_answer_ack(self):
        observed = []

        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit):
                observed.append(("read", limit))
                return b'{"success":true}'

        def open_request(request, timeout):
            observed.append(("open", request.full_url, timeout))
            return Response()

        with patch.object(bridge_module.urllib.request, "build_opener", return_value=SimpleNamespace(open=open_request)):
            self.bridge._request({"action": "session", "callId": CALL})
            self.bridge._request({"action": "search", "callId": CALL, "query": {"text": "Medicine"}})
            self.assertTrue(self.bridge._announce_answered())
        self.assertEqual([row[2] for row in observed if row[0] == "open"], [5, 2, 2])
        self.assertEqual([row[1] for row in observed if row[0] == "read"], [32769] * 3)

    def test_missing_identity_or_quote_flags_reject_entire_result(self):
        for field in ["customerVerified", "canQuote", "canSubmitTo1c", "canResolveIdentity", "requiresOperatorReview"]:
            data = result(); del data[field]
            self.assertEqual(self.bridge.safe_result(data)["candidates"], [])


class ArtifactTests(unittest.TestCase):
    def test_unreviewed_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unexpected_live_core_digest"):
            builder.build(b"different runtime", "")

    @unittest.skipUnless(os.environ.get("ZEYTUN_INSPECTED_CORE"), "private inspected core is not available in CI")
    def test_patch_compiles_and_limits_changes_to_intended_gemini_methods(self):
        source = Path(os.environ["ZEYTUN_INSPECTED_CORE"]).read_bytes()
        generated = builder.build(source, (ROOT / "fanum-zeytun-inbound.py").read_text())
        compile(generated, "reviewed-zeytun-core", "exec")
        before, after = ast.parse(source), ast.parse(generated)
        originals = {node.name: node for node in before.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        changed = {node.name: node for node in after.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        for name, node in originals.items():
            if name != "GeminiLiveSession": self.assertEqual(ast.dump(node), ast.dump(changed[name]), name)
        old_methods = {node.name: node for node in originals["GeminiLiveSession"].body if isinstance(node, ast.FunctionDef)}
        new_methods = {node.name: node for node in changed["GeminiLiveSession"].body if isinstance(node, ast.FunctionDef)}
        differences = {name for name in old_methods if ast.dump(old_methods[name]) != ast.dump(new_methods[name])}
        allowed = {"__init__", "start", "_setup_event", "_handle_current_gemini_event",
                   "_fresh_recovery_prompt", "_fresh_recovery_event"}
        # Recovery method names are discovered from the pinned source; assert
        # their changed content is confined to the four neutral-wording checks.
        for name in differences - allowed:
            original = ast.unparse(old_methods[name])
            expected = original.replace("self.is_demo_call", "(self.is_demo_call or self.pharmacy_preview)")
            self.assertEqual(ast.dump(ast.parse(expected).body[0]), ast.dump(new_methods[name]), name)
        self.assertEqual(set(new_methods) - set(old_methods), {"_send_pharmacy_result"})
        start = ast.unparse(new_methods["start"])
        self.assertIn("ZEYTUN_INBOUND_PILOT_ENABLED", start)
        self.assertIn("instruction_for_call()", start)
        self.assertIn("self.pharmacy_preview = True", start)
        self.assertNotIn("self.is_demo_call = True", start)

        # Execute the exact patched setup/send functions, without importing the
        # live core (which starts services and reads real credentials).
        globals_ = {"GEMINI_LIVE_MODEL": "synthetic-test", "GEMINI_LIVE_VOICE": "test",
                    "GEMINI_LIVE_LANGUAGE_CODE": "", "GEMINI_LIVE_PROVIDER_VAD": False}
        functions = ast.Module(body=[new_methods["_setup_event"], new_methods["_send_pharmacy_result"]], type_ignores=[])
        exec(compile(functions, "isolated-core-functions", "exec"), globals_)
        obj = SimpleNamespace(instruction="test", pharmacy_preview=False)
        setup = globals_["_setup_event"](obj)
        self.assertNotIn("tools", setup["setup"])
        # Ordinary AAC calls keep provider language detection untouched.
        self.assertEqual(setup["setup"]["inputAudioTranscription"], {})
        obj.pharmacy_preview = True
        self.assertNotIn("languageCode", setup["setup"]["generationConfig"]["speechConfig"])
        obj.pharmacy_bridge = SimpleNamespace(tools=lambda: ["synthetic-declaration"],
                                              transcription=lambda: {"languageCodes": ["az-AZ"]},
                                              speech_language=lambda: "az-AZ")
        pharmacy = globals_["_setup_event"](obj)["setup"]
        self.assertEqual(pharmacy["tools"], ["synthetic-declaration"])
        self.assertEqual(pharmacy["inputAudioTranscription"], {"languageCodes": ["az-AZ"]})
        self.assertEqual(pharmacy["generationConfig"]["speechConfig"]["languageCode"], "az-AZ")
        # The chosen voice stays the station's own.
        self.assertEqual(pharmacy["generationConfig"]["speechConfig"]["voiceConfig"],
                         setup["setup"]["generationConfig"]["speechConfig"]["voiceConfig"])
        # Every replacement session is built by the same method, so recovery
        # cannot silently fall back to per-turn language detection.
        self.assertEqual(globals_["_setup_event"](obj, "resume-handle")["setup"]["inputAudioTranscription"],
                         {"languageCodes": ["az-AZ"]})
        ws, received = object(), []
        obj.gemini_event_lock = threading.RLock(); obj.state_lock = threading.Lock()
        obj.closed = False; obj.hangup_started = False; obj.ws = ws; obj.gemini_ws_epoch = 2
        obj._send_gemini_event = lambda active_ws, value: received.append(value) or True
        send = globals_["_send_pharmacy_result"]
        self.assertTrue(send(obj, ws, 2, lambda: {"toolResponse": "test"}))
        self.assertFalse(send(obj, ws, 1, {"stale": True}))
        self.assertFalse(send(obj, object(), 2, {"stale": True}))
        obj.hangup_started = True
        self.assertFalse(send(obj, ws, 2, {"late": True}))
        self.assertEqual(received, [{"toolResponse": "test"}])


if __name__ == "__main__":
    unittest.main()
