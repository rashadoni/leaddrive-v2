"""The station's whole core on this machine, for line-stand.ts (owner 2026-11-06: «сделай тесты»).

Call 452259a8 lost the caller's first words to the core's own speech gate, and
no stand saw it: the voice stand drives Gemini as the core would, but without
the core. Here the core itself runs, built exactly as the install builds it
(build-zeytun-inbound-core.py over the inspected base core and a station
transport), and answers an AudioSocket call as on the station: its ear (Silero
gate, barge-in, activity markers), its TTS relay (Vertex, the line's Sulafat),
its playout, its bridge and its CRM calls. What is not the station's:

 - the Gemini socket goes through line-stand-relay.py on prod, which adds the
   key there (RealtimeWebSocket is replaced by RelayWebSocket below: same
   methods, the core builds and reads every message itself);
 - every HTTPS request of the core goes through line-stand.ts's proxy
   (HTTPS_PROXY): app.leaddrivecrm.org is answered by the stand's CRM on a
   catalog snapshot and never reaches prod, Vertex passes through;
 - agent.env on the station is root-only, so its values are not copied: the
   tunables below are the core's defaults, which the station's logs show it
   runs with (floor 280, end silence 0.65 s, lookback 24 frames).

  python3 -I scripts/zeytun-line/line-stand-core.py --source <base core> [--builder <build-zeytun-inbound-core.py>]
      [--station <fanum-zeytun-inbound.py>] --port N --vendor <dir with onnxruntime> --silero <silero-vad.onnx>
      --spool <dir> --tts-key <vertex key file> --tts-project <project> --proxy http://127.0.0.1:P --ca-bundle <pem>

stdout: the core's own LD_LATENCY lines, and the runner's: STAND {"ready": port, "policy": "..."}
        | STAND {"usage": {...}} (every usageMetadata) | STAND {"relay": "..."} (socket trouble)
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import time

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--builder", default=str(HERE.parent / "pbx" / "build-zeytun-inbound-core.py"))
parser.add_argument("--station", default=str(HERE.parent / "pbx" / "fanum-zeytun-inbound.py"))
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--vendor", required=True)
parser.add_argument("--silero", required=True)
parser.add_argument("--spool", required=True)
parser.add_argument("--tts-key", required=True)
parser.add_argument("--tts-project", required=True)
parser.add_argument("--proxy", required=True)
parser.add_argument("--ca-bundle", required=True)
parser.add_argument("--live-model", default="gemini-3.8-live")
args = parser.parse_args()

out_lock = threading.Lock()


def stand(value):
    with out_lock:
        sys.stdout.write("STAND " + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


# The station's environment, as far as it is not a secret.
os.environ.update({
    "GEMINI_API_KEY": "line-stand",  # never leaves this machine: the relay drops the path
    "GOOGLE_SPEECH_API_KEY": "line-stand",  # the legacy pipeline's; a Live call never uses it
    "VOICE_ENGINE": "gemini_live",
    "GEMINI_LIVE_MODEL": args.live_model,
    "GEMINI_LIVE_VOICE": "Sulafat",
    "ZEYTUN_INBOUND_PILOT_ENABLED": "1",
    "VOICE_CRM_RUNTIME_URL": "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config",
    "VOICE_CRM_RUNTIME_TOKEN": "line-stand",
    "ZEYTUN_TTS_VERTEX_PROJECT": args.tts_project,
    "ZEYTUN_TTS_VERTEX_KEY": Path(args.tts_key).read_text().strip(),
    "SILERO_VAD_MODEL_PATH": args.silero,
    "ZEYTUN_ORDER_SPOOL_DIR": args.spool,
    "VOICE_LISTEN_HOST": "127.0.0.1",
    "VOICE_LISTEN_PORT": str(args.port),
    "HTTPS_PROXY": args.proxy, "https_proxy": args.proxy, "NO_PROXY": "", "no_proxy": "",
    "SSL_CERT_FILE": args.ca_bundle,
})
sys.path.insert(0, args.vendor)

# Built as the install builds it: the builder's own digest check, the station transport.
builder_spec = importlib.util.spec_from_file_location("zeytun_builder", args.builder)
builder = importlib.util.module_from_spec(builder_spec)
builder_spec.loader.exec_module(builder)
built = builder.build(Path(args.source).read_bytes(), Path(args.station).read_text())
work = Path(tempfile.mkdtemp(prefix="line-stand-core-"))
core_file = work / "fanum-voice-core.py"
core_file.write_bytes(built)
spec = importlib.util.spec_from_file_location("fanum_voice_core", core_file)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

# ---------- the Gemini socket, through prod ----------

prod_key = os.environ.get("LEADDRIVE_PROD_SSH_KEY") or str(Path.home() / ".ssh/leaddrive_prod_2026_09_09")
prod_host = os.environ.get("LEADDRIVE_PROD_HOST") or "root@13.140.132.245"
relay_script = base64.b64encode((HERE / "line-stand-relay.py").read_bytes()).decode()
relay = subprocess.Popen(["ssh", "-o", "BatchMode=yes", "-i", prod_key, prod_host,
                          f"python3 -I -W ignore -c \"$(printf %s '{relay_script}' | base64 -d)\""],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
relay_lock = threading.Lock()
relay_waiting = {}
relay_inbox = {}
ids = iter(range(1, 1 << 30))


def relay_send(value):
    with relay_lock:
        relay.stdin.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        relay.stdin.flush()


def relay_reader():
    for line in relay.stdout:
        event = json.loads(line)
        n = event.get("id")
        if event["ev"] in ("connected", "failed"):
            slot = relay_waiting.pop(n, None)
            if slot:
                slot["event"] = event
                slot["ready"].set()
            if event["ev"] == "failed":
                stand({"relay": "connect_failed", "detail": event.get("detail")})
        elif n in relay_inbox:
            if event["ev"] == "msg" and isinstance(event["msg"], dict) and event["msg"].get("usageMetadata"):
                stand({"usage": event["msg"]["usageMetadata"]})
            if event["ev"] == "closed":
                stand({"relay": "closed", "code": event.get("code"), "money": event.get("money")})
            relay_inbox[n].put(event)
    stand({"relay": "gone"})


def relay_errors():
    for line in relay.stderr:
        sys.stderr.write("[relay] " + line)


threading.Thread(target=relay_reader, daemon=True).start()
threading.Thread(target=relay_errors, daemon=True).start()


# A planned drop (stdin {"drop": true}): every open socket ends as a bare EOF, as Google's
# drops do (2 % of openings, 2026-11-04), and every resume attempt after it is refused with
# 1008, so the core falls back to a fresh session with its context restore: the case in
# which call ac5ccd37 lost the lines it had not saved.
live_sockets = set()
refuse_resume = {"until": 0.0}


class RelayWebSocket:
    """core.RealtimeWebSocket for the Gemini socket: the same calls, carried by the prod relay."""

    def __init__(self, host, path, headers, timeout=10, port=443, cert_sha256="", handshake_deadline=None):
        self.closed = False
        live_sockets.add(self)
        self.socket = None
        self.n = next(ids)
        self.asked_at = time.monotonic()
        self.first_seen = False
        self.inbox = relay_inbox[self.n] = queue.Queue()
        slot = relay_waiting[self.n] = {"ready": threading.Event(), "event": None}
        relay_send({"op": "connect", "id": self.n})
        wait = timeout if handshake_deadline is None else max(0.05, float(handshake_deadline) - time.monotonic())
        if not slot["ready"].wait(wait):
            relay_waiting.pop(self.n, None)
            relay_send({"op": "close", "id": self.n})
            raise TimeoutError("realtime websocket handshake timed out")
        if slot["event"]["ev"] != "connected":
            raise OSError("realtime websocket connect failed")

    def send_frame(self, payload, opcode=0x1):
        if self.closed:
            raise EOFError("realtime websocket closed")
        if opcode == 0x8:
            self.close()
            return
        relay_send({"op": "send", "id": self.n, "msg": json.loads(payload)})

    def send_json(self, event):
        if self.closed:
            raise EOFError("realtime websocket closed")
        resumption = ((event.get("setup") or {}).get("sessionResumption") or {}) if isinstance(event, dict) else {}
        if resumption.get("handle") and time.monotonic() < refuse_resume["until"]:
            self.inbox.put({"ev": "closed", "code": 1008})
            stand({"forced": "resume_refused"})
            return
        relay_send({"op": "send", "id": self.n, "msg": event})

    def drop(self):
        if not self.closed:
            self.inbox.put({"ev": "closed", "code": None})
            relay_send({"op": "close", "id": self.n})

    def receive_message(self, deadline=None):
        if self.closed:
            return None
        wait = core.REALTIME_SOCKET_IDLE_TIMEOUT_SECONDS if deadline is None else max(0.0, float(deadline) - time.monotonic())
        try:
            event = self.inbox.get(timeout=wait)
        except queue.Empty:
            raise socket.timeout("timed out")
        if event["ev"] == "msg":
            if not self.first_seen:
                # How long the provider took to its first message (setupComplete): the core gives a fresh session 2.5 s.
                self.first_seen = True
                stand({"relay": "first_message", "ms": round((time.monotonic() - self.asked_at) * 1000), "keys": sorted(event["msg"])[:3]})
            return event["msg"]
        self.closed = True
        if event.get("code") is None:
            return None  # a bare drop, as the core's own socket reports it
        raise core.RealtimeWebSocketClosed(event["code"], core.websocket_close_category(event["code"]))

    def close(self):
        live_sockets.discard(self)
        if self.closed:
            return
        self.closed = True
        relay_send({"op": "close", "id": self.n})


core.RealtimeWebSocket = RelayWebSocket

# The ssh relay on prod starts in a second or two; the core's early socket of the first call
# must not spend its deadline on that. One socket opened and closed before the listener opens.
try:
    RelayWebSocket("warm", "", {}, timeout=20).close()
except Exception as error:  # the first call will say what is wrong
    stand({"relay": "warm_failed", "detail": type(error).__name__})

# ---------- the AudioSocket listener, as the service starts it ----------

core.silero_session()
if core._silero_state.get("session") is None:
    stand({"error": "silero_unavailable"})
    sys.exit(2)
server = core.Server((core.HOST, core.PORT), core.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
stand({"ready": core.PORT, "policy": core.TECHNICAL_VOICE_POLICY_VERSION, "core": core_file.name})
try:
    for line in sys.stdin:  # the stand ends the core by closing stdin
        command = json.loads(line) if line.strip() else {}
        if command.get("drop"):
            refuse_resume["until"] = time.monotonic() + float(command.get("refuse_resume_s", 10))
            for ws in list(live_sockets):
                ws.drop()
            stand({"forced": "drop"})
finally:
    server.shutdown()
    relay.stdin.close()
    import shutil
    shutil.rmtree(work, ignore_errors=True)  # the built core: not left behind
