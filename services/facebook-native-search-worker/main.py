#!/usr/bin/env python3
"""CLI entry point for the bounded Facebook native-search worker."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import random
import signal
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path
from threading import Event
from typing import Any

from collector import CollectorError, FacebookNativeCollector
from config import ConfigurationError, RuntimeLimits, WorkerConfig
from delivery import ApiError, LeadDriveApi, SearchJob
from state import WorkerState, isoformat, utc_now


STOP = Event()
MIN_AVAILABLE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024


def log_event(event: str, level: str = "INFO", **fields: Any) -> None:
    """Write only structured operational metadata.

    Callers must not pass tokens, cookies, page text, API response bodies, or
    raw queries. Query references are one-way hashes.
    """

    record = {
        "timestamp": isoformat(),
        "level": level,
        "event": event,
        **fields,
    }
    print(
        json.dumps(record, ensure_ascii=True, separators=(",", ":"), sort_keys=True),
        flush=True,
    )


def query_reference(query: str) -> str:
    return hashlib.sha256(query.encode("utf-8")).hexdigest()[:12]


def has_safe_memory(
    meminfo_path: Path = Path("/proc/meminfo"),
    minimum_bytes: int = MIN_AVAILABLE_MEMORY_BYTES,
) -> bool:
    """Fail closed unless Linux reports at least the required available RAM."""

    try:
        lines = meminfo_path.read_text(encoding="ascii").splitlines()
    except OSError:
        return False
    for line in lines:
        if not line.startswith("MemAvailable:"):
            continue
        parts = line.split()
        if len(parts) != 3 or parts[2] != "kB" or not parts[1].isdigit():
            return False
        return int(parts[1]) * 1024 >= minimum_bytes
    return False


def fair_order_jobs(state: WorkerState, jobs: list[SearchJob]) -> list[SearchJob]:
    """Never-seen jobs first, then least-recently-run, with stable ties."""

    latest = state.latest_start_by_job(job.job_id for job in jobs)
    indexed = list(enumerate(jobs))
    indexed.sort(
        key=lambda pair: (
            pair[1].job_id in latest,
            latest.get(pair[1].job_id, ""),
            pair[0],
        )
    )
    return [job for _, job in indexed]


class ProcessLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._fd: int | None = None

    def __enter__(self) -> "ProcessLock":
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            os.close(self._fd)
            self._fd = None
            raise RuntimeError("WORKER_ALREADY_RUNNING") from exc
        os.ftruncate(self._fd, 0)
        os.write(self._fd, str(os.getpid()).encode("ascii"))
        os.fsync(self._fd)
        return self

    def __exit__(self, *_: object) -> None:
        if self._fd is not None:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
            os.close(self._fd)
            self._fd = None


def deliver_pending(
    state: WorkerState,
    api: LeadDriveApi,
    limit: int,
) -> tuple[int, int]:
    succeeded = 0
    failed = 0
    for pending in state.pending_deliveries(limit):
        if STOP.is_set():
            break
        try:
            api.deliver_results(pending.as_request())
        except ApiError as exc:
            if exc.code == "HTTP_410":
                state.mark_delivery_obsolete(pending.run_id, exc.code)
                log_event(
                    "delivery_obsolete",
                    level="WARNING",
                    runId=pending.run_id,
                    errorCode=exc.code,
                )
                continue
            state.mark_delivery_failed(pending.run_id, exc.code)
            failed += 1
            log_event(
                "delivery_deferred",
                level="WARNING",
                runId=pending.run_id,
                errorCode=exc.code,
                attempts=pending.attempts + 1,
            )
            continue
        state.mark_delivery_succeeded(pending.run_id)
        succeeded += 1
        log_event(
            "delivery_succeeded",
            runId=pending.run_id,
            itemCount=len(pending.items),
        )
    return succeeded, failed


def wait_for_pacing(state: WorkerState, limits: RuntimeLimits) -> bool:
    previous = state.latest_run_started_at()
    if previous is None:
        return True
    elapsed = max(0.0, (utc_now() - previous).total_seconds())
    delay = max(0.0, limits.query_delay_seconds - elapsed)
    if delay > 0:
        delay += random.uniform(0, limits.query_jitter_seconds)
        log_event("query_pacing_wait", waitSeconds=round(delay, 1))
        if STOP.wait(delay):
            return False
    return True


def rate_capacity(state: WorkerState, limits: RuntimeLimits) -> int:
    now = utc_now()
    hourly = state.runs_started_since(now - timedelta(hours=1))
    daily = state.runs_started_since(now - timedelta(days=1))
    return max(
        0,
        min(
            limits.max_queries_per_cycle,
            limits.max_queries_per_hour - hourly,
            limits.max_queries_per_day - daily,
        ),
    )


def collect_job(
    state: WorkerState,
    collector: FacebookNativeCollector,
    job: SearchJob,
) -> tuple[bool, bool]:
    """Collect one job. Returns ``(completed, terminal_block)``."""

    run_id = f"fbnsrun_{uuid.uuid4().hex}"
    started_at = isoformat()
    state.begin_run(
        run_id,
        job.job_id,
        job.target_binding_version,
        [target.as_request() for target in job.targets],
        job.query,
        started_at,
    )
    query_ref = query_reference(job.query)
    log_event(
        "collection_started",
        runId=run_id,
        jobId=job.job_id,
        queryRef=query_ref,
    )
    try:
        result = collector.collect(job.query)
    except CollectorError as exc:
        state.finalize_blocked_run(run_id, exc.code)
        log_event(
            "collection_blocked",
            level="ERROR" if exc.fatal else "WARNING",
            runId=run_id,
            jobId=job.job_id,
            queryRef=query_ref,
            errorCode=exc.code,
        )
        terminal_codes = {
            "FACEBOOK_AUTH_REQUIRED",
            "FACEBOOK_TEMPORARILY_BLOCKED",
            "RECENT_POSTS_FILTER_UNAVAILABLE",
            "RECENT_POSTS_FILTER_NOT_ACTIVE",
            "RECENT_POSTS_FILTER_URL_MISSING",
            "SEARCH_ROUTE_CHANGED",
            "SEARCH_QUERY_MISMATCH",
            "CDP_CONTEXT_INVALID",
        }
        return False, exc.code in terminal_codes
    except Exception:
        state.fail_run(run_id, "UNEXPECTED_COLLECTION_ERROR")
        log_event(
            "collection_failed",
            level="ERROR",
            runId=run_id,
            jobId=job.job_id,
            queryRef=query_ref,
            errorCode="UNEXPECTED_COLLECTION_ERROR",
        )
        return False, False

    finished_at = isoformat()
    new_items, duplicate_items = state.finalize_run(
        run_id,
        result.coverage,
        result.items,
        finished_at=finished_at,
    )
    log_event(
        "collection_completed",
        runId=run_id,
        jobId=job.job_id,
        queryRef=query_ref,
        observed=result.coverage["articlesObserved"],
        accepted=result.coverage["acceptedPublicItems"],
        queued=new_items,
        duplicates=duplicate_items,
        scrolls=result.coverage["completedScrolls"],
        stopReason=result.coverage["stopReason"],
    )
    terminal_anomaly = (
        result.coverage.get("deliveryReason") == "SEARCH_RESULTS_EMPTY_ANOMALY"
    )
    return True, terminal_anomaly


def run_cycle(config: WorkerConfig, state: WorkerState, api: LeadDriveApi) -> bool:
    """Run one serial cycle. Returns True only for a terminal UI/auth block."""

    _, delivery_failures = deliver_pending(
        state,
        api,
        config.limits.max_delivery_runs_per_cycle,
    )
    if delivery_failures:
        log_event(
            "cycle_deferred_for_outbox",
            level="WARNING",
            pending=state.pending_delivery_count(),
        )
        return False
    if not has_safe_memory():
        log_event(
            "collection_deferred",
            level="WARNING",
            errorCode="RESOURCE_PRESSURE",
        )
        return False

    try:
        batch = api.fetch_jobs()
        limits = config.limits.tightened_by(batch.limits)
    except (ApiError, ConfigurationError) as exc:
        code = exc.code if isinstance(exc, ApiError) else "REMOTE_LIMITS_INVALID"
        log_event("jobs_unavailable", level="WARNING", errorCode=code)
        return False

    capacity = rate_capacity(state, limits)
    jobs = fair_order_jobs(state, batch.jobs)[:capacity]
    if not jobs:
        log_event(
            "cycle_idle",
            configuredJobs=len(batch.jobs),
            rateCapacity=capacity,
            pending=state.pending_delivery_count(),
        )
        return False

    try:
        with FacebookNativeCollector(config.cdp_url, limits) as collector:
            for job in jobs:
                if STOP.is_set() or not wait_for_pacing(state, limits):
                    break
                _, terminal_block = collect_job(state, collector, job)
                deliver_pending(state, api, limits.max_delivery_runs_per_cycle)
                if terminal_block:
                    return True
    except CollectorError as exc:
        log_event(
            "browser_connection_blocked",
            level="ERROR",
            errorCode=exc.code,
        )
        return exc.code in {
            "FACEBOOK_AUTH_REQUIRED",
            "FACEBOOK_TEMPORARILY_BLOCKED",
            "CDP_CONTEXT_INVALID",
        }
    return False


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Bounded Facebook native-search collector for LeadDrive"
    )
    parser.add_argument("--config", required=True, help="Path to worker JSON config")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one collection cycle and exit",
    )
    parser.add_argument(
        "--validate-config",
        action="store_true",
        help="Validate config and token permissions without network access",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = WorkerConfig.from_file(args.config)
        token = config.read_api_token()
    except ConfigurationError as exc:
        log_event(
            "configuration_invalid",
            level="ERROR",
            errorCode=type(exc).__name__,
        )
        return 2
    if args.validate_config:
        log_event("configuration_valid")
        return 0

    api = LeadDriveApi(
        config.jobs_url,
        config.results_url,
        token,
        config.limits.http_timeout_seconds,
        config.user_agent,
    )
    try:
        with ProcessLock(config.lock_file), WorkerState(config.state_database) as state:
            abandoned = state.recover_abandoned_runs()
            log_event(
                "worker_started",
                recoveredRuns=abandoned,
                pending=state.pending_delivery_count(),
                mode="once" if args.once else "daemon",
            )
            while not STOP.is_set():
                terminal_block = run_cycle(config, state, api)
                if terminal_block:
                    log_event(
                        "worker_stopped_for_manual_action",
                        level="ERROR",
                    )
                    # A clean stop prevents systemd from repeatedly hitting a
                    # Facebook checkpoint. Restart after the operator repairs
                    # the authenticated browser session.
                    return 0
                if args.once:
                    return 0
                if STOP.wait(config.limits.cycle_interval_seconds):
                    break
    except RuntimeError as exc:
        code = str(exc) if str(exc) == "WORKER_ALREADY_RUNNING" else "STATE_ERROR"
        log_event("worker_failed", level="ERROR", errorCode=code)
        return 2
    finally:
        token = ""
    log_event("worker_stopped")
    return 0


def _handle_signal(_signum: int, _frame: object) -> None:
    STOP.set()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    sys.exit(main())
