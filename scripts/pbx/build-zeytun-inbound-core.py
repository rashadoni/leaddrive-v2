#!/usr/bin/env python3
"""Build a reviewable PBX artifact from the inspected core. Never installs it."""
import argparse
import ast
import hashlib
import os
from pathlib import Path

EXPECTED_SOURCE = "e38400b8d339f94b78c60f44c70e3cdcac5ed71269614c3be08c0d086bd94386"


def build(source, bridge):
    if hashlib.sha256(source).hexdigest() != EXPECTED_SOURCE:
        raise ValueError("unexpected_live_core_digest")
    text = source.decode("utf-8")
    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise ValueError("ambiguous_patch_anchor")
        text = text.replace(old, new, 1)
    replace("class GeminiLiveSession(RealtimeSession):", bridge + "\n\nclass GeminiLiveSession(RealtimeSession):")
    replace("        self.is_demo_call = False\n", "        self.is_demo_call = False\n        self.pharmacy_preview = False\n        self.pharmacy_bridge = None\n")
    start = text.index("        # Started before the prompt fetch so the two CRM round-trips overlap;")
    end = text.index("        ws = None\n", start)
    normal = text[start:end]
    pilot = '''        pilot = None
        if os.environ.get("ZEYTUN_INBOUND_PILOT_ENABLED") == "1":
            self.pharmacy_bridge = ZeytunInboundBridge(CRM_RUNTIME_URL, CRM_RUNTIME_TOKEN, self.call_id)
            pilot = self.pharmacy_bridge.open()
        if pilot:
            # Preserve the normal kill switch / voice-policy handshake, without
            # querying this ambiguous test phone's CRM history or source.
            instruction_for_call()
            self.pharmacy_preview = True
            self.instruction = demo_instruction("", pilot["prompt"])
            self.crm_opening_text = pilot["opening"]
            self.crm_max_seconds = pilot["maxSeconds"]
            if pilot.get("closing"):
                # The station hangs up once this closing has played in full,
                # as on demo calls; without it the call ran to its ceiling.
                folded = closing_words(pilot["closing"]).replace(" ", "")
                self.closing_keys = tuple(dict.fromkeys([folded, folded.replace("ə", "e")]))
            self.is_callback = False
            fetched, continuation_box, continuation_thread = True, {}, None
        else:
'''
    text = text[:start] + pilot + "".join("    " + line if line.strip() else line for line in normal.splitlines(True)) + text[end:]
    replace('        return {"setup": setup}\n', '        if self.pharmacy_preview:\n            setup["tools"] = self.pharmacy_bridge.tools()\n            setup["inputAudioTranscription"] = self.pharmacy_bridge.transcription()\n            language, voice = self.pharmacy_bridge.speech_language(), self.pharmacy_bridge.speech_voice()\n            if language:\n                setup["generationConfig"]["speechConfig"]["languageCode"] = language\n            if voice:\n                setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] = voice\n        return {"setup": setup}\n')
    method = '''    def _send_pharmacy_result(self, active_ws, expected_epoch, payload):
        with self.gemini_event_lock:
            with self.state_lock:
                if (self.closed or self.hangup_started or self.ws is not active_ws
                        or self.gemini_ws_epoch != expected_epoch):
                    return False
            body = payload() if callable(payload) else payload
            return bool(body is not None and self._send_gemini_event(active_ws, body))

'''
    replace('    def _setup_event(self, resume_handle=None):\n', method + '    def _setup_event(self, resume_handle=None):\n')
    anchor = '        self._accept_resumption_update(event)\n        if "goAway" in event:'
    replacement = '''        if self.pharmacy_preview:
            epoch = self.gemini_ws_epoch
            current = lambda: (not self.closed and not self.hangup_started
                and self.ws is active_ws and self.gemini_ws_epoch == epoch)
            send = lambda payload: self._send_pharmacy_result(active_ws, epoch, payload)
            if self.pharmacy_bridge.handle(event, send, current):
                return
        self._accept_resumption_update(event)
        if "goAway" in event:'''
    replace(anchor, replacement)
    # Only recovery wording changes; pharmacy calls are never marked as demos.
    for phrase in ['"what they last said" if self.is_demo_call', '"question" if self.is_demo_call', '"" if self.is_demo_call',
                   'FRESH_RECOVERY_REPEAT_SENTENCES_NEUTRAL if self.is_demo_call']:
        replace(phrase, phrase.replace('self.is_demo_call', '(self.is_demo_call or self.pharmacy_preview)'))
    ast.parse(text)
    return text.encode("utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.source).read_bytes(), Path(__file__).with_name("fanum-zeytun-inbound.py").read_text())
    # Refuse to overwrite an existing artifact or the source.
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        output.write(result)
    print("source_sha256=" + EXPECTED_SOURCE)
    print("artifact_sha256=" + hashlib.sha256(result).hexdigest())


if __name__ == "__main__":
    main()
