#!/usr/bin/env python3
"""Send the line's finished call recordings to the CRM, then delete them.

Owner, 2026-10-31: «нужно чтоб и диалог записывался». The dialplan records
the AI line's calls (MixMonitor, scripts/pbx/fanum-inbound-browser.conf) into
DIRECTORY, one file per call, named by the call's id. Once a file has stopped
growing the call is over: each run (a timer, once a minute) converts it to
8 kHz G.711 mu-law — what the phone line itself carries, half the size, and
inside the 10 MB the CRM's proxy passes — posts it with the token the call
events use, and deletes it when the CRM has it or refuses it for good. A CRM
that does not answer leaves it for the next run, for a day at most.
Nothing but the audio and the call id leaves the station.
"""
import audioop
import io
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave

CONFIG_PATH = "/etc/fanum-pbx-coordinator.env"
RECORDING_PATH = "/api/internal/asterisk/call-recording"
DIRECTORY = "/var/spool/asterisk/fanum-recordings"
# MixMonitor writes as long as the call lasts, silence included.
QUIET_SECONDS = 20
KEEP_SECONDS = 24 * 3600
# The CRM takes 9 728 000 bytes (src/lib/calls/station-recordings.ts).
MAX_BYTES = 9_728_000
PER_RUN = 10
TIMEOUT_SECONDS = 60
NAME = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.wav$")
# The CRM's answers that will never change for this file: delete it.
REFUSED = {400, 403, 404, 413, 415}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_config(path=CONFIG_PATH):
    """The two keys the call events use, read as data; the file is never sourced."""
    values = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key in ("VOICE_CRM_HUMAN_LIFECYCLE_URL", "VOICE_CRM_RUNTIME_TOKEN"):
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                values[key] = value
    lifecycle = urllib.parse.urlsplit(values.get("VOICE_CRM_HUMAN_LIFECYCLE_URL", ""))
    token = values.get("VOICE_CRM_RUNTIME_TOKEN", "")
    if lifecycle.scheme != "https" or not lifecycle.hostname or lifecycle.username or lifecycle.password or not token:
        raise ValueError("station_config_invalid")
    return urllib.parse.urlunsplit(("https", lifecycle.netloc, RECORDING_PATH, "", "")), token


def mulaw_wave(data):
    """A recording as 8 kHz mono mu-law WAVE, cut to MAX_BYTES; ValueError for anything else."""
    with wave.open(io.BytesIO(data), "rb") as source:
        channels, width, rate = source.getnchannels(), source.getsampwidth(), source.getframerate()
        frames = source.readframes(source.getnframes())
    if width != 2 or channels not in (1, 2) or not 8000 <= rate <= 48000:
        raise ValueError("unsupported_recording")
    if channels == 2:
        frames = audioop.tomono(frames, 2, 0.5, 0.5)
    if rate != 8000:
        frames, _ = audioop.ratecv(frames, 2, 1, rate, 8000, None)
    body = audioop.lin2ulaw(frames, 2)
    header_bytes = 58
    body = body[:MAX_BYTES - header_bytes]
    # WAVE_FORMAT_MULAW (7): an 18-byte fmt with cbSize 0, and the fact chunk a
    # non-PCM file carries.
    fmt = struct.pack("<HHIIHHH", 7, 1, 8000, 8000, 1, 8, 0)
    head = (b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 12 + 8 + len(body)) + b"WAVE"
            + b"fmt " + struct.pack("<I", len(fmt)) + fmt
            + b"fact" + struct.pack("<II", 4, len(body))
            + b"data" + struct.pack("<I", len(body)))
    assert len(head) == header_bytes
    return head + body


def send(url, token, call_id, body, opener=None):
    request = urllib.request.Request(url + "?callId=" + call_id, data=body, method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "audio/wav"})
    with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status


def run_once(url, token, directory=DIRECTORY, now=None, post=send, log=print):
    now = time.time() if now is None else now
    counts = {"sent": 0, "waiting": 0, "dropped": 0, "retry": 0}
    try:
        names = sorted(name for name in os.listdir(directory) if NAME.match(name))
    except OSError:
        log("call_recordings directory_unavailable")
        return counts
    for name in names[:PER_RUN]:
        path = os.path.join(directory, name)
        try:
            info = os.stat(path)
        except OSError:
            continue
        age = now - info.st_mtime
        if age < QUIET_SECONDS:
            counts["waiting"] += 1
            continue
        if age > KEEP_SECONDS:
            os.unlink(path)
            counts["dropped"] += 1
            log("call_recordings expired")
            continue
        try:
            with open(path, "rb") as handle:
                body = mulaw_wave(handle.read())
        except (OSError, ValueError, EOFError, wave.Error, audioop.error):
            os.unlink(path)
            counts["dropped"] += 1
            log("call_recordings unreadable")
            continue
        try:
            post(url, token, name[:-4], body)
        except urllib.error.HTTPError as error:
            if error.code in REFUSED:
                os.unlink(path)
                counts["dropped"] += 1
                log("call_recordings refused http_%d" % error.code)
            else:
                counts["retry"] += 1
                log("call_recordings retry http_%d" % error.code)
            continue
        except (OSError, urllib.error.URLError) as error:
            counts["retry"] += 1
            log("call_recordings retry %s" % type(error).__name__)
            continue
        os.unlink(path)
        counts["sent"] += 1
    return counts


def main():
    try:
        url, token = read_config()
    except (OSError, ValueError):
        print("call_recordings config_invalid", file=sys.stderr)
        return 1
    counts = run_once(url, token)
    print("call_recordings sent=%(sent)d waiting=%(waiting)d retry=%(retry)d dropped=%(dropped)d" % counts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
