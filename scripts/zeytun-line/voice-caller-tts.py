"""The pharmacy's voice for voice-stand.ts: one phrase through Vertex TTS, made into what the trunk delivers.

  python3 -I scripts/zeytun-line/voice-caller-tts.py <vertex key file> <cache dir> <voice> <text>

gemini-3.8-flash-tts on Vertex (the line's own TTS path, task 9), but another
voice than the line's Sulafat, so the two sides are told apart on the
recording. The 24 kHz answer is made a phone call: ffmpeg's resampler with a
3.4 kHz low-pass to 8 kHz, a G.711 µ-law round trip (the trunk's codec), the
silence the model puts around the words cut to LEAD_S before (the station's
lookback hears the line before the voice) and none after (voice-live-remote.py
adds the station's 0.65 s of end silence). The result is cached by text, voice
and style, so three runs hear the same audio; it is the owner's test audio,
kept in ~/inbox, never in Git. Prints one JSON line: {"file", "speech_s", "cached"}.
The key is read from its file, never printed.
"""
import audioop
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave

PROJECT = "gen-lang-client-0496964632"
MODEL = "gemini-3.8-flash-tts"
STYLE = ("Bakı azərbaycancası, telefonda danışan aptek işçisi: distribyutora sifariş verir, adi danışıq sürəti, "
         "rəqəmləri və dərman adlarını azərbaycanca deyir")
LEAD_S = 0.2
LOUD = 250  # RMS of a 20 ms frame (PCM16) that is voice, not the model's silence

keyfile, cache, voice, text = sys.argv[1:5]
name = hashlib.sha256(json.dumps([MODEL, voice, STYLE, text], ensure_ascii=False).encode()).hexdigest()[:16]
target = os.path.join(cache, name + ".wav")


def synthesize():
    key = open(keyfile, encoding="utf-8").read().strip()
    url = ("https://aiplatform.googleapis.com/v1/projects/" + PROJECT + "/locations/global/publishers/google/models/"
           + MODEL + ":streamGenerateContent?alt=sse&key=" + urllib.parse.quote(key, safe=""))
    body = {"contents": [{"role": "user", "parts": [{"text": text, "speechMetadata": {"style": STYLE}}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    for attempt in range(3):
        request = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
        pcm, rate = bytearray(), 24000
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                for line in response:
                    line = line.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    part = json.loads(line[5:])
                    for candidate in part.get("candidates", []):
                        for piece in (candidate.get("content") or {}).get("parts", []):
                            data = piece.get("inlineData")
                            if data and data.get("data"):
                                if "rate=" in (data.get("mimeType") or ""):
                                    rate = int(data["mimeType"].split("rate=")[1].split(";")[0])
                                pcm += base64.b64decode(data["data"])
            if pcm:
                return bytes(pcm), rate
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise SystemExit("vertex tts HTTP %d" % error.code)
        time.sleep(2 + 3 * attempt)
    raise SystemExit("vertex tts: no audio")


def phone(pcm, rate):
    narrow = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", "pipe:0",
                             "-af", "lowpass=f=3400", "-ar", "8000", "-f", "s16le", "pipe:1"],
                            input=pcm, capture_output=True, check=True).stdout
    line = audioop.ulaw2lin(audioop.lin2ulaw(narrow, 2), 2)
    frames = [line[i:i + 320] for i in range(0, len(line) - 319, 320)]
    loud = [i for i, frame in enumerate(frames) if audioop.rms(frame, 2) >= LOUD]
    if not loud:
        raise SystemExit("vertex tts: silence only")
    voice_pcm = b"".join(frames[loud[0]:loud[-1] + 1])
    return b"\0" * int(8000 * 2 * LEAD_S) + voice_pcm, len(voice_pcm) / 16000


cached = os.path.exists(target)
if not cached:
    os.makedirs(cache, mode=0o700, exist_ok=True)
    clip, _ = phone(*synthesize())
    with wave.open(target + ".part", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(clip)
    os.replace(target + ".part", target)
with wave.open(target) as w:
    frames = w.getnframes()
print(json.dumps({"file": target, "speech_s": round(frames / 8000 - LEAD_S, 2), "cached": cached}))
