#!/usr/bin/env python3
"""Gate an inbound Asterisk channel on an exact live browser claim.

The AGI deliberately never answers or originates a call.  Dialplan owns the
channel; this helper only publishes lifecycle events and asks LeadDrive whether
the exact claimed browser is still parked in the relay.  Customer numbers are
never logged; the initial ringing event is held only in the mode-0600 local
spool until LeadDrive durably accepts it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
from typing import Callable, Mapping, Protocol, TextIO
import urllib.error
import urllib.parse
import urllib.request
import uuid


CONFIG_PATH = Path("/etc/fanum-pbx-coordinator.env")
SPOOL_DIR = Path("/var/spool/fanum-inbound-browser-events")
LIFECYCLE_PATH = "/api/internal/asterisk/call-lifecycle"
READINESS_PATH = "/api/internal/asterisk/inbound-browser-ready"
READY_TIMEOUT_SECONDS = 25.0
READY_POLL_SECONDS = 1.0
HTTP_TIMEOUT_SECONDS = 2.0
MAX_SPOOL_FILES = 1_000
DRAIN_BATCH_SIZE = 100
PARTY_RE = re.compile(r"^[+0-9A-Za-z*#(). _-]{1,64}$")
TERMINAL_STATES = frozenset({"connected", "no_answer", "busy", "failed", "cancelled"})
SPOOL_STATE_ORDER = {
    "ringing": 0,
    "answered": 1,
    **{state: 2 for state in TERMINAL_STATES},
}

_hangup_requested = False


class ConfigurationError(Exception):
    pass


class SendResult(Enum):
    SENT = "sent"
    RETRY = "retry"
    REJECTED = "rejected"


@dataclass(frozen=True)
class RuntimeConfig:
    lifecycle_url: str
    readiness_url: str
    runtime_token: str


class LifecycleClient(Protocol):
    def send_lifecycle(self, payload: Mapping[str, object]) -> SendResult:
        ...

    def browser_ready(self, call_id: str) -> bool:
        ...


def _safe_log(event: str) -> None:
    # Fixed vocabulary only.  Never interpolate URLs, tokens or call parties.
    print(f"fanum-inbound-browser: {event}", file=sys.stderr, flush=True)


def _unquote_env_value(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _validated_endpoint(raw: str, expected_path: str) -> tuple[str, urllib.parse.SplitResult]:
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError as error:
        raise ConfigurationError("invalid endpoint") from error
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConfigurationError("unsafe endpoint")
    if parsed.path.rstrip("/") != expected_path or not parsed.hostname:
        raise ConfigurationError("unexpected endpoint path")
    loopback = parsed.hostname in {"127.0.0.1", "::1", "localhost"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ConfigurationError("endpoint must use https")
    normalized = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, expected_path, "", ""),
    )
    return normalized, parsed


def load_runtime_config(path: Path = CONFIG_PATH) -> RuntimeConfig:
    """Parse two fixed keys as data; never source the station's env file."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ConfigurationError("cannot read config") from error

    wanted = {
        "VOICE_CRM_HUMAN_LIFECYCLE_URL",
        "VOICE_CRM_RUNTIME_TOKEN",
    }
    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in wanted:
            continue
        if key in values:
            raise ConfigurationError("duplicate config key")
        values[key] = _unquote_env_value(value)

    lifecycle_raw = values.get("VOICE_CRM_HUMAN_LIFECYCLE_URL", "")
    token = values.get("VOICE_CRM_RUNTIME_TOKEN", "")
    if len(token) < 32 or any(character.isspace() for character in token):
        raise ConfigurationError("runtime token is missing")
    lifecycle_url, parsed = _validated_endpoint(lifecycle_raw, LIFECYCLE_PATH)
    readiness_url = urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, READINESS_PATH, "", ""),
    )
    return RuntimeConfig(
        lifecycle_url=lifecycle_url,
        readiness_url=readiness_url,
        runtime_token=token,
    )


class HttpLifecycleClient:
    def __init__(self, config: RuntimeConfig) -> None:
        self._config = config
        self._opener = urllib.request.build_opener(_NoRedirectHandler())

    def _post(self, url: str, payload: Mapping[str, object]) -> tuple[int, bytes]:
        request = urllib.request.Request(
            url,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._config.runtime_token}",
                "Content-Type": "application/json",
                "User-Agent": "fanum-inbound-browser/1",
            },
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        )
        try:
            with self._opener.open(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                return response.status, response.read(4_096)
        except urllib.error.HTTPError as error:
            # Status is safe operational data; the response body can contain
            # implementation detail, so it is consumed only by strict parsers
            # and is never logged.
            return error.code, error.read(4_096)

    def send_lifecycle(self, payload: Mapping[str, object]) -> SendResult:
        try:
            status, _body = self._post(self._config.lifecycle_url, payload)
        except (OSError, TimeoutError, urllib.error.URLError, ValueError):
            return SendResult.RETRY
        if 200 <= status < 300:
            try:
                decoded = json.loads(_body.decode("utf-8"))
            except (UnicodeError, json.JSONDecodeError):
                return SendResult.REJECTED
            return (
                SendResult.SENT
                if isinstance(decoded, dict) and decoded.get("success") is True
                else SendResult.REJECTED
            )
        if status in {408, 425, 429} or 500 <= status < 600:
            return SendResult.RETRY
        return SendResult.REJECTED

    def browser_ready(self, call_id: str) -> bool:
        try:
            status, body = self._post(self._config.readiness_url, {"callId": call_id})
            if not 200 <= status < 300:
                return False
            decoded = json.loads(body.decode("utf-8"))
            return isinstance(decoded, dict) and decoded.get("ready") is True
        except (OSError, TimeoutError, UnicodeError, json.JSONDecodeError, urllib.error.URLError, ValueError):
            return False

    def preflight(self) -> bool:
        """Prove both authenticated routes without creating or changing a call."""
        try:
            lifecycle_status, lifecycle_body = self._post(self._config.lifecycle_url, {})
            lifecycle_result = json.loads(lifecycle_body.decode("utf-8"))
            if (
                lifecycle_status != 400
                or not isinstance(lifecycle_result, dict)
                or not isinstance(lifecycle_result.get("error"), str)
            ):
                return False

            readiness_status, readiness_body = self._post(
                self._config.readiness_url,
                {"callId": str(uuid.uuid4())},
            )
            readiness_result = json.loads(readiness_body.decode("utf-8"))
            return (
                200 <= readiness_status < 300
                and isinstance(readiness_result, dict)
                and readiness_result.get("ready") is False
            )
        except (
            OSError,
            TimeoutError,
            UnicodeError,
            json.JSONDecodeError,
            urllib.error.URLError,
            ValueError,
        ):
            return False


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _event(state: str, call_id: str, *, duration_seconds: int | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "eventId": str(uuid.uuid4()),
        "callId": call_id,
        "state": state,
        "occurredAt": _utc_now(),
    }
    if duration_seconds is not None:
        payload["durationSeconds"] = duration_seconds
    return payload


def _valid_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except (ValueError, AttributeError):
        return False


def _new_call_id() -> str | None:
    try:
        call_id = str(uuid.uuid4())
    except (OSError, ValueError):
        return None
    return call_id if _valid_uuid(call_id) else None


def _agi_set(output: TextIO, name: str, value: str) -> None:
    # Names and values are closed enums, validated digits, or a generated UUID.
    output.write(f'SET VARIABLE {name} "{value}"\n')
    output.flush()


def read_agi_environment(stream: TextIO) -> dict[str, str]:
    variables: dict[str, str] = {}
    for raw_line in stream:
        line = raw_line.rstrip("\r\n")
        if not line:
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        variables[key.strip()] = value.strip()
    return variables


def _fsync_directory(directory: Path) -> None:
    directory_descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def _queue_payload(payload: Mapping[str, object], spool_dir: Path) -> Path | None:
    temporary: Path | None = None
    try:
        spool_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if sum(1 for path in spool_dir.glob("*.json") if path.is_file()) >= MAX_SPOOL_FILES:
            _safe_log("spool_full")
            return None
        safe_payload = _safe_spooled_payload(dict(payload))
        if safe_payload is None:
            return None
        event_id = safe_payload["eventId"]
        call_id = safe_payload["callId"]
        state = safe_payload["state"]
        assert isinstance(event_id, str)
        assert isinstance(call_id, str)
        assert isinstance(state, str)
        state_order = SPOOL_STATE_ORDER[state]
        destination = spool_dir / f"{call_id}.{state_order}.{event_id}.json"
        temporary = spool_dir / f".{event_id}.{uuid.uuid4()}.tmp"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            encoded = json.dumps(
                safe_payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            remaining = memoryview(encoded)
            while remaining:
                written = os.write(descriptor, remaining)
                if written <= 0:
                    raise OSError("short spool write")
                remaining = remaining[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, destination)
        temporary = None
        _fsync_directory(spool_dir)
        return destination
    except (OSError, TypeError, ValueError):
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        _safe_log("spool_write_failed")
        return None


def _remove_spooled(path: Path) -> None:
    path.unlink(missing_ok=True)
    _fsync_directory(path.parent)


def _send_ringing_durable(
    client: LifecycleClient,
    payload: Mapping[str, object],
    spool_dir: Path,
) -> SendResult:
    """Persist phone identity first, then attempt its synchronous delivery."""
    try:
        spool_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (spool_dir / ".drain.lock").open("a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            queued = _queue_payload(payload, spool_dir)
            if queued is None:
                return SendResult.RETRY
            result = client.send_lifecycle(payload)
            if result is not SendResult.RETRY:
                _remove_spooled(queued)
            return result
    except OSError:
        _safe_log("spool_write_failed")
        return SendResult.RETRY


def _safe_spooled_payload(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    keys = set(value)
    if keys not in (
        {"eventId", "callId", "state", "occurredAt"},
        {"eventId", "callId", "state", "occurredAt", "durationSeconds"},
        {"eventId", "callId", "state", "occurredAt", "fromNumber", "toNumber"},
    ):
        return None
    if not isinstance(value.get("eventId"), str) or not _valid_uuid(value["eventId"]):
        return None
    if not isinstance(value.get("callId"), str) or not _valid_uuid(value["callId"]):
        return None
    state = value.get("state")
    if state == "ringing":
        from_number = value.get("fromNumber")
        to_number = value.get("toNumber")
        if (
            keys != {"eventId", "callId", "state", "occurredAt", "fromNumber", "toNumber"}
            or not isinstance(from_number, str)
            or not PARTY_RE.fullmatch(from_number)
            or not isinstance(to_number, str)
            or not PARTY_RE.fullmatch(to_number)
        ):
            return None
        return value
    if state == "answered":
        return value if "durationSeconds" not in value else None
    if state not in TERMINAL_STATES:
        return None
    duration = value.get("durationSeconds")
    if not isinstance(duration, int) or isinstance(duration, bool) or not 0 <= duration <= 14_400:
        return None
    return value


def drain_spool(client: LifecycleClient, spool_dir: Path = SPOOL_DIR) -> tuple[int, int]:
    """Send a bounded batch under flock; return (sent_or_rejected, deferred)."""
    try:
        spool_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        lock_path = spool_dir / ".drain.lock"
        with lock_path.open("a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            processed = 0
            deferred = 0
            for path in sorted(spool_dir.glob("*.json"))[:DRAIN_BATCH_SIZE]:
                try:
                    payload = _safe_spooled_payload(json.loads(path.read_text(encoding="utf-8")))
                except (OSError, UnicodeError, json.JSONDecodeError):
                    payload = None
                if payload is None:
                    _remove_spooled(path)
                    processed += 1
                    _safe_log("spool_entry_rejected")
                    continue
                result = client.send_lifecycle(payload)
                if result is SendResult.RETRY:
                    deferred += 1
                    break
                _remove_spooled(path)
                processed += 1
            return processed, deferred
    except (BlockingIOError, OSError):
        return 0, 0


def _wait_ready(
    client: LifecycleClient,
    call_id: str,
    *,
    timeout_seconds: float,
    monotonic: Callable[[], float],
    sleep: Callable[[float], None],
) -> bool:
    deadline = monotonic() + timeout_seconds
    while not _hangup_requested:
        if client.browser_ready(call_id):
            return True
        if monotonic() >= deadline:
            return False
        sleep(READY_POLL_SECONDS)
    return False


def run_mode(
    *,
    mode: str,
    arguments: list[str],
    agi_variables: Mapping[str, str],
    client: LifecycleClient,
    spool_dir: Path,
    output: TextIO,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    ready_timeout_seconds: float = READY_TIMEOUT_SECONDS,
) -> int:
    if mode == "identify":
        if arguments:
            return 1
        call_id = _new_call_id()
        if call_id is None:
            return 1
        _agi_set(output, "__FANUM_SAFE_CALL_ID", call_id)
        return 0

    if len(arguments) < 1 or not _valid_uuid(arguments[0]):
        _agi_set(output, "FANUM_INBOUND_EVENT_OK", "0")
        return 1
    call_id = arguments[0]

    if mode == "ringing":
        from_number = agi_variables.get("agi_callerid", "").strip()
        to_number = arguments[1].strip() if len(arguments) == 2 else ""
        if not PARTY_RE.fullmatch(from_number) or not PARTY_RE.fullmatch(to_number):
            _agi_set(output, "FANUM_INBOUND_EVENT_OK", "0")
            return 1
        payload = _event("ringing", call_id)
        payload["fromNumber"] = from_number
        payload["toNumber"] = to_number
        sent = _send_ringing_durable(client, payload, spool_dir) is SendResult.SENT
        _agi_set(output, "FANUM_INBOUND_EVENT_OK", "1" if sent else "0")
        return 0 if sent else 1

    if mode == "ready":
        ready = _wait_ready(
            client,
            call_id,
            timeout_seconds=ready_timeout_seconds,
            monotonic=monotonic,
            sleep=sleep,
        )
        _agi_set(output, "FANUM_BROWSER_READY", "1" if ready else "0")
        return 0

    if mode == "answered" and len(arguments) == 1:
        # No network operation is permitted between Answer() and AudioSocket:
        # a slow callback there would answer the customer into silence.  The
        # timer drains this local event in order with the terminal event.
        accepted = _queue_payload(_event("answered", call_id), spool_dir)
        _agi_set(output, "FANUM_INBOUND_EVENT_OK", "1" if accepted else "0")
        return 0 if accepted else 1

    if mode == "terminal" and len(arguments) == 3:
        state = arguments[1]
        try:
            duration_seconds = int(arguments[2], 10)
        except ValueError:
            duration_seconds = -1
        if state not in TERMINAL_STATES or not 0 <= duration_seconds <= 14_400:
            _agi_set(output, "FANUM_INBOUND_EVENT_OK", "0")
            return 1
        accepted = _queue_payload(
            _event(state, call_id, duration_seconds=duration_seconds),
            spool_dir,
        )
        _agi_set(output, "FANUM_INBOUND_EVENT_OK", "1" if accepted else "0")
        return 0 if accepted else 1

    _agi_set(output, "FANUM_INBOUND_EVENT_OK", "0")
    return 1


def _mark_hangup(_signum: int, _frame: object) -> None:
    global _hangup_requested
    _hangup_requested = True


def _client_from_station_config() -> HttpLifecycleClient:
    return HttpLifecycleClient(load_runtime_config(CONFIG_PATH))


def main(argv: list[str]) -> int:
    os.umask(0o077)
    if argv == ["--self-check"]:
        try:
            load_runtime_config(CONFIG_PATH)
            return 0 if _new_call_id() is not None else 1
        except ConfigurationError:
            _safe_log("configuration_invalid")
            return 1
    if argv == ["--preflight"]:
        try:
            return 0 if _client_from_station_config().preflight() else 1
        except ConfigurationError:
            _safe_log("configuration_invalid")
            return 1
    if argv == ["--drain-spool"]:
        try:
            drain_spool(_client_from_station_config(), SPOOL_DIR)
            return 0
        except ConfigurationError:
            _safe_log("configuration_invalid")
            return 1

    if not argv:
        return 2
    mode, arguments = argv[0], argv[1:]
    signal.signal(signal.SIGHUP, _mark_hangup)
    signal.signal(signal.SIGTERM, _mark_hangup)
    agi_variables = read_agi_environment(sys.stdin)
    try:
        client = _client_from_station_config()
    except ConfigurationError:
        _agi_set(sys.stdout, "FANUM_INBOUND_EVENT_OK", "0")
        _safe_log("configuration_invalid")
        return 1
    return run_mode(
        mode=mode,
        arguments=arguments,
        agi_variables=agi_variables,
        client=client,
        spool_dir=SPOOL_DIR,
        output=sys.stdout,
    )


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
