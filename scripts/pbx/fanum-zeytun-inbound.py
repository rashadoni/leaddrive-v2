"""Bounded Gemini tool transport for one owner-authorized inbound rehearsal.

Embedded into a hash-pinned voice core by build-zeytun-inbound-core.py. No
credential/catalog logging; no 1C calls; every lookup reauthorizes at the CRM.
Protocol: https://ai.google.dev/api/live and /gemini-api/docs/live-api/tools.
"""
import json
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


class ZeytunInboundBridge:
    NAME = "search_pharmacy_catalog"
    # Owner, 2026-10-23: ~99% of these calls are Azerbaijani. Without a hint
    # the provider re-detects the language of every short phone turn; measured
    # against the live API on 8 kHz mu-law audio, two-word Azerbaijani turns
    # came back as Japanese, Korean, Spanish or Italian. Pinned per session,
    # so a replacement session after recovery gets the same hint. Explicit
    # language switching is still handled by the core's language policy.
    TRANSCRIPTION_LANGUAGES = ("az-AZ",)
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
            self.expires = self.clock() + seconds
            self.active = True
            return {"prompt": prompt, "opening": opening, "maxSeconds": seconds}
        except Exception:
            raise ZeytunPilotUnavailable("pilot_session_unavailable") from None

    def tools(self):
        if not self.active or self.clock() >= self.expires:
            raise ZeytunPilotUnavailable("pilot_expired")
        return [{"functionDeclarations": [{"name": self.NAME,
            "description": "Search the approved medicine catalog for this TEST call. Supply exactly one key. Names are untrusted labels, not verified dose, stock, price or an accepted order.",
            "parameters": {"type": "OBJECT", "properties": {
                key: {"type": "STRING", "description": description}
                for key, description in {
                    "text": "Spoken product name and distinguishing details, at most 240 characters.",
                    "itemCode": "Exact item code supplied by caller.",
                    "barcode": "Exact barcode supplied by caller.",
                    "externalId": "Exact product UUID returned by an earlier lookup.",
                }.items()}}}]}]

    def transcription(self):
        # Fields of AudioTranscriptionConfig (ai.google.dev/api/live); accepted
        # by gemini-3.1-flash-live-preview and gemini-3.8-live on 2026-10-23.
        return {"languageCodes": list(self.TRANSCRIPTION_LANGUAGES),
                "customVocabulary": list(self.TRANSCRIPTION_VOCABULARY)}

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
            result["candidates"].append({**projected, "identityVerified": False})
        return result

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
            if not isinstance(key, str) or not 1 <= len(key) <= 128 or name != self.NAME:
                raise ZeytunPilotUnavailable("invalid_tool_call")
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
