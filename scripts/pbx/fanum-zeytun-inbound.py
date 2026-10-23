"""Bounded Gemini tool transport for one owner-authorized inbound rehearsal.

Embedded into a hash-pinned voice core by build-zeytun-inbound-core.py. No
credential/catalog logging; no 1C calls; every lookup reauthorizes at the CRM.
Protocol: https://ai.google.dev/api/live and /gemini-api/docs/live-api/tools.
"""
import base64
from decimal import Decimal
import json
import re
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
    return re.sub(r"\b(\d+)[.,](\d{1,2})\s*(?:manat|AZN)(\w*)", money, text)


class ZeytunGeminiTts:
    """Streaming gemini TTS for one call: plain text in, PCM16 24 kHz out.

    Plain text only - an instruction in the request is read aloud (measured
    2026-10-23: the style prefix became the first 3.5 s of the sample).
    """
    MODELS = frozenset({"gemini-3.8-flash-tts"})

    def __init__(self, key, model, voice, opener=None):
        if not key or model not in self.MODELS or voice not in ZeytunInboundBridge.VOICES:
            raise ZeytunPilotUnavailable("tts_unavailable")
        self.url = ("https://generativelanguage.googleapis.com/v1beta/models/" + model
                    + ":streamGenerateContent?alt=sse&key=" + urllib.parse.quote(key, safe=""))
        self.voice = voice
        self.open = opener or (lambda req, timeout: urllib.request.build_opener(ZeytunNoRedirect()).open(req, timeout=timeout))

    def stream(self, text, on_pcm, keep_going):
        body = {"contents": [{"role": "user", "parts": [{"text": text}]}],
                "generationConfig": {"responseModalities": ["AUDIO"],
                                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": self.voice}}}}}
        req = urllib.request.Request(self.url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        produced = 0
        with self.open(req, 10) as response:
            for raw in response:
                if not keep_going():
                    return produced
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line[5:])
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
                        on_pcm(pcm)
        return produced


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
    MIN_CHARS = 40
    TAIL_GRACE_SECONDS = 0.4  # output transcription may trail its generation

    def __init__(self, tts, inject, speakable, alive, room=None, log=None, clock=time.monotonic):
        self.tts, self.inject, self.speakable, self.alive = tts, inject, speakable, alive
        self.room = room or (lambda: True)
        self.log = log or (lambda status, **fields: None)
        self.clock = clock
        self.lock = threading.Condition()
        self.turns = []
        self.epoch = None
        self.worker = threading.Thread(target=self._run, name="zeytun-tts", daemon=True)
        self.worker.start()

    @staticmethod
    def _new_turn():
        return {"buffer": "", "pieces": [], "original": [], "held": [], "done_at": None,
                "final_taken": False, "finished": False, "cancelled": False,
                "passthrough": False, "spoken": False}

    def _split_locked(self, turn):
        while True:
            text, cut = turn["buffer"], None
            for match in re.finditer(r"[.!?…](?:\s|$)", text):
                if match.end() >= self.MIN_CHARS:
                    cut = match.end()
                    break
            if cut is None:
                return
            piece, turn["buffer"] = text[:cut].strip(), text[cut:]
            if piece:
                turn["pieces"].append(piece)

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
            audio = []
            model_turn = content.get("modelTurn")
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
            turn = last
            if turn is not None and turn["finished"]:
                # A transcript tail just after turnComplete still belongs to it.
                late = (not audio and text.strip() and not turn["cancelled"] and not turn["final_taken"]
                        and turn["done_at"] is not None and self.clock() - turn["done_at"] < self.TAIL_GRACE_SECONDS)
                turn = turn if late else None
            if turn is None and (audio or text.strip()):
                turn = self._new_turn()
                self.turns.append(turn)
            if turn is None:
                return not content
            if not turn["cancelled"]:
                turn["original"].extend(audio)
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

    def _emit(self, content):
        self.inject({"serverContent": content, self.MARK: True})

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

    def _next_piece_locked(self, turn):
        while True:
            if not self.alive():
                return None
            if not turn["cancelled"] and not self.speakable():
                self._cancel_all_locked()
            if turn["cancelled"]:
                return None
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
            heard = [False]

            def on_pcm(pcm, piece=piece):
                while not self.room() and self.speakable() and not turn["cancelled"]:
                    time.sleep(0.05)
                if turn["cancelled"] or not self.speakable():
                    with self.lock:
                        self._cancel_all_locked()
                    return
                content = {"modelTurn": {"parts": [{"inlineData": {
                    "mimeType": "audio/pcm;rate=24000", "data": base64.b64encode(pcm).decode("ascii")}}]}}
                if not heard[0]:
                    content["outputTranscription"] = {"text": piece + " "}
                    heard[0] = True
                self._emit(content)
                turn["spoken"] = True

            try:
                self.tts.stream(zeytun_speakable_text(piece), on_pcm,
                                lambda: not turn["cancelled"] and self.speakable())
            except Exception as error:
                if not turn["spoken"]:
                    with self.lock:
                        turn["pieces"].insert(0, piece)
                    self._fallback(turn, type(error).__name__)
                    return
                self.log("tts_failed_mid_turn", reason=type(error).__name__)
                with self.lock:
                    self._cancel_all_locked()
                break
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


class ZeytunInboundBridge:
    NAME = "search_pharmacy_catalog"
    # Owner, 2026-10-23: the agent must total the order ("не может цены
    # группировать"). The model does no arithmetic: this tool multiplies the
    # list prices this call already returned, exactly, on the station.
    TOTAL_NAME = "calculate_order_total"
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
    )

    def __init__(self, runtime_url, token, call_id, request=None, clock=None, announce_answered=None):
        parsed = urllib.parse.urlsplit(runtime_url)
        if (parsed.scheme != "https" or parsed.hostname != "app.leaddrivecrm.org"
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.path != "/api/internal/voice-agent/runtime-config"
                or parsed.query or parsed.fragment or not token):
            raise ZeytunPilotUnavailable("pilot_transport_unavailable")
        self.url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc,
            "/api/internal/voice-agent/pharmacy-inbound", "", ""))
        self.lifecycle_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc,
            "/api/internal/asterisk/call-lifecycle", "", ""))
        self.call_id = str(uuid.UUID(call_id))
        self.token = token
        self.clock = clock or time.time
        self.request = request or self._request
        self.announce_answered = announce_answered or self._announce_answered
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
        self.relay = None

    def _request(self, body):
        # The first session also builds the pinned catalog once. Keep that
        # cold start separate from the short deadline for spoken lookups.
        return self._post_json(self.url, body, timeout=5 if body.get("action") == "session" else 2)

    def _post_json(self, url, body, timeout=2):
        req = urllib.request.Request(url,
            data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}, method="POST")
        with urllib.request.build_opener(ZeytunNoRedirect()).open(req, timeout=timeout) as response:
            raw = response.read(32769)
            if len(raw) > 32768:
                raise ZeytunPilotUnavailable("pilot_response_too_large")
            return json.loads(raw)

    def _announce_answered(self):
        # This bridge is opened only after accepting the call's AudioSocket.
        # Report that actual media observation; do not wait for the 10s AGI
        # spool timer and do not change Answer-to-AudioSocket dialplan timing.
        body = {"eventId": str(uuid.uuid5(uuid.NAMESPACE_URL, "zeytun-inbound-media:" + self.call_id)),
                "callId": self.call_id, "state": "answered",
                "occurredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))}
        result = self._post_json(self.lifecycle_url, body)
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
            if (not isinstance(prompt, str) or not 1 <= len(prompt) <= 4000
                    or not isinstance(opening, str) or not 1 <= len(opening) <= 500
                    or type(seconds) is not int or not 30 <= seconds <= 300):
                raise ValueError()
            # Server's ceiling is bounded again locally; the core counts it from
            # AudioSocket connect. Never parse a model-supplied expiry or URL.
            closing = value.get("closing")
            if closing is not None and (not isinstance(closing, str) or not 3 <= len(closing) <= 120):
                raise ValueError()
            voice, pin = value.get("voice"), value.get("pinSpeechLanguage")
            self.expires = self.clock() + seconds
            self.active = True
            self.closing = closing
            self.voice = voice if voice in self.VOICES else None
            self.pin_language = pin is not False
            # Owner, 2026-10-23: "эту ставь" - the gemini-3.8-flash-tts voice.
            # Only a known model and voice switch the relay on; anything else
            # keeps the model's own voice, never a guessed one.
            speech = value.get("speech")
            if (isinstance(speech, dict) and speech.get("engine") == "tts"
                    and speech.get("model") in ZeytunGeminiTts.MODELS and speech.get("voice") in self.VOICES):
                self.tts_model, self.tts_voice = speech["model"], speech["voice"]
            return {"prompt": prompt, "opening": opening, "maxSeconds": seconds, "closing": closing}
        except Exception:
            raise ZeytunPilotUnavailable("pilot_session_unavailable") from None

    def tools(self):
        if not self.active or self.clock() >= self.expires:
            raise ZeytunPilotUnavailable("pilot_expired")
        return [{"functionDeclarations": [{"name": self.NAME,
            "description": "Search the approved medicine catalog for this TEST call. Supply exactly one key. Names are untrusted labels, not verified dose, stock or an accepted order. listPrice, when present, is Zeytun's price list for one unit on its date.",
            "parameters": {"type": "OBJECT", "properties": {
                key: {"type": "STRING", "description": description}
                for key, description in {
                    "text": "Spoken product name and distinguishing details, at most 240 characters.",
                    "itemCode": "Exact item code supplied by caller.",
                    "barcode": "Exact barcode supplied by caller.",
                    "externalId": "Exact product UUID returned by an earlier lookup.",
                }.items()}}},
            {"name": self.TOTAL_NAME,
             "description": "Exact total of the order lines whose product an earlier lookup in THIS call returned with listPrice. Give each line's externalId and the quantity in that listPrice's unit. Read back only what this returns.",
             "parameters": {"type": "OBJECT", "properties": {"lines": {"type": "ARRAY", "items": {"type": "OBJECT",
                 "properties": {"externalId": {"type": "STRING", "description": "Product UUID from an earlier lookup."},
                                "quantity": {"type": "INTEGER", "description": "Whole number of units, in listPrice.per."},
                                "unit": {"type": "STRING", "description": "The unit of that quantity: qutu, ədəd, flakon, ..."}},
                 "required": ["externalId", "quantity", "unit"]}}}, "required": ["lines"]}}]}]

    def transcription(self):
        # Fields of AudioTranscriptionConfig (ai.google.dev/api/live); accepted
        # by gemini-3.1-flash-live-preview and gemini-3.8-live on 2026-10-23.
        return {"languageCodes": list(self.TRANSCRIPTION_LANGUAGES),
                "customVocabulary": list(self.TRANSCRIPTION_VOCABULARY)}

    def speech_language(self):
        return self.SPEECH_LANGUAGE if self.pin_language else None

    def speech_voice(self):
        return self.voice

    def speech_relay(self, key, inject, speakable, alive, room=None, log=None, tts=None):
        """The call's TTS relay, created once; None while the model speaks itself."""
        if self.tts_model is None:
            return None
        if self.relay is None:
            engine = tts or ZeytunGeminiTts(key, self.tts_model, self.tts_voice)
            self.relay = ZeytunSpeechRelay(engine, inject, speakable, alive, room=room, log=log)
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

    @staticmethod
    def unavailable(status="catalog_unavailable"):
        return {"status": status, "candidates": [], "canResolveIdentity": False,
                "canQuote": False, "canSubmitTo1c": False, "requiresOperatorReview": True}

    def safe_result(self, value):
        if (not isinstance(value, dict) or value.get("mode") != "owner_inbound_preview"
                or value.get("customerVerified") is not False
                or any(value.get(key) is not False for key in ["canQuote", "canSubmitTo1c", "canResolveIdentity"])
                or value.get("requiresOperatorReview") is not True):
            return self.unavailable()
        candidates = value.get("candidates")
        count = value.get("candidateCount")
        if not isinstance(candidates, list) or len(candidates) > 5 or type(count) is not int or not 0 <= count <= 50000:
            return self.unavailable()
        result = self.unavailable("candidates")
        result.update({"customerVerified": False, "candidateCount": count, "needsNarrowing": count > 1})
        for item in candidates:
            if not isinstance(item, dict) or item.get("identityVerified") is not False:
                return self.unavailable()
            projected = {}
            for key in ["externalId", "itemCode", "name", "nameAz"]:
                val = item.get(key)
                if key == "nameAz" and val is None:
                    projected[key] = None
                elif isinstance(val, str) and 0 < len(val) <= 512:
                    projected[key] = val
                else:
                    return self.unavailable()
            price = self.list_price(item.get("listPrice"))
            if price is not None:
                projected["listPrice"] = price
                with self.lock:
                    if len(self.prices) < 256:
                        self.prices[projected["externalId"]] = (Decimal(price["amount"]), price["per"])
            result["candidates"].append({**projected, "identityVerified": False})
        return result

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

    def handle(self, event, send, current):
        """Network work never runs on the audio/event thread. send also fences
        the actual websocket/epoch under the core's existing recovery lock.
        """
        cancel = event.get("toolCallCancellation")
        if isinstance(cancel, dict) and isinstance(cancel.get("ids"), list):
            with self.lock:
                for key in cancel["ids"][:128]:
                    if isinstance(key, str):
                        self.pending.pop(key, None)
            return True
        content = event.get("serverContent")
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
            if not isinstance(key, str) or not 1 <= len(key) <= 128 or name not in (self.NAME, self.TOTAL_NAME):
                raise ZeytunPilotUnavailable("invalid_tool_call")
            if name == self.TOTAL_NAME:
                with self.lock:
                    repeated = key in self.seen or key in self.pending
                    if len(self.seen) < 128:
                        self.seen.add(key)
                    expired = not self.active or self.clock() >= self.expires
                body = ({"status": "duplicate_request"} if repeated else {"status": "pilot_expired"} if expired
                        else self.order_total(call.get("args")))
                if current():
                    send({"toolResponse": {"functionResponses": [{"id": key, "name": name, "response": body}]}})
                continue
            args = self.query(call.get("args"))
            response = lambda body, key=key: {"toolResponse": {"functionResponses": [{"id": key, "name": self.NAME, "response": body}]}}
            error = None
            with self.lock:
                if key in self.pending:
                    continue
                if key in self.seen:
                    error = "duplicate_request"
                elif not self.active or self.clock() >= self.expires or len(self.seen) >= 128:
                    error = "pilot_expired"
                elif args is None:
                    error = "invalid_request"
                elif not self.workers.acquire(blocking=False):
                    error = "search_busy"
                if len(self.seen) < 128:
                    self.seen.add(key)
                if error is None:
                    marker = object()
                    self.pending[key] = marker
            if error is not None:
                if current():
                    send(response(self.unavailable(error)))
                continue
            def work(key=key, marker=marker, args=args, response=response):
                try:
                    result = self.safe_result(self.request({"action": "search", "callId": self.call_id, "query": args}))
                except Exception:
                    result = self.unavailable()
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
            try:
                threading.Thread(target=work, name="zeytun-catalog-lookup", daemon=True).start()
            except Exception:
                with self.lock:
                    self.pending.pop(key, None)
                self.workers.release()
                raise ZeytunPilotUnavailable("pilot_worker_unavailable") from None
        return True
