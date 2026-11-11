"""Bounded Gemini tool transport for one owner-authorized inbound rehearsal.

Embedded into a hash-pinned voice core by build-zeytun-inbound-core.py. No
credential/catalog logging; no 1C calls; every lookup reauthorizes at the CRM.
Protocol: https://ai.google.dev/api/live and /gemini-api/docs/live-api/tools.
"""
import array
import audioop
import base64
import collections
from decimal import Decimal
import http.client
import io
import json
import math
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ZeytunPilotUnavailable(Exception):
    pass


class ZeytunNoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ZeytunKeptResponse:
    """One answer on a kept connection: lines or bytes; the connection goes
    back to the pool only once the answer was read to its end."""

    def __init__(self, pool, key, conn, response):
        self.pool, self.key, self.conn, self.response = pool, key, conn, response
        self.status = response.status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def __iter__(self):
        while True:
            line = self.response.readline()
            if not line:
                return
            yield line

    def read(self, amount=None):
        return self.response.read(amount)

    def settimeout(self, seconds):
        """The socket's read timeout from now on (the TTS waits less for its first audio)."""
        sock = self.conn.sock if self.conn is not None else None
        if sock is not None:
            sock.settimeout(seconds)

    def close(self):
        conn, self.conn = self.conn, None
        if conn is None:
            return
        if self.response.isclosed() and not self.response.will_close:
            self.pool.give(self.key, conn)
        else:
            # Unread bytes would become the next answer's start.
            self.response.close()
            conn.close()


class ZeytunKeepAlive:
    """HTTPS to the TTS and the CRM over kept connections.

    Measured from the station 2026-11-04: a new connection costs 0.2-0.3 s
    (TCP and TLS from Baku; up to 0.5 s to the CRM), and the line opened one
    for every TTS clip, lookup and save (urllib does not keep them). Here a
    connection is taken from the pool, used by one request at a time and put
    back once its answer was read to the end. One idle longer than
    IDLE_SECONDS is closed rather than trusted. A kept connection the peer has
    closed fails at once; that request is sent again on a new one, never one
    that timed out. Behind a proxy, or for another scheme, it is plain urllib
    as before. Refusals are urllib's HTTPError, network failures URLError, as
    callers already expect.
    """
    IDLE_SECONDS = 50.0
    MAX_IDLE = 4

    def __init__(self, clock=time.monotonic, connect=None, proxies=None):
        self.clock = clock
        self.connect = connect or self._connect
        self.proxies = proxies or urllib.request.getproxies
        self.lock = threading.Lock()
        self.idle = {}

    @staticmethod
    def _connect(scheme, host, port, timeout):
        if scheme == "https":
            return http.client.HTTPSConnection(host, port, timeout=timeout, context=ssl.create_default_context())
        return http.client.HTTPConnection(host, port, timeout=timeout)

    def take(self, key):
        with self.lock:
            pool = self.idle.get(key) or []
            now = self.clock()
            while pool:
                conn, since = pool.pop()
                if now - since < self.IDLE_SECONDS:
                    return conn
                conn.close()
        return None

    def give(self, key, conn):
        with self.lock:
            pool = self.idle.setdefault(key, [])
            if len(pool) < self.MAX_IDLE:
                pool.append((conn, self.clock()))
                return
        conn.close()

    def keeps(self, url):
        """True when url goes over a kept connection (not behind a proxy)."""
        return self._key(url)[0] is not None

    def _key(self, url):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname or self.proxies().get(parts.scheme):
            return None, None
        path = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        return (parts.scheme, parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)), path

    def warm(self, url, timeout=4):
        """Open a connection ahead of the first request, in the background."""
        key, _ = self._key(url)
        if key is None:
            return False

        def connect():
            try:
                conn = self.connect(key[0], key[1], key[2], timeout)
                conn.connect()
            except Exception:
                return
            self.give(key, conn)
        threading.Thread(target=connect, name="zeytun-http-warm", daemon=True).start()
        return True

    def open(self, req, timeout):
        url = req.full_url
        key, path = self._key(url)
        if key is None:
            return urllib.request.build_opener(ZeytunNoRedirect()).open(req, timeout=timeout)
        headers = dict(req.header_items())
        while True:
            conn = self.take(key)
            kept = conn is not None
            if conn is None:
                conn = self.connect(key[0], key[1], key[2], timeout)
            conn.timeout = timeout
            if conn.sock is not None:
                conn.sock.settimeout(timeout)
            try:
                conn.request(req.get_method(), path, body=req.data, headers=headers)
                response = conn.getresponse()
            except Exception as error:
                conn.close()
                if kept and isinstance(error, (http.client.HTTPException, OSError)) and not isinstance(error, TimeoutError):
                    continue  # the peer closed an idle connection: once more on a new one
                if isinstance(error, (http.client.HTTPException, OSError)):
                    raise urllib.error.URLError(error) from None
                raise
            break
        if not 200 <= response.status < 300:
            try:
                body = response.read(65536)
            except Exception:
                body = b""
            conn.close()
            raise urllib.error.HTTPError(url, response.status, response.reason, response.msg, io.BytesIO(body))
        return ZeytunKeptResponse(self, key, conn, response)


# One pool for the process: the TTS and the CRM, every call.
ZEYTUN_HTTP = ZeytunKeepAlive()


ZEYTUN_ONES = ("", "bir", "iki", "üç", "dörd", "beş", "altı", "yeddi", "səkkiz", "doqquz")
ZEYTUN_TENS = ("", "on", "iyirmi", "otuz", "qırx", "əlli", "altmış", "yetmiş", "səksən", "doxsan")


def zeytun_number_words(number):
    """A whole number below a million in Azerbaijani words: 115 is "yüz on beş", 2000 "iki min"."""
    if number == 0:
        return "sıfır"

    def below_thousand(n):
        hundreds, rest = divmod(n, 100)
        words = ([] if hundreds == 0 else ["yüz"] if hundreds == 1 else [ZEYTUN_ONES[hundreds], "yüz"])
        tens, ones = divmod(rest, 10)
        return words + [w for w in (ZEYTUN_TENS[tens], ZEYTUN_ONES[ones]) if w]
    thousands, rest = divmod(number, 1000)
    words = ([] if thousands == 0 else ["min"] if thousands == 1 else below_thousand(thousands) + ["min"])
    return " ".join(words + below_thousand(rest))


def zeytun_speakable_text(text):
    """What the TTS reads: "1.33 manatdır" as "1 manat 33 qəpikdir".

    The Live model says amounts in words but its transcript writes digits,
    and the TTS reads that transcript. Only the predicate suffix is carried
    over; any other suffix keeps the amount as it was written.
    """
    def money(match):
        whole, cents, suffix = match.group(1), match.group(2), match.group(3)
        cents = cents if len(cents) == 2 else cents + "0"
        if suffix and not re.fullmatch(r"d[ıiuü]r", suffix):
            return match.group(0)
        if cents == "00":
            return whole + " manat" + suffix
        return whole + " manat " + str(int(cents)) + " qəpik" + ("dir" if suffix else "")
    text = re.sub(r"\b(\d+)[.,](\d{1,2})\s*(?:manat|AZN)(\w*)", money, text)
    # Owner's call 2026-11-03: «переходит на английский». "Ketonal geli 10
    # qutu." has no Azerbaijani letter, and the TTS voiced it as English ("ten").
    # Whole numbers, "№", mq and ml are written out in Azerbaijani words; a
    # suffix after a hyphen joins its word ("5-dən" is "beşdən"). A decimal
    # (2,5%) and an ordinal are left as written.
    text = re.sub(r"№\s*", "nömrə ", text)
    # Owner's queue 2026-11-06, task 8: the order number "TS-1026" was voiced
    # "TS-min iyirmi altı", the Latin letters as the TTS liked. The letters are
    # named as the owner says them (2026-11-07: «правильно звучание Te eS»): "Te-eS min iyirmi altı".
    text = re.sub(r"\bTS-(?=\d)", "Te-eS ", text)
    text = re.sub(r"(?<=\d)\s*(mq|ml)\b|\b(mq|ml)\b",
                  lambda m: (" " if m.group(1) else "") + ("milliqram" if (m.group(1) or m.group(2)).lower() == "mq" else "millilitr"),
                  text, flags=re.IGNORECASE)
    # An ordinal ("2025-ci", "3-cü") changes the word itself: left as written.
    text = re.sub(r"(?<![\d.,])(\d{1,6})(?:-(\w+))?(?![\d]|[.,]\d)",
                  lambda m: m.group(0) if m.group(2) and re.fullmatch(r"[iıuü]?n?c[iıuü]", m.group(2).lower())
                  else zeytun_number_words(int(m.group(1))) + (m.group(2) or ""), text)
    # Owner, 2026-10-30, of the sample with a breath and a "Hmm…" («C»): the
    # 3.8 TTS voices these angle-bracket events instead of reading them.
    text = re.sub(r"^Salam!\s+", "Salam! <breath> ", text)
    return re.sub(r"^(?:Hmm+|Hım+|Hm+)[.,…]*\s+", "Hmm... <short pause> ", text, flags=re.IGNORECASE)


def _zeytun_phone_band_taps(count=63, cutoff=3500.0, rate=24000.0):
    """Hamming-windowed sinc low-pass, unity gain at 0 Hz."""
    fc, mid = cutoff / rate, (count - 1) / 2
    taps = [(2 * fc if i == mid else math.sin(2 * math.pi * fc * (i - mid)) / (math.pi * (i - mid)))
            * (0.54 - 0.46 * math.cos(2 * math.pi * i / (count - 1))) for i in range(count)]
    total = sum(taps)
    return tuple(tap / total for tap in taps)


ZEYTUN_PHONE_BAND_TAPS = _zeytun_phone_band_taps()


def zeytun_phone_band(pcm24, state):
    """24 kHz PCM16 -> 8 kHz PCM16 for the phone, filtered first.

    Owner, 2026-11-04, of the Vertex sample: the file converted with ffmpeg was
    the best, the line sounded hoarse. The core went 24 -> 8 kHz with
    audioop.ratecv, which does not filter: a third of the voice's energy lies
    above 4 kHz (35 % on the line's greeting) and folded back into the phone
    band. The low-pass is the one in the sample the owner chose («2c»): 63
    taps, 3.5 kHz, then every third sample. Computed with audioop over whole
    chunks, so the CPU stays in C. state carries the last 62 input samples and
    the decimation phase across chunks; None starts fresh, as ratecv's did.
    """
    taps = ZEYTUN_PHONE_BAND_TAPS
    keep = 2 * (len(taps) - 1)
    # Anything else (None, a ratecv state from before the call became a
    # pharmacy call) starts fresh.
    fresh = not (isinstance(state, tuple) and len(state) == 2 and isinstance(state[0], bytes)
                 and len(state[0]) == keep and state[1] in (0, 1, 2))
    tail, phase = (b"\x00" * keep, 0) if fresh else state
    count = len(pcm24) // 2
    if not count:
        return b"", (tail, phase)
    buffer = tail + pcm24[:2 * count]
    # sample << 8 in 32 bits: headroom for the sum, precision for the products.
    wide = audioop.mul(audioop.lin2lin(buffer, 2, 4), 4, 1 / 256)
    total = None
    for index, tap in enumerate(taps):
        term = audioop.mul(wide[4 * index:4 * (index + count)], 4, tap)
        total = term if total is None else audioop.add(total, term, 4)
    filtered = array.array("h", audioop.lin2lin(audioop.mul(total, 4, 256), 4, 2))
    return filtered[phase::3].tobytes(), (buffer[-keep:], (phase - count) % 3)


class ZeytunGeminiTts:
    """Streaming gemini TTS for one call: plain text in, PCM16 24 kHz out.

    Plain text only - an instruction in the text is read aloud (measured
    2026-10-23: the style prefix became the first 3.5 s of the sample). The
    delivery goes in the part's speechMetadata.style instead (3.8 TTS; owner,
    2026-10-30, chose that sample: «C»); a request it refuses (400) is sent
    once more without it, and the call keeps the plain delivery.

    Two paths to the same model and voice (task 9, owner 2026-11-04 of the
    Vertex sample: «Тот же, переключай»): the Gemini API on Tier 1 allows 100
    TTS requests a day - three to five calls - and returned 429 for the rest
    of the day; Vertex AI (Standard PayGo) has no daily count. With a Vertex
    key the request goes there first; a refusal before any audio that is
    about capacity or the server (429, 5xx, 401/403 of a revoked key) is
    asked of the next path, so the old path is the rollback.

    Vertex's EU multi-region first, then global (measured from the station
    2026-11-04: global answered after 0.93-1.07 s, eu after 0.34-0.39 s; the
    model is not served in single regions, 404). Owner 2026-11-05, «изучи
    про лимиты и подводные камни»: a preview model may leave a region, and a
    regional pool can be busy. So eu gets EU_FIRST_AUDIO_SECONDS for its
    first audio, then global is asked; EU_PAUSE_AFTER failures in a row skip
    eu for EU_PAUSE_SECONDS. eu is off unless ZEYTUN_TTS_VERTEX_EU=1: on kept
    connections it was only 0.08 s faster (station, 2026-11-05). The worst
    case with it on is today's path plus EU_FIRST_AUDIO_SECONDS on one reply.
    Over kept connections (ZEYTUN_HTTP): a new one cost the station 0.2-0.3 s.
    """
    VERTEX_LOCATIONS = (("vertex", "https://aiplatform.eu.rep.googleapis.com", "eu"),
                        ("vertex_global", "https://aiplatform.googleapis.com", "global"))
    EU_FIRST_AUDIO_SECONDS = 1.2
    EU_PAUSE_AFTER = 5
    EU_PAUSE_SECONDS = 600.0
    # Process-wide: every call of this station shares the eu path's health.
    eu_lock = threading.Lock()
    eu_failures = 0
    eu_paused_until = 0.0
    MODELS = frozenset({"gemini-3.8-flash-tts"})
    VERTEX_PROJECT = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
    # Refusals after which the other path is worth one more request; a 400
    # is about the request itself and would be refused there too.
    FALLBACK_CODES = frozenset({401, 403, 408, 429, 500, 502, 503, 504})
    # First audio arrives in ~0.7 s; a turn waiting longer than this falls
    # back to the model's own voice rather than leave the line silent.
    TIMEOUT_SECONDS = 4

    def __init__(self, key, model, voice, opener=None, style=None, vertex=None, environ=None, clock=time.monotonic):
        if not key or model not in self.MODELS or voice not in ZeytunInboundBridge.VOICES:
            raise ZeytunPilotUnavailable("tts_unavailable")
        self.style = style
        query = ":streamGenerateContent?alt=sse&key="
        self.urls = []
        project, vertex_key = vertex if isinstance(vertex, tuple) and len(vertex) == 2 else (None, None)
        if (isinstance(project, str) and self.VERTEX_PROJECT.match(project)
                and isinstance(vertex_key, str) and 30 <= len(vertex_key.strip()) <= 256):
            # Off unless asked for: from the station on 2026-11-05, on kept connections, eu's first
            # audio came 0.08 s before global's (median 0.57 against 0.65 s, 7 each); the gain
            # is the kept connection, not the region, and the region's risks stay.
            eu_off = str((os.environ if environ is None else environ).get("ZEYTUN_TTS_VERTEX_EU", "")).strip() not in ("1", "on", "true")
            for path, host, location in self.VERTEX_LOCATIONS:
                if location == "eu" and eu_off:
                    continue
                self.urls.append((path, host + "/v1/projects/" + project + "/locations/" + location
                                  + "/publishers/google/models/" + model
                                  + query + urllib.parse.quote(vertex_key.strip(), safe="")))
        self.urls.append(("studio", "https://generativelanguage.googleapis.com/v1beta/models/" + model
                          + query + urllib.parse.quote(key, safe="")))
        self.url = self.urls[0][1]
        self.path = self.urls[0][0]
        self.model = model
        self.voice = voice
        # What this call's synthesis cost (owner, 2026-11-11: «почему расходов 0?»):
        # every request asked, its text and the audio it returned, for the CRM's spend report.
        self.billed_lock = threading.Lock()
        self.billed_counts = {"requests": 0, "chars": 0, "audioBytes": 0}
        self.open = opener or ZEYTUN_HTTP.open
        self.kept = opener is None
        self.clock = clock
        self.eu_note = None  # why the last reply did not come from eu, for the journal

    def warm(self):
        """The first path's connection, opened while the call greets."""
        return self.kept and ZEYTUN_HTTP.warm(self.urls[0][1], self.TIMEOUT_SECONDS)

    @classmethod
    def _eu_result(cls, ok, now):
        with cls.eu_lock:
            if ok:
                cls.eu_failures = 0
                return
            cls.eu_failures += 1
            if cls.eu_failures >= cls.EU_PAUSE_AFTER:
                cls.eu_failures = 0
                cls.eu_paused_until = now + cls.EU_PAUSE_SECONDS

    @classmethod
    def _eu_paused(cls, now):
        with cls.eu_lock:
            return now < cls.eu_paused_until

    def stream(self, text, on_pcm, keep_going):
        heard = [0]
        def counted(pcm):
            heard[0] += len(pcm)
            on_pcm(pcm)
        self.eu_note = None
        for index, (path, url) in enumerate(self.urls):
            last = index + 1 == len(self.urls)
            eu = "/locations/eu/" in url
            if eu and not last and self._eu_paused(self.clock()):
                self.eu_note = "paused"
                continue
            self.path = path
            try:
                produced = self._styled(url, text, counted, keep_going, eu and not last)
                if eu:
                    self._eu_result(True, self.clock())
                return produced
            except ZeytunPilotUnavailable as error:
                code = str(error).rsplit("_", 1)[-1]
                if eu and not heard[0]:
                    self._eu_result(False, self.clock())
                    self.eu_note = str(error)
                # Before any audio, eu gives way to the next path whatever went wrong.
                if heard[0] or last or not keep_going() or not (eu or (code.isdigit() and int(code) in self.FALLBACK_CODES)):
                    raise
        raise ZeytunPilotUnavailable("tts_unavailable")

    def _styled(self, url, text, on_pcm, keep_going, fast=False):
        try:
            return self._stream(url, text, on_pcm, keep_going, self.style, fast)
        except ZeytunPilotUnavailable as error:
            if not self.style or str(error) != "tts_http_400":
                raise
            self.style = None
        return self._stream(url, text, on_pcm, keep_going, None, fast)

    def _stream(self, url, text, on_pcm, keep_going, style, fast=False):
        part = {"text": text}
        if style:
            part["speechMetadata"] = {"style": style}
        body = {"contents": [{"role": "user", "parts": [part]}],
                "generationConfig": {"responseModalities": ["AUDIO"],
                                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.voice}}}}}
        req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        # The audio this request returned, billed whether it ends in a return or a raise.
        returned = [0]
        try:
            return self._stream_counted(req, url, on_pcm, keep_going, fast, returned)
        finally:
            self._bill(text, style, returned[0])

    def _stream_counted(self, req, url, on_pcm, keep_going, fast, returned):
        produced = 0
        # fast (eu): the first audio within EU_FIRST_AUDIO_SECONDS of asking,
        # on a kept connection whose read timeout can follow the deadline.
        fast = fast and (not self.kept or ZEYTUN_HTTP.keeps(url))
        deadline = self.clock() + self.EU_FIRST_AUDIO_SECONDS
        try:
            response = self.open(req, self.EU_FIRST_AUDIO_SECONDS if fast else self.TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            raise ZeytunPilotUnavailable("tts_http_%d" % error.code) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError):
            if fast:
                raise ZeytunPilotUnavailable("tts_eu_timeout") from None
            raise
        settimeout = getattr(response, "settimeout", None)
        with response:
            lines = iter(response)
            while True:
                if fast and settimeout is not None:
                    settimeout(max(0.05, deadline - self.clock()) if not produced else self.TIMEOUT_SECONDS)
                try:
                    raw = next(lines)
                except StopIteration:
                    break
                except (http.client.HTTPException, OSError):
                    if fast and not produced:
                        raise ZeytunPilotUnavailable("tts_eu_timeout") from None
                    raise
                if fast and not produced and self.clock() > deadline:
                    raise ZeytunPilotUnavailable("tts_eu_timeout")
                if not keep_going():
                    return produced
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line[5:])
                if isinstance(payload, dict) and payload.get("error"):
                    # Google can report a refusal inside a 200 stream; without
                    # this the turn stayed silent (station call, 2026-10-23).
                    code = (payload.get("error") or {}).get("code") if isinstance(payload.get("error"), dict) else None
                    raise ZeytunPilotUnavailable("tts_stream_error_%s" % (code if isinstance(code, int) else "unknown"))
                for candidate in payload.get("candidates") or []:
                    for part in (candidate.get("content") or {}).get("parts") or []:
                        inline = part.get("inlineData") if isinstance(part, dict) else None
                        if not isinstance(inline, dict) or not inline.get("data"):
                            continue
                        mime = str(inline.get("mimeType") or "").lower().replace(" ", "")
                        if "rate=" in mime and "rate=24000" not in mime:
                            raise ZeytunPilotUnavailable("tts_audio_format")
                        pcm = base64.b64decode(inline["data"], validate=True)
                        if len(pcm) % 2:
                            raise ZeytunPilotUnavailable("tts_audio_format")
                        produced += len(pcm)
                        returned[0] = produced
                        on_pcm(pcm)
        if not produced and keep_going():
            raise ZeytunPilotUnavailable("tts_no_audio")
        return produced

    def _bill(self, text, style, produced):
        with self.billed_lock:
            self.billed_counts["requests"] += 1
            self.billed_counts["chars"] += len(text) + len(style or "")
            self.billed_counts["audioBytes"] += produced

    def billed(self):
        """This call's synthesis so far: requests, characters asked, seconds of audio returned."""
        with self.billed_lock:
            counts = dict(self.billed_counts)
        return {"requests": counts["requests"], "chars": counts["chars"],
                "audioSeconds": round(counts["audioBytes"] / 48000.0, 2)}


# The line's opening, voiced once per process: (voice, model, text) -> PCM
# chunks. Owner, 2026-10-28: «долго… несколько секунд тишина, а потом
# включается ассистент». The opening is fixed text from the CRM, so a call
# need not wait for the model to say it or for the TTS to voice it again.
ZEYTUN_OPENING_AUDIO = {}
ZEYTUN_OPENING_AUDIO_MAX = 4
# Owner's call 2026-10-30 (Tetrasiklin): 28 s of silence while the agent
# looked a product up. A lookup still running after a second gets this, in the
# call's voice, voiced once per process like the opening.
ZEYTUN_WAIT_FILLER = "Hmm... bir saniyə."
# Task 1 of the owner's queue (2026-11-06): a fresh session after a drop restores the
# whole pharmacy call and first saves every line the conversation confirmed, silently.
ZEYTUN_RESTORE_TURNS = 60


def zeytun_caller_owed(bridge):
    """True unless the line's relay knows the caller has said nothing since the agent's last audio."""
    relay = getattr(bridge, "relay", None)
    owed = getattr(relay, "caller_owed", None)
    return True if owed is None else owed()


def zeytun_restore_note(bridge):
    """The restore's save rule, with the list the station last sent: its externalIds keep the lines
    on their 1C products (2026-11-06 stand: a save rebuilt from the words alone came back not found)."""
    lines = list(getattr(bridge, "last_lines", None) or [])
    listed = json.dumps([{key: line[key] for key in ("spoken", "quantity", "unit", "externalId") if key in line}
                         for line in lines], ensure_ascii=False, separators=(",", ":"))
    return ("Before you speak, if any order line was confirmed in this call, call save_order_list once, silently, "
            "with the whole list so far: " + ("the list last saved, " + listed + ", keeping every externalId exactly, "
            if lines else "") + "with the lines and corrections the conversation confirmed after it. Never mention it. ")
# Owner, 2026-11-06: «когда перебиваешь, он начинает сразу в тишину… например говорил «ага» или хмыкал».
# Owner, 2026-11-07: «не Hə. — это не тактично; аха. Это уже не слово, а сигнал того, что слушаю».
ZEYTUN_BARGE_ACK = "Aha."
ZEYTUN_FILLER_AUDIO = {}


class ZeytunSpeechRelay:
    """Re-voices the Live model's answers through a TTS voice the owner chose.

    gemini-3.8-live cannot answer in TEXT (1007, 2026-10-23), so the model
    still speaks; its audio is withheld and its own output transcription is
    read by the TTS instead. Synthetic events carry that audio and text into
    the core's ordinary handler, so playback, barge-in, the transcript, the
    farewell hang-up and recovery see a normal Gemini turn. A turn's
    generationComplete/turnComplete are held until its new audio is queued.
    If the TTS fails before any of a turn is heard, the caller hears the
    model's own audio for that turn instead of silence.

    One turn is one provider generation: it ends at its turnComplete or at
    interrupted, so audio still streaming from a cancelled generation is
    dropped rather than spoken as a new answer.
    """
    MARK = "zeytunTtsRelay"
    # The first clip sets the reply's delay: it goes out at the first sentence
    # end from MIN_CHARS on, or, while no sentence has ended, at the first
    # clause break from CLAUSE_MIN_CHARS on. Owner, 2026-10-26, of slow
    # answers: «пусть станция начинает озвучку раньше». At 40 characters a
    # short reply ("Başqa nə əlavə edək?") waited for the model's whole turn.
    MIN_CHARS = 12
    CLAUSE_MIN_CHARS = 24
    # Each TTS clip starts and ends right on the voice; back to back on an
    # 8 kHz line the first and last sounds were swallowed (owner, 2026-10-23:
    # «слово обрывается, или начало, или конец»). Air before and after a
    # clip, and a short fade-in against the click of a hard start.
    LEAD_SILENCE_MS = 80
    TAIL_SILENCE_MS = 160
    FADE_IN_MS = 15
    TAIL_GRACE_SECONDS = 0.4  # output transcription may trail its generation
    # Whatever stalls the TTS path, a turn the model has spoken is never left
    # silent for longer than this: the caller then hears the model itself.
    SILENCE_LIMIT_SECONDS = 5.0
    FALLBACK = object()

    # The core's resume-progress watchdog counts only audio written to the
    # line, and allows 2 s after a barge-in; withheld model audio plus the TTS
    # delay outlasted it and tore a healthy session down twice in one call
    # (2026-10-23, reproduced on the harness). Model audio arriving here is
    # proof the session lives, so it re-arms that watchdog (at most this often).
    PROGRESS_EVERY_SECONDS = 0.5
    FILLER_EVERY_SECONDS = 8.0

    # Owner, 2026-11-03: «только чтоб говорил на азербайджанском». A reply the
    # model wrote in English (2026-10-31 call: two turns) is never voiced; the
    # model is asked once, for that turn, to say it again in Azerbaijani.
    FOREIGN_RETRY = ("Station note, never read it aloud: your last reply was in English and the caller did not "
                     "hear it. Say it again now, in Azerbaijani only.")
    # Owner's call 2026-11-05 (4c36453f): asked "Ketonal krem, yoxsa gel?", the
    # owner answered at once; the answer never reached the model, the agent
    # waited 23 s in silence and the owner hung up. A question the line has
    # been quiet after for SILENCE_NUDGE_SECONDS - nobody speaking, nothing
    # playing, no tool working - is asked again once, as an operator would.
    # Owner, 2026-11-05: «эти паузы вводят в заблуждение». A caller who
    # finished a phrase and hears nothing for TURN_FILLER_SECONDS after the
    # station closed it (0.65 s of end silence before that) gets the wait
    # filler, as when a lookup runs long: once per phrase, never over a reply,
    # never more often than FILLER_EVERY_SECONDS. 2.5 s: at 1.5 s (owner's
    # call c682e76e, 2026-11-05) it played on 7 of 10 answers, most a second
    # before the answer itself, which then waited for it; the answers came
    # 1-3 s after the phrase closed. Only a long pause gets it now.
    # Off since the owner's rehearsal 2026-11-06 (4347170e): «просто говорит
    # хмм даже когда ничего не спрашиваешь» - a caller who paused mid-order
    # ("daha doğrusu...") got it too. None turns it off; a long lookup still
    # gets the filler (FILLER_AFTER).
    TURN_FILLER_SECONDS = None
    # Owner, 2026-11-06: «когда перебиваешь, он начинает сразу в тишину». The
    # caller who cut the agent off hears it stop at once, then ~2.5 s of
    # nothing while the model and the TTS answer. Only after such a phrase:
    # "Aha." in the line's voice, BARGE_ACK_SECONDS after the station closed
    # it, if the answer has not begun and nothing plays. Once per phrase, never
    # within FILLER_EVERY_SECONDS of a filler. None turns it off.
    BARGE_ACK_SECONDS = 0.3
    BARGE_ACK_WINDOW_SECONDS = 20.0
    SILENCE_NUDGE_SECONDS = 6.0
    SILENCE_NUDGES_PER_CALL = 3
    SILENCE_NUDGE = ("Station note, never read it aloud: the caller has said nothing for six seconds since your "
                     "question; they may not have heard it, or you did not hear them. Ask once, in a few Azerbaijani "
                     "words, whether they hear you, and repeat that question briefly.")

    def __init__(self, tts, inject, speakable, alive, room=None, log=None, clock=time.monotonic,
                 progress=None, recovering=None, ask=None, quiet=None, playing=None):
        self.tts, self.inject, self.speakable, self.alive = tts, inject, speakable, alive
        # Set by the core: True while nobody speaks, nothing plays and no tool works.
        self.quiet = quiet
        # Set by the core: True while the line still plays the agent's audio.
        self.playing = playing or (lambda: False)
        self.caller_done_at = None
        # When the agent was last cut off by the caller (interrupted), and when "Aha." is due.
        self.barged_at = None
        self.ack_due_at = None
        self.ack_key = None
        # When the caller last finished a phrase, whether one is open now, when the agent's audio last went out.
        self.caller_end_at = None
        self.caller_speaking = False
        self.agent_audio_at = None
        self.question_pending = False
        self.quiet_since = None
        self.nudges = 0
        # Set by the core: sends a client turn to the current Live session.
        self.ask = ask or (lambda payload: False)
        self.progress = progress or (lambda: None)
        # While the core waits for a replacement session's first audio (2.5 s),
        # a TTS delay would fail the recovery: such a turn keeps the model voice.
        self.recovering = recovering or (lambda: False)
        self.progress_at = None
        self.filler_at = None
        self.filler_key = None
        self.room = room or (lambda: True)
        self.log = log or (lambda status, **fields: None)
        self.clock = clock
        self.lock = threading.Condition()
        self.turns = []
        self.epoch = None
        self.prefilled = False
        self.worker = threading.Thread(target=self._run, name="zeytun-tts", daemon=True)
        self.worker.start()
        if quiet is not None:
            threading.Thread(target=self._watch_silence, name="zeytun-silence", daemon=True).start()

    def caller_spoke(self):
        """The core opened a caller phrase: the question was answered, or is being."""
        with self.lock:
            self.question_pending = False
            self.quiet_since = None
            self.caller_done_at = None
            self.ack_due_at = None
            self.caller_speaking = True

    def caller_done(self):
        """The core closed a caller phrase: the agent owes an answer (TURN_FILLER_SECONDS).

        A phrase that cut the agent off also owes the caller "Aha." (BARGE_ACK_SECONDS)."""
        with self.lock:
            now = self.clock()
            self.caller_done_at = now
            self.caller_end_at = now
            self.caller_speaking = False
            if (self.BARGE_ACK_SECONDS is not None and self.barged_at is not None
                    and now - self.barged_at < self.BARGE_ACK_WINDOW_SECONDS):
                self.ack_due_at = now + self.BARGE_ACK_SECONDS
            self.barged_at = None

    def barge_ack_tick(self):
        """One check of the pause after a phrase that cut the agent off (the watch thread calls it)."""
        with self.lock:
            due = self.ack_due_at
            if due is None or self.clock() < due:
                return False
            self.ack_due_at = None
        if self.playing():
            return False
        played = self.filler(ZEYTUN_BARGE_ACK, key=self.ack_key, kind="barge_ack")
        return played

    def turn_filler_tick(self):
        """One check of the pause after a caller phrase (the watch thread calls it)."""
        with self.lock:
            done = self.caller_done_at
            if self.TURN_FILLER_SECONDS is None or done is None or self.clock() - done < self.TURN_FILLER_SECONDS:
                return False
            self.caller_done_at = None
        if self.playing():
            return False
        played = self.filler()
        if played:
            self.log("turn_filler")
        return played

    def silence_tick(self):
        """One check of the silence after a question (the watch thread calls it)."""
        with self.lock:
            if not self.question_pending or self.nudges >= self.SILENCE_NUDGES_PER_CALL:
                return False
            if any(not turn["finished"] or turn["pieces"] for turn in self.turns) or not self.quiet():
                self.quiet_since = None
                return False
            now = self.clock()
            if self.quiet_since is None:
                self.quiet_since = now
            if now - self.quiet_since < self.SILENCE_NUDGE_SECONDS:
                return False
            self.question_pending = False
            self.quiet_since = None
            self.nudges += 1
            nudge = self.nudges
        self.log("silence_nudge", n=nudge)
        self.ask({"clientContent": {"turns": [{"role": "user", "parts": [{"text": self.SILENCE_NUDGE}]}],
                                    "turnComplete": True}})
        return True

    def _watch_silence(self):
        while self.alive():
            try:
                self.barge_ack_tick()
                self.turn_filler_tick()
                self.silence_tick()
            except Exception as error:  # never the call's problem: the watch stops and says why
                self.log("silence_watch_error", reason=type(error).__name__)
                return
            time.sleep(0.1)

    @staticmethod
    def _new_turn():
        return {"buffer": "", "pieces": [], "original": [], "held": [], "done_at": None, "created": time.monotonic(),
                "final_taken": False, "finished": False, "cancelled": False, "made": 0,
                "passthrough": False, "spoken": False, "prefill": False, "said": ""}

    def prefill(self, text, epoch=None):
        """Voice the call's fixed opening now, as the greeting generation's turn.

        The core has just asked the model to say exactly this text. Its words
        for that generation are not voiced again; its boundaries are still
        held until the opening is queued, as for any turn.
        """
        text = text.strip() if isinstance(text, str) else ""
        with self.lock:
            if self.prefilled or self.turns or not text:
                return False
            self.prefilled = True
            # The greeting generation arrives on this socket: it must not read
            # as a replacement that cancels what was queued for an old one.
            self.epoch = epoch
            turn = self._new_turn()
            turn["prefill"], turn["pieces"], turn["made"] = True, [text], 1
            self.turns.append(turn)
            self.lock.notify_all()
        return True

    def prefetch_filler(self, text=ZEYTUN_WAIT_FILLER):
        """Voice the wait filler (or "Aha.", ZEYTUN_BARGE_ACK) in the background, once per process and voice."""
        key = (getattr(self.tts, "voice", None), getattr(self.tts, "url", "").split("?")[0],
               getattr(self.tts, "style", None), text)
        if text == ZEYTUN_BARGE_ACK:
            self.ack_key = key
        else:
            self.filler_key = key
        if key in ZEYTUN_FILLER_AUDIO:
            return

        def voice():
            chunks = []
            try:
                self.tts.stream(zeytun_speakable_text(text), chunks.append, lambda: True)
            except Exception as error:
                self.log("filler_unavailable", reason=str(error) if isinstance(error, ZeytunPilotUnavailable)
                         else type(error).__name__)
                return
            if chunks:
                ZEYTUN_FILLER_AUDIO[key] = tuple(chunks)
        threading.Thread(target=voice, name="zeytun-filler", daemon=True).start()

    def filler(self, text=ZEYTUN_WAIT_FILLER, key=None, kind="wait_filler"):
        """Play the wait filler (or another voiced clip) now, if it is ready and nothing is being said.

        Never over a reply in progress, never more often than FILLER_EVERY_SECONDS.
        """
        chunks = ZEYTUN_FILLER_AUDIO.get(key or getattr(self, "filler_key", None))
        with self.lock:
            busy = any(not turn["finished"] or turn["pieces"] or turn["buffer"].strip() for turn in self.turns)
            now = self.clock()
            if (not chunks or busy or not self.speakable()
                    or (self.filler_at is not None and now - self.filler_at < self.FILLER_EVERY_SECONDS)):
                return False
            self.filler_at = now
        for index, pcm in enumerate(chunks):
            if index == 0:
                pcm = self._silence(self.LEAD_SILENCE_MS) + self._fade_in(pcm)
            content = {"modelTurn": {"parts": [{"inlineData": {
                "mimeType": "audio/pcm;rate=24000", "data": base64.b64encode(pcm).decode("ascii")}}]}}
            if index == 0:
                content["outputTranscription"] = {"text": text + " "}
            self._emit(content)
        self._emit({"modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000",
            "data": base64.b64encode(self._silence(self.TAIL_SILENCE_MS)).decode("ascii")}}]}})
        self.log(kind)
        return True

    def _split_locked(self, turn):
        # Only the first sentence goes out alone (it sets the reply's delay);
        # the rest of the turn is one request. Per-sentence requests hit the
        # station key's TTS rate limit (HTTP 429, 2026-10-23 call: 13 requests).
        while not turn["made"]:
            text, cut = turn["buffer"], None
            for match in re.finditer(r"[.!?…](?:\s|$)", text):
                if match.end() >= self.MIN_CHARS:
                    cut = match.end()
                    break
            if cut is None:
                # A comma needs a space after it: "1,33 manat" is one number.
                for match in re.finditer(r"[,;:—–]\s", text):
                    if match.end() >= self.CLAUSE_MIN_CHARS:
                        cut = match.end()
                        break
            if cut is None:
                return
            piece, turn["buffer"] = text[:cut].strip(), text[cut:]
            if piece:
                turn["pieces"].append(piece)
                turn["made"] += 1

    def _cancel_all_locked(self, generation_over=False):
        for queued in self.turns:
            queued["cancelled"] = True
            if generation_over:
                queued["finished"] = True
        self.lock.notify_all()

    def filter(self, event, epoch=None):
        """Rewrites one provider event in place; True when nothing is left for the core."""
        if event.pop(self.MARK, False):
            return False
        content = event.get("serverContent")
        if not isinstance(content, dict):
            return False
        with self.lock:
            if epoch != self.epoch:
                # A replacement socket: nothing queued for the old one is owed.
                self._cancel_all_locked(generation_over=True)
                self.epoch = epoch
            if content.get("interrupted") is True:
                self.barged_at = self.clock()
                self._cancel_all_locked(generation_over=True)
                for queued in self.turns:
                    for key in queued["held"]:
                        content[key] = True  # the dropped generation's boundaries, in order
                    queued["held"] = []
            last = self.turns[-1] if self.turns else None
            if last is not None and last["passthrough"] and not last["finished"]:
                if content.get("turnComplete") is True:
                    last["finished"] = True
                    self.lock.notify_all()
                return False
            starts_turn = last is None or last["finished"]
            model_turn = content.get("modelTurn")
            speaks = (isinstance(model_turn, dict) and any(isinstance(p, dict) and isinstance(p.get("inlineData"), dict)
                      for p in model_turn.get("parts") or [])) or isinstance(content.get("outputTranscription"), dict)
            if starts_turn and speaks and self.recovering():
                # A replacement session must be heard within 2.5 s; the TTS delay
                # would fail it, so this whole turn is the model's own voice.
                turn = self._new_turn()
                turn["passthrough"] = True
                turn["finished"] = content.get("turnComplete") is True
                self.turns.append(turn)
                self.log("tts_passthrough", reason="recovery")
                self.lock.notify_all()
                return False
            audio = []
            if isinstance(model_turn, dict) and isinstance(model_turn.get("parts"), list):
                keep = []
                for part in model_turn["parts"]:
                    inline = part.get("inlineData") if isinstance(part, dict) else None
                    (audio if isinstance(inline, dict) and inline.get("data") else keep).append(part)
                if keep:
                    model_turn["parts"] = keep
                else:
                    content.pop("modelTurn")
            output = content.pop("outputTranscription", None)
            text = output.get("text") if isinstance(output, dict) else None
            text = text if isinstance(text, str) else ""
            if audio and (last is None or not last["passthrough"]):
                now = self.clock()
                if self.progress_at is None or now - self.progress_at >= self.PROGRESS_EVERY_SECONDS:
                    self.progress_at = now
                    self.progress()
            turn = last
            if turn is not None and turn["finished"]:
                # A transcript tail just after turnComplete still belongs to it.
                late = (not audio and text.strip() and not turn["cancelled"] and not turn["final_taken"]
                        and turn["done_at"] is not None and self.clock() - turn["done_at"] < self.TAIL_GRACE_SECONDS)
                turn = turn if late else None
            if turn is None and (audio or text.strip()):
                turn = self._new_turn()
                self.turns.append(turn)
                self.question_pending = False
                self.quiet_since = None
                self.caller_done_at = None  # the answer has begun: no filler
                self.ack_due_at = None

            if turn is None:
                return not content
            if not turn["cancelled"]:
                turn["original"].extend(audio)
                turn["said"] += text
                if not turn["prefill"]:
                    turn["buffer"] += text
                    self._split_locked(turn)
            for key in ("generationComplete", "turnComplete"):
                if content.get(key) is not True:
                    continue
                if key == "turnComplete":
                    turn["finished"] = True
                if turn["done_at"] is None:
                    turn["done_at"] = self.clock()
                if turn["cancelled"]:
                    continue  # nothing of it is spoken any more: the core gets it now
                content.pop(key)
                turn["held"].append(key)
            if turn["cancelled"] and turn["held"]:
                for key in turn["held"]:
                    content[key] = True  # boundaries held before the cancel
                turn["held"] = []
            self.lock.notify_all()
            return not content

    @staticmethod
    def _silence(ms):
        return b"\x00\x00" * (24 * ms)

    @classmethod
    def _fade_in(cls, pcm):
        samples = array.array("h")
        samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
        ramp = min(len(samples), 24 * cls.FADE_IN_MS)
        for i in range(ramp):
            samples[i] = int(samples[i] * i / ramp)
        return samples.tobytes() + pcm[len(samples) * 2:]

    def _emit(self, content):
        if any(isinstance(part, dict) and part.get("inlineData") for part in (content.get("modelTurn") or {}).get("parts") or []):
            self.agent_audio_at = self.clock()
        self.inject({"serverContent": content, self.MARK: True})

    def caller_owed(self):
        """Whether the caller spoke after the agent's last audio: a restore owes them an answer.

        Task 3 of the owner's queue (2026-11-06): after every drop in silence the restored
        agent asked "son dediyinizi təkrar edin" — the core's check marks the caller's turn
        untranscribed even when it was long answered."""
        with self.lock:
            if self.caller_speaking:
                return True
            return self.caller_end_at is not None and (self.agent_audio_at is None or self.caller_end_at > self.agent_audio_at)

    def _run(self):
        while self.alive():
            with self.lock:
                if not self.turns:
                    self.lock.wait(0.5)
                    continue
                turn = self.turns[0]
            self._speak(turn)
            with self.lock:
                # Keep the generation until the provider ends it, so its
                # stragglers are recognised as belonging to it.
                while not turn["finished"] and self.alive():
                    self.lock.wait(0.5)
                if self.turns and self.turns[0] is turn:
                    self.turns.pop(0)
                # A spoken reply that ends on a question waits for an answer (SILENCE_NUDGE).
                if (not turn["cancelled"] and not turn["prefill"] and not self.turns
                        and turn["said"].strip().endswith("?")):
                    self.question_pending = True
                    self.quiet_since = None

    def _next_piece_locked(self, turn):
        while True:
            if not self.alive():
                return None
            if not turn["cancelled"] and not self.speakable():
                self._cancel_all_locked()
            if turn["cancelled"] or turn["passthrough"]:
                return None
            if (not turn["spoken"] and turn["original"]
                    and time.monotonic() - turn["created"] >= self.SILENCE_LIMIT_SECONDS):
                return self.FALLBACK
            if turn["pieces"]:
                return turn["pieces"].pop(0)
            if turn["done_at"] is not None and self.clock() - turn["done_at"] >= self.TAIL_GRACE_SECONDS:
                turn["final_taken"] = True
                piece, turn["buffer"] = turn["buffer"].strip(), ""
                return piece or None
            self.lock.wait(0.1 if turn["done_at"] is not None else 0.5)

    def _speak(self, turn):
        while True:
            with self.lock:
                piece = self._next_piece_locked(turn)
            if piece is None:
                break
            if piece is self.FALLBACK:
                self._fallback(turn, "tts_wait_timeout")
                return
            if zeytun_is_english(piece):
                with self.lock:
                    # Counted as said: the model's own English audio must not
                    # stand in for it (the fallback after SILENCE_LIMIT_SECONDS).
                    turn["spoken"] = True
                    first, turn["foreign"] = not turn.get("foreign"), True
                self.log("foreign_dropped", chars=len(piece))
                if first:
                    try:
                        self.ask({"clientContent": {"turns": [{"role": "user", "parts": [{"text": self.FOREIGN_RETRY}]}],
                                                    "turnComplete": True}})
                    except Exception:
                        pass
                if turn["final_taken"]:
                    break
                continue
            heard = [False]
            asked = time.monotonic()
            if not turn["spoken"]:
                # 2026-10-31 call: the agent spoke English in two turns the
                # transcript does not hold. Which script, never the words.
                self.log("tts_request", chars=len(piece), script=zeytun_script(piece))

            def on_pcm(pcm, piece=piece):
                while not self.room() and self.speakable() and not turn["cancelled"]:
                    time.sleep(0.05)
                if turn["cancelled"] or not self.speakable():
                    with self.lock:
                        self._cancel_all_locked()
                    return
                if not heard[0]:
                    pcm = self._silence(self.LEAD_SILENCE_MS) + self._fade_in(pcm)
                content = {"modelTurn": {"parts": [{"inlineData": {
                    "mimeType": "audio/pcm;rate=24000", "data": base64.b64encode(pcm).decode("ascii")}}]}}
                if not heard[0]:
                    content["outputTranscription"] = {"text": piece + " "}
                    heard[0] = True
                    if not turn["spoken"]:
                        self.log("tts_first_audio", ms=round((time.monotonic() - asked) * 1000),
                                 path=getattr(self.tts, "path", None), eu=getattr(self.tts, "eu_note", None))
                self._emit(content)
                turn["spoken"] = True

            try:
                self._stream(turn, zeytun_speakable_text(piece), on_pcm,
                             lambda: not turn["cancelled"] and self.speakable())
            except Exception as error:
                # Our own codes say why (tts_http_403, tts_no_audio, ...); never a body.
                reason = str(error) if isinstance(error, ZeytunPilotUnavailable) else type(error).__name__
                if not turn["spoken"]:
                    with self.lock:
                        turn["pieces"].insert(0, piece)
                    self._fallback(turn, reason)
                    return
                self.log("tts_failed_mid_turn", reason=reason)
                with self.lock:
                    self._cancel_all_locked()
                break
            if heard[0] and not turn["cancelled"] and self.speakable():
                self._emit({"modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000",
                    "data": base64.b64encode(self._silence(self.TAIL_SILENCE_MS)).decode("ascii")}}]}})
            if turn["final_taken"]:
                break
        # This turn's audio is queued: the core gets its boundaries once the
        # provider has sent them (a cancelled turn's boundaries go via filter).
        with self.lock:
            while not turn["finished"] and not turn["cancelled"] and self.alive():
                self.lock.wait(0.5)
            held, turn["held"] = turn["held"], []
        for key in held:
            self._emit({key: True})

    def _stream(self, turn, text, on_pcm, keep_going):
        if not turn["prefill"]:
            return self.tts.stream(text, on_pcm, keep_going)
        key = (getattr(self.tts, "voice", None), getattr(self.tts, "url", "").split("?")[0], text)
        cached = ZEYTUN_OPENING_AUDIO.get(key)
        if cached:
            self.log("opening_cached")
            for pcm in cached:
                if not keep_going():
                    break
                on_pcm(pcm)
            return sum(len(pcm) for pcm in cached)
        chunks = []
        produced = self.tts.stream(text, lambda pcm: (chunks.append(pcm), on_pcm(pcm)), keep_going)
        # Only a whole opening is kept: a cut one would be cut on every call.
        if produced and chunks and keep_going():
            if len(ZEYTUN_OPENING_AUDIO) >= ZEYTUN_OPENING_AUDIO_MAX:
                ZEYTUN_OPENING_AUDIO.clear()
            ZEYTUN_OPENING_AUDIO[key] = tuple(chunks)
        return produced

    def _fallback(self, turn, reason):
        # Nothing of the TTS was heard: the caller hears the model instead.
        with self.lock:
            turn["passthrough"] = True
            original, turn["original"] = turn["original"], []
            text = (" ".join(turn["pieces"]) + " " + turn["buffer"]).strip()
            turn["pieces"], turn["buffer"] = [], ""
            held, turn["held"] = turn["held"], []
        self.log("tts_fallback", reason=reason)
        content = {}
        if original:
            content["modelTurn"] = {"parts": original}
        if text:
            content["outputTranscription"] = {"text": text}
        for key in held:
            content[key] = True
        if content:
            self._emit(content)


def zeytun_post_json(url, token, body, timeout):
    req = urllib.request.Request(url,
        data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    with ZEYTUN_HTTP.open(req, timeout) as response:
        raw = response.read(32769)
        if len(raw) > 32768:
            raise ZeytunPilotUnavailable("pilot_response_too_large")
        return json.loads(raw)


def zeytun_retryable(error):
    """A CRM that did not answer (network, timeout, 5xx, 429), as opposed to one that said no."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code in (408, 425, 429) or error.code >= 500
    return not isinstance(error, ZeytunPilotUnavailable)


def zeytun_failure(error):
    return "http_%d" % error.code if isinstance(error, urllib.error.HTTPError) else type(error).__name__


# Words an English reply cannot do without and an Azerbaijani one never uses.
ZEYTUN_ENGLISH_WORDS = frozenset((
    "the", "and", "you", "your", "is", "are", "please", "would", "like", "anything", "else", "boxes", "box",
    "how", "many", "what", "can", "we", "have", "will", "this", "that", "of", "to", "for", "with", "order",
    "okay", "thank", "thanks", "sorry", "which", "one", "do", "need", "it", "has", "pieces", "price",
    # Numbers as an English voice says them: a short reply carries little else.
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen",
    "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "manats",
))


def zeytun_is_english(text):
    """True for a reply in English: no Azerbaijani or Cyrillic letter and two
    distinct English function words. "Ketonal geli on qutu" is not."""
    if zeytun_script(text) != "latin":
        return False
    words = set(re.findall(r"[a-z']+", text.lower()))
    return len(words & ZEYTUN_ENGLISH_WORDS) >= 2


def zeytun_script(text):
    """az when the words carry Azerbaijani letters, cyrillic, latin, or none."""
    letters = [c for c in text.lower() if c.isalpha()]
    if not letters:
        return "none"
    if any(c in "əğıöüşç" for c in letters):
        return "az"
    if sum(1 for c in letters if "\u0400" <= c <= "\u04ff") * 2 > len(letters):
        return "cyrillic"
    return "latin"


# Measured 2026-11-04 from production (no calls): about 2 % of caller turns
# end the Live session at once, with no close frame and no goAway, whatever
# the station sends. gemini-3.8-live hands out one resumption handle, at
# setup, and never refreshes it, so the core's resumable reconnect (which
# wants a handle newer than the caller's turn) never runs after the first
# turn and every drop became a fresh session: the "Bir saniyə" notice, the
# model's own voice and a retold conversation. Resuming by that one handle
# restores the session as it was, the caller's half-finished turn included:
# the model recalled the earlier products and heard the turn whole when
# only the rest of it was sent, and twice when it was sent again from the
# start. After a drop forced from this side the provider refuses the first
# attempt (close 1008) and takes the next one half a second later; after its
# own drops it took the first attempt 3 times in 4, and once closed it
# without a frame, which is retried alike.
ZEYTUN_RESUME_RETRY_SECONDS = 0.5
ZEYTUN_RESUME_WINDOW_SECONDS = 3.0
ZEYTUN_RESUME_PER_MINUTE = 3
ZEYTUN_RESUME_PER_CALL = 8


def zeytun_resume_retry(code, started, now):
    """Another attempt after a refused resume (1008, or closed with no frame), only within the window."""
    return code in (1008, None) and now + ZEYTUN_RESUME_RETRY_SECONDS - started < ZEYTUN_RESUME_WINDOW_SECONDS


def zeytun_resume_allowed(history, total, now):
    """A resume budget, so a provider that drops every session cannot become a reconnect storm."""
    recent = [stamp for stamp in history if now - stamp < 60.0]
    return len(recent) < ZEYTUN_RESUME_PER_MINUTE and total < ZEYTUN_RESUME_PER_CALL, recent


def zeytun_call_transcript(order, items, truncated, audible, non_business, keys):
    """The pharmacy call's CRM transcript: everything the caller heard.

    Call 7c2383d1, 2026-11-03: the transcript ended after the agent's second
    answer and was read as the agent going silent after a lookup; it had
    answered twice more. The core leaves every truncated turn out of the CRM
    record, and the TTS relay queues a whole answer (and its tail of air)
    long before it plays, so a caller who spoke as the answer ended, or hung
    up while it played, erased what they had heard. Here an agent turn whose
    audio reached the line stays, marked as cut off; one that never played
    and the core's technical turns are still left out. transcript_order puts
    an interruption before the answer it cut, so the turns follow the causal
    keys the core's own context restore uses, when every turn has one.
    """
    cut = {item_id for item_id in set(truncated) & set(audible)
           if item_id not in non_business and (items.get(item_id) or {}).get("role") == "agent"}
    kept = [item_id for item_id in order
            if item_id in items and item_id not in non_business and (item_id not in truncated or item_id in cut)]
    if kept and all(item_id in keys for item_id in kept):
        kept = [item_id for _, item_id in sorted(enumerate(kept), key=lambda entry: (keys[entry[1]], entry[0]))]
    return [dict(items[item_id], text=items[item_id]["text"].rstrip(" .…") + " …") if item_id in cut
            else items[item_id] for item_id in kept]


class ZeytunOrderSpool:
    """The order list waits on the station's disk until the CRM has it.

    Owner, 2026-10-28 («станция досылает заказ, если CRM не ответила»): the
    agent saves the whole list after every line, and a save the CRM did not
    answer was gone with the call. Each save is written here first, one file
    per call (the newer list replaces the older), and removed once the CRM
    answers. A thread of the core resends what is left, during the call and
    after it, for a day. The CRM keeps a call's newest list by its seq, so a
    late or repeated send never brings an older list back.
    """
    DIRECTORY = "/var/spool/zeytun-phone-orders"
    RETRY_SECONDS = (10, 20, 30, 60)
    KEEP_SECONDS = 24 * 3600
    MAX_FILES = 500
    TICK_SECONDS = 5
    POST_TIMEOUT_SECONDS = 10

    def __init__(self, directory, post, clock=time.time, log=None):
        self.directory = directory
        self.failed = os.path.join(directory, "failed")
        self.post = post
        self.clock = clock
        self.log = log or (lambda status, call_id=None, **fields: None)
        self.lock = threading.Lock()
        # callId -> (next attempt, attempts so far). A list just kept waits
        # one interval: its own save is still on the way to the CRM.
        self.retry = {}
        self.wake = threading.Event()
        self.thread = None
        try:
            os.makedirs(self.failed, mode=0o700, exist_ok=True)
            self.ready = all(os.access(path, os.W_OK | os.X_OK) for path in (directory, self.failed))
        except OSError:
            self.ready = False

    def _path(self, call_id):
        return os.path.join(self.directory, str(uuid.UUID(call_id)) + ".json")

    def _read(self, path):
        """The kept entry, None when there is none; raises on a file that is not one."""
        try:
            with open(path, "rb") as handle:
                raw = handle.read(65537)
        except FileNotFoundError:
            return None
        value = json.loads(raw) if len(raw) <= 65536 else None
        order = ZeytunInboundBridge.order_request(value.get("order")) if isinstance(value, dict) else None
        if (order is None or value.get("v") != 1 or type(value.get("seq")) is not int or value["seq"] < 1
                or type(value.get("keptAt")) not in (int, float)
                or value.get("callId") != os.path.basename(path)[:-len(".json")]):
            raise ValueError("invalid_spool_entry")
        return {"callId": value["callId"], "seq": value["seq"], "keptAt": value["keptAt"], "order": order}

    def _sync_directory(self):
        fd = os.open(self.directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def keep(self, call_id, seq, order):
        """Write the call's list before the CRM is asked; False when it is not on disk."""
        if not self.ready:
            return False
        path = self._path(call_id)
        data = json.dumps({"v": 1, "callId": call_id, "seq": seq, "keptAt": self.clock(), "order": order},
                          ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        temporary = os.path.join(self.directory, ".%s.%s.tmp" % (call_id, uuid.uuid4().hex))
        with self.lock:
            try:
                try:
                    current = self._read(path)
                except Exception:
                    current = None
                if current is not None and current["seq"] >= seq:
                    return True
                if not os.path.exists(path) and sum(1 for n in os.listdir(self.directory) if n.endswith(".json")) >= self.MAX_FILES:
                    self.log("full", call_id)
                    return False
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    view = memoryview(data)
                    while view:
                        view = view[os.write(fd, view):]
                    os.fsync(fd)
                finally:
                    os.close(fd)
                os.replace(temporary, path)
                self._sync_directory()
                self.retry[call_id] = (self.clock() + self.RETRY_SECONDS[0], self.retry.get(call_id, (0, 0))[1])
                return True
            except Exception as error:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                self.log("write_failed", call_id, error_type=type(error).__name__)
                return False

    def settle(self, call_id, seq):
        """The CRM answered the list `seq`: an entry no newer than it is done."""
        if not self.ready:
            return
        path = self._path(call_id)
        with self.lock:
            try:
                current = self._read(path)
            except Exception:
                current = {"seq": seq}
            if current is not None and current["seq"] <= seq:
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass
                self.retry.pop(call_id, None)

    def _fail(self, name, call_id, reason):
        """Set aside an entry the CRM refused or that outlived the day; never resent."""
        with self.lock:
            source = os.path.join(self.directory, name)
            try:
                if sum(1 for _ in os.listdir(self.failed)) < self.MAX_FILES:
                    os.replace(source, os.path.join(self.failed, "%d-%s" % (int(self.clock()), name)))
                else:
                    os.unlink(source)
            except OSError:
                pass
            if call_id:
                self.retry.pop(call_id, None)
        self.log("failed", call_id, reason=reason)

    def drain_once(self):
        if not self.ready:
            return
        try:
            names = sorted(name for name in os.listdir(self.directory) if name.endswith(".json"))
        except OSError:
            return
        for name in names[:100]:
            now = self.clock()
            try:
                with self.lock:
                    entry = self._read(os.path.join(self.directory, name))
                    due, attempts = self.retry.get(entry["callId"], (0, 0)) if entry else (0, 0)
            except Exception:
                self._fail(name, None, "invalid_entry")
                continue
            if entry is None or now < due:
                continue
            call_id = entry["callId"]
            if now - entry["keptAt"] > self.KEEP_SECONDS:
                self._fail(name, call_id, "expired")
                continue
            try:
                value = self.post({"action": "order", "callId": call_id, "seq": entry["seq"], **entry["order"]})
            except Exception as error:
                if not zeytun_retryable(error):
                    self._fail(name, call_id, zeytun_failure(error))
                    continue
                with self.lock:
                    if os.path.exists(os.path.join(self.directory, name)):
                        self.retry[call_id] = (now + self.RETRY_SECONDS[min(attempts, len(self.RETRY_SECONDS) - 1)], attempts + 1)
                self.log("retry", call_id, attempt=attempts + 1, reason=zeytun_failure(error))
                continue
            saved = ZeytunInboundBridge.safe_saved(value)
            if saved["status"] == "not_saved":
                self._fail(name, call_id, "not_saved")
                continue
            self.settle(call_id, entry["seq"])
            self.log("delivered", call_id, attempt=attempts + 1, seq=entry["seq"], order=saved["status"],
                     orderNumber=saved["orderNumber"])

    def start(self):
        with self.lock:
            if self.thread is None and self.ready:
                self.thread = threading.Thread(target=self._run, name="zeytun-order-spool", daemon=True)
                self.thread.start()
        return self

    def _run(self):
        while True:
            try:
                self.drain_once()
            except Exception as error:
                self.log("drain_error", None, error_type=type(error).__name__)
            self.wake.wait(self.TICK_SECONDS)
            self.wake.clear()


_ZEYTUN_ORDER_SPOOL = None
_ZEYTUN_ORDER_SPOOL_LOCK = threading.Lock()


def zeytun_order_spool(runtime_url, token, log):
    """The core's one spool, started once; None when the CRM is not the line's."""
    global _ZEYTUN_ORDER_SPOOL
    with _ZEYTUN_ORDER_SPOOL_LOCK:
        if _ZEYTUN_ORDER_SPOOL is None:
            try:
                url = ZeytunInboundBridge.endpoints(runtime_url, token)[0]
            except ZeytunPilotUnavailable:
                return None
            spool = ZeytunOrderSpool(os.environ.get("ZEYTUN_ORDER_SPOOL_DIR") or ZeytunOrderSpool.DIRECTORY,
                lambda body: zeytun_post_json(url, token, body, ZeytunOrderSpool.POST_TIMEOUT_SECONDS),
                log=lambda status, call_id=None, **fields: log("zeytun_order_spool", call_id, status=status, **fields))
            log("zeytun_order_spool", None, status="ready" if spool.ready else "unavailable", dir=spool.directory)
            _ZEYTUN_ORDER_SPOOL = spool.start()
        return _ZEYTUN_ORDER_SPOOL


class ZeytunInboundBridge:
    NAME = "search_pharmacy_catalog"
    # Owner, 2026-10-23: the agent must total the order ("не может цены
    # группировать"). The model does no arithmetic: this tool multiplies the
    # list prices this call already returned, exactly, on the station.
    TOTAL_NAME = "calculate_order_total"
    # Owner, 2026-10-24: «делай карточку заказа и сообщение менеджеру». The
    # agreed list goes to the CRM, which resolves and prices it against the
    # catalog itself; the model's words only name the lines.
    SAVE_NAME = "save_order_list"
    # Owner, 2026-10-27: «переводить на менеджеров Зейтуна в браузере CRM, как
    # обычный входящий». The CRM records the request; the agent says the
    # CRM's phrase, the station ends this AI leg after it (closing_keys) and
    # rings the managers' browsers. Offered only when the CRM names a phrase.
    TRANSFER_NAME = "transfer_to_manager"
    # Owner's call 2026-10-31: asked to cancel, the agent said goodbye and the
    # order went to the managers. The CRM marks the call's order cancelled;
    # offered only when the CRM names the phrase, like the transfer.
    CANCEL_NAME = "cancel_order"
    # Owner's call 2026-11-03: «я говорю подтверждаю, а он говорит да, я понял,
    # отменяю». To "Sifarişi ləğv edək?" recognition heard "Tərtiblə" and the
    # model cancelled anyway. A cancel cannot be undone on the call, so the
    # station itself reads the caller's answer to that question: only a plain
    # yes cancels; "təsdiq", "yox" or anything unclear leaves the order.
    CANCEL_QUESTION = "ləğv edək"
    CANCEL_YES = ("bəli", "beli", "hə", "he", "həə", "hee", "ha", "hı", "ok", "okey", "olsun", "razıyam",
                  "düzdür", "əlbəttə", "да", "ага", "конечно")
    CANCEL_NO = ("yox", "xeyr", "təsdiq", "saxla", "dayan", "gözlə", "lazımdır", "нет", "не", "подтвер", "оставь")
    CANCEL_ANSWER_WAIT_SECONDS = 1.5
    # Owner, 2026-10-27: a long order must not be lost. The CRM allows a call
    # up to 15 minutes (the core's own ceiling is 900 s) and the agent saves
    # the list after every line, so the per-call tool budget and the prompt
    # (which now carries that rule) are larger than the 5-minute pilot's.
    MAX_CALL_SECONDS = 900
    # Owner, 2026-11-04: the agent is to sell as well (promotions, substitutes,
    # "as usual"), and the 8000 left the company notes 910 characters. The
    # station takes 12000 first; the CRM raises its own limit only after
    # this core is live (src/__tests__/lib-zeytun-inbound-pilot.test.ts).
    MAX_PROMPT_CHARS = 12000
    MAX_TOOL_CALLS = 256
    # Owner, 2026-10-23: ~99% of these calls are Azerbaijani. Without a hint
    # the provider re-detects the language of every short phone turn; measured
    # against the live API on 8 kHz mu-law audio, two-word Azerbaijani turns
    # came back as Japanese, Korean, Spanish or Italian. Pinned per session,
    # so a replacement session after recovery gets the same hint. Explicit
    # language switching is still handled by the core's language policy.
    TRANSCRIPTION_LANGUAGES = ("az-AZ",)
    # The agent's own voice, 2026-10-23 call: one provider session, no
    # recovery, yet the voice changed after a turn transcribed as Turkish.
    # Unpinned, the provider picks the spoken language and accent per turn.
    # Accepted by gemini-3.8-live (voice Sulafat) on 2026-10-23.
    SPEECH_LANGUAGE = "az-AZ"
    # Owner, 2026-10-23, of Sulafat with the pin: "голос ужасный, акцент
    # провинциальный". The CRM may name another prebuilt voice and turn the
    # spoken-language pin off for this pilot, so choosing by ear needs no
    # station install. Anything outside this list keeps the station's voice.
    VOICES = frozenset({
        "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
        "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
        "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird",
        "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
    })
    # Order words only: units, forms and packaging. Medicine names are left
    # out on purpose: a hard-coded list here would drift from the catalog.
    TRANSCRIPTION_VOCABULARY = (
        "qutu", "ədəd", "ampula", "flakon", "şam", "tablet", "həb", "kapsul", "sirop",
        "suspenziya", "damcı", "sprey", "məlhəm", "krem", "gel", "toz", "paket", "blister",
        "şpris", "məhlul", "milliqram", "mikroqram", "millilitr", "qram", "beynəlxalq vahid",
        "film örtüklü",
        # 2026-10-25 live call: "ampula" came back as "анкетирование". Callers
        # in Baku say the form in Russian as often as in Azerbaijani.
        "ампулы", "таблетки", "капсулы", "свечи", "суппозитории", "сироп", "капли",
        "мазь", "гель", "крем", "спрей", "саше", "флакон", "упаковка", "коробка", "штук",
        # 2026-10-31 live call: "ləğv edin" came back as "Çox sağ olun".
        "ləğv", "ləğv edin", "sifarişi ləğv edin", "отмените", "отменить заказ",
        # 2026-11-03 live call: with only the cancel phrase hinted, "Sifarişi
        # təsdiq edin" came back as "Sifarişi ləğv edin". Hint both alike.
        "təsdiq", "təsdiq edin", "sifarişi təsdiq edin", "təsdiqləyirəm", "подтверждаю", "подтвердите",
    )

    @staticmethod
    def endpoints(runtime_url, token):
        """The line's CRM addresses, derived only from the pinned runtime URL."""
        parsed = urllib.parse.urlsplit(runtime_url)
        if (parsed.scheme != "https" or parsed.hostname != "app.leaddrivecrm.org"
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.path != "/api/internal/voice-agent/runtime-config"
                or parsed.query or parsed.fragment or not token):
            raise ZeytunPilotUnavailable("pilot_transport_unavailable")
        return (urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/api/internal/voice-agent/pharmacy-inbound", "", "")),
                urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/api/internal/asterisk/call-lifecycle", "", "")))

    def __init__(self, runtime_url, token, call_id, request=None, clock=None, announce_answered=None, spool=None,
                 utterances=None, post_utterance=None):
        self.url, self.lifecycle_url = self.endpoints(runtime_url, token)
        self.call_id = str(uuid.UUID(call_id))
        self.token = token
        self.clock = clock or time.time
        self.request = request or self._request
        self.announce_answered = announce_answered or self._announce_answered
        # Where a save waits when the CRM does not answer it (ZeytunOrderSpool).
        self.spool = spool
        self.order_seq = 0
        # The call's order number once the CRM has given it (one order per call).
        self.order_number = None
        # The list of the latest save, as sent: a fresh session after a drop resaves it (zeytun_restore_note).
        self.last_lines = []
        self.lock = threading.Lock()
        self.pending = {}
        self.workers = threading.BoundedSemaphore(2)
        self.seen = set()
        self.expires = 0
        self.active = False
        self.prices = {}
        self.closing = None
        self.voice = None
        self.pin_language = True
        self.tts_voice = None
        self.tts_model = None
        self.tts_style = None
        self.relay = None
        self.vocabulary = ()
        self.transfer_phrase = None
        self.cancel_phrase = None
        # Once the CRM cancelled the call's order, no list of it is sent again.
        self.cancelled = False
        # What the caller said since the agent last asked CANCEL_QUESTION
        # (None: not asked, or the answer was already used).
        self.cancel_answer = None
        self.model_turn_text = ""
        self.cancel_asked_this_turn = False
        # Set by the core: called with the phrase once the CRM took the transfer.
        self.on_transfer = None
        # Set by the core: the station journal (zeytun_cancel status=...).
        self.log = lambda status, **fields: None
        # Set by the core: other station journal lines (event name, fields).
        self.log_event = lambda event, **fields: None
        # Set by the core: called when a lookup has run FILLER_AFTER_SECONDS.
        self.on_wait = None
        # The second ear (utterance_edge): on once the CRM's session asks for
        # it ("utterance": true), so a CRM without the action never gets one.
        # ZEYTUN_UTTERANCE_ENABLED=0 is the station's emergency off switch.
        self.utterance_switch = (os.environ.get("ZEYTUN_UTTERANCE_ENABLED") != "0") if utterances is None else bool(utterances)
        self.utterances = False
        self.post_utterance = post_utterance or self._post_utterance
        self.utterance_lock = threading.Lock()
        self.utterance = None
        self.utterance_cut = False
        # The frames before a phrase opens (#1342): the station's detector opens
        # it ~280 ms into the word, and Chirp heard "Lumi 600" for "Fluimucil
        # 600", "hansı…" for "Paracetamol hansı…". 480 ms, as the core's own
        # lookback for the provider (GEMINI_LIVE_GATED_LOOKBACK_FRAMES).
        self.utterance_lookback = collections.deque(maxlen=self.UTTERANCE_LOOKBACK_FRAMES)
        self.utterance_seq = 0
        self.utterance_busy = False

    # At the top of each minute the CRM answered in 1-4 s (measured 2026-10-28,
    # the hour a call was hung up for a 2 s deadline). A lookup that times out
    # tells the caller the catalog is unavailable, and a failed answer ACK ends
    # the AI call before its greeting, so neither may be shorter than that.
    LOOKUP_TIMEOUT_SECONDS = 4
    FILLER_AFTER_SECONDS = 1.0
    ANSWER_ACK_TIMEOUT_SECONDS = 5

    def _request(self, body):
        # The first session also builds the pinned catalog once. Keep that
        # cold start separate from the shorter deadline for spoken lookups.
        action = body.get("action")
        return self._post_json(self.url, body, timeout=5 if action == "session" else 6 if action in ("order", "transfer", "cancel")
                               else self.LOOKUP_TIMEOUT_SECONDS)

    def _post_json(self, url, body, timeout=2):
        return zeytun_post_json(url, self.token, body, timeout)

    # Owner, 2026-11-04 (task 6 of docs/zeytun-line-recognition-plan.md, PR
    # #1318): with Google Chirp's text of the same phrase the search found
    # 84 % of the names instead of 71 %. The core hands the bridge each caller
    # phrase, activityStart to activityEnd, as the 8 kHz PCM16 the provider
    # gets before its resample, without the lookback; the CRM transcribes it
    # and searches with that text as well. Nothing here waits on the CRM: one
    # phrase is in flight per call, the next one while it is is not sent, and
    # a CRM that does not know the action (400/404) is not asked again on this
    # call, nor one that answers "off". The journal says how it went, never
    # what was said.
    UTTERANCE_RATE = 8000
    UTTERANCE_MAX_BYTES = 8000 * 2 * 15
    UTTERANCE_MIN_BYTES = 8000 * 2 // 5  # under 0.2 s is a click, not a phrase
    UTTERANCE_TIMEOUT_SECONDS = 3
    UTTERANCE_LOOKBACK_FRAMES = 24  # 20 ms frames

    def _post_utterance(self, body):
        req = urllib.request.Request(self.url, data=json.dumps(body, separators=(",", ":")).encode("ascii"),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method="POST")
        with ZEYTUN_HTTP.open(req, self.UTTERANCE_TIMEOUT_SECONDS) as response:
            raw = response.read(32768)
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def utterance_audio(self, pcm):
        """Every caller frame, on the audio thread: kept only inside a phrase, at most 15 s of it."""
        if not self.utterances:
            return
        with self.utterance_lock:
            phrase = self.utterance
            if phrase is None:
                self.utterance_lookback.append(bytes(pcm))
                return
            room = self.UTTERANCE_MAX_BYTES - len(phrase)
            if len(pcm) > room:
                self.utterance_cut = True
            if room > 0:
                phrase.extend(pcm[:room])

    def utterance_edge(self, opened, pcm=b""):
        """activityStart (True, with its first frame) or activityEnd (False) of a caller phrase."""
        if self.relay is not None:
            (self.relay.caller_spoke if opened else self.relay.caller_done)()
        if not self.utterances:
            return
        with self.utterance_lock:
            if opened:
                # A phrase still open here was cut by a session the core
                # replaced; its audio is not sent, and never twice. The core
                # hands the opening frame to utterance_audio first, so it is
                # the lookback's last frame already: never added twice.
                frames = list(self.utterance_lookback)
                self.utterance_lookback.clear()
                if pcm and (not frames or frames[-1] != pcm):
                    frames.append(bytes(pcm))
                audio = b"".join(frames)
                self.utterance = bytearray(audio[:self.UTTERANCE_MAX_BYTES])
                self.utterance_cut = len(audio) > self.UTTERANCE_MAX_BYTES
                return
            phrase, cut, self.utterance = self.utterance, self.utterance_cut, None
            if phrase is None:
                return
            self.utterance_seq += 1
            seq = self.utterance_seq
            seconds = round(len(phrase) / (2.0 * self.UTTERANCE_RATE), 2)
            status = None
            if not self.active or self.clock() >= self.expires:
                status = "expired"
            elif len(phrase) < self.UTTERANCE_MIN_BYTES:
                status = "short"
            elif self.utterance_busy:
                status = "busy"
            else:
                self.utterance_busy = True
        if status is not None:
            self._utterance_log(status=status, seq=seq, seconds=seconds)
            return
        body = {"action": "utterance", "callId": self.call_id, "seq": seq,
                "audio": base64.b64encode(bytes(phrase)).decode("ascii")}
        try:
            threading.Thread(target=self._send_utterance, args=(body, seconds, cut),
                             name="zeytun-utterance", daemon=True).start()
        except Exception:
            with self.utterance_lock:
                self.utterance_busy = False
            self._utterance_log(status="no_thread", seq=seq, seconds=seconds)

    def _utterance_log(self, **fields):
        # Called on the audio thread too: a journal failure never reaches the call.
        try:
            self.log_event("zeytun_utterance", **fields)
        except Exception:
            pass

    def _send_utterance(self, body, seconds, cut):
        sent = time.monotonic()
        status = "ok"
        try:
            answer = self.post_utterance(body)
            said = answer.get("status") if isinstance(answer, dict) else None
            if said == "off":
                # No key at the CRM, or not a line call: nothing to hear.
                self.utterances = False
                status = "off"
            elif said == "busy":
                status = "crm_busy"
        except Exception as error:
            status = zeytun_failure(error)
            if isinstance(error, urllib.error.HTTPError) and error.code in (400, 404):
                # A CRM without the action (or with another schema) refuses
                # every phrase alike: stop asking for the rest of the call.
                self.utterances = False
        finally:
            with self.utterance_lock:
                self.utterance_busy = False
        self._utterance_log(status=status, seq=body["seq"], seconds=seconds, cut=cut,
                            ms=round((time.monotonic() - sent) * 1000))

    def _announce_answered(self):
        # This bridge is opened only after accepting the call's AudioSocket.
        # Report that actual media observation; do not wait for the 10s AGI
        # spool timer and do not change Answer-to-AudioSocket dialplan timing.
        body = {"eventId": str(uuid.uuid5(uuid.NAMESPACE_URL, "zeytun-inbound-media:" + self.call_id)),
                "callId": self.call_id, "state": "answered",
                "occurredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))}
        result = self._post_json(self.lifecycle_url, body, timeout=self.ANSWER_ACK_TIMEOUT_SECONDS)
        return isinstance(result, dict) and result.get("success") is True

    def open(self):
        try:
            value = self.request({"action": "session", "callId": self.call_id})
            if value == {"enabled": False}:
                return None
            if value == {"enabled": False, "status": "awaiting_answered"}:
                if not self.announce_answered():
                    raise ValueError()
                # Exactly one new authorization after the lifecycle ACK. A
                # closed/revoked/still-unanswered call stops; no AAC fallback.
                value = self.request({"action": "session", "callId": self.call_id})
            if not isinstance(value, dict) or value.get("enabled") is not True or value.get("variant") != "pharmacy_inbound_preview":
                raise ValueError()
            prompt, opening, seconds = value.get("prompt"), value.get("opening"), value.get("maxSeconds")
            if (not isinstance(prompt, str) or not 1 <= len(prompt) <= self.MAX_PROMPT_CHARS
                    or not isinstance(opening, str) or not 1 <= len(opening) <= 500
                    or type(seconds) is not int or not 30 <= seconds <= self.MAX_CALL_SECONDS):
                raise ValueError()
            # Server's ceiling is bounded again locally; the core counts it from
            # AudioSocket connect. Never parse a model-supplied expiry or URL.
            closing = value.get("closing")
            if closing is not None and (not isinstance(closing, str) or not 3 <= len(closing) <= 120):
                raise ValueError()
            transfer, cancel = value.get("transfer"), value.get("cancel")
            for phrase in (transfer, cancel):
                if phrase is not None and (not isinstance(phrase, str) or not 3 <= len(phrase) <= 120):
                    raise ValueError()
            voice, pin = value.get("voice"), value.get("pinSpeechLanguage")
            self.expires = self.clock() + seconds
            self.active = True
            self.utterances = self.utterance_switch and value.get("utterance") is True
            self.closing = closing
            self.transfer_phrase = transfer
            self.cancel_phrase = cancel
            self.voice = voice if voice in self.VOICES else None
            self.pin_language = pin is not False
            # Owner, 2026-10-23: "эту ставь" - the gemini-3.8-flash-tts voice.
            # Only a known model and voice switch the relay on; anything else
            # keeps the model's own voice, never a guessed one.
            # 2026-10-25 live call: "Sopharma" was transcribed "суппозитории".
            # The CRM sends the catalog's manufacturer words; only short
            # printable words are taken, and the base list always comes first.
            words = value.get("vocabulary")
            if isinstance(words, list):
                self.vocabulary = tuple(dict.fromkeys(
                    w.strip() for w in words[:400]
                    if isinstance(w, str) and 2 <= len(w.strip()) <= 40 and w.isprintable()))
            speech = value.get("speech")
            if (isinstance(speech, dict) and speech.get("engine") == "tts"
                    and speech.get("model") in ZeytunGeminiTts.MODELS and speech.get("voice") in self.VOICES):
                self.tts_model, self.tts_voice = speech["model"], speech["voice"]
                # How the voice speaks, never what it says: plain words only.
                style = speech.get("style")
                if (isinstance(style, str) and 1 <= len(style.strip()) <= 400 and style.isprintable()
                        and not re.search(r"[<>\[\]{}]", style)):
                    self.tts_style = style.strip()
            return {"prompt": prompt, "opening": opening, "maxSeconds": seconds, "closing": closing, "transfer": transfer,
                    "cancel": cancel}
        except Exception:
            raise ZeytunPilotUnavailable("pilot_session_unavailable") from None

    def tools(self):
        if not self.active or self.clock() >= self.expires:
            raise ZeytunPilotUnavailable("pilot_expired")
        # gemini-3.8-live runs a tool asynchronously unless it is declared
        # BLOCKING (src/lib/ai/voice/gemini-live.ts, measured 2026-10-08): the
        # model said "checking" and, with the result in, waited for the caller
        # to speak — 28 s of silence on the owner's call 2026-10-30.
        declarations = self._declarations()
        for declaration in declarations[0]["functionDeclarations"]:
            declaration["behavior"] = "BLOCKING"
        return declarations

    def _declarations(self):
        # Short on purpose (owner, 2026-11-04: «мне нужна оптимизация»): these
        # are sent with every turn of the call; how to talk is the CRM's
        # prompt, here only what each tool does and what its answers mean.
        return [{"functionDeclarations": [{"name": self.NAME,
            "description": "Search Zeytun's catalog by exactly one key. Candidates are unverified; listPrice is for one unit (per).",
            "parameters": {"type": "OBJECT", "properties": {
                key: {"type": "STRING", "description": description}
                for key, description in {
                    "text": "Name and details as spoken, at most 240 characters.",
                    "itemCode": "Code the caller said.",
                    "barcode": "Barcode the caller said.",
                    "externalId": "From an earlier lookup.",
                }.items()}}},
            {"name": self.TOTAL_NAME,
             "description": "Exact total of lines looked up in this call with listPrice. Read back only what it returns.",
             "parameters": {"type": "OBJECT", "properties": {"lines": {"type": "ARRAY", "items": {"type": "OBJECT",
                 "properties": {"externalId": {"type": "STRING"},
                                "quantity": {"type": "INTEGER", "description": "Whole units, in listPrice.per."},
                                "unit": {"type": "STRING"}},
                 "required": ["externalId", "quantity", "unit"]}}}, "required": ["lines"]}},
            {"name": self.SAVE_NAME,
             "description": "Save the whole list so far, resolved or not: after every line that is settled, and once more with final true when the caller has nothing to add. An ordinary save returns recorded: say nothing. Only the final save returns saved with orderNumber, or queued.",
             "parameters": {"type": "OBJECT", "properties": {"lines": {"type": "ARRAY", "items": {"type": "OBJECT",
                 "properties": {"externalId": {"type": "STRING", "description": "Omit if unresolved."},
                                "quantity": {"type": "INTEGER", "description": "In the caller's unit."},
                                "unit": {"type": "STRING", "description": "The caller's unit: qutu, ədəd, flakon, ..."},
                                "spoken": {"type": "STRING", "description": "The caller's words, at most 160 characters."}},
                 "required": ["quantity", "unit", "spoken"]}},
                 "pharmacy": {"type": "STRING", "description": "As named, at most 120 characters."},
                 "final": {"type": "BOOLEAN", "description": "true only after the caller confirmed the whole order (təsdiq edin, bu qədər); never per line. Only a final order goes to the pharmacy on WhatsApp."}},
                 "required": ["lines"]}}] + ([
            {"name": self.TRANSFER_NAME,
             "description": "Only when the caller asks for a person. transferring: say exactly its say text, then nothing. unavailable: no manager now; keep taking the order.",
             "parameters": {"type": "OBJECT", "properties": {}}}] if self.transfer_phrase else []) + ([
            {"name": self.CANCEL_NAME,
             "description": "Cancel the whole order, only after the caller asked to cancel (ləğv, отмена) and said yes to \"Sifarişi ləğv edək?\". təsdiq or подтверждаю confirms the order: finish it, never ask about cancelling. cancelled: say its say text, then the closing. not_confirmed: the order stays; say so. not_cancelled: it is with the manager already.",
             "parameters": {"type": "OBJECT", "properties": {}}}] if self.cancel_phrase else [])}]

    def transcription(self):
        # Fields of AudioTranscriptionConfig (ai.google.dev/api/live); accepted
        # by gemini-3.1-flash-live-preview and gemini-3.8-live on 2026-10-23.
        words = list(dict.fromkeys(self.TRANSCRIPTION_VOCABULARY + self.vocabulary))
        # More than 1000 entries is rejected by the provider (2026-10-23).
        return {"languageCodes": list(self.TRANSCRIPTION_LANGUAGES), "customVocabulary": words[:1000]}

    def speech_language(self):
        return self.SPEECH_LANGUAGE if self.pin_language else None

    def speech_voice(self):
        return self.voice

    @staticmethod
    def tts_vertex(environ=None):
        """The station's Vertex AI path for the TTS (task 9), from the service's
        environment: a drop-in EnvironmentFile, root-only. None: Gemini API only."""
        environ = os.environ if environ is None else environ
        project = (environ.get("ZEYTUN_TTS_VERTEX_PROJECT") or "").strip()
        key = (environ.get("ZEYTUN_TTS_VERTEX_KEY") or "").strip()
        return (project, key) if project and key else None

    def speech_relay(self, key, inject, speakable, alive, room=None, log=None, tts=None,
                     progress=None, recovering=None, ask=None, quiet=None, playing=None):
        """The call's TTS relay, created once; None while the model speaks itself."""
        if self.tts_model is None:
            return None
        if self.relay is None:
            engine = tts or ZeytunGeminiTts(key, self.tts_model, self.tts_voice, style=self.tts_style,
                                            vertex=self.tts_vertex())
            self.relay = ZeytunSpeechRelay(engine, inject, speakable, alive, room=room, log=log,
                                           progress=progress, recovering=recovering, ask=ask, quiet=quiet,
                                           playing=playing)
            warm = getattr(engine, "warm", None)
            if warm is not None:
                warm()
            self.relay.prefetch_filler()
            if ZeytunSpeechRelay.BARGE_ACK_SECONDS is not None:
                self.relay.prefetch_filler(ZEYTUN_BARGE_ACK)
        return self.relay

    @staticmethod
    def query(args):
        if not isinstance(args, dict) or len(args) != 1:
            return None
        key, value = next(iter(args.items()))
        if key not in {"text", "itemCode", "barcode", "externalId"} or not isinstance(value, str):
            return None
        if not value.strip() or len(value) > (240 if key == "text" else 512):
            return None
        if key == "externalId":
            try:
                if str(uuid.UUID(value)) != value.lower():
                    return None
            except ValueError:
                return None
        return {key: value}

    # Owner, 2026-11-04 («мне нужна оптимизация»): every answer stays in the
    # model's context and is billed again on every later turn and tool round
    # of the call (~300 tokens a lookup, a quarter of the text input). The
    # model sees only what the line's rules use; the CRM's safety flags are
    # still checked here (restricted, identityVerified) and never forwarded.
    @staticmethod
    def unavailable(status="catalog_unavailable"):
        return {"status": status, "candidates": []}

    @staticmethod
    def restricted(value):
        return (all(value.get(key) is False for key in ["canQuote", "canSubmitTo1c", "canResolveIdentity"])
                and value.get("requiresOperatorReview") is True)

    def safe_result(self, value, with_code=False):
        """The lookup as the model sees it; with_code keeps itemCode, for a lookup by code."""
        if isinstance(value, dict) and value.get("mode") == "pharmacy_history":
            return self.safe_history(value)
        if (not isinstance(value, dict) or value.get("mode") != "owner_inbound_preview"
                or value.get("customerVerified") is not False or not self.restricted(value)):
            return self.unavailable()
        candidates = value.get("candidates")
        count = value.get("candidateCount")
        # Five of the model's own words and up to two the second ear heard (alsoHeard).
        if not isinstance(candidates, list) or len(candidates) > 7 or type(count) is not int or not 0 <= count <= 50000:
            return self.unavailable()
        result = self.unavailable("candidates")
        result["candidateCount"] = count
        for item in candidates:
            projected = self.candidate(item, with_code)
            if projected is None:
                return self.unavailable()
            heard = self.also_heard(item.get("alsoHeard"))
            if heard is not None:
                projected["alsoHeard"] = heard
            result["candidates"].append(projected)
        return result

    def candidate(self, item, with_code=False):
        """One catalog candidate as the model may see it, or None: then the whole answer is refused."""
        if not isinstance(item, dict) or item.get("identityVerified") is not False:
            return None
        projected = {}
        for key in ["externalId", "itemCode", "name", "nameAz"]:
            val = item.get(key)
            if key == "nameAz" and val is None:
                continue
            if not isinstance(val, str) or not 0 < len(val) <= 512:
                return None
            if key != "itemCode" or with_code:
                projected[key] = val
        price = self.list_price(item.get("listPrice"))
        if price is not None:
            # Checked whole (AZN, its date); the model reads amount and unit.
            projected["listPrice"] = {"amount": price["amount"], "per": price["per"]}
            with self.lock:
                if len(self.prices) < 256:
                    self.prices[projected["externalId"]] = (Decimal(price["amount"]), price["per"])
        stock = self.stock(item.get("stock"))
        if stock is not None:
            projected["stock"] = stock
        promotion = self.promotion(item.get("promotion"))
        if promotion is not None:
            projected["promotion"] = promotion
        # Task 11 (2026-11-06): the one variant of its name the calling pharmacy orders; only a plain true.
        if item.get("usual") is True:
            projected["usual"] = True
        return projected

    # The CRM's second ear (#1321): the word Google Chirp heard where the
    # model heard another, so the agent can ask "Adexa or Adefa?". A short
    # plain word or nothing: anything else is dropped, the candidate kept.
    @staticmethod
    def also_heard(value):
        if (isinstance(value, str) and 1 <= len(value) <= 64 and value.strip()
                and all(c.isalpha() or c in "0123456789 -'." for c in value)):
            return value
        return None

    # «Как обычно» (owner, 2026-11-04; #1309): for "history:" the CRM answers
    # with the call's own pharmacy's last confirmed order. Each line is a
    # candidate of today's catalog with what was ordered; a product the
    # catalog no longer has comes as unavailable, only its id, name and order.
    HISTORY_STATUSES = frozenset({"found", "none", "pharmacy_unknown"})
    HISTORY_MAX_LINES = 10

    def safe_history(self, value):
        status = value.get("status")
        candidates = value.get("candidates")
        if (status not in self.HISTORY_STATUSES or not self.restricted(value) or not isinstance(candidates, list)
                or len(candidates) > self.HISTORY_MAX_LINES or (status != "found" and candidates)):
            return self.unavailable()
        result = self.unavailable(status)
        result["mode"] = "pharmacy_history"
        if status != "found":
            return result
        number, at, count = value.get("orderNumber"), value.get("orderedAt"), value.get("lineCount")
        if (not isinstance(number, str) or not 1 <= len(number) <= 32 or not number.isprintable()
                or not isinstance(at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", at)
                or type(count) is not int or not 0 <= count <= 500):
            return self.unavailable()
        result.update({"orderNumber": number, "orderedAt": at, "lineCount": count})
        for item in candidates:
            if isinstance(item, dict) and item.get("unavailable") is True:
                key, name = item.get("externalId"), item.get("name")
                if not isinstance(key, str) or not 0 < len(key) <= 512:
                    return self.unavailable()
                if not isinstance(name, str) or not 0 < len(name) <= 512:
                    continue  # nothing the agent could name
                projected = {"externalId": key, "name": name}
            else:
                projected = self.candidate(item)
                if projected is None:
                    return self.unavailable()
            ordered = self.ordered(item.get("ordered"))
            if ordered is not None:
                projected["ordered"] = ordered
            if item.get("unavailable") is True:
                projected["unavailable"] = True
            result["candidates"].append(projected)
        return result

    @staticmethod
    def ordered(value):
        if not isinstance(value, dict) or set(value) != {"quantity", "unit"}:
            return None
        quantity, unit = value["quantity"], value["unit"]
        if (type(quantity) is not int or not 1 <= quantity <= 100000 or not isinstance(unit, str)
                or not 1 <= len(unit) <= 16 or not unit.isprintable()):
            return None
        return {"quantity": quantity, "unit": unit}

    # Owner, 2026-10-23: one final price for all of Zeytun's pharmacies. Only
    # this exact shape reaches the model; anything else is dropped, never
    # forwarded, so a malformed price is silence rather than a wrong number.
    LIST_PRICE_UNITS = frozenset({"ədəd", "qutu", "flakon", "ampula", "blister", "şpris", "cüt"})

    def list_price(self, value):
        if value is None or not isinstance(value, dict) or set(value) != {"amount", "currency", "per", "asOf"}:
            return None
        amount, currency, per, as_of = value["amount"], value["currency"], value["per"], value["asOf"]
        if (not isinstance(amount, str) or not re.fullmatch(r"\d{1,7}(?:\.\d{1,4})?", amount)
                or not re.search(r"[1-9]", amount) or currency != "AZN" or per not in self.LIST_PRICE_UNITS
                or not isinstance(as_of, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T[0-9:.]{8,15}Z", as_of)):
            return None
        return {"amount": amount, "currency": currency, "per": per, "asOf": as_of}

    # Owner, 2026-10-27: the agent tells the pharmacy what the warehouse has
    # when it asks for more, and 1C's "buy N, get M" offer. The same rule as
    # the price: only these exact shapes reach the model, anything else is
    # dropped. 1C shows at most 100, which the CRM marks as orMore.
    STOCK_SHOWN_MAX = 100

    def stock(self, value):
        if not isinstance(value, dict) or set(value) - {"quantity", "per", "orMore"} or not {"quantity", "per"} <= set(value):
            return None
        quantity, per, more = value["quantity"], value["per"], value.get("orMore")
        if type(quantity) is not int or not 0 <= quantity <= self.STOCK_SHOWN_MAX or per not in self.LIST_PRICE_UNITS:
            return None
        if "orMore" in value and (more is not True or quantity != self.STOCK_SHOWN_MAX):
            return None
        return {"quantity": quantity, "per": per, **({"orMore": True} if more is True else {})}

    def promotion(self, value):
        if not isinstance(value, dict) or set(value) - {"buy", "get", "per", "until"} or not {"buy", "get", "until"} <= set(value):
            return None
        buy, get, until = value["buy"], value["get"], value["until"]
        if (type(buy) is not int or type(get) is not int or not 1 <= buy <= 100000 or not 1 <= get <= 100000
                or not isinstance(until, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", until)):
            return None
        if "per" in value and value["per"] not in self.LIST_PRICE_UNITS:
            return None
        return {"buy": buy, "get": get, "until": until, **({"per": value["per"]} if "per" in value else {})}

    def order_total(self, args):
        """Exact sum on the station; a line without a price returned in this
        call, or in another unit, is named and left out, never guessed."""
        lines = args.get("lines") if isinstance(args, dict) and set(args) == {"lines"} else None
        if not isinstance(lines, list) or not 1 <= len(lines) <= 30:
            return {"status": "invalid_request"}
        total, priced, skipped = Decimal("0"), [], []
        for line in lines:
            if not isinstance(line, dict) or set(line) != {"externalId", "quantity", "unit"}:
                return {"status": "invalid_request"}
            key, quantity, unit = line["externalId"], line["quantity"], line["unit"]
            if isinstance(quantity, float) and quantity.is_integer():
                quantity = int(quantity)
            if (not isinstance(key, str) or not isinstance(unit, str) or type(quantity) is not int
                    or not 1 <= quantity <= 100000):
                return {"status": "invalid_request"}
            with self.lock:
                known = self.prices.get(key)
            if known is None:
                skipped.append({"externalId": key, "reason": "no_price_in_this_call"})
            elif unit.strip().lower() != known[1]:
                skipped.append({"externalId": key, "reason": "unit_differs_from_price_unit", "priceUnit": known[1]})
            else:
                amount = (known[0] * quantity).quantize(Decimal("0.01"))
                total += amount
                priced.append({"externalId": key, "quantity": quantity, "unit": known[1],
                               "unitPrice": str(known[0]), "lineTotal": str(amount)})
        return {"status": "total", "currency": "AZN", "total": str(total.quantize(Decimal("0.01"))),
                "lines": priced, "notIncluded": skipped, "complete": not skipped}

    @staticmethod
    def order_request(args):
        """The save call as the CRM accepts it ({"lines", "pharmacy"?, "final"?}), or None.

        final: the save after the caller confirmed the whole order (owner's
        call 2026-11-03: he hung up mid-order and still got the list on
        WhatsApp). Only true is sent; false or absent is an ordinary save.
        """
        if not isinstance(args, dict) or not {"lines"} <= set(args) <= {"lines", "pharmacy", "final"}:
            return None
        lines = ZeytunInboundBridge.order_lines({"lines": args["lines"]})
        pharmacy, final = args.get("pharmacy"), args.get("final")
        if (lines is None or (pharmacy is not None and (not isinstance(pharmacy, str) or not 1 <= len(pharmacy.strip()) <= 120))
                or (final is not None and not isinstance(final, bool))):
            return None
        return {"lines": lines, **({"pharmacy": pharmacy.strip()} if pharmacy is not None else {}), **({"final": True} if final else {})}

    @staticmethod
    def order_lines(args):
        """The save call's lines exactly as the CRM accepts them, or None."""
        lines = args.get("lines") if isinstance(args, dict) and set(args) == {"lines"} else None
        if not isinstance(lines, list) or not 1 <= len(lines) <= 30:
            return None
        result = []
        for line in lines:
            if not isinstance(line, dict) or not {"quantity", "unit", "spoken"} <= set(line) <= {"externalId", "quantity", "unit", "spoken"}:
                return None
            quantity, unit, spoken = line["quantity"], line["unit"], line["spoken"]
            if isinstance(quantity, float) and quantity.is_integer():
                quantity = int(quantity)
            if (type(quantity) is not int or not 1 <= quantity <= 100000 or not isinstance(unit, str)
                    or not 1 <= len(unit.strip()) <= 24 or not isinstance(spoken, str) or not 1 <= len(spoken.strip()) <= 160):
                return None
            item = {"quantity": quantity, "unit": unit.strip(), "spoken": spoken.strip()}
            key = line.get("externalId")
            if key is not None:
                try:
                    if not isinstance(key, str) or str(uuid.UUID(key)) != key.lower():
                        return None
                except ValueError:
                    return None
                item["externalId"] = key.lower()
            result.append(item)
        return result

    @staticmethod
    def safe_saved(value):
        """Only the fields the model may read back; anything else is "not saved"."""
        if not isinstance(value, dict):
            return {"status": "not_saved"}
        number = value.get("orderNumber")
        if not isinstance(number, str) or not re.fullmatch(r"TS-\d{1,9}", number):
            return {"status": "not_saved"}
        if value.get("status") == "already_reviewed":
            return {"status": "already_reviewed", "orderNumber": number}
        total, notes = value.get("total"), {}
        if value.get("status") != "saved" or not isinstance(total, str) or not re.fullmatch(r"\d{1,12}\.\d{2}", total):
            return {"status": "not_saved"}
        for key in ("notFound", "unpriced"):
            items = value.get(key)
            if not isinstance(items, list) or len(items) > 30 or not all(isinstance(i, str) and len(i) <= 160 for i in items):
                return {"status": "not_saved"}
            notes[key] = items
        return {"status": "saved", "orderNumber": number, "total": total, "currency": "AZN", **notes}

    def save_order(self, args):
        """One save, as the model hears it.

        Owner's call 2026-11-04 (TS-1015): the first save after a line came
        back "saved" with the order number, and the agent — told to announce
        the number and say goodbye when a save returns saved — closed the call
        two products in. Only the final save (after «təsdiq») is "saved" with
        the number now; any other is "recorded", with what was not found.
        """
        result = self._save_order(args)
        if args.get("final") is True or result.get("status") not in ("saved", "queued"):
            return result
        return {"status": "recorded", **{key: result[key] for key in ("notFound", "unpriced") if key in result}}

    def _save_order(self, args):
        """One save: kept on the station's disk, then sent. A CRM that does not
        answer leaves it kept, and the model hears queued: the spool delivers
        it. A CRM that answers, yes or no, settles it.

        Owner, 2026-10-30: «долго принимает заказ». The agent saves after every
        line, and each save held its next words (and a lookup slot) for the
        CRM's answer, 1-4 s at the top of a minute. Once this call has its
        order number, a list kept on disk is answered at once with that number
        and sent behind the reply; the spool still delivers it if the CRM does
        not answer. The first save, and any save without a disk, still waits.
        """
        with self.lock:
            if self.cancelled:
                return {"status": "cancelled"}
            self.order_seq += 1
            seq = self.order_seq
            number = self.order_number
            self.last_lines = list(args.get("lines") or [])
        kept = self.spool is not None and self.spool.keep(self.call_id, seq, args)
        if kept and number is not None:
            try:
                threading.Thread(target=self._send_order, args=(seq, args, kept),
                                 name="zeytun-order-send", daemon=True).start()
                return {"status": "saved", "orderNumber": number}
            except Exception:
                pass
        return self._send_order(seq, args, kept)

    def _send_order(self, seq, args, kept):
        try:
            value = self.request({"action": "order", "callId": self.call_id, "seq": seq, **args})
        except Exception as error:
            if kept and zeytun_retryable(error):
                return {"status": "queued"}
            if kept:
                self.spool.settle(self.call_id, seq)
            return {"status": "not_saved"}
        if kept:
            self.spool.settle(self.call_id, seq)
        result = self.safe_saved(value)
        if result["status"] == "saved":
            with self.lock:
                self.order_number = result["orderNumber"]
        return result

    @classmethod
    def cancel_confirmed(cls, answer):
        """A plain yes, and nothing that says keep it."""
        words = re.findall(r"\w+", (answer or "").lower())
        if any(word.startswith(no) if len(no) > 3 else word == no for word in words for no in cls.CANCEL_NO):
            return False
        joined = " ".join(words)
        return any(word in cls.CANCEL_YES for word in words) or "ləğv edin" in joined or "ləğv olsun" in joined

    def note_content(self, content):
        """Follow the agent's words and the caller's answer to CANCEL_QUESTION."""
        spoken = []
        output = content.get("outputTranscription")
        if isinstance(output, dict) and isinstance(output.get("text"), str):
            spoken.append(output["text"])
        model_turn = content.get("modelTurn")
        if isinstance(model_turn, dict):
            for part in model_turn.get("parts") or []:
                if isinstance(part, dict) and isinstance(part.get("text"), str) and not part.get("thought"):
                    spoken.append(part["text"])
        heard = content.get("inputTranscription")
        with self.lock:
            if spoken:
                # Pieces carry their own spaces and may split a word.
                self.model_turn_text = (self.model_turn_text + "".join(spoken))[-2000:]
                said = " ".join(self.model_turn_text.lower().split())
                if not self.cancel_asked_this_turn and self.CANCEL_QUESTION in said:
                    self.cancel_asked_this_turn = True
                    self.cancel_answer = ""
            if isinstance(heard, dict) and isinstance(heard.get("text"), str) and self.cancel_answer is not None:
                self.cancel_answer = (self.cancel_answer + " " + heard["text"])[-500:]
            if content.get("turnComplete") is True or content.get("interrupted") is True:
                self.model_turn_text = ""
                self.cancel_asked_this_turn = False

    def caller_answer_to_cancel(self):
        """The caller's answer to CANCEL_QUESTION, waiting briefly for recognition to catch up."""
        deadline = time.monotonic() + self.CANCEL_ANSWER_WAIT_SECONDS
        while True:
            with self.lock:
                answer = self.cancel_answer
            if answer is None or answer.strip() or time.monotonic() >= deadline:
                break
            time.sleep(0.1)
        with self.lock:
            self.cancel_answer = None
        return answer

    def cancel_order(self):
        """The CRM cancels the call's order; the station then keeps and sends no
        list of it. A CRM that does not answer leaves the order as it is: the
        agent says so, and the kept list still reaches the manager."""
        answer = self.caller_answer_to_cancel()
        if not self.cancel_confirmed(answer):
            self.log("not_confirmed", asked=answer is not None)
            return {"status": "not_confirmed"}
        with self.lock:
            self.order_seq += 1
            seq = self.order_seq
        try:
            value = self.request({"action": "cancel", "callId": self.call_id, "seq": seq})
        except Exception:
            return {"status": "not_cancelled"}
        if not (isinstance(value, dict) and value.get("status") == "cancelled"
                and self.cancel_phrase and value.get("say") == self.cancel_phrase):
            return {"status": "not_cancelled"}
        with self.lock:
            self.cancelled = True
        if self.spool is not None:
            self.spool.settle(self.call_id, seq)
        return {"status": "cancelled", "say": self.cancel_phrase}

    def safe_transfer(self, value):
        """Transferring only with the exact phrase this session was given."""
        if (isinstance(value, dict) and value.get("status") == "transferring"
                and self.transfer_phrase and value.get("say") == self.transfer_phrase):
            return {"status": "transferring", "say": self.transfer_phrase}
        return {"status": "unavailable"}

    # gemini-3.8-live, USD per 1M tokens (ai.google.dev/gemini-api/docs/pricing, 2026-11-04);
    # the same table as the line stand's (scripts/zeytun-line/stand-crm.ts PRICE).
    LIVE_PRICE = {"textIn": 0.75, "audioIn": 3.0, "textOut": 4.5, "audioOut": 12.0}

    def add_usage(self, usage):
        """One usageMetadata of the call's Live sessions: every turn bills the whole context again."""
        def split(details, total):
            text = sum(d.get("tokenCount") or 0 for d in details or [] if isinstance(d, dict) and d.get("modality") == "TEXT")
            return text, max(0, (total or 0) - text)
        text_in, audio_in = split(usage.get("promptTokensDetails"), usage.get("promptTokenCount"))
        text_out, audio_out = split(usage.get("responseTokensDetails"), usage.get("responseTokenCount"))
        with self.lock:
            totals = self.__dict__.setdefault("usage_totals", {"textIn": 0, "audioIn": 0, "textOut": 0, "audioOut": 0, "turns": 0})
            totals["textIn"] += text_in
            totals["audioIn"] += audio_in
            totals["textOut"] += text_out + (usage.get("thoughtsTokenCount") or 0)
            totals["audioOut"] += audio_out
            totals["turns"] += 1

    def log_cost(self, log):
        """Owner's queue 2026-11-06, task 13: what the call cost in Live tokens, one line, once."""
        with self.lock:
            if self.__dict__.get("cost_logged"):
                return False
            self.cost_logged = True
            totals = dict(self.__dict__.get("usage_totals") or {"textIn": 0, "audioIn": 0, "textOut": 0, "audioOut": 0, "turns": 0})
        usd = sum(totals[key] * price for key, price in self.LIVE_PRICE.items()) / 1e6
        log("call", usd=round(usd, 4), **totals)
        return True

    USAGE_MODEL = re.compile(r"^[a-z0-9][a-z0-9.-]{0,63}$")

    def call_usage(self):
        """What this AI leg spent, sent with the call's result (owner, 2026-11-11: «почему
        расходов 0?» — the line's Live and speech run on the station's keys, and the CRM's
        spend report saw none of them). None when nothing was counted: the CRM then prices
        the leg by its length. The CRM's schema (voiceAgentLineUsageSchema) is strict."""
        with self.lock:
            totals = dict(self.__dict__.get("usage_totals") or {})
        usage = {}
        if totals.get("turns"):
            live = {key: int(totals.get(key) or 0) for key in ("textIn", "audioIn", "textOut", "audioOut", "turns")}
            model = globals().get("GEMINI_LIVE_MODEL")
            if isinstance(model, str) and self.USAGE_MODEL.match(model):
                live["model"] = model
            usage["live"] = live
        engine = getattr(self.relay, "tts", None)
        billed = getattr(engine, "billed", None)
        speech = billed() if callable(billed) else None
        if isinstance(speech, dict) and speech.get("requests"):
            model = getattr(engine, "model", None)
            if isinstance(model, str) and self.USAGE_MODEL.match(model):
                speech["model"] = model
            usage["tts"] = speech
        return usage or None

    def handle(self, event, send, current):
        """Network work never runs on the audio/event thread. send also fences
        the actual websocket/epoch under the core's existing recovery lock.
        """
        if isinstance(event, dict) and isinstance(event.get("usageMetadata"), dict):
            self.add_usage(event["usageMetadata"])
        cancel = event.get("toolCallCancellation")
        if isinstance(cancel, dict) and isinstance(cancel.get("ids"), list):
            with self.lock:
                for key in cancel["ids"][:128]:
                    if isinstance(key, str):
                        self.pending.pop(key, None)
            return True
        content = event.get("serverContent")
        if isinstance(content, dict):
            self.note_content(content)
        if isinstance(content, dict) and content.get("interrupted") is True:
            with self.lock:
                self.pending.clear()
        tool = event.get("toolCall")
        if not isinstance(tool, dict):
            return False
        calls = tool.get("functionCalls")
        if not isinstance(calls, list) or len(calls) > 4:
            raise ZeytunPilotUnavailable("invalid_tool_batch")
        for call in calls:
            if not isinstance(call, dict):
                raise ZeytunPilotUnavailable("invalid_tool_call")
            key, name = call.get("id"), call.get("name")
            if (not isinstance(key, str) or not 1 <= len(key) <= 128
                    or name not in (self.NAME, self.TOTAL_NAME, self.SAVE_NAME, self.TRANSFER_NAME, self.CANCEL_NAME)
                    or (name == self.TRANSFER_NAME and not self.transfer_phrase)
                    or (name == self.CANCEL_NAME and not self.cancel_phrase)):
                raise ZeytunPilotUnavailable("invalid_tool_call")
            if name == self.TOTAL_NAME:
                with self.lock:
                    repeated = key in self.seen or key in self.pending
                    if len(self.seen) < self.MAX_TOOL_CALLS:
                        self.seen.add(key)
                    expired = not self.active or self.clock() >= self.expires
                body = ({"status": "duplicate_request"} if repeated else {"status": "pilot_expired"} if expired
                        else self.order_total(call.get("args")))
                if current():
                    send({"toolResponse": {"functionResponses": [{"id": key, "name": name, "response": body}]}})
                continue
            saving = name == self.SAVE_NAME
            transferring = name == self.TRANSFER_NAME
            cancelling = name == self.CANCEL_NAME
            args = (({} if call.get("args") in (None, {}) else None) if transferring or cancelling
                    else self.order_request(call.get("args")) if saving else self.query(call.get("args")))
            response = lambda body, key=key, name=name: {"toolResponse": {"functionResponses": [{"id": key, "name": name, "response": body}]}}
            error = None
            with self.lock:
                if key in self.pending:
                    continue
                if key in self.seen:
                    error = "duplicate_request"
                elif not self.active or self.clock() >= self.expires or len(self.seen) >= self.MAX_TOOL_CALLS:
                    error = "pilot_expired"
                elif args is None:
                    error = "invalid_request"
                elif not self.workers.acquire(blocking=False):
                    error = "search_busy"
                if len(self.seen) < self.MAX_TOOL_CALLS:
                    self.seen.add(key)
                if error is None:
                    marker = object()
                    self.pending[key] = marker
            if error is not None:
                if current():
                    send(response({"status": "unavailable"} if transferring else {"status": "not_cancelled"} if cancelling
                                  else {"status": "not_saved", "reason": error} if saving else self.unavailable(error)))
                continue
            def work(key=key, marker=marker, args=args, response=response, saving=saving, transferring=transferring,
                     cancelling=cancelling):
                try:
                    if transferring:
                        result = self.safe_transfer(self.request({"action": "transfer", "callId": self.call_id}))
                    elif cancelling:
                        result = self.cancel_order()
                    elif saving:
                        result = self.save_order(args)
                    else:
                        result = self.safe_result(self.request({"action": "search", "callId": self.call_id, "query": args}),
                                                  with_code=bool(set(args) & {"itemCode", "barcode"}))
                except Exception:
                    result = ({"status": "unavailable"} if transferring else {"status": "not_cancelled"} if cancelling
                              else {"status": "not_saved"} if saving else self.unavailable())
                if result.get("status") == "transferring" and self.on_transfer:
                    # Before the model hears it: the phrase it is about to say
                    # must already end this leg.
                    try:
                        self.on_transfer(self.transfer_phrase)
                    except Exception:
                        result = {"status": "unavailable"}
                # The core's send callback serializes this final check/send with
                # cancellation, interruption, hangup and websocket replacement.
                def deliver():
                    with self.lock:
                        if self.pending.get(key) is not marker:
                            return None
                        self.pending.pop(key, None)
                        if not self.active or self.clock() >= self.expires:
                            return None
                        return response(result)
                try:
                    if current():
                        send(deliver)
                finally:
                    with self.lock:
                        if self.pending.get(key) is marker:
                            self.pending.pop(key, None)
                    self.workers.release()
            if not saving and not transferring and not cancelling and self.on_wait is not None:
                def waited(key=key, marker=marker):
                    with self.lock:
                        still = self.pending.get(key) is marker
                    if still and current():
                        try:
                            self.on_wait()
                        except Exception:
                            pass
                timer = threading.Timer(self.FILLER_AFTER_SECONDS, waited)
                timer.daemon = True
                timer.start()
            try:
                threading.Thread(target=work, name="zeytun-transfer" if transferring else "zeytun-order-cancel" if cancelling
                                 else "zeytun-order-save" if saving else "zeytun-catalog-lookup", daemon=True).start()
            except Exception:
                with self.lock:
                    self.pending.pop(key, None)
                self.workers.release()
                raise ZeytunPilotUnavailable("pilot_worker_unavailable") from None
        return True
