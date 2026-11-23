"""The phone agent's session on the station bridge (owner, 2026-11-22): which tools a
call has is the CRM's to say, and each call of one goes back to the CRM.

What is tested is what the model would get and what the CRM would be asked — the
bridge driven as the core drives it — not the shape of a function call.
"""
import importlib.util
import io
import json
import threading
import time
import unittest
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge_module = load("zeytun_bridge_agent", ROOT / "fanum-zeytun-inbound.py")
CALL = "bbbbbbbb-2222-4222-8222-222222222222"
URL = "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config"

FIND = {"name": "find_free_times", "description": "Free times of one service on one day.",
        "parameters": {"type": "OBJECT", "properties": {"service": {"type": "STRING", "enum": ["s1", "s2"]},
                                                         "date": {"type": "STRING", "description": "YYYY-MM-DD"}},
                       "required": ["service", "date"]}}
BOOK = {"name": "book_appointment", "description": "Book once the caller gave service, day, time and name.",
        "parameters": {"type": "OBJECT", "properties": {"service": {"type": "STRING", "enum": ["s1", "s2"]},
                                                         "date": {"type": "STRING"}, "time": {"type": "STRING"},
                                                         "name": {"type": "STRING"}},
                       "required": ["service", "date", "time", "name"]}}


def agent_session(**overrides):
    session = {"enabled": True, "variant": "agent_tools", "prompt": "The clinic's rules", "opening": "Klinika, salam!",
               "closing": "Sağ olun, xoş günlər!", "maxSeconds": 600, "voice": None, "pinSpeechLanguage": True,
               "speech": {"engine": "tts", "model": "gemini-3.8-flash-tts", "voice": "Sulafat", "style": "friendly"},
               "vocabulary": ["Stomatoloq müayinəsi"], "tools": [FIND, BOOK]}
    session.update(overrides)
    return session


def tool_call(key, name, args=None):
    return {"toolCall": {"functionCalls": [{"id": key, "name": name, **({} if args is None else {"args": args})}]}}


class AgentBridge(unittest.TestCase):
    session = None

    def setUp(self):
        self.now = 100
        self.requests, self.sent = [], []
        self.gate = threading.Event()
        self.answered = threading.Event()
        self.block = False
        self.tool_reply = {"result": {"status": "booked", "date": "2026-11-23", "weekday": "Monday", "time": "11:00"}}
        self.tool_error = None

        def request(body):
            self.requests.append(body)
            if body["action"] == "session":
                return self.session if self.session is not None else agent_session()
            if self.block:
                self.gate.wait(2)
            if self.tool_error is not None:
                raise self.tool_error
            return self.tool_reply

        self.events = []
        self.bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, request, lambda: self.now)
        self.bridge.log_event = lambda event, **fields: self.events.append((event, fields))

    def tearDown(self):
        self.gate.set()
        until = time.monotonic() + 2
        while self.bridge.pending and time.monotonic() < until:
            time.sleep(0.005)

    def send(self, payload):
        body = payload() if callable(payload) else payload
        if body is not None:
            self.sent.append(body)
        self.answered.set()
        return body is not None

    def handle(self, body):
        return self.bridge.handle(body, self.send, lambda: True)

    def answer(self, index=-1):
        return self.sent[index]["toolResponse"]["functionResponses"][0]

    def tool_requests(self):
        return [body for body in self.requests if body["action"] == "tool"]


class AgentSessionTests(AgentBridge):
    def test_the_call_has_the_tools_the_crm_named_and_none_of_the_pharmacy_s(self):
        pilot = self.bridge.open()
        self.assertEqual(pilot["prompt"], "The clinic's rules")
        self.assertEqual(pilot["closing"], "Sağ olun, xoş günlər!")
        declarations = self.bridge.tools()[0]["functionDeclarations"]
        self.assertEqual([d["name"] for d in declarations], ["find_free_times", "book_appointment"])
        # gemini-3.8-live answers before a tool's result unless the tool is BLOCKING (28 s of silence, 2026-10-30).
        self.assertEqual({d["behavior"] for d in declarations}, {"BLOCKING"})
        self.assertEqual(declarations[0]["parameters"], FIND["parameters"])
        self.assertNotIn("pharmacy", json.dumps(self.bridge.tools()))
        self.assertNotIn("save_order_list", json.dumps(self.bridge.tools()))

    def test_the_recognizer_is_not_hinted_medicine_words_on_a_clinic_s_call(self):
        self.bridge.open()
        hints = self.bridge.transcription()
        self.assertEqual(hints, {"languageCodes": ["az-AZ"], "customVocabulary": ["Stomatoloq müayinəsi"]})
        self.session = agent_session(vocabulary=[])
        other = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, self.bridge.request, lambda: self.now)
        other.open()
        self.assertEqual(other.transcription(), {"languageCodes": ["az-AZ"]})

    def test_the_line_s_voice_speaks_for_the_agent(self):
        self.bridge.open()
        self.assertEqual((self.bridge.tts_model, self.bridge.tts_voice, self.bridge.tts_style),
                         ("gemini-3.8-flash-tts", "Sulafat", "friendly"))
        self.assertEqual(self.bridge.speech_language(), "az-AZ")

    def test_a_session_may_name_no_tool_at_all(self):
        self.session = agent_session(tools=[])
        self.bridge.open()
        self.assertEqual(self.bridge.tools(), [])
        # A tool call the session never declared is refused, not forwarded.
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
            self.handle(tool_call("x-1", "book_appointment", {}))
        self.assertEqual(self.tool_requests(), [])

    def test_the_pharmacy_s_transfer_cancel_and_second_ear_are_not_the_agent_s(self):
        self.session = agent_session(transfer="Sizi menecerə qoşuram, xətdə qalın.", cancel="Sifarişiniz ləğv olundu.", utterance=True)
        pilot = self.bridge.open()
        self.assertIsNone(pilot["transfer"])
        self.assertIsNone(pilot["cancel"])
        self.assertFalse(self.bridge.utterances)
        self.assertEqual([d["name"] for d in self.bridge.tools()[0]["functionDeclarations"]], ["find_free_times", "book_appointment"])

    def test_a_tool_list_the_station_cannot_bound_refuses_the_session(self):
        too_big = dict(FIND, description="x" * 401)
        heavy = dict(FIND, parameters={"type": "OBJECT", "properties": {"a": {"type": "STRING", "description": "y" * 1500}}})
        for tools in (
            "find_free_times",                                     # not a list
            [dict(FIND, name="Find-Times")],                       # a name the model could not be held to
            [FIND, FIND],                                          # the same tool twice
            [dict(FIND, url="https://elsewhere.example/tool")],    # a key the station does not forward
            [dict(FIND, parameters={"type": "STRING"})],
            [too_big], [heavy],
            [dict(FIND, name="tool_%d" % index) for index in range(9)],
        ):
            self.session = agent_session(tools=tools)
            bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, self.bridge.request, lambda: self.now)
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable, msg=repr(tools)[:60]):
                bridge.open()
            self.assertIsNone(bridge.agent_tools)

    def test_a_restored_session_is_not_told_to_save_an_order(self):
        self.bridge.open()
        self.assertEqual(bridge_module.zeytun_restore_note(self.bridge), "")


class AgentToolCallTests(AgentBridge):
    def setUp(self):
        super().setUp()
        self.bridge.open()

    def test_a_tool_call_is_run_by_the_crm_for_this_call_and_its_answer_is_what_the_model_reads(self):
        args = {"service": "s1", "date": "2026-11-23", "time": "11:00", "name": "Elvin Məmmədov"}
        self.assertTrue(self.handle(tool_call("book-1", "book_appointment", args)))
        self.assertTrue(self.answered.wait(2))
        self.assertEqual(self.tool_requests(), [{"action": "tool", "callId": CALL, "name": "book_appointment", "args": args, "id": "book-1"}])
        self.assertEqual(self.answer(), {"id": "book-1", "name": "book_appointment",
                                         "response": {"status": "booked", "date": "2026-11-23", "weekday": "Monday", "time": "11:00"}})
        # The journal names the tool and its status, never the caller's name.
        self.assertIn(("zeytun_agent_tool", {"tool": "book_appointment", "status": "booked"}), self.events)
        self.assertNotIn("Elvin", json.dumps(self.events, ensure_ascii=False))

    def test_the_same_call_id_again_reaches_the_crm_once(self):
        args = {"service": "s1", "date": "2026-11-23", "time": "11:00", "name": "Elvin"}
        self.handle(tool_call("book-1", "book_appointment", args))
        self.assertTrue(self.answered.wait(2))
        self.answered.clear()
        self.handle(tool_call("book-1", "book_appointment", args))
        self.assertTrue(self.answered.wait(2))
        self.assertEqual(len(self.tool_requests()), 1)
        self.assertEqual(self.answer()["response"], {"status": "unavailable", "reason": "duplicate_request"})

    def test_a_tool_of_the_pharmacy_line_is_not_this_call_s(self):
        for name in ("save_order_list", "search_pharmacy_catalog", "cancel_order", "transfer_to_manager"):
            with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
                self.handle(tool_call("p-" + name, name, {"text": "Adefa"}))
        self.assertEqual(self.tool_requests(), [])
        self.assertEqual(self.sent, [])

    def test_a_crm_that_refuses_or_does_not_answer_is_unavailable_never_a_made_up_booking(self):
        failures = (urllib.error.HTTPError(URL, 403, "Forbidden", {}, io.BytesIO(b"{}")), TimeoutError(), ValueError("bad json"))
        for index, error in enumerate(failures):
            self.tool_error = error
            self.answered.clear()
            self.handle(tool_call("fail-%d" % index, "book_appointment", {"service": "s1"}))
            self.assertTrue(self.answered.wait(2))
            self.assertEqual(self.answer()["response"], {"status": "unavailable"})
        self.tool_error = None
        for index, reply in enumerate(({"status": "booked"}, {"result": "booked"}, {"result": {"blob": "z" * 2100}}, None)):
            self.tool_reply = reply
            self.answered.clear()
            self.handle(tool_call("odd-%d" % index, "book_appointment", {"service": "s1"}))
            self.assertTrue(self.answered.wait(2))
            self.assertEqual(self.answer()["response"], {"status": "unavailable"}, repr(reply)[:40])

    def test_arguments_the_station_cannot_bound_never_leave_it(self):
        for index, args in enumerate(("s1", ["s1"], {"name": "x" * 1100})):
            self.answered.clear()
            self.handle(tool_call("big-%d" % index, "book_appointment", args))
            self.assertTrue(self.answered.wait(2))
            self.assertEqual(self.answer()["response"], {"status": "unavailable", "reason": "invalid_request"})
        self.assertEqual(self.tool_requests(), [])
        # No arguments at all is an empty object, as the provider sends it.
        self.answered.clear()
        self.handle(tool_call("none-1", "find_free_times"))
        self.assertTrue(self.answered.wait(2))
        self.assertEqual(self.tool_requests()[-1]["args"], {})

    def test_nothing_is_run_after_the_call_s_ceiling(self):
        self.now = 100 + 600
        self.handle(tool_call("late-1", "book_appointment", {"service": "s1"}))
        self.assertTrue(self.answered.wait(2))
        self.assertEqual(self.answer()["response"], {"status": "unavailable", "reason": "expired"})
        self.assertEqual(self.tool_requests(), [])

    def test_an_answer_that_arrives_after_the_model_cancelled_the_call_is_dropped(self):
        self.block = True
        self.handle(tool_call("slow-1", "book_appointment", {"service": "s1"}))
        self.handle({"toolCallCancellation": {"ids": ["slow-1"]}})
        self.gate.set()
        until = time.monotonic() + 2
        while len(self.tool_requests()) < 1 and time.monotonic() < until:
            time.sleep(0.01)
        time.sleep(0.1)
        self.assertEqual(self.sent, [])

    def test_a_slow_tool_asks_for_the_wait_filler(self):
        waits = []
        self.bridge.on_wait = lambda: waits.append(1)
        self.bridge.FILLER_AFTER_SECONDS = 0.05
        self.block = True
        self.handle(tool_call("slow-2", "book_appointment", {"service": "s1"}))
        until = time.monotonic() + 2
        while not waits and time.monotonic() < until:
            time.sleep(0.01)
        self.assertEqual(waits, [1])
        self.gate.set()
        self.assertTrue(self.answered.wait(2))

    def test_the_call_s_spend_is_counted_for_its_result(self):
        self.handle({"usageMetadata": {"promptTokenCount": 3000, "responseTokenCount": 120, "thoughtsTokenCount": 100,
                                       "promptTokensDetails": [{"modality": "TEXT", "tokenCount": 2700}, {"modality": "AUDIO", "tokenCount": 300}],
                                       "responseTokensDetails": [{"modality": "AUDIO", "tokenCount": 120}]}})
        usage = self.bridge.call_usage()
        self.assertEqual({key: usage["live"][key] for key in ("textIn", "audioIn", "textOut", "audioOut", "turns")},
                         {"textIn": 2700, "audioIn": 300, "textOut": 100, "audioOut": 120, "turns": 1})


class StationCapabilityTests(unittest.TestCase):
    def post(self, body):
        seen = {}

        class Response:
            def __enter__(self): return self
            def __exit__(self, *exc): return False
            def read(self, amount=None): return b'{"enabled": false}'

        def opened(request, timeout):
            seen["headers"] = dict(request.header_items())
            seen["timeout"] = timeout
            seen["body"] = json.loads(request.data)
            return Response()

        original = bridge_module.ZEYTUN_HTTP.open
        bridge_module.ZEYTUN_HTTP.open = opened
        try:
            bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL)
            answer = bridge._request(body)
        finally:
            bridge_module.ZEYTUN_HTTP.open = original
        return seen, answer

    def test_every_request_tells_the_crm_this_station_runs_crm_named_tools(self):
        seen, answer = self.post({"action": "session", "callId": CALL})
        self.assertEqual({key.lower(): value for key, value in seen["headers"].items()}["x-voice-agent-caps"], "tools-1, live-token-1")
        # The body is the one the CRM's strict schema already takes: nothing new in it.
        self.assertEqual(seen["body"], {"action": "session", "callId": CALL})
        self.assertEqual(answer, {"enabled": False})

    def test_a_booking_gets_the_time_a_calendar_check_needs(self):
        seen, _ = self.post({"action": "tool", "callId": CALL, "name": "book_appointment", "args": {}, "id": "k"})
        self.assertEqual(seen["timeout"], 9)
        seen, _ = self.post({"action": "search", "callId": CALL, "query": {"text": "Adefa"}})
        self.assertEqual(seen["timeout"], 4)


class PharmacySessionUnchangedTests(unittest.TestCase):
    """The line's own session beside the agent's: same bridge, nothing of the agent in it."""

    def open(self, session):
        bridge = bridge_module.ZeytunInboundBridge(URL, "t" * 48, CALL, lambda body: session, lambda: 100)
        return bridge, bridge.open()

    def test_the_line_keeps_its_five_tools_its_hints_and_its_restore_rule(self):
        bridge, pilot = self.open({"enabled": True, "variant": "pharmacy_inbound_preview", "prompt": "Line rules",
                                   "opening": "Salam", "maxSeconds": 900, "transfer": "Sizi menecerə qoşuram, xətdə qalın.",
                                   "cancel": "Sifarişiniz ləğv olundu.", "tools": [FIND]})
        self.assertIsNone(bridge.agent_tools)
        self.assertEqual([d["name"] for d in bridge.tools()[0]["functionDeclarations"]],
                         ["search_pharmacy_catalog", "calculate_order_total", "save_order_list", "transfer_to_manager", "cancel_order"])
        self.assertEqual(pilot["transfer"], "Sizi menecerə qoşuram, xətdə qalın.")
        self.assertIn("qutu", bridge.transcription()["customVocabulary"])
        self.assertIn("save_order_list", bridge_module.zeytun_restore_note(bridge))
        # A tool the CRM's line session happened to list is not the line's: the model is held to the five.
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
            bridge.handle(tool_call("x", "find_free_times", {}), lambda payload: True, lambda: True)

    def test_an_unknown_variant_is_still_refused(self):
        with self.assertRaises(bridge_module.ZeytunPilotUnavailable):
            self.open({"enabled": True, "variant": "something_else", "prompt": "x", "opening": "y", "maxSeconds": 60})


if __name__ == "__main__":
    unittest.main()
