"""Minimal authenticated HTTP client for jobs and collection reports."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
JOBS_SCHEMA_VERSION = "facebook-native-search-jobs-v2"
RESULTS_SCHEMA_VERSION = "facebook-native-search-results-v2"
TARGET_BINDING_VERSION = "facebook-native-search-targets-v1"
MAX_JOBS = 50
MAX_TARGETS_PER_JOB = 25
_JOB_ID = re.compile(r"^fbns_[a-f0-9]{32}$")
_TARGET_FIELDS = {"scenarioId", "subjectId", "sourceId"}
_JOB_FIELDS = {"jobId", "targetBindingVersion", "targets", "query"}


class ApiError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SearchTarget:
    scenario_id: str
    subject_id: str
    source_id: str

    def as_request(self) -> dict[str, str]:
        return {
            "scenarioId": self.scenario_id,
            "subjectId": self.subject_id,
            "sourceId": self.source_id,
        }


@dataclass(frozen=True)
class SearchJob:
    job_id: str
    target_binding_version: str
    targets: tuple[SearchTarget, ...]
    query: str


@dataclass(frozen=True)
class JobBatch:
    jobs: list[SearchJob]
    limits: dict[str, Any]


def target_key(target: SearchTarget) -> str:
    return json.dumps(
        [target.scenario_id, target.subject_id, target.source_id],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _has_forbidden_control(value: str) -> bool:
    return any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)


def compute_job_id(query: str, targets: tuple[SearchTarget, ...]) -> str:
    """Mirror the server's NFKC/lower-case grouped job identifier."""

    if _has_forbidden_control(query):
        raise ApiError("JOBS_RESPONSE_INVALID")
    query_key = unicodedata.normalize("NFKC", query).lower()
    material = "\0".join(
        (TARGET_BINDING_VERSION, query_key, *(target_key(target) for target in targets))
    )
    try:
        digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    except UnicodeEncodeError as exc:
        raise ApiError("JOBS_RESPONSE_INVALID") from exc
    return f"fbns_{digest[:32]}"


def _parse_target(value: Any) -> SearchTarget:
    if not isinstance(value, dict) or set(value) != _TARGET_FIELDS:
        raise ApiError("JOBS_RESPONSE_INVALID")
    fields: list[str] = []
    for name in ("scenarioId", "subjectId", "sourceId"):
        raw = value.get(name)
        if not isinstance(raw, str):
            raise ApiError("JOBS_RESPONSE_INVALID")
        normalized = raw.strip()
        if not 1 <= len(normalized) <= 191 or _has_forbidden_control(normalized):
            raise ApiError("JOBS_RESPONSE_INVALID")
        fields.append(normalized)
    return SearchTarget(*fields)


def _read_bounded(response: Any) -> bytes:
    content = response.read(MAX_RESPONSE_BYTES + 1)
    if len(content) > MAX_RESPONSE_BYTES:
        raise ApiError("API_RESPONSE_TOO_LARGE")
    return content


def _parse_json_object(content: bytes, code: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ApiError(code) from exc
    if not isinstance(parsed, dict):
        raise ApiError(code)
    return parsed


def parse_jobs_response(value: Mapping[str, Any]) -> JobBatch:
    if value.get("success") is not True:
        raise ApiError("JOBS_API_REJECTED")
    data = value.get("data")
    if not isinstance(data, dict):
        raise ApiError("JOBS_RESPONSE_INVALID")
    if data.get("schemaVersion") != JOBS_SCHEMA_VERSION:
        raise ApiError("JOBS_SCHEMA_UNSUPPORTED")
    raw_jobs = data.get("jobs")
    raw_limits = data.get("limits", {})
    if not isinstance(raw_jobs, list) or not isinstance(raw_limits, dict):
        raise ApiError("JOBS_RESPONSE_INVALID")
    if len(raw_jobs) > MAX_JOBS:
        raise ApiError("JOBS_RESPONSE_INVALID")

    jobs: list[SearchJob] = []
    seen: set[str] = set()
    for raw in raw_jobs:
        if not isinstance(raw, dict) or set(raw) != _JOB_FIELDS:
            raise ApiError("JOBS_RESPONSE_INVALID")
        job_id = raw.get("jobId")
        if not isinstance(job_id, str) or not _JOB_ID.fullmatch(job_id):
            raise ApiError("JOBS_RESPONSE_INVALID")
        if job_id in seen:
            raise ApiError("JOBS_RESPONSE_INVALID")
        seen.add(job_id)

        binding = raw.get("targetBindingVersion")
        if binding != TARGET_BINDING_VERSION:
            raise ApiError("JOBS_RESPONSE_INVALID")

        raw_targets = raw.get("targets")
        if (
            not isinstance(raw_targets, list)
            or not 1 <= len(raw_targets) <= MAX_TARGETS_PER_JOB
        ):
            raise ApiError("JOBS_RESPONSE_INVALID")
        targets = tuple(_parse_target(value) for value in raw_targets)
        keys = [target_key(target) for target in targets]
        if len(set(keys)) != len(keys) or keys != sorted(keys):
            raise ApiError("JOBS_RESPONSE_INVALID")

        query = raw.get("query")
        if not isinstance(query, str):
            raise ApiError("JOBS_RESPONSE_INVALID")
        normalized = " ".join(query.split())
        if (
            not 1 <= len(normalized) <= 160
            or normalized != query
            or _has_forbidden_control(normalized)
        ):
            raise ApiError("JOBS_RESPONSE_INVALID")
        if compute_job_id(normalized, targets) != job_id:
            raise ApiError("JOBS_RESPONSE_INVALID")
        jobs.append(
            SearchJob(
                job_id=job_id,
                target_binding_version=TARGET_BINDING_VERSION,
                targets=targets,
                query=normalized,
            )
        )

    return JobBatch(jobs=jobs, limits=dict(raw_limits))


class LeadDriveApi:
    """API adapter with a deliberately narrow, non-extensible payload surface."""

    def __init__(
        self,
        jobs_url: str,
        results_url: str,
        token: str,
        timeout_seconds: float,
        user_agent: str,
    ) -> None:
        self.jobs_url = jobs_url
        self.results_url = results_url
        self._token = token
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent

    def __repr__(self) -> str:
        return (
            f"{type(self).__name__}(jobs_url={self.jobs_url!r}, "
            f"results_url={self.results_url!r}, token=<redacted>)"
        )

    def _request(
        self,
        method: str,
        url: str,
        body: Mapping[str, Any] | None = None,
    ) -> tuple[int, bytes]:
        encoded = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._token}",
            "User-Agent": self.user_agent,
        }
        if body is not None:
            encoded = json.dumps(
                body,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            url=url,
            data=encoded,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.timeout_seconds,
            ) as response:
                return response.status, _read_bounded(response)
        except urllib.error.HTTPError as exc:
            # Never read/log the response body: it could reflect request data.
            raise ApiError(f"HTTP_{exc.code}") from exc
        except urllib.error.URLError as exc:
            raise ApiError("HTTP_UNAVAILABLE") from exc
        except TimeoutError as exc:
            raise ApiError("HTTP_TIMEOUT") from exc

    def fetch_jobs(self) -> JobBatch:
        status, content = self._request("GET", self.jobs_url)
        if status < 200 or status >= 300:
            raise ApiError(f"HTTP_{status}")
        response = _parse_json_object(content, "JOBS_RESPONSE_INVALID")
        return parse_jobs_response(response)

    def deliver_results(self, payload: Mapping[str, Any]) -> None:
        if payload.get("schemaVersion") != RESULTS_SCHEMA_VERSION:
            raise ApiError("RESULTS_SCHEMA_INVALID")
        status, content = self._request("POST", self.results_url, payload)
        if status < 200 or status >= 300:
            raise ApiError(f"HTTP_{status}")
        if not content:
            return
        response = _parse_json_object(content, "RESULTS_RESPONSE_INVALID")
        if response.get("success") is not True:
            raise ApiError("RESULTS_API_REJECTED")
