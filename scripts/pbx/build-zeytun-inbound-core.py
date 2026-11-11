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
                self.pharmacy_bridge.log = lambda status, **fields: latency("zeytun_cancel", self.call_id, status=status, **fields)
                self.pharmacy_bridge.log_event = lambda event, **fields: latency(event, self.call_id, **fields)
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
            # Owner's call 2026-10-30: a slow lookup is not dead air.
            self.pharmacy_bridge.on_wait = self._pharmacy_wait_filler
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
                                    or self.fresh_recovery_input_fenced),
            # A reply in English is asked again in Azerbaijani (ZeytunSpeechRelay.FOREIGN_RETRY).
            ask=lambda payload: self._send_pharmacy_result(self.ws, self.gemini_ws_epoch, payload),
            # Owner's call 2026-11-05: an unanswered question is asked again (SILENCE_NUDGE).
            quiet=lambda: not (self.closed or self.hangup_started or self.response_active or self.playback_active
                               or self.local_speech_active or self.reconnecting or self.pharmacy_bridge.pending
                               or self.wrapup_sent or self.closing_response_seq is not None),
            # Owner 2026-11-05: a long pause after the caller gets the wait filler (TURN_FILLER_SECONDS).
            playing=lambda: bool(self.playback_active or self.hangup_started or self.closed))

    def _pharmacy_wait_filler(self):
        # The relay logs it (zeytun_tts status=wait_filler) when it plays.
        relay = self._pharmacy_speech_relay()
        if relay is not None:
            relay.filler()

    def _pharmacy_tool_progress(self):
        # Owner's call 2026-10-29: the caller interrupted, the agent looked the
        # product up instead of speaking, and the 2 s "resume progress"
        # watchdog took the live session for wedged and tore it down (new
        # session, a recovery phrase in another voice, then two more drops).
        # A tool call is the model working on the answer it owes.
        timer = None
        with self.state_lock:
            if not self.resume_progress_pending:
                return
            self.resume_progress_epoch += 1
            self.resume_progress_pending = False
            self.resume_progress_waiting_for_speech = False
            self.resume_progress_ws = None
            self.resume_progress_pcm_floor = None
            timer, self.resume_progress_timer = self.resume_progress_timer, None
        self._cancel_timer(timer)
        latency("realtime_response_progress", self.call_id, status="tool_call", engine="gemini_live")

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
            # Owner's call 2026-11-03 (ac5ccd37): the Live session dropped at
            # 299 s and its recovery 5 s later, the first call past 5 minutes.
            # Whether the provider warned first, and with what, is the question.
            if "goAway" in event:
                notice = event.get("goAway")
                latency("zeytun_goaway", self.call_id, time_left=str((notice or {}).get("timeLeft"))[:16]
                        if isinstance(notice, dict) else None, resumable=bool(self.resumption_currently_available))
            epoch = self.gemini_ws_epoch
            current = lambda: (not self.closed and not self.hangup_started
                and self.ws is active_ws and self.gemini_ws_epoch == epoch)
            send = lambda payload: self._send_pharmacy_result(active_ws, epoch, payload)
            if self.pharmacy_bridge.handle(event, send, current):
                if "toolCall" in event:
                    self._pharmacy_tool_progress()
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
    # Owner's call 2026-11-03 (85cb2f29): the speech gate (Silero) scored the
    # caller's loud words 0.0-0.02 while the agent was silent and dropped them:
    # "Mezim forte on min, on qutu" reached the model as "qutu", and the last
    # 2.5 s (Smekta, Lineks, Amoksiklav) not at all, so the agent waited and
    # the caller hung up. The gate exists against the agent's own echo; on the
    # pharmacy line it vetoes only while the agent speaks and for 0.4 s after,
    # and loudness alone decides otherwise, as before the gate. Owner's call
    # 2026-11-05 (4c36453f): "krem", said right after the question, fell into
    # the 0.8 s it was before; the echo tail of the line is shorter.
    # Owner's call 2026-11-06 (452259a8): "agent speaking" also counts the
    # model's own greeting turn, which the line never voices (the CRM opening
    # plays instead) and which ran ~3 s past the audible greeting. The gate
    # dropped the caller's first second ("…mərkəzi aptekdən") there, the model
    # got a quiet fragment and heard it as the drug "Adenurik". The veto is
    # against echo, so on the pharmacy line it follows what is actually played.
    replace("            if loud and verdict is False:\n",
            "            if self.pharmacy_preview:\n"
            "                with self.state_lock:\n"
            "                    pharmacy_audible = bool(self.playback_active)\n"
            "                if pharmacy_audible:\n"
            "                    self.pharmacy_agent_heard_at = time.monotonic()\n"
            "            if loud and verdict is False and (not self.pharmacy_preview or pharmacy_audible\n"
            "                    or time.monotonic() - getattr(self, 'pharmacy_agent_heard_at', 0.0) < 0.4):\n")
    # Owner's queue 2026-11-06, task 1 («qeyd etdim» without a save): a fresh
    # session got the last 8 turns, so lines the model had confirmed earlier
    # and not saved were gone, and its next save overwrote the order with the
    # shorter list (line stand, pauses + a planned drop: 0 of 6 lines). The
    # pharmacy line restores the whole call (60 turns), and the restore asks
    # for one silent save of every confirmed line before the model speaks.
    replace('            "turns": ordered[-max(2, GEMINI_LIVE_CONTEXT_RESTORE_TURNS):],\n',
            '            "turns": ordered[-max(2, ZEYTUN_RESTORE_TURNS if self.pharmacy_preview\n'
            '                                   else GEMINI_LIVE_CONTEXT_RESTORE_TURNS):],\n')
    replace('            + obligation\n',
            '            + (zeytun_restore_note(self.pharmacy_bridge) if self.pharmacy_preview else "")\n'
            '            + obligation\n')
    # Task 3 (2026-11-06): every restore after a drop in silence asked the caller to
    # repeat; on the pharmacy line only a caller who spoke after the agent's last audio is.
    replace('        if state.get("untranscribed_caller_turn"):\n',
            '        if state.get("untranscribed_caller_turn") and (not self.pharmacy_preview\n'
            '                                                     or zeytun_caller_owed(self.pharmacy_bridge)):\n')
    # Owner's queue 2026-11-06 (line stand): a fresh session that took longer
    # than 2.5 s to set up, or to its first TTS audio (the line's TTS adds
    # ~1 s), ended the pharmacy's call. Its setup took 0.5-0.9 s on the stand,
    # but Google is sometimes slower; 2.5 s more silence costs far less than
    # a dropped order. Other calls keep 2.5 s.
    replace("                GEMINI_LIVE_FRESH_RECOVERY_TIMEOUT_SECONDS,\n",
            "                (5.0 if self.pharmacy_preview else GEMINI_LIVE_FRESH_RECOVERY_TIMEOUT_SECONDS),\n")
    replace("                GEMINI_LIVE_FRESH_RECOVERY_FIRST_AUDIO_TIMEOUT_SECONDS,\n",
            "                (5.0 if self.pharmacy_preview else GEMINI_LIVE_FRESH_RECOVERY_FIRST_AUDIO_TIMEOUT_SECONDS),\n")
    # Only recovery wording changes; pharmacy calls are never marked as demos.
    for phrase in ['"what they last said" if self.is_demo_call', '"question" if self.is_demo_call', '"" if self.is_demo_call',
                   'FRESH_RECOVERY_REPEAT_SENTENCES_NEUTRAL if self.is_demo_call']:
        replace(phrase, phrase.replace('self.is_demo_call', '(self.is_demo_call or self.pharmacy_preview)'))
    # A pharmacy answer is voiced by the TTS relay, ~1 s after the model's
    # text: the 2 s bound left one second for the model itself. The core
    # already caps the bound at 5 s.
    replace("            min(5.0, GEMINI_LIVE_RESUME_PROGRESS_TIMEOUT_SECONDS),\n",
            "            min(5.0, 5.0 if self.pharmacy_preview else GEMINI_LIVE_RESUME_PROGRESS_TIMEOUT_SECONDS),\n")
    # Call 7c2383d1, 2026-11-03: the CRM transcript lost two answers the
    # caller heard (see zeytun_call_transcript). Other calls keep the core's
    # own record.
    replace('''            excluded = set(self.truncated_items)
            excluded.update(self.non_business_transcript_items)
        return [
''', '''            excluded = set(self.truncated_items)
            excluded.update(self.non_business_transcript_items)
            heard = (set(self.truncated_items), set(self.audible_agent_items),
                     set(self.non_business_transcript_items), dict(self.dialog_turn_keys))
        if self.pharmacy_preview:
            # Task 13 (2026-11-06): the call's Gemini usage, once, as the call's record is made.
            log_cost = getattr(self.pharmacy_bridge, "log_cost", None)
            if log_cost is not None:
                log_cost(lambda status, **fields: latency("zeytun_cost", self.call_id, status=status, **fields))
            return zeytun_call_transcript(order, items, *heard)
        return [
''')
    # Owner, 2026-11-04: the line sounded hoarse, the same voice converted
    # with a filter did not. Pharmacy calls go to 8 kHz through the filtered
    # zeytun_phone_band; other calls keep ratecv.
    replace('''                        pcm8, self.output_resample_state = audioop.ratecv(
                            pcm24,
                            2,
                            1,
                            GEMINI_LIVE_OUTPUT_RATE,
                            8000,
                            self.output_resample_state,
                        )
''', '''                        if self.pharmacy_preview:
                            pcm8, self.output_resample_state = zeytun_phone_band(
                                pcm24, self.output_resample_state)
                        else:
                            pcm8, self.output_resample_state = audioop.ratecv(
                                pcm24,
                                2,
                                1,
                                GEMINI_LIVE_OUTPUT_RATE,
                                8000,
                                self.output_resample_state,
                            )
''')
    # Measured 2026-11-04 (see ZEYTUN_RESUME_* in the bridge): a dropped
    # pharmacy session is resumed by its one handle, the caller's turn going
    # on where it stopped, before the core's own recovery is tried. Same
    # session, same voice, no notice; without a resume the core recovers as
    # before.
    replace("        self.pharmacy_bridge = None\n",
            "        self.pharmacy_bridge = None\n        self.pharmacy_resumes = []\n        self.pharmacy_resume_total = 0\n")
    replace('''                if goaway_result == "none":
                    if self._recover_gemini(
''', '''                if goaway_result == "none":
                    if (self.pharmacy_preview
                            and (bare_receive_eof or isinstance(error, (RealtimeWebSocketClosed, OSError)))
                            and self._pharmacy_resume(type(error).__name__, active_ws)):
                        continue
                    if self._recover_gemini(
''')
    replace('''                if not self._recover_gemini(
                    type(error).__name__, delivery_ws
                ):
                    self.fail_closed()
''', '''                if not (self.pharmacy_preview
                        and self._pharmacy_resume(type(error).__name__, delivery_ws)) and not self._recover_gemini(
                    type(error).__name__, delivery_ws
                ):
                    self.fail_closed()
''')
    replace('    def _setup_event(self, resume_handle=None):\n', '''    def _pharmacy_resume(self, error_type, failed_ws):
        """Resume a dropped pharmacy session by its handle; False leaves recovery to the core."""
        with self.reconnect_lock:
            with self.gemini_event_lock:
                with self.control_send_lock:
                    with self.state_lock:
                        if self.closed or self.hangup_started:
                            return False
                        if self.ws is not None and self.ws is not failed_ws:
                            return True
                        handle = self.resumption_handle
                        now = time.monotonic()
                        allowed, recent = zeytun_resume_allowed(self.pharmacy_resumes, self.pharmacy_resume_total, now)
                        if not handle or not allowed:
                            return False
                        self.pharmacy_resumes = recent + [now]
                        self.pharmacy_resume_total += 1
                        # The provider keeps the caller's open turn: only what
                        # the caller says from now on is sent, into that turn.
                        window_open = self.provider_activity_open
                        self.reconnecting = True
                        self.gemini_ws_epoch += 1
                        self.ws = None
                        if self.goaway_ws is failed_ws:
                            self.goaway_ws = None
                            self.goaway_deadline = 0.0
            try:
                failed_ws.close()
            except Exception:
                pass
            latency("zeytun_resume", self.call_id, status="started", error_type=error_type, window_open=window_open)
            started = time.monotonic()
            attempts = 0
            replacement = None
            try:
                while True:
                    attempts += 1
                    deadline = started + ZEYTUN_RESUME_WINDOW_SECONDS
                    try:
                        replacement = self._open_gemini_websocket(deadline=deadline)
                        self._await_setup(replacement, resume_handle=handle, deadline=deadline)
                        break
                    except EOFError as error:  # RealtimeWebSocketClosed is one, with its code
                        if replacement is not None:
                            replacement.close()
                            replacement = None
                        if not zeytun_resume_retry(getattr(error, "code", None), started, time.monotonic()):
                            raise
                    time.sleep(ZEYTUN_RESUME_RETRY_SECONDS)
                    with self.state_lock:
                        if self.closed or self.hangup_started:
                            raise EOFError("call ended during resume")
                discarded = 0
                while True:
                    with self.state_lock:
                        if self.closed or self.hangup_started:
                            raise EOFError("call ended during resume")
                        buffered = bytes(self.pending_gemini_input)
                        self.pending_gemini_input.clear()
                    if buffered and not window_open:
                        # Outside a caller turn the provider takes no audio.
                        discarded += len(buffered)
                        buffered = b""
                    if not buffered:
                        with self.gemini_event_lock:
                            with self.control_send_lock:
                                with self.state_lock:
                                    if self.closed or self.hangup_started:
                                        raise EOFError("call ended during resume")
                                    if self.pending_gemini_input:
                                        continue
                                    end_turn = bool(window_open and not self.local_speech_active)
                                    owed_response = bool(
                                        self.response_active
                                        or (self.latest_customer_item_id is not None and not self.customer_turn_complete))
                                    playback_progress_version = self.gemini_playback_progress_version
                                    self.resume_progress_pcm_floor = self.gemini_audio_enqueue_seq
                                    self.gemini_ws_epoch += 1
                                    self.ws = replacement
                                    self.gemini_input_release_at = 0.0
                                    self.provider_activity_open = bool(window_open and not end_turn)
                                    self.reconnecting = False
                                    timers = self._retire_fresh_recovery_episode_locked()
                        break
                    event = {"realtimeInput": {"audio": {"data": base64.b64encode(buffered).decode("ascii"),
                                                         "mimeType": "audio/pcm;rate=%d" % GEMINI_LIVE_INPUT_RATE}}}
                    if not self._send_gemini_event(replacement, event, require_current=False):
                        raise EOFError("Gemini buffered input cancelled")
                for timer in timers:
                    self._cancel_timer(timer)
                if end_turn:
                    # The caller finished speaking while the session was away.
                    self._send_gemini_event(replacement, {"realtimeInput": {"activityEnd": {}}})
                    latency("gemini_activity", self.call_id, status="end", engine="gemini_live")
                self._start_resume_progress_watchdog(replacement, owed_response=owed_response,
                                                     expected_progress_version=playback_progress_version)
                latency("zeytun_resume", self.call_id, status="ok", attempts=attempts,
                        ms=round((time.monotonic() - started) * 1000), discarded_bytes=discarded, end_turn=end_turn)
                return True
            except Exception as error:
                if replacement is not None:
                    try:
                        replacement.close()
                    except Exception:
                        pass
                with self.gemini_event_lock:
                    with self.control_send_lock:
                        with self.state_lock:
                            if self.ws is replacement:
                                self.ws = None
                            self.reconnecting = False
                latency("zeytun_resume", self.call_id, status="failed", attempts=attempts,
                        error_type=type(error).__name__, close_code=getattr(error, "code", None),
                        ms=round((time.monotonic() - started) * 1000))
                return False

    def _setup_event(self, resume_handle=None):
''')
    # Owner, 2026-11-04 (task 6 of docs/zeytun-line-recognition-plan.md):
    # a second ear. Each caller phrase, activityStart to activityEnd, goes to
    # the CRM as the 8 kHz audio the provider gets before its resample (no
    # lookback); the CRM transcribes it itself and searches with that text
    # too. The bridge copies and sends it (utterance_audio/utterance_edge),
    # off this thread, once the CRM's session asks for it ("utterance": true);
    # ZEYTUN_UTTERANCE_ENABLED=0 switches it off at the station.
    replace("            self._resume_progress_after_speech()\n\n        pcm16, self.gemini_input_resample_state = audioop.ratecv(\n",
            "            self._resume_progress_after_speech()\n\n"
            "        if self.pharmacy_preview:\n"
            "            self.pharmacy_bridge.utterance_audio(payload)\n"
            "        pcm16, self.gemini_input_resample_state = audioop.ratecv(\n")
    replace("""                if self.provider_activity_open:
                    self.provider_activity_open = False
                    activity_open = False
        if activity_open is not None and not GEMINI_LIVE_PROVIDER_VAD:
""", """                if self.provider_activity_open:
                    self.provider_activity_open = False
                    activity_open = False
        if self.pharmacy_preview and activity_open is not None and not GEMINI_LIVE_PROVIDER_VAD:
            self.pharmacy_bridge.utterance_edge(activity_open, payload)
        if activity_open is not None and not GEMINI_LIVE_PROVIDER_VAD:
""")
    # A turn the resumed session closes is the end of that caller phrase.
    replace('''                    self._send_gemini_event(replacement, {"realtimeInput": {"activityEnd": {}}})
''', '''                    self._send_gemini_event(replacement, {"realtimeInput": {"activityEnd": {}}})
                    self.pharmacy_bridge.utterance_edge(False)
''')
    # Owner, 2026-10-28: the station resends an order the CRM did not answer.
    # Started with the service, so what a previous run left is sent before
    # the first call after a restart.
    replace('    logging.info("Fanum Voice Core listening on %s:%s",HOST,PORT)\n',
            '    if os.environ.get("ZEYTUN_INBOUND_PILOT_ENABLED") == "1":\n'
            '        zeytun_order_spool(CRM_RUNTIME_URL, CRM_RUNTIME_TOKEN, latency)\n'
            '    logging.info("Fanum Voice Core listening on %s:%s",HOST,PORT)\n')
    # Owner, 2026-11-11 («почему расходов 0?»): a pharmacy leg's result carries what the
    # leg spent on Live and speech (the bridge's call_usage), for the CRM's spend report.
    # The CRM accepts `usage` since the PR that added this; every other call sends none.
    replace('    demo_prompt_applied=False,\n):\n',
            '    demo_prompt_applied=False,\n    usage=None,\n):\n')
    replace('''    if recovery_attempts is not None:
        payload["recoveryAttempts"] = max(0, min(100, int(recovery_attempts)))
''', '''    if recovery_attempts is not None:
        payload["recoveryAttempts"] = max(0, min(100, int(recovery_attempts)))
    if isinstance(usage, dict) and usage:
        payload["usage"] = usage
''')
    replace('''                demo_prompt_applied=getattr(session, "is_demo_call", False) is True,
            )
''', '''                demo_prompt_applied=getattr(session, "is_demo_call", False) is True,
                usage=zeytun_leg_usage(session),
            )
''')
    replace("class GeminiLiveSession(RealtimeSession):", '''def zeytun_leg_usage(session):
    """A pharmacy leg's spend for its result; None for every other call, and never a raise."""
    if getattr(session, "pharmacy_preview", False) is not True:
        return None
    try:
        return session.pharmacy_bridge.call_usage()
    except Exception:
        return None


class GeminiLiveSession(RealtimeSession):''')
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
