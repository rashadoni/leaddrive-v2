#!/usr/bin/env python3
"""Cut what the pharmacy said out of the line's call recordings, for the stand.

Task 3 of docs/zeytun-line-recognition-plan.md. A recording is one channel
with both voices (MixMonitor); when the caller spoke is in the station's
journal: `gemini_activity start/end` — the station's own decision that the
caller held the turn — timed from `call_start`. A recording does not start at
`call_start` (measured: −5 to +25 s against the journal), so both clocks are
pinned to the greeting: its first audio in the journal (`greeting
first_audio`) is the first sound in the recording (ffmpeg silencedetect).
Each such turn becomes a WAV
(8 kHz mono PCM16, padded a little either side) and a line in labels.jsonl
with what the model then searched for (the CRM's `[zeytun-line] search` log,
the first lookups within a few seconds after the turn). `said` and `expected`
are left for a person to fill: what was actually said, which 1C product.

    python3 scripts/zeytun-line/cut-caller-phrases.py \\
        --recordings DIR --calls calls.tsv --journal night-journal.txt \\
        --searches line-searches.txt --out DIR/segments

calls.tsv: `<CRM call id>\\t<station call id>\\t<label>`; the recordings are
`call-<CRM call id>.wav` as the CRM serves them. Recordings and cuts are the
client's data: keep them out of Git.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

PAD_BEFORE, PAD_AFTER = 0.4, 0.6
SEARCH_WINDOW_SECONDS = 12.0
EVENT = re.compile(r"^(\S+) .*?LD_LATENCY (\{.*\})$")
SEARCH = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d): \[zeytun-line\] search (\{.*\})$")


def journal_turns(path):
    """Per station call id: call_start time and the caller's turns (start, end)."""
    calls = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        match = EVENT.match(line.strip())
        if not match:
            continue
        at = datetime.datetime.fromisoformat(match.group(1))
        event = json.loads(match.group(2))
        call = calls.setdefault(event.get("call_id"), {"start": None, "turns": [], "open": None})
        if event.get("event") == "greeting" and event.get("status") == "first_audio" and call["start"] is None:
            call["start"] = at
        elif event.get("event") == "gemini_activity" and event.get("status") == "start":
            call["open"] = at
        elif event.get("event") == "gemini_activity" and event.get("status") == "end" and call["open"]:
            call["turns"].append((call["open"], at))
            call["open"] = None
    return calls


def first_sound(recording):
    """Seconds into the recording where sound first starts (the greeting)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", recording, "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    match = re.search(r"silence_end: ([0-9.]+)", out)
    return float(match.group(1)) if match else 0.0


def searches(path):
    """(time, call id or None, query) of every line search the CRM logged."""
    found = []
    if not path:
        return found
    for line in open(path, encoding="utf-8", errors="replace"):
        match = SEARCH.match(line.strip())
        if not match:
            continue
        date, time, offset = match.group(1).split(" ")
        entry = json.loads(match.group(2))
        found.append((datetime.datetime.fromisoformat(f"{date}T{time}{offset}"), entry.get("call"), entry.get("query", "")))
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--recordings", required=True)
    parser.add_argument("--calls", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--searches")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    os.makedirs(args.out, mode=0o700, exist_ok=True)
    calls, lookups = journal_turns(args.journal), searches(args.searches)
    labels, missing = [], []
    for row in open(args.calls, encoding="utf-8"):
        if not row.strip():
            continue
        crm_id, call_id, label = row.rstrip("\n").split("\t")
        recording = os.path.join(args.recordings, f"call-{crm_id}.wav")
        call = calls.get(call_id)
        if not os.path.exists(recording) or not call or not call["start"]:
            missing.append(f"{label} ({'no recording' if not os.path.exists(recording) else 'no journal'})")
            continue
        greeting = first_sound(recording)
        for index, (opened, closed) in enumerate(call["turns"], 1):
            start = max(0.0, greeting + (opened - call["start"]).total_seconds() - PAD_BEFORE)
            end = greeting + (closed - call["start"]).total_seconds() + PAD_AFTER
            name = f"{call_id[:8]}-{index:02d}.wav"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", recording, "-ss", f"{start:.2f}", "-to", f"{end:.2f}",
                            "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", os.path.join(args.out, name)], check=True)
            # A lookup belongs to the caller's last turn before it, not to every
            # turn in the window: short turns (a quantity, "bəli") follow each other.
            following = call["turns"][index] if index < len(call["turns"]) else None
            heard = [query for at, logged, query in lookups
                     if (logged in (None, call_id)) and 0 <= (at - closed).total_seconds() <= SEARCH_WINDOW_SECONDS
                     and (following is None or at < following[1])]
            labels.append({"file": name, "call": call_id, "order": label, "turn": index,
                           "seconds": [round(start, 2), round(end, 2)], "said": "", "expected": [],
                           "heardByModel": heard})
    with open(os.path.join(args.out, "labels.jsonl"), "w", encoding="utf-8") as out:
        for entry in labels:
            out.write(json.dumps(entry, ensure_ascii=False) + "\n")
    os.chmod(os.path.join(args.out, "labels.jsonl"), 0o600)
    print(f"phrases: {len(labels)}; skipped: {', '.join(missing) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
