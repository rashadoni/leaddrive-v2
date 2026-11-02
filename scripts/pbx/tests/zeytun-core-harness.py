# Run the station's built voice core against the real Gemini APIs with a fake
# AudioSocket peer instead of Asterisk. CRM calls are stubbed; no phone call,
# no CRM write. Prints the core's LD_LATENCY lines and what the peer heard.
import importlib.util, os, socket, struct, sys, threading, time, uuid, audioop

core_path, seconds = sys.argv[1], float(sys.argv[2])
os.environ.setdefault("GOOGLE_SPEECH_API_KEY", "unused")
os.environ.update({"GEMINI_LIVE_ENABLED": "1", "GEMINI_LIVE_MODEL": "gemini-3.8-live", "GEMINI_LIVE_VOICE": "Sulafat",
                   "ZEYTUN_INBOUND_PILOT_ENABLED": "1", "VOICE_CRM_RUNTIME_URL": "", "VOICE_CRM_RUNTIME_TOKEN": ""})
spec = importlib.util.spec_from_file_location("core", core_path)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

PROMPT = open(sys.argv[3]).read()
OPENING = "Salam! Zeytunun süni intellekt köməkçisiyəm. Bu sınaq zəngində sifariş siyahınızı hazırlayaq. Hansı preparatdan başlayaq?"
USE_TTS = os.environ.get("HARNESS_TTS", "1") == "1"

def fake_open(self):
    self.expires, self.active, self.closing = self.clock() + 300, True, "Sağ olun, xoş günlər!"
    if USE_TTS:
        self.tts_model, self.tts_voice = "gemini-3.8-flash-tts", "Sulafat"
    return {"prompt": PROMPT, "opening": OPENING, "maxSeconds": 120, "closing": "Sağ olun, xoş günlər!"}

core.ZeytunInboundBridge.open = fake_open
core.CRM_RUNTIME_URL = "https://app.leaddrivecrm.org/api/internal/voice-agent/runtime-config"
core.CRM_RUNTIME_TOKEN = "harness-token-not-used"
core.instruction_for_call = lambda call_id=None: core.instruction_with_technical_policies(core.INSTRUCTION, call_id)
core.post_call_result = lambda *args, **kwargs: None
if os.environ.get("HARNESS_BREAK_TTS") == "1":
    original_init = core.ZeytunGeminiTts.__init__
    def broken_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.url = self.url.replace("gemini-3.8-flash-tts", "gemini-no-such-tts")
    core.ZeytunGeminiTts.__init__ = broken_init

peer, line = socket.socketpair()
heard, started = [], time.monotonic()

def reader():
    while True:
        header = core.recv_exact(peer, 3)
        if header is None:
            return
        kind, length = header[0], struct.unpack(">H", header[1:])[0]
        payload = core.recv_exact(peer, length) if length else b""
        if payload is None:
            return
        if kind == 0x10 and payload:
            heard.append((time.monotonic() - started, audioop.rms(payload, 2), payload))

SCRIPT = []
if os.environ.get("HARNESS_SCRIPT"):
    import json as _json
    for at, path in _json.load(open(os.environ["HARNESS_SCRIPT"])):
        SCRIPT.append((float(at), open(path, "rb").read()))

def writer():
    peer.sendall(core.packet(0x01, uuid.uuid4().bytes))
    silence = b"\x00\x00" * 160
    begin = time.monotonic(); end = begin + seconds
    queue_audio = b""
    pending = list(SCRIPT)
    while time.monotonic() < end:
        now = time.monotonic() - begin
        while pending and pending[0][0] <= now:
            queue_audio += pending.pop(0)[1]
            print("HARNESS caller speaks at %.1f" % now, flush=True)
        frame, queue_audio = (queue_audio[:320], queue_audio[320:]) if queue_audio else (silence, b"")
        peer.sendall(core.packet(0x10, frame.ljust(320, b"\x00")))
        time.sleep(0.02)
    peer.sendall(core.packet(0x00))

threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=writer, daemon=True).start()
handler_thread = threading.Thread(target=lambda: core.Handler(line, ("harness", 0), None), daemon=True)
handler_thread.start()
handler_thread.join(seconds + 20)

loud = [(t, r) for t, r, _ in heard if r > 200]
print("HARNESS frames=%d loud=%d first_loud=%s last_loud=%s" % (
    len(heard), len(loud), round(loud[0][0], 2) if loud else None, round(loud[-1][0], 2) if loud else None))
with open(os.environ.get("HARNESS_WAV", "/dev/null"), "wb") as raw:
    raw.write(b"".join(p for _, _, p in heard))
