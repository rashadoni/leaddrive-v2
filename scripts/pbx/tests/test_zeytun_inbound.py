import ast
import base64
import importlib.util
import json
import os
from pathlib import Path
import threading
import time
import unittest
import urllib.error
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
            if body["action"] == "order":
                return self.order_reply
            return result()

        self.order_reply = {"status": "saved", "orderNumber": "TS-1024", "changed": True, "total": "170.40",
                            "currency": "AZN", "notFound": ["fluimusil üç qutu"], "unpriced": [], "pharmacy": "secret"}
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

    def save(self, lines, key="save-1"):
        self.finished.clear()
        self.handle({"toolCall": {"functionCalls": [{"id": key, "name": "save_order_list", "args": {"lines": lines}}]}})
        self.assertTrue(self.finished.wait(2))
        return self.sent[-1]["toolResponse"]["functionResponses"][0]

    def test_save_sends_the_agreed_lines_and_reads_back_only_the_receipt(self):
        names = [d["name"] for d in self.bridge.tools()[0]["functionDeclarations"]]
        self.assertEqual(names, ["search_pharmacy_catalog", "calculate_order_total", "save_order_list"])
        product = "bbbbbbbb-2222-4222-8222-222222222222"
        response = self.save([{"externalId": product.upper(), "quantity": 10.0, "unit": " qutu ", "spoken": "noşpa on qutu"},
                              {"quantity": 3, "unit": "qutu", "spoken": "fluimusil üç qutu"}])
        self.assertEqual(self.requests[-1], {"action": "order", "callId": CALL, "lines": [
            {"quantity": 10, "unit": "qutu", "spoken": "noşpa on qutu", "externalId": product},
            {"quantity": 3, "unit": "qutu", "spoken": "fluimusil üç qutu"}]})
        self.assertEqual(response["name"], "save_order_list")
        self.assertEqual(response["response"], {"status": "saved", "orderNumber": "TS-1024", "total": "170.40",
            "currency": "AZN", "notFound": ["fluimusil üç qutu"], "unpriced": []})

    def test_a_malformed_save_never_reaches_the_crm(self):
        sent = len(self.requests)
        for lines in [[], [{"quantity": 0, "unit": "qutu", "spoken": "x"}], [{"quantity": 1, "unit": "qutu"}],
                      [{"externalId": "not-a-uuid", "quantity": 1, "unit": "qutu", "spoken": "x"}],
                      [{"quantity": 1, "unit": "qutu", "spoken": "x", "price": "1.00"}],
                      [{"quantity": 1, "unit": "qutu", "spoken": "x" * 161}]]:
            response = self.save(lines, key="bad-%d" % len(self.sent))
            self.assertEqual(response["response"]["status"], "not_saved")
        self.assertEqual(len(self.requests), sent)

    def test_save_receipt_of_another_shape_is_not_saved(self):
        for reply in [{"status": "saved", "orderNumber": "1024", "total": "1.00", "notFound": [], "unpriced": []},
                      {"status": "saved", "orderNumber": "TS-1", "total": "1", "notFound": [], "unpriced": []},
                      {"status": "orders_disabled"}, {"error": "pilot_unavailable"}, None]:
            self.order_reply = reply
            self.assertEqual(self.save([{"quantity": 1, "unit": "qutu", "spoken": "x"}], key="r-%d" % len(self.sent))["response"],
                             {"status": "not_saved"})
        self.order_reply = {"status": "already_reviewed", "orderNumber": "TS-7"}
        self.assertEqual(self.save([{"quantity": 1, "unit": "qutu", "spoken": "x"}], key="done")["response"],
                         {"status": "already_reviewed", "orderNumber": "TS-7"})

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

    def total_call(self, lines, key="total-1"):
        return {"toolCall": {"functionCalls": [{"id": key, "name": "calculate_order_total", "args": {"lines": lines}}]}}

    def priced(self, external_id=CALL, amount="1.33", per="qutu"):
        data = result()
        data["candidates"][0]["externalId"] = external_id
        data["candidates"][0]["listPrice"] = {"amount": amount, "currency": "AZN", "per": per,
                                              "asOf": "2026-10-22T11:14:56.587Z"}
        return self.bridge.safe_result(data)

    def test_order_total_is_exact_and_only_from_prices_this_call_returned(self):
        other = "dddddddd-1111-4111-8111-111111111111"
        self.priced(CALL, "1.33", "qutu")
        self.priced(other, "4.54", "ədəd")
        self.assertTrue(self.handle(self.total_call([
            {"externalId": CALL, "quantity": 15, "unit": "qutu"},
            {"externalId": other, "quantity": 30, "unit": "ədəd"},
        ])))
        body = self.sent[-1]["toolResponse"]["functionResponses"][0]
        self.assertEqual(body["name"], "calculate_order_total")
        # 15 x 1.33 + 30 x 4.54 = 19.95 + 136.20, in decimals, not floats.
        self.assertEqual(body["response"]["total"], "156.15")
        self.assertEqual([line["lineTotal"] for line in body["response"]["lines"]], ["19.95", "136.20"])
        self.assertTrue(body["response"]["complete"])
        self.assertEqual(self.requests[-1]["action"], "session")  # no network for a total

    def test_order_total_names_lines_it_cannot_price_instead_of_guessing(self):
        self.priced(CALL, "4.54", "ədəd")
        self.handle(self.total_call([
            {"externalId": CALL, "quantity": 3, "unit": "qutu"},
            {"externalId": "eeeeeeee-1111-4111-8111-111111111111", "quantity": 5, "unit": "qutu"},
        ]))
        response = self.sent[-1]["toolResponse"]["functionResponses"][0]["response"]
        self.assertEqual(response["total"], "0.00")
        self.assertFalse(response["complete"])
        self.assertEqual([item["reason"] for item in response["notIncluded"]],
                         ["unit_differs_from_price_unit", "no_price_in_this_call"])

    def test_order_total_rejects_fractional_or_malformed_lines(self):
        self.priced(CALL)
        for lines in [[{"externalId": CALL, "quantity": 1.5, "unit": "qutu"}],
                      [{"externalId": CALL, "quantity": 0, "unit": "qutu"}],
                      [{"externalId": CALL, "quantity": 2}], []]:
            self.sent.clear()
            self.handle(self.total_call(lines, key=f"bad-{len(self.bridge.seen)}"))
            self.assertEqual(self.sent[-1]["toolResponse"]["functionResponses"][0]["response"], {"status": "invalid_request"})

    def test_closing_sentence_travels_with_the_session_only_when_well_formed(self):
        def bridge_with(closing):
            def request(body):
                return {"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Test rules",
                        "opening": "Test greeting", "maxSeconds": 60, "closing": closing}
            return bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, request, lambda: self.now)
        self.assertEqual(bridge_with("Sağ olun, xoş günlər!").open()["closing"], "Sağ olun, xoş günlər!")
        self.assertIsNone(self.bridge.open()["closing"])  # older CRM: no closing, call still opens
        for bad in [42, "", "x" * 121]:
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
                bridge_with(bad).open()

    def test_agent_voice_is_pinned_to_azerbaijani(self):
        self.assertEqual(self.bridge.speech_language(), "az-AZ")
        self.assertIsNone(self.bridge.speech_voice())

    def test_crm_may_choose_a_known_voice_and_unpin_the_language(self):
        def opened(extra):
            def request(body):
                return {"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Test rules",
                        "opening": "Test greeting", "maxSeconds": 60, **extra}
            bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, request, lambda: self.now)
            bridge.open()
            return bridge
        chosen = opened({"voice": "Kore", "pinSpeechLanguage": False})
        self.assertEqual((chosen.speech_voice(), chosen.speech_language()), ("Kore", None))
        # An unknown voice name never reaches the provider; only an explicit false unpins.
        unknown = opened({"voice": "Kore'); drop", "pinSpeechLanguage": "no"})
        self.assertEqual((unknown.speech_voice(), unknown.speech_language()), (None, "az-AZ"))

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


class FakeTts:
    def __init__(self, fail=None, chunks=2):
        self.texts, self.fail, self.chunks = [], fail, chunks

    def stream(self, text, on_pcm, keep_going):
        self.texts.append(text)
        if self.fail:
            raise self.fail
        for _ in range(self.chunks):
            if not keep_going():
                return
            on_pcm(b"\x01\x00" * 480)


class SpeechRelayTests(unittest.TestCase):
    MODEL_AUDIO = {"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": "AQABAA=="}}

    def setUp(self):
        self.injected, self.speak, self.live = [], True, True
        self.lock = threading.Lock()

    def tearDown(self):
        self.live = False

    def relay(self, tts):
        def inject(event):
            with self.lock:
                self.injected.append(event)
        relay = bridge_module.ZeytunSpeechRelay(tts, inject, lambda: self.speak, lambda: self.live)
        relay.TAIL_GRACE_SECONDS = 0.05
        return relay

    def wait_for(self, predicate, seconds=3):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            with self.lock:
                if predicate(list(self.injected)):
                    return True
            time.sleep(0.01)
        return False

    @staticmethod
    def content(text=None, audio=False, **flags):
        content = dict(flags)
        if audio:
            content["modelTurn"] = {"parts": [dict(SpeechRelayTests.MODEL_AUDIO)]}
        if text is not None:
            content["outputTranscription"] = {"text": text}
        return {"serverContent": content}

    def kinds(self):
        with self.lock:
            events = list(self.injected)
        out = []
        for event in events:
            content = event["serverContent"]
            self.assertTrue(event.get(bridge_module.ZeytunSpeechRelay.MARK))
            if "modelTurn" in content:
                out.append(("audio", content.get("outputTranscription", {}).get("text")))
            for key in ("generationComplete", "turnComplete"):
                if content.get(key):
                    out.append((key, None))
        return out

    def test_model_audio_is_withheld_and_its_text_is_spoken_before_the_held_boundaries(self):
        tts = FakeTts()
        relay = self.relay(tts)
        self.assertTrue(relay.filter(self.content("Salam! Buyurun, ", audio=True)))
        self.assertTrue(relay.filter(self.content("hansı dərmanları sifariş etmək istərdiniz? ", audio=True)))
        event = self.content(generationComplete=True)
        self.assertTrue(relay.filter(event))  # held, nothing reaches the core yet
        self.assertTrue(relay.filter(self.content(turnComplete=True)))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(tts.texts, ["Salam! Buyurun, hansı dərmanları sifariş etmək istərdiniz?"])
        # Two TTS chunks, then the clip's tail silence, then the held boundaries.
        self.assertEqual(self.kinds(), [("audio", "Salam! Buyurun, hansı dərmanları sifariş etmək istərdiniz? "),
                                        ("audio", None), ("audio", None),
                                        ("generationComplete", None), ("turnComplete", None)])
        # The provider's own audio never reached the core.
        self.assertNotIn("AQABAA==", json.dumps(self.injected))

    def test_caller_input_and_other_fields_still_reach_the_core_at_once(self):
        relay = self.relay(FakeTts())
        event = {"serverContent": {"inputTranscription": {"text": "Salam"}}}
        self.assertFalse(relay.filter(event))
        self.assertEqual(event["serverContent"], {"inputTranscription": {"text": "Salam"}})
        self.assertFalse(relay.filter({"sessionResumptionUpdate": {"newHandle": "h"}}))

    def test_synthetic_events_pass_straight_to_the_core(self):
        relay = self.relay(FakeTts())
        event = {"serverContent": {"turnComplete": True}, bridge_module.ZeytunSpeechRelay.MARK: True}
        self.assertFalse(relay.filter(event))
        self.assertNotIn(bridge_module.ZeytunSpeechRelay.MARK, event)

    def test_interrupted_generation_stops_and_its_boundaries_go_out_with_the_interrupt(self):
        tts = FakeTts()
        relay = self.relay(tts)
        relay.TAIL_GRACE_SECONDS = 1.0
        relay.filter(self.content("Bir az gözləyin, kataloqda yoxlayıram, ", audio=True))
        relay.filter(self.content(generationComplete=True))
        event = self.content(interrupted=True)
        self.assertFalse(relay.filter(event))
        self.assertTrue(event["serverContent"].get("generationComplete"))
        time.sleep(0.2)
        self.assertEqual(tts.texts, [])
        with self.lock:
            self.assertEqual(self.injected, [])  # the boundary went out once, with the interrupt

    def test_barge_in_cancels_and_the_rest_of_that_generation_is_dropped(self):
        tts = FakeTts(chunks=1)
        relay = self.relay(tts)
        relay.filter(self.content("Parasetamol beş yüz milliqram Sopharma, on qutu qeyd etdim. ", audio=True))
        self.assertTrue(self.wait_for(lambda events: len(events) >= 1))
        self.speak = False  # the core is discarding: the caller talks over the agent
        relay.filter(self.content("Başqa nə əlavə edək, zəhmət olmasa deyin? ", audio=True))
        time.sleep(0.3)
        self.assertEqual(len(tts.texts), 1)
        self.speak = True
        event = self.content(turnComplete=True)
        self.assertFalse(relay.filter(event))  # the core gets its boundary directly
        self.assertTrue(event["serverContent"].get("turnComplete"))

    def test_tts_failure_before_any_audio_plays_the_model_itself(self):
        relay = self.relay(FakeTts(fail=OSError("down")))
        relay.filter(self.content("Salam! Buyurun, hansı dərmanları sifariş etmək istərdiniz? ", audio=True))
        relay.filter(self.content(turnComplete=True))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        content = self.injected[0]["serverContent"]
        self.assertEqual(content["modelTurn"]["parts"], [self.MODEL_AUDIO])
        self.assertIn("istərdiniz", content["outputTranscription"]["text"])

    def test_a_tts_that_answers_without_audio_falls_back_to_the_model_voice(self):
        # Station call 2026-10-23: no TTS audio and no error meant 16 s of silence.
        class Silent(FakeTts):
            def stream(self, text, on_pcm, keep_going):
                self.texts.append(text)
                raise bridge_module.ZeytunPilotUnavailable("tts_no_audio")
        logs = []
        relay = bridge_module.ZeytunSpeechRelay(Silent(), lambda e: self.injected.append(e), lambda: True,
                                                lambda: self.live, log=lambda status, **f: logs.append((status, f)))
        relay.TAIL_GRACE_SECONDS = 0.05
        relay.filter(self.content("Salam! Buyurun, hansı dərmanları sifariş etmək istərdiniz? ", audio=True))
        relay.filter(self.content(turnComplete=True))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(self.injected[0]["serverContent"]["modelTurn"]["parts"], [self.MODEL_AUDIO])
        self.assertIn(("tts_fallback", {"reason": "tts_no_audio"}), logs)

    def test_a_turn_never_stays_silent_past_the_limit(self):
        # Model audio but no sentence (or a hung TTS): the model is heard.
        relay = self.relay(FakeTts())
        relay.SILENCE_LIMIT_SECONDS = 0.2
        relay.TAIL_GRACE_SECONDS = 5.0
        relay.filter(self.content("Bir az", audio=True))
        self.assertTrue(self.wait_for(lambda events: any("modelTurn" in e["serverContent"] for e in events)))
        self.assertEqual(self.injected[0]["serverContent"]["modelTurn"]["parts"], [self.MODEL_AUDIO])
        # Later audio of that turn now goes straight to the core.
        event = self.content(" gözləyin.", audio=True)
        self.assertFalse(relay.filter(event))
        self.assertIn("modelTurn", event["serverContent"])

    def test_a_turn_is_at_most_two_tts_requests(self):
        # Per-sentence requests hit the station key's rate limit (HTTP 429).
        tts = FakeTts()
        relay = self.relay(tts)
        relay.filter(self.content("Siyahınızda on beş qutu Parasetamol 500 mq Sopharma var. ", audio=True))
        relay.filter(self.content("Qiyməti bir qutu üçün bir manat otuz üç qəpikdir. ", audio=True))
        relay.filter(self.content("Seftriakson otuz ədəd Rotexmedica. Başqa nə əlavə edək?", audio=True))
        relay.filter(self.content(turnComplete=True))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(tts.texts, ["Siyahınızda on beş qutu Parasetamol 500 mq Sopharma var.",
            "Qiyməti bir qutu üçün bir manat otuz üç qəpikdir. Seftriakson otuz ədəd Rotexmedica. Başqa nə əlavə edək?"])

    def test_each_clip_gets_air_before_and_after_and_a_soft_start(self):
        relay = self.relay(FakeTts(chunks=1))
        relay.filter(self.content("Salam! Buyurun, hansı dərmanları sifariş etmək istərdiniz? ", audio=True))
        relay.filter(self.content(turnComplete=True))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        audio = [base64.b64decode(e["serverContent"]["modelTurn"]["parts"][0]["inlineData"]["data"])
                 for e in self.injected if "modelTurn" in e["serverContent"]]
        lead = 2 * 24 * relay.LEAD_SILENCE_MS
        self.assertEqual(audio[0][:lead], b"\x00" * lead)  # air before the voice
        self.assertEqual(audio[0][lead:lead + 2], b"\x00\x00")  # the fade starts from zero
        self.assertEqual(audio[-1], b"\x00" * (2 * 24 * relay.TAIL_SILENCE_MS))  # air after it

    def test_withheld_model_audio_keeps_the_core_watchdog_fed(self):
        # 2026-10-23: after a barge-in the 2 s watchdog saw no line audio and
        # replaced a healthy session twice; model audio proves it is alive.
        fed = []
        relay = bridge_module.ZeytunSpeechRelay(FakeTts(), lambda e: None, lambda: True, lambda: self.live,
                                                progress=lambda: fed.append(time.monotonic()))
        for _ in range(5):
            relay.filter(self.content(audio=True))
        self.assertEqual(len(fed), 1)  # throttled
        relay.progress_at -= relay.PROGRESS_EVERY_SECONDS
        relay.filter(self.content(audio=True))
        self.assertEqual(len(fed), 2)

    def test_a_turn_starting_during_recovery_is_the_model_voice_untouched(self):
        recovering = [True]
        tts = FakeTts()
        relay = bridge_module.ZeytunSpeechRelay(tts, lambda e: self.injected.append(e), lambda: True,
                                                lambda: self.live, recovering=lambda: recovering[0])
        first = self.content("Bağışlayın, son cümləni təkrar edərsiniz?", audio=True)
        self.assertFalse(relay.filter(first))
        self.assertIn("modelTurn", first["serverContent"])
        self.assertIn("outputTranscription", first["serverContent"])
        recovering[0] = False  # the rest of that turn still passes untouched
        rest = self.content(" Eşidirəm.", audio=True, turnComplete=True)
        self.assertFalse(relay.filter(rest))
        self.assertTrue(rest["serverContent"].get("turnComplete"))
        # The next turn is voiced by the TTS again, and nothing is stuck.
        relay.filter(self.content("Növbəti preparat hansıdır, zəhmət olmasa deyin? ", audio=True))
        relay.filter(self.content(turnComplete=True))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(tts.texts, ["Növbəti preparat hansıdır, zəhmət olmasa deyin?"])

    def tts_with_lines(self, lines, error=None):
        class Response(list):
            def __enter__(self): return self
            def __exit__(self, *exc): return False
        def opener(req, timeout):
            self.assertLessEqual(timeout, 4)
            if error:
                raise error
            return Response(lines)
        return bridge_module.ZeytunGeminiTts("k" * 39, "gemini-3.8-flash-tts", "Sulafat", opener=opener)

    def test_tts_refusals_are_failures_with_a_reason_never_silence(self):
        error_line = b"data: " + json.dumps({"error": {"code": 403, "message": "denied"}}).encode() + b"\n"
        cases = [([error_line], None, "tts_stream_error_403"), ([b"data: {}\n"], None, "tts_no_audio"),
                 ([], urllib.error.HTTPError("u", 404, "nf", {}, None), "tts_http_404")]
        for lines, error, reason in cases:
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable) as raised:
                self.tts_with_lines(lines, error).stream("Salam", lambda pcm: None, lambda: True)
            self.assertEqual(str(raised.exception), reason)

    def test_a_transcript_tail_after_turn_complete_belongs_to_that_turn(self):
        tts = FakeTts()
        relay = self.relay(tts)
        relay.TAIL_GRACE_SECONDS = 0.3
        relay.filter(self.content("Siyahınızda on beş qutu Parasetamol", audio=True))
        relay.filter(self.content(turnComplete=True))
        relay.filter(self.content(" var."))
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(tts.texts, ["Siyahınızda on beş qutu Parasetamol var."])

    def test_a_new_socket_drops_what_was_queued_for_the_old_one(self):
        tts = FakeTts()
        relay = self.relay(tts)
        relay.filter(self.content("Köhnə cavab, artıq lazım deyil", audio=True), epoch=1)
        relay.filter(self.content("Yeni sessiya cavabı, zəhmət olmasa təkrar deyin.", audio=True), epoch=2)
        relay.filter(self.content(turnComplete=True), epoch=2)
        self.assertTrue(self.wait_for(lambda events: any(e["serverContent"].get("turnComplete") for e in events)))
        self.assertEqual(tts.texts, ["Yeni sessiya cavabı, zəhmət olmasa təkrar deyin."])

    def test_amounts_are_read_as_manat_and_qepik(self):
        self.assertEqual(bridge_module.zeytun_speakable_text("Qiyməti 1.33 manatdır."), "Qiyməti 1 manat 33 qəpikdir.")
        self.assertEqual(bridge_module.zeytun_speakable_text("Cəmi 264.79 manat."), "Cəmi 264 manat 79 qəpik.")
        self.assertEqual(bridge_module.zeytun_speakable_text("12.5 manat"), "12 manat 50 qəpik")
        self.assertEqual(bridge_module.zeytun_speakable_text("1,3 manatdan"), "1,3 manatdan")

    def test_tts_stream_parses_server_sent_audio_and_stops_when_told(self):
        lines = [b"data: " + json.dumps({"candidates": [{"content": {"parts": [{"inlineData": {
            "mimeType": "audio/L16;codec=pcm;rate=24000", "data": "AQABAA=="}}]}}]}).encode() + b"\n"] * 3

        class Response(list):
            def __enter__(self): return self
            def __exit__(self, *exc): return False
        seen, keep = [], [True]
        tts = bridge_module.ZeytunGeminiTts("k" * 39, "gemini-3.8-flash-tts", "Sulafat",
                                            opener=lambda req, timeout: Response(lines))
        def on_pcm(pcm):
            seen.append(pcm)
            keep[0] = False
        tts.stream("Salam", on_pcm, lambda: keep[0])
        self.assertEqual(seen, [b"\x01\x00\x01\x00"])
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
            bridge_module.ZeytunGeminiTts("k" * 39, "gemini-2.5-pro-preview-tts", "Sulafat")

    def test_session_switches_the_relay_on_only_for_a_known_model_and_voice(self):
        def opened(extra):
            def request(body):
                return {"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Test rules",
                        "opening": "Test greeting", "maxSeconds": 60, **extra}
            bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, request, lambda: 100)
            bridge.open()
            return bridge
        noop = dict(inject=lambda e: None, speakable=lambda: True, alive=lambda: False)
        self.assertIsNone(opened({}).speech_relay("k", **noop))
        self.assertIsNone(opened({"speech": {"engine": "tts", "model": "other", "voice": "Sulafat"}}).speech_relay("k", **noop))
        on = opened({"speech": {"engine": "tts", "model": "gemini-3.8-flash-tts", "voice": "Sulafat"}})
        relay = on.speech_relay("k" * 39, tts=FakeTts(), **noop)
        self.assertIsNotNone(relay)
        self.assertIs(on.speech_relay("k" * 39, **noop), relay)  # one per call


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
        self.assertIn("self.closing_keys = tuple(", start)
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
                                              speech_language=lambda: "az-AZ", speech_voice=lambda: None)
        pharmacy = globals_["_setup_event"](obj)["setup"]
        self.assertEqual(pharmacy["tools"], ["synthetic-declaration"])
        self.assertEqual(pharmacy["inputAudioTranscription"], {"languageCodes": ["az-AZ"]})
        self.assertEqual(pharmacy["generationConfig"]["speechConfig"]["languageCode"], "az-AZ")
        # Without a CRM choice the voice stays the station's own.
        self.assertEqual(pharmacy["generationConfig"]["speechConfig"]["voiceConfig"],
                         setup["setup"]["generationConfig"]["speechConfig"]["voiceConfig"])
        obj.pharmacy_bridge.speech_voice, obj.pharmacy_bridge.speech_language = (lambda: "Kore"), (lambda: None)
        chosen = globals_["_setup_event"](obj)["setup"]["generationConfig"]["speechConfig"]
        self.assertEqual(chosen["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"], "Kore")
        self.assertNotIn("languageCode", chosen)
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
