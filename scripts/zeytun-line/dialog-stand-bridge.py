"""The station's own tool bridge for the dialog stand (dialog-stand.ts).

Loads scripts/pbx/fanum-zeytun-inbound.py as it is and drives one
ZeytunInboundBridge per scenario, so the model hears exactly what the station
would send it: the projected lookup (safe_result), the station's exact total
(order_total), "recorded" for an ordinary save and "saved" only for the final
one (save_order), the cancel check on the caller's answer (note_content). Every
request the bridge makes to the CRM comes back to the stand on stdout and is
answered by the CRM's own handler there; nothing leaves this machine.

  python3 -I scripts/zeytun-line/dialog-stand-bridge.py           (JSON lines on stdin/stdout)
  python3 -I scripts/zeytun-line/dialog-stand-bridge.py --declarations
  ... --station <file>   another station transport instead of scripts/pbx's (a fix on its branch)

stdin  {"op": "open"} | {"op": "tools", "calls": [...]} | {"op": "note", "content": {...}}
       | {"op": "lang", "text": "..."} | {"reply": n, "value": {...}}
       | {"op": "utterance", "first": b64, "rest": b64}   (one caller phrase as the core hands it to the
         bridge: the 8 kHz frame that opened the activity, then every frame to activityEnd)
       | {"op": "live", "core": "<station's base core>", "pilot": <open's answer>, "model": "gemini-3.8-live"}
         (voice-stand.ts: the Live setup, greeting and language note exactly as the station's core
          builds them for this bridge, from the core build-zeytun-inbound-core.py makes of the base)
stdout {"crm": n, "body": {...}} | {"done": <result>} | {"error": "..."}
"""
import ast
import base64
import importlib.util
import json
from pathlib import Path
import queue
import sys
import threading
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parents[1]
STATION = Path(sys.argv[sys.argv.index("--station") + 1]) if "--station" in sys.argv else ROOT / "pbx" / "fanum-zeytun-inbound.py"
spec = importlib.util.spec_from_file_location("zeytun_bridge", STATION)
station = importlib.util.module_from_spec(spec)
spec.loader.exec_module(station)

URL = "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config"
CALL_ID = "00000000-0000-4000-8000-00000000d1a1"


def declarations():
    """What a line session with transfer and cancel declares (tools() adds BLOCKING for Live only)."""
    bridge = station.ZeytunInboundBridge(URL, "stand", CALL_ID, request=lambda body: {})
    bridge.transfer_phrase, bridge.cancel_phrase = "transfer", "cancel"
    return bridge._declarations()


def live_messages(core, pilot, model):
    """The station core's own _setup_event, _greeting_event and _language_turn_event for this bridge.

    The core is the station's (not in Git): build-zeytun-inbound-core.py patches it with
    this station transport, as the install does, and only these functions and the
    policies they read are taken from the result; nothing else of the core runs here.
    """
    builder_spec = importlib.util.spec_from_file_location("zeytun_builder", ROOT / "pbx" / "build-zeytun-inbound-core.py")
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    tree = ast.parse(builder.build(Path(core).read_bytes(), STATION.read_text()).decode())
    policies = {"LIVE_CONVERSATION_POLICY", "VOICE_DELIVERY_POLICY", "EXPLICIT_LANGUAGE_POLICY"}
    scope = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in policies for t in node.targets):
            exec(compile(ast.Module(body=[node], type_ignores=[]), "core", "exec"), scope)
    functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    session = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "GeminiLiveSession")
    methods = {n.name: n for n in session.body if isinstance(n, ast.FunctionDef)}
    # The station's environment: no provider VAD, no language code but the CRM's, the CRM's opening.
    scope.update(GEMINI_LIVE_MODEL=model, GEMINI_LIVE_VOICE="Sulafat", GEMINI_LIVE_LANGUAGE_CODE="",
                 GEMINI_LIVE_PROVIDER_VAD=False, GEMINI_LIVE_OPENING_TEXT="")
    exec(compile(ast.Module(body=[functions["demo_instruction"], methods["_setup_event"], methods["_greeting_event"],
                                  methods["_language_turn_event"]], type_ignores=[]), "core", "exec"), scope)
    live = SimpleNamespace(instruction=scope["demo_instruction"]("", pilot["prompt"]), pharmacy_preview=True,
                           pharmacy_bridge=bridge, is_callback=False, crm_opening_text=pilot["opening"],
                           state_lock=threading.Lock(), last_supported_caller_language="az")
    return {"setup": scope["_setup_event"](live), "greeting": scope["_greeting_event"](live),
            "language": scope["_language_turn_event"](live)}


if "--declarations" in sys.argv:
    print(json.dumps(declarations(), ensure_ascii=False, indent=2))
    sys.exit(0)

out_lock = threading.Lock()


def emit(value):
    with out_lock:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        sys.stdout.flush()


replies, waiting, ops = {}, {}, queue.Queue()
counter = iter(range(1, 1 << 30))
replies_lock = threading.Lock()


def reader():
    for line in sys.stdin:
        message = json.loads(line)
        if "reply" in message:
            with replies_lock:
                replies[message["reply"]] = message.get("value")
                event = waiting.pop(message["reply"], None)
            if event:
                event.set()
        else:
            ops.put(message)
    ops.put(None)


def crm(body):
    """One request of the bridge to the CRM, answered by the stand."""
    with replies_lock:
        number = next(counter)
        event = waiting[number] = threading.Event()
    emit({"crm": number, "body": body})
    if not event.wait(30):
        raise TimeoutError()
    with replies_lock:
        value = replies.pop(number)
    if value is None:
        raise station.ZeytunPilotUnavailable("crm_unavailable")
    return value


threading.Thread(target=reader, daemon=True).start()
# post_utterance: the second ear's phrases go to the stand's CRM too (on only when its session says so).
bridge = station.ZeytunInboundBridge(URL, "stand", str(uuid.uuid4()), request=crm, utterances=True, post_utterance=crm)
# The cancel check waits 1.5 s for recognition; the stand's caller has already spoken.
bridge.CANCEL_ANSWER_WAIT_SECONDS = 0.1

while True:
    op = ops.get()
    if op is None:
        break
    try:
        if op["op"] == "open":
            pilot = bridge.open()
            # standUtterances: whether this bridge now hands the CRM the caller's phrases (the second ear).
            emit({"done": dict(pilot, standUtterances=bridge.utterances) if pilot else pilot})
        elif op["op"] == "note":
            bridge.note_content(op["content"])
            emit({"done": True})
        elif op["op"] == "utterance":
            bridge.utterance_edge(True, base64.b64decode(op["first"]))
            bridge.utterance_audio(base64.b64decode(op["rest"]))
            bridge.utterance_edge(False)
            emit({"done": True})
        elif op["op"] == "live":
            emit({"done": live_messages(op["core"], op["pilot"], op.get("model") or "gemini-3.8-live")})
        elif op["op"] == "lang":
            emit({"done": {"script": station.zeytun_script(op["text"]), "english": station.zeytun_is_english(op["text"])}})
        elif op["op"] == "tools":
            calls = op["calls"]
            got, done = [], threading.Event()

            def send(message):
                value = message() if callable(message) else message
                if value is not None:
                    got.extend(value["toolResponse"]["functionResponses"])
                if len(got) >= len(calls):
                    done.set()

            bridge.handle({"toolCall": {"functionCalls": calls}}, send, lambda: True)
            done.wait(60)
            emit({"done": got})
        else:
            emit({"error": "unknown_op"})
    except Exception as error:  # the stand reports it; the run goes on
        emit({"error": f"{type(error).__name__}: {error}"})
