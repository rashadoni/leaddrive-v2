"""Validated configuration for the Facebook native-search worker.

The worker intentionally supports only a loopback Chrome DevTools endpoint.
It must attach to the persistent browser that was provisioned separately; it
never starts or owns a browser process.
"""

from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit


class ConfigurationError(ValueError):
    """Raised when a configuration could weaken a worker safety invariant."""


@dataclass(frozen=True)
class RuntimeLimits:
    """Conservative, locally enforced collection limits.

    Remote job configuration may only make these limits stricter. It cannot
    increase collection volume or decrease pacing.
    """

    min_scrolls: int = 8
    max_scrolls: int = 8
    stagnant_scrolls_after_minimum: int = 2
    max_queries_per_cycle: int = 1
    max_queries_per_hour: int = 2
    max_queries_per_day: int = 8
    max_items_per_query: int = 25
    max_delivery_runs_per_cycle: int = 50
    query_delay_seconds: float = 1800.0
    query_jitter_seconds: float = 120.0
    scroll_wait_seconds: float = 3.0
    cycle_interval_seconds: float = 900.0
    navigation_timeout_seconds: float = 60.0
    http_timeout_seconds: float = 30.0

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any] | None) -> "RuntimeLimits":
        value = value or {}
        known = {
            "minScrolls",
            "maxScrolls",
            "stagnantScrollsAfterMinimum",
            "maxQueriesPerCycle",
            "maxQueriesPerHour",
            "maxQueriesPerDay",
            "maxItemsPerQuery",
            "maxDeliveryRunsPerCycle",
            "queryDelaySeconds",
            "queryJitterSeconds",
            "scrollWaitSeconds",
            "cycleIntervalSeconds",
            "navigationTimeoutSeconds",
            "httpTimeoutSeconds",
        }
        unknown = set(value) - known
        if unknown:
            raise ConfigurationError(
                f"Unknown runtime limit keys: {', '.join(sorted(unknown))}"
            )

        def integer(name: str, default: int) -> int:
            raw = value.get(name, default)
            if isinstance(raw, bool) or not isinstance(raw, int):
                raise ConfigurationError(f"{name} must be an integer")
            return raw

        def number(name: str, default: float) -> float:
            raw = value.get(name, default)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ConfigurationError(f"{name} must be a number")
            return float(raw)

        limits = cls(
            min_scrolls=integer("minScrolls", cls.min_scrolls),
            max_scrolls=integer("maxScrolls", cls.max_scrolls),
            stagnant_scrolls_after_minimum=integer(
                "stagnantScrollsAfterMinimum",
                cls.stagnant_scrolls_after_minimum,
            ),
            max_queries_per_cycle=integer(
                "maxQueriesPerCycle", cls.max_queries_per_cycle
            ),
            max_queries_per_hour=integer(
                "maxQueriesPerHour", cls.max_queries_per_hour
            ),
            max_queries_per_day=integer(
                "maxQueriesPerDay", cls.max_queries_per_day
            ),
            max_items_per_query=integer(
                "maxItemsPerQuery", cls.max_items_per_query
            ),
            max_delivery_runs_per_cycle=integer(
                "maxDeliveryRunsPerCycle", cls.max_delivery_runs_per_cycle
            ),
            query_delay_seconds=number(
                "queryDelaySeconds", cls.query_delay_seconds
            ),
            query_jitter_seconds=number(
                "queryJitterSeconds", cls.query_jitter_seconds
            ),
            scroll_wait_seconds=number(
                "scrollWaitSeconds", cls.scroll_wait_seconds
            ),
            cycle_interval_seconds=number(
                "cycleIntervalSeconds", cls.cycle_interval_seconds
            ),
            navigation_timeout_seconds=number(
                "navigationTimeoutSeconds", cls.navigation_timeout_seconds
            ),
            http_timeout_seconds=number(
                "httpTimeoutSeconds", cls.http_timeout_seconds
            ),
        )
        limits.validate()
        return limits

    def validate(self) -> None:
        if self.min_scrolls != 8:
            raise ConfigurationError("minScrolls must remain exactly 8")
        if self.max_scrolls != 8:
            raise ConfigurationError("maxScrolls must remain exactly 8")
        if not 1 <= self.stagnant_scrolls_after_minimum <= 4:
            raise ConfigurationError(
                "stagnantScrollsAfterMinimum must be between 1 and 4"
            )
        if self.max_queries_per_cycle != 1:
            raise ConfigurationError("maxQueriesPerCycle must remain exactly 1")
        if not 1 <= self.max_queries_per_hour <= 2:
            raise ConfigurationError("maxQueriesPerHour must be between 1 and 2")
        if not 1 <= self.max_queries_per_day <= 8:
            raise ConfigurationError("maxQueriesPerDay must be between 1 and 8")
        if not 1 <= self.max_items_per_query <= 25:
            raise ConfigurationError("maxItemsPerQuery must be between 1 and 25")
        if not 1 <= self.max_delivery_runs_per_cycle <= 100:
            raise ConfigurationError(
                "maxDeliveryRunsPerCycle must be between 1 and 100"
            )
        if self.query_delay_seconds < 1800:
            raise ConfigurationError("queryDelaySeconds cannot be below 1800")
        if not 0 <= self.query_jitter_seconds <= 120:
            raise ConfigurationError("queryJitterSeconds must be between 0 and 120")
        if not 3 <= self.scroll_wait_seconds <= 10:
            raise ConfigurationError("scrollWaitSeconds must be between 3 and 10")
        if self.cycle_interval_seconds < 300:
            raise ConfigurationError("cycleIntervalSeconds cannot be below 300")
        if not 15 <= self.navigation_timeout_seconds <= 180:
            raise ConfigurationError(
                "navigationTimeoutSeconds must be between 15 and 180"
            )
        if not 5 <= self.http_timeout_seconds <= 120:
            raise ConfigurationError("httpTimeoutSeconds must be between 5 and 120")

    def tightened_by(self, remote: Mapping[str, Any] | None) -> "RuntimeLimits":
        """Apply only remote settings that reduce load or increase pacing."""

        if not remote:
            return self

        def remote_int(name: str) -> int | None:
            raw = remote.get(name)
            if raw is None:
                return None
            if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
                raise ConfigurationError(f"Remote {name} must be a positive integer")
            return raw

        def remote_number(name: str) -> float | None:
            raw = remote.get(name)
            if raw is None:
                return None
            if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw < 0:
                raise ConfigurationError(f"Remote {name} must be a non-negative number")
            return float(raw)

        max_queries = remote_int("maxQueriesPerCycle")
        max_jobs = remote_int("maxJobs")
        max_items = remote_int("maxItemsPerQuery")
        max_batch_items = remote_int("maxBatchItems")
        max_deliveries = remote_int("maxDeliveryRunsPerCycle")
        delay = remote_number("queryDelaySeconds")
        tightened = replace(
            self,
            max_queries_per_cycle=min(
                self.max_queries_per_cycle,
                max_queries
                if max_queries is not None
                else max_jobs
                if max_jobs is not None
                else self.max_queries_per_cycle,
            ),
            max_items_per_query=min(
                self.max_items_per_query,
                max_items
                if max_items is not None
                else max_batch_items
                if max_batch_items is not None
                else self.max_items_per_query,
            ),
            max_delivery_runs_per_cycle=min(
                self.max_delivery_runs_per_cycle,
                max_deliveries
                if max_deliveries is not None
                else self.max_delivery_runs_per_cycle,
            ),
            query_delay_seconds=max(
                self.query_delay_seconds,
                delay if delay is not None else self.query_delay_seconds,
            ),
        )
        tightened.validate()
        return tightened


@dataclass(frozen=True)
class WorkerConfig:
    cdp_url: str
    jobs_url: str
    results_url: str
    api_token_file: Path
    state_database: Path
    lock_file: Path
    limits: RuntimeLimits
    allow_insecure_localhost_api: bool = False
    user_agent: str = "LeadDrive-Facebook-Native-Search/1.0"

    @classmethod
    def from_file(cls, path: str | os.PathLike[str]) -> "WorkerConfig":
        config_path = Path(path).expanduser().resolve()
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigurationError(
                f"Unable to load JSON configuration: {type(exc).__name__}"
            ) from exc
        if not isinstance(raw, dict):
            raise ConfigurationError("Configuration root must be an object")

        allowed = {
            "cdpUrl",
            "jobsUrl",
            "resultsUrl",
            "apiTokenFile",
            "stateDatabase",
            "lockFile",
            "limits",
            "allowInsecureLocalhostApi",
            "userAgent",
        }
        unknown = set(raw) - allowed
        if unknown:
            raise ConfigurationError(
                f"Unknown configuration keys: {', '.join(sorted(unknown))}"
            )

        def required_string(name: str) -> str:
            value = raw.get(name)
            if not isinstance(value, str) or not value.strip():
                raise ConfigurationError(f"{name} must be a non-empty string")
            return value.strip()

        def resolved_path(name: str) -> Path:
            candidate = Path(required_string(name)).expanduser()
            if not candidate.is_absolute():
                candidate = config_path.parent / candidate
            return candidate.resolve()

        allow_insecure = raw.get("allowInsecureLocalhostApi", False)
        if not isinstance(allow_insecure, bool):
            raise ConfigurationError("allowInsecureLocalhostApi must be boolean")

        user_agent = raw.get("userAgent", cls.user_agent)
        if not isinstance(user_agent, str) or not user_agent.strip():
            raise ConfigurationError("userAgent must be a non-empty string")

        config = cls(
            cdp_url=required_string("cdpUrl"),
            jobs_url=required_string("jobsUrl"),
            results_url=required_string("resultsUrl"),
            api_token_file=resolved_path("apiTokenFile"),
            state_database=resolved_path("stateDatabase"),
            lock_file=resolved_path("lockFile"),
            limits=RuntimeLimits.from_mapping(raw.get("limits")),
            allow_insecure_localhost_api=allow_insecure,
            user_agent=user_agent.strip(),
        )
        config.validate()
        return config

    def validate(self) -> None:
        parsed_cdp = urlsplit(self.cdp_url)
        if (
            parsed_cdp.scheme != "http"
            or parsed_cdp.hostname != "127.0.0.1"
            or parsed_cdp.port != 9222
            or parsed_cdp.path not in ("", "/")
            or parsed_cdp.query
            or parsed_cdp.fragment
            or parsed_cdp.username
            or parsed_cdp.password
        ):
            raise ConfigurationError(
                "cdpUrl must be exactly the loopback endpoint "
                "http://127.0.0.1:9222"
            )
        self._validate_api_url(self.jobs_url, "jobsUrl")
        self._validate_api_url(self.results_url, "resultsUrl")
        if self.state_database == self.api_token_file:
            raise ConfigurationError("stateDatabase cannot be the API token file")
        if self.lock_file == self.api_token_file:
            raise ConfigurationError("lockFile cannot be the API token file")

    def _validate_api_url(self, value: str, field: str) -> None:
        parsed = urlsplit(value)
        if parsed.username or parsed.password:
            raise ConfigurationError(f"{field} must not contain credentials")
        if parsed.scheme == "https" and parsed.hostname:
            return
        if (
            self.allow_insecure_localhost_api
            and parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "localhost"}
        ):
            return
        raise ConfigurationError(
            f"{field} must use HTTPS (HTTP is permitted only for explicit localhost tests)"
        )

    def read_api_token(self) -> str:
        try:
            metadata = self.api_token_file.stat()
        except OSError as exc:
            raise ConfigurationError(
                f"API token file is unavailable: {type(exc).__name__}"
            ) from exc
        if not stat.S_ISREG(metadata.st_mode):
            raise ConfigurationError("API token path must be a regular file")
        if metadata.st_mode & 0o077:
            raise ConfigurationError("API token file permissions must be 0600 or stricter")
        try:
            token = self.api_token_file.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise ConfigurationError(
                f"API token file cannot be read: {type(exc).__name__}"
            ) from exc
        if not token or len(token) > 4096 or any(char.isspace() for char in token):
            raise ConfigurationError("API token file does not contain one valid token")
        return token
