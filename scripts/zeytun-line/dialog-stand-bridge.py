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

stdin  {"op": "open"} | {"op": "tools", "calls": [...]} | {"op": "note", "content": {...}}
       | {"op": "lang", "text": "..."} | {"reply": n, "value": {...}}
stdout {"crm": n, "body": {...}} | {"done": <result>} | {"error": "..."}
"""
import importlib.util
import json
from pathlib import Path
import queue
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("zeytun_bridge", ROOT / "pbx" / "fanum-zeytun-inbound.py")
station = importlib.util.module_from_spec(spec)
spec.loader.exec_module(station)

URL = "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config"
CALL_ID = "00000000-0000-4000-8000-00000000d1a1"


def declarations():
    """What a line session with transfer and cancel declares (tools() adds BLOCKING for Live only)."""
    bridge = station.ZeytunInboundBridge(URL, "stand", CALL_ID, request=lambda body: {})
    bridge.transfer_phrase, bridge.cancel_phrase = "transfer", "cancel"
    return bridge._declarations()


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
bridge = station.ZeytunInboundBridge(URL, "stand", str(uuid.uuid4()), request=crm)
# The cancel check waits 1.5 s for recognition; the stand's caller has already spoken.
bridge.CANCEL_ANSWER_WAIT_SECONDS = 0.1

while True:
    op = ops.get()
    if op is None:
        break
    try:
        if op["op"] == "open":
            emit({"done": bridge.open()})
        elif op["op"] == "note":
            bridge.note_content(op["content"])
            emit({"done": True})
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
