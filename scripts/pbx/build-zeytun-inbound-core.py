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
        # Owner, 2026-10-28: «несколько секунд тишина, а потом включается
        # ассистент». The provider socket does not depend on the CRM's answer:
        # it opens while the CRM is asked, and the kill switch is awaited
        # before the greeting rather than before the socket.
        early = {"lock": threading.Lock(), "ws": None, "closed": False, "thread": None,
                 "kill": None, "kill_error": None}
        if os.environ.get("ZEYTUN_INBOUND_PILOT_ENABLED") == "1":
            early["thread"] = threading.Thread(target=self._pharmacy_open_early, args=(early,),
                                               name="gemini-early-open", daemon=True)
            early["thread"].start()
            asked = time.monotonic()
            try:
                self.pharmacy_bridge = ZeytunInboundBridge(CRM_RUNTIME_URL, CRM_RUNTIME_TOKEN, self.call_id,
                    spool=zeytun_order_spool(CRM_RUNTIME_URL, CRM_RUNTIME_TOKEN, latency))
                pilot = self.pharmacy_bridge.open()
            except Exception:
                self._pharmacy_drop_early(early)
                raise
            latency("zeytun_session", self.call_id, ms=round((time.monotonic() - asked) * 1000), pilot=bool(pilot))
        if pilot:
            # Preserve the normal kill switch / voice-policy handshake, without
            # querying this ambiguous test phone's CRM history or source.
            early["kill"] = threading.Thread(target=self._pharmacy_kill_switch, args=(early,),
                                             name="voice-kill-switch", daemon=True)
            early["kill"].start()
            self.pharmacy_preview = True
            self.instruction = demo_instruction("", pilot["prompt"])
            self.crm_opening_text = pilot["opening"]
            self.crm_max_seconds = pilot["maxSeconds"]
            if pilot.get("closing"):
                # The station hangs up once this closing has played in full,
                # as on demo calls; without it the call ran to its ceiling.
                folded = closing_words(pilot["closing"]).replace(" ", "")
                self.closing_keys = tuple(dict.fromkeys([folded, folded.replace("ə", "e")]))
            if pilot.get("transfer"):
                # Owner, 2026-10-27: once the CRM took a transfer, its phrase
                # ends this AI leg like the goodbye; the dialplan keeps the
                # caller and rings the managers' browsers.
                def add_transfer_closing(phrase):
                    folded = closing_words(phrase).replace(" ", "")
                    with self.state_lock:
                        self.closing_keys = tuple(dict.fromkeys(self.closing_keys + (folded, folded.replace("ə", "e"))))
                self.pharmacy_bridge.on_transfer = add_transfer_closing
            self.is_callback = False
            fetched, continuation_box, continuation_thread = True, {}, None
        else:
'''
    text = text[:start] + pilot + "".join("    " + line if line.strip() else line for line in normal.splitlines(True)) + text[end:]
    replace('        return {"setup": setup}\n', '        if self.pharmacy_preview:\n            setup["tools"] = self.pharmacy_bridge.tools()\n            setup["inputAudioTranscription"] = self.pharmacy_bridge.transcription()\n            language, voice = self.pharmacy_bridge.speech_language(), self.pharmacy_bridge.speech_voice()\n            if language:\n                setup["generationConfig"]["speechConfig"]["languageCode"] = language\n            if voice:\n                setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] = voice\n        return {"setup": setup}\n')
    method = '''    def _pharmacy_open_early(self, early):
        opened = time.monotonic()
        try:
            ws = self._open_gemini_websocket()
        except Exception as error:
            latency("gemini_early_open", self.call_id, status=type(error).__name__)
            return
        with early["lock"]:
            if early["closed"]:
                ws.close()
                return
            early["ws"] = ws
        latency("gemini_early_open", self.call_id, status="open", ms=round((time.monotonic() - opened) * 1000))

    def _pharmacy_take_early(self, early):
        if early["thread"] is not None:
            early["thread"].join(GEMINI_LIVE_SETUP_TIMEOUT_SECONDS)
        with early["lock"]:
            early["closed"] = True
            ws, early["ws"] = early["ws"], None
        return ws

    def _pharmacy_drop_early(self, early):
        with early["lock"]:
            early["closed"] = True
            ws, early["ws"] = early["ws"], None
        if ws is not None:
            ws.close()

    def _pharmacy_kill_switch(self, early):
        asked = time.monotonic()
        try:
            instruction_for_call()
        except Exception as error:
            early["kill_error"] = error
        latency("voice_kill_switch", self.call_id, ms=round((time.monotonic() - asked) * 1000),
                status="disabled" if early["kill_error"] is not None else "enabled")

    def _pharmacy_await_kill_switch(self, early):
        if early["kill"] is None:
            return
        early["kill"].join(5.0)
        if early["kill"].is_alive():
            raise VoiceAgentDisabled("voice agent disabled")
        if early["kill_error"] is not None:
            raise early["kill_error"]

    def _pharmacy_speech_relay(self):
        return self.pharmacy_bridge.speech_relay(
            GEMINI_KEY,
            inject=lambda value: self._handle_gemini_event(value, self.ws),
            speakable=lambda: not (self.closed or self.hangup_started or self.discarding_response),
            alive=lambda: not self.closed,
            room=lambda: self.output_queue.qsize() < GEMINI_LIVE_AUDIO_QUEUE_FRAMES * 4 // 5,
            log=lambda status, **fields: latency("zeytun_tts", self.call_id, status=status, **fields),
            # Model audio proves the session lives: re-arm a pending watchdog.
            progress=lambda: ((self._pause_resume_progress_for_speech(), self._resume_progress_after_speech())
                              if self.resume_progress_pending and not self.resume_progress_waiting_for_speech else None),
            recovering=lambda: bool(self.reconnecting or self.fresh_recovery_waiting_for_audio
                                    or self.fresh_recovery_input_fenced))

    def _send_pharmacy_result(self, active_ws, expected_epoch, payload):
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
            relay = self._pharmacy_speech_relay()
            if relay is not None and relay.filter(event, epoch):
                return
        self._accept_resumption_update(event)
        if "goAway" in event:'''
    replace(anchor, replacement)
    replace('''        ws = None
        try:
            ws = self._open_gemini_websocket()
            self._await_setup(ws)
        except Exception:
            if ws is not None:
                ws.close()
            raise
        self.setup_complete = True
''', '''        ws = None
        try:
            ws = self._pharmacy_take_early(early) or self._open_gemini_websocket()
            self._await_setup(ws)
            self._pharmacy_await_kill_switch(early)
        except Exception:
            if ws is not None:
                ws.close()
            self._pharmacy_drop_early(early)
            raise
        self.setup_complete = True
''')
    # The opening is fixed text: the caller hears it now, not after the model
    # has said it and the TTS has voiced it again (about two seconds).
    replace('''            self.greeting_sent = True
            latency(
                "greeting",
                self.call_id,
                status="sent",
                engine="gemini_live",
            )
''', '''            self.greeting_sent = True
            latency(
                "greeting",
                self.call_id,
                status="sent",
                engine="gemini_live",
            )
            if self.pharmacy_preview and not self.is_callback:
                relay = self._pharmacy_speech_relay()
                if relay is not None and relay.prefill(self.crm_opening_text, self.gemini_ws_epoch):
                    latency("zeytun_opening", self.call_id, status="prefill")
''')
    # Owner, 2026-10-25: «после прощания почему не кладёт трубку?» — the goodbye
    # ended at 20:35:14.5 and the station still waited (3 s for a caller who
    # might answer it, then 1.5 s): the caller hung up first. A pharmacy call
    # closes only after the caller said goodbye, so it hangs up about a second
    # after the closing has played. Other calls keep the core's waits.
    replace("                elif now - caller_quiet_since >= CALL_FAREWELL_CALLER_WAIT_SECONDS:\n",
            "                elif now - caller_quiet_since >= (1.0 if self.pharmacy_preview else CALL_FAREWELL_CALLER_WAIT_SECONDS):\n")
    replace("                elif now - farewell_done_at >= CALL_FAREWELL_HANGUP_DELAY_SECONDS:\n",
            "                elif now - farewell_done_at >= (0.8 if self.pharmacy_preview else CALL_FAREWELL_HANGUP_DELAY_SECONDS):\n")
    # Only recovery wording changes; pharmacy calls are never marked as demos.
    for phrase in ['"what they last said" if self.is_demo_call', '"question" if self.is_demo_call', '"" if self.is_demo_call',
                   'FRESH_RECOVERY_REPEAT_SENTENCES_NEUTRAL if self.is_demo_call']:
        replace(phrase, phrase.replace('self.is_demo_call', '(self.is_demo_call or self.pharmacy_preview)'))
    # Owner, 2026-10-28: the station resends an order the CRM did not answer.
    # Started with the service, so what a previous run left is sent before
    # the first call after a restart.
    replace('    logging.info("Fanum Voice Core listening on %s:%s",HOST,PORT)\n',
            '    if os.environ.get("ZEYTUN_INBOUND_PILOT_ENABLED") == "1":\n'
            '        zeytun_order_spool(CRM_RUNTIME_URL, CRM_RUNTIME_TOKEN, latency)\n'
            '    logging.info("Fanum Voice Core listening on %s:%s",HOST,PORT)\n')
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
