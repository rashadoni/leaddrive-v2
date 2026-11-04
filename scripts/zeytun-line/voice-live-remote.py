"""Runs on prod for voice-stand.ts: one Gemini Live session, driven as the Zeytun station drives it.

The Gemini key lives only on prod: it is read here from /etc/leaddrive/app.env,
never printed, never written; nothing of this process stays on the host (it is
started over ssh from a base64 command line). JSON lines on stdin/stdout:

stdin  {"op": "open", "setup": {...}}            connect, send the station's setup, wait for setupComplete
       {"op": "send", "msg": {...}}              one client message as is (greeting, toolResponse)
       {"op": "speak", "pcm8k": b64, "language": {...}}
                                                 one caller phrase, as the station's core sends it:
                                                 8 kHz PCM16 from the trunk, resampled to 16 kHz with
                                                 audioop.ratecv; the station's VAD confirms speech after
                                                 SPEECH_CONFIRM_S of it, then sends the language note,
                                                 activityStart and the lookback (24 frames = 480 ms) at
                                                 once, the rest in real time, END_SILENCE_S of line
                                                 silence after the last word, then activityEnd
       {"op": "close"}
stdout {"ev": "open"} | {"ev": "server", "t": s, "msg": {...}} | {"ev": "spoke", ...times}
       | {"ev": "drop", "t", "code", "kind", "reason"} | {"ev": "resumed", "t", "attempts"} | {"ev": "dead", "t"}
       | {"ev": "money", "detail"}  (a 402/429/quota refusal: no resume; the stand stops) | {"ev": "error", "detail"}
Every "t" is seconds of this process's monotonic clock since open: latencies are
measured here, next to the provider, not across the ssh link.

A dropped session is resumed as the station does since 2026-11-04 (_pharmacy_resume):
the last sessionResumptionUpdate handle, a new socket every 0.5 s for 3 s; a caller
phrase in progress goes on into the resumed session. No handle, or 3 s gone: "dead".
"""
import audioop
import base64
import json
import os
import socket
import ssl
import struct
import sys
import threading
import time

HOST = "generativelanguage.googleapis.com"
PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key="
FRAME_16K = 640  # 20 ms of 16 kHz PCM16
LOOKBACK_FRAMES = 24  # GEMINI_LIVE_GATED_LOOKBACK_FRAMES: ceil(SILERO_VAD_BARGE_MIN_MS 280 / 20) + 10
SPEECH_CONFIRM_S = 0.28  # SILERO_VAD_BARGE_MIN_MS
END_SILENCE_S = 0.65  # VOICE_END_SILENCE_SECONDS
RESUME_RETRY_S, RESUME_WINDOW_S = 0.5, 3.0  # ZEYTUN_RESUME_RETRY_SECONDS / _WINDOW_SECONDS

T0 = time.monotonic()
out_lock = threading.Lock()


def now():
    return round(time.monotonic() - T0, 3)


def emit(value):
    with out_lock:
        sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def key():
    for line in open("/etc/leaddrive/app.env", encoding="utf-8"):
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")


# A refusal for money or quota: the stand stops at once, no resume, no retry.
MONEY = ("402", "429", "quota", "billing", "exhausted", "credit", "prepay")


def money(text):
    return any(word in (text or "").lower() for word in MONEY)


class Closed(Exception):
    def __init__(self, code, reason=""):
        super().__init__(code)
        self.code = code
        self.reason = reason


class Ws:
    def __init__(self, k):
        raw = socket.create_connection((HOST, 443), timeout=10)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=HOST)
        nonce = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(("GET " + PATH + k + " HTTP/1.1\r\nHost: " + HOST + "\r\nUpgrade: websocket\r\n"
                           "Connection: Upgrade\r\nSec-WebSocket-Key: " + nonce + "\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise EOFError("handshake")
            head += chunk
        status, rest = head.split(b"\r\n\r\n", 1)
        if b" 101 " not in status.split(b"\r\n")[0]:
            raise RuntimeError("handshake status " + status.split(b"\r\n")[0].decode()[:40])
        self.buf = bytearray(rest)
        self.lock = threading.Lock()
        self.sock.settimeout(None)

    def send(self, obj):
        payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
        n = len(payload)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
                                 if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        mask = os.urandom(4)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.lock:
            self.sock.sendall(head + mask + body)

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError("bare")
            self.buf.extend(chunk)
        data = bytes(self.buf[:n])
        del self.buf[:n]
        return data

    def receive(self):
        parts = b""
        while True:
            b1, b2 = self._read(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            data = self._read(n)
            if op == 0x8:
                raise Closed(struct.unpack(">H", data[:2])[0] if len(data) >= 2 else None,
                             data[2:].decode("utf-8", "replace")[:200])
            if op == 0x9:
                with self.lock:
                    m = os.urandom(4)
                    self.sock.sendall(bytes([0x8A, 0x80 | len(data)]) + m + bytes(b ^ m[i % 4] for i, b in enumerate(data)))
                continue
            if op == 0xA:
                continue
            parts += data
            if b1 & 0x80:
                return json.loads(parts)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Session:
    def __init__(self):
        self.key = key()
        self.setup = None
        self.ws = None
        self.handle = None
        self.cv = threading.Condition()
        self.ready = False  # a socket that took the setup is in self.ws
        self.closing = False

    def _connect(self, setup):
        ws = Ws(self.key)
        ws.send(setup)
        while True:
            ev = ws.receive()
            if "setupComplete" in ev:
                return ws
            if ev.get("sessionResumptionUpdate", {}).get("newHandle"):
                self.handle = ev["sessionResumptionUpdate"]["newHandle"]

    def open(self, setup):
        self.setup = setup
        ws = self._connect(setup)
        with self.cv:
            self.ws, self.ready = ws, True
        threading.Thread(target=self._reader, args=(ws,), daemon=True).start()
        emit({"ev": "open", "t": now()})

    def _reader(self, ws):
        try:
            while True:
                ev = ws.receive()
                update = ev.get("sessionResumptionUpdate") or {}
                if update.get("resumable") and update.get("newHandle"):
                    self.handle = update["newHandle"]
                emit({"ev": "server", "t": now(), "msg": ev})
        except Closed as error:
            self._dropped(ws, "close", error.code, error.reason)
        except (EOFError, OSError, ValueError) as error:
            self._dropped(ws, "eof" if isinstance(error, EOFError) else type(error).__name__, None)

    def _dropped(self, ws, kind, code, reason=""):
        with self.cv:
            if self.closing or ws is not self.ws:
                return
            self.ready = False
        emit({"ev": "drop", "t": now(), "kind": kind, "code": code, "reason": reason})
        if money(reason):
            emit({"ev": "money", "t": now(), "detail": "close %s: %s" % (code, reason)})
            return
        started, attempts, errors = time.monotonic(), 0, []
        while self.handle and time.monotonic() - started < RESUME_WINDOW_S:
            attempts += 1
            setup = json.loads(json.dumps(self.setup))
            setup["setup"]["sessionResumption"] = {"handle": self.handle}
            try:
                fresh = self._connect(setup)
            except Closed as error:
                errors.append("close %s" % error.code)
                if money(error.reason):
                    emit({"ev": "money", "t": now(), "detail": "close %s: %s" % (error.code, error.reason)})
                    return
                time.sleep(RESUME_RETRY_S)
                continue
            except Exception as error:
                errors.append(type(error).__name__)
                if money(str(error)):
                    emit({"ev": "money", "t": now(), "detail": str(error)[:200]})
                    return
                time.sleep(RESUME_RETRY_S)
                continue
            with self.cv:
                self.ws, self.ready = fresh, True
                self.cv.notify_all()
            threading.Thread(target=self._reader, args=(fresh,), daemon=True).start()
            emit({"ev": "resumed", "t": now(), "attempts": attempts})
            return
        emit({"ev": "dead", "t": now(), "attempts": attempts, "errors": errors if self.handle else ["no handle"]})

    def send(self, msg):
        """Into the live socket; while a resume is under way, wait for it (the station buffers the same way)."""
        deadline = time.monotonic() + RESUME_WINDOW_S + 1
        while True:
            with self.cv:
                while not self.ready and time.monotonic() < deadline:
                    self.cv.wait(0.05)
                ws = self.ws if self.ready else None
            if ws is None:
                return False
            try:
                ws.send(msg)
                return True
            except OSError:
                time.sleep(0.05)  # the reader sees the drop and resumes

    def speak(self, pcm8k, language):
        pcm16, _ = audioop.ratecv(pcm8k, 2, 1, 8000, 16000, None)
        frames = [pcm16[i:i + FRAME_16K] for i in range(0, len(pcm16) - FRAME_16K + 1, FRAME_16K)]
        silence = [b"\0" * FRAME_16K] * int(END_SILENCE_S / 0.02)
        audio = lambda pcm: {"realtimeInput": {"audio": {"data": base64.b64encode(pcm).decode(), "mimeType": "audio/pcm;rate=16000"}}}
        # The clip starts with LEAD_S of line silence (voice-caller-tts.py): the
        # station confirms the voice SPEECH_CONFIRM_S into it, i.e. once the
        # lookback's 480 ms (lead + 280 ms of voice) have reached it.
        t_voice = time.monotonic()
        time.sleep(LOOKBACK_FRAMES * 0.02)
        t_start = now()
        self.send(language)
        self.send({"realtimeInput": {"activityStart": {}}})
        self.send(audio(b"".join(frames[:LOOKBACK_FRAMES])))
        next_at = time.monotonic()
        for frame in frames[LOOKBACK_FRAMES:]:
            next_at += 0.02
            time.sleep(max(0.0, next_at - time.monotonic()))
            self.send(audio(frame))
        t_speech_end = now()
        for frame in silence:
            next_at += 0.02
            time.sleep(max(0.0, next_at - time.monotonic()))
            self.send(audio(frame))
        self.send({"realtimeInput": {"activityEnd": {}}})
        emit({"ev": "spoke", "t_voice": round(t_voice - T0, 3), "t_start": t_start,
              "t_speech_end": t_speech_end, "t_activity_end": now()})

    def close(self):
        with self.cv:
            self.closing = True
            ws = self.ws
        if ws:
            ws.close()


def main():
    session = Session()
    for line in sys.stdin:
        op = json.loads(line)
        try:
            if op["op"] == "open":
                session.open(op["setup"])
            elif op["op"] == "send":
                session.send(op["msg"])
            elif op["op"] == "speak":
                threading.Thread(target=session.speak, args=(base64.b64decode(op["pcm8k"]), op["language"]),
                                 daemon=True).start()
            elif op["op"] == "close":
                break
        except Exception as error:  # no key, no URL: the class name and a short message only
            detail = type(error).__name__ + ": " + (getattr(error, "reason", "") or str(error))[:200]
            emit({"ev": "money" if money(detail) else "error", "detail": detail})
    session.close()


if __name__ == "__main__":
    main()
