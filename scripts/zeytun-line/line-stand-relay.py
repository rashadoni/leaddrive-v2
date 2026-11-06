"""Runs on prod for line-stand.ts: the station core's Gemini Live sockets, with the key added here.

The line stand runs the station's whole core on the dev box; only its socket to
Gemini goes through this process, because the Gemini key lives only on prod. It
is read from /etc/leaddrive/app.env, never printed, never written; nothing of
this process stays on the host (started over ssh from a base64 command line).
The core builds every message itself; this process only carries them.

stdin  {"op": "connect", "id": n}        open a socket (the core's RealtimeWebSocket)
       {"op": "send", "id": n, "msg": {...}}
       {"op": "close", "id": n}
stdout {"ev": "connected", "id": n} | {"ev": "failed", "id": n, "detail": "..."}
       | {"ev": "msg", "id": n, "msg": {...}} | {"ev": "closed", "id": n, "code": c, "money": bool}
"""
import base64
import json
import os
import queue
import socket
import ssl
import struct
import sys
import threading

HOST = "generativelanguage.googleapis.com"
PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key="
MONEY = ("402", "429", "quota", "billing", "exhausted", "credit", "prepay")
out_lock = threading.Lock()


def emit(value):
    with out_lock:
        sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def key():
    for line in open("/etc/leaddrive/app.env", encoding="utf-8"):
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")


class Closed(Exception):
    def __init__(self, code, reason=""):
        super().__init__(code)
        self.code, self.reason = code, reason


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
        # XOR as one big integer: the per-byte loop cost ~1 ms a 20 ms audio frame.
        body = (int.from_bytes(payload, "big") ^ int.from_bytes((mask * (n // 4 + 1))[:n], "big")).to_bytes(n, "big") if n else b""
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


sockets = {}
outboxes = {}
the_key = key()


def sender(n, ws, box):
    """One thread per socket: a socket Google stopped reading blocks only itself, never a new connect."""
    while True:
        msg = box.get()
        if msg is None:
            return
        try:
            ws.send(msg)
        except Exception:
            return


def reader(n, ws):
    code, money = None, False
    try:
        while True:
            emit({"ev": "msg", "id": n, "msg": ws.receive()})
    except Closed as closed:
        code, money = closed.code, any(word in (closed.reason or "").lower() for word in MONEY)
    except Exception:  # a bare drop: no close frame
        pass
    sockets.pop(n, None)
    emit({"ev": "closed", "id": n, "code": code, "money": money})


def connect(n):
    # One retry: a TLS hiccup between prod and Google (seen once, SSLError) is the stand's, not the line's.
    for attempt in (1, 2):
        try:
            ws = Ws(the_key)
            break
        except Exception as error:  # the class name only: a message could carry the URL
            if attempt == 2:
                emit({"ev": "failed", "id": n, "detail": type(error).__name__})
                return
    sockets[n] = ws
    box = outboxes[n] = queue.Queue()
    threading.Thread(target=sender, args=(n, ws, box), daemon=True).start()
    emit({"ev": "connected", "id": n})
    threading.Thread(target=reader, args=(n, ws), daemon=True).start()


for line in sys.stdin:
    op = json.loads(line)
    n = op.get("id")
    if op["op"] == "connect":
        threading.Thread(target=connect, args=(n,), daemon=True).start()
    elif op["op"] == "send" and n in outboxes:
        outboxes[n].put(op["msg"])
    elif op["op"] == "close" and n in sockets:
        box = outboxes.pop(n, None)
        if box is not None:
            box.put(None)
        sockets.pop(n).close()
for ws in list(sockets.values()):
    ws.close()
