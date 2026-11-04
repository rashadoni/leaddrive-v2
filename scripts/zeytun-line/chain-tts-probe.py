"""First sound of the line's TTS for chain-stand.ts (plan task 11): how long a reply waits for its voice.

  python3 -I scripts/zeytun-line/chain-tts-probe.py <vertex key file> <style>   (JSON list of texts on stdin)

Each text goes as the station sends it: zeytun_speakable_text, then the
station's own ZeytunGeminiTts (gemini-3.8-flash-tts, voice Sulafat, the
line's style in speechMetadata) on the Vertex path only. Prints one JSON line
a text: {"chars", "first_ms", "total_ms", "audio_s"}, or {"chars", "error"}.
The audio is not kept. The key is read from its file, never printed.
"""
import importlib.util
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("zeytun_station", ROOT / "pbx" / "fanum-zeytun-inbound.py")
station = importlib.util.module_from_spec(spec)
spec.loader.exec_module(station)

PROJECT = "gen-lang-client-0496964632"
keyfile, style = sys.argv[1:3]
vertex_key = open(keyfile, encoding="utf-8").read().strip()

for text in json.load(sys.stdin):
    # The Gemini API key is only the fallback path; it is dropped, so nothing but Vertex is asked.
    tts = station.ZeytunGeminiTts("unused", "gemini-3.8-flash-tts", "Sulafat", style=style, vertex=(PROJECT, vertex_key))
    tts.urls = tts.urls[:1]
    started, first, size = time.monotonic(), [None], [0]

    def on_pcm(pcm):
        if first[0] is None:
            first[0] = time.monotonic()
        size[0] += len(pcm)

    speakable = station.zeytun_speakable_text(text)
    try:
        tts.stream(speakable, on_pcm, lambda: True)
        done = time.monotonic()
        print(json.dumps({"chars": len(speakable), "first_ms": round((first[0] - started) * 1000),
                          "total_ms": round((done - started) * 1000), "audio_s": round(size[0] / 2 / 24000, 2)}), flush=True)
    except Exception as error:  # a refusal is a measured outcome, not the probe's end
        print(json.dumps({"chars": len(speakable), "error": str(error)[:120]}), flush=True)
