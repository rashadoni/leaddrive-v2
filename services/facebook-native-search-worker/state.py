"""Durable SQLite state and transactional delivery outbox."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


SCHEMA_VERSION = 3
MAX_DELIVERY_PAYLOAD_BYTES = 240 * 1024
RESULTS_SCHEMA_VERSION = "facebook-native-search-results-v2"
TARGET_BINDING_VERSION = "facebook-native-search-targets-v1"
_ERROR_CODE = re.compile(r"^[A-Z0-9_]{1,64}$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def payload_hash(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def semantic_payload_hash(value: Mapping[str, Any]) -> str:
    """Hash content while excluding per-capture and volatile DOM evidence."""

    evidence = value.get("evidence")
    stable_evidence: dict[str, Any] = {}
    if isinstance(evidence, Mapping):
        stable_evidence = {
            "mediaKinds": evidence.get("mediaKinds"),
            "outboundLinks": evidence.get("outboundLinks"),
        }
    audience = value.get("audience")
    audience_kind = audience.get("kind") if isinstance(audience, Mapping) else None
    semantic = {
        "kind": value.get("kind"),
        "externalId": value.get("externalId"),
        "permalink": value.get("permalink"),
        "authorName": value.get("authorName"),
        "authorUrl": value.get("authorUrl"),
        "text": value.get("text"),
        "audienceKind": audience_kind,
        "evidence": stable_evidence,
    }
    return payload_hash(semantic)


def delivery_payload_size(value: Mapping[str, Any]) -> int:
    """Return the exact UTF-8 body size used by the HTTP adapter."""

    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def safe_error_code(value: str) -> str:
    if not _ERROR_CODE.fullmatch(value):
        return "UNCLASSIFIED_ERROR"
    return value


def validated_targets(targets: Iterable[Mapping[str, Any]]) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    for raw in targets:
        if set(raw) != {"scenarioId", "subjectId", "sourceId"}:
            raise ValueError("Every target requires the exact binding fields")
        target: dict[str, str] = {}
        for field in ("scenarioId", "subjectId", "sourceId"):
            value = raw.get(field)
            if not isinstance(value, str):
                raise ValueError("Target identifiers must be strings")
            clean = value.strip()
            has_control = any(
                ord(character) < 0x20 or ord(character) == 0x7F
                for character in clean
            )
            if not 1 <= len(clean) <= 191 or has_control:
                raise ValueError("Target identifier is invalid")
            target[field] = clean
        normalized.append(target)
    if not 1 <= len(normalized) <= 25:
        raise ValueError("A run requires between 1 and 25 targets")
    keys = [
        json.dumps(
            [target["scenarioId"], target["subjectId"], target["sourceId"]],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        for target in normalized
    ]
    if len(set(keys)) != len(keys) or keys != sorted(keys):
        raise ValueError("Targets must be unique and sorted")
    return normalized


@dataclass(frozen=True)
class PendingDelivery:
    job_id: str
    run_id: str
    started_at: str
    finished_at: str
    target_binding_version: str
    targets: list[dict[str, str]]
    query: str
    coverage: dict[str, Any]
    items: list[dict[str, Any]]
    attempts: int

    def as_request(self) -> dict[str, Any]:
        stop_reason = self.coverage.get("stopReason")
        explicit_status = self.coverage.get("deliveryStatus")
        is_partial = stop_reason == "item_cap_after_minimum"
        status = (
            explicit_status
            if explicit_status in {"COMPLETE", "PARTIAL", "BLOCKED"}
            else "PARTIAL"
            if is_partial
            else "COMPLETE"
        )
        reason = self.coverage.get("deliveryReason")
        if reason is None and is_partial:
            reason = "LOCAL_ITEM_CAP_REACHED"
        recent_verified = bool(self.coverage.get("recentPostsVerified", False))
        if status in {"COMPLETE", "PARTIAL"} and not recent_verified:
            status = "BLOCKED"
            reason = "RECENT_POSTS_NOT_VERIFIED"
        if not isinstance(reason, str):
            reason = None
        return {
            "schemaVersion": RESULTS_SCHEMA_VERSION,
            "jobId": self.job_id,
            "runId": self.run_id,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "targetBindingVersion": self.target_binding_version,
            "targets": self.targets,
            "query": self.query,
            "coverage": {
                "status": status,
                "searchedResultCount": min(
                    1000, max(0, int(self.coverage.get("articlesObserved", 0)))
                ),
                "recentPostsVerified": recent_verified,
                "reason": reason[:500] if reason else None,
            },
            "items": self.items,
        }


class WorkerState:
    def __init__(self, database: str | Path) -> None:
        self.path = Path(database)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.connection = sqlite3.connect(
            str(self.path),
            timeout=10,
            isolation_level=None,
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA busy_timeout = 10000")
        self.connection.execute("PRAGMA foreign_keys = ON")
        journal_mode = self.connection.execute("PRAGMA journal_mode = WAL").fetchone()[0]
        if str(journal_mode).lower() != "wal":
            raise RuntimeError("SQLite WAL mode could not be enabled")
        self.connection.execute("PRAGMA synchronous = FULL")
        self._migrate()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "WorkerState":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _migrate(self) -> None:
        with self.connection:
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            current = self.connection.execute(
                "SELECT value FROM schema_metadata WHERE key = 'schema_version'"
            ).fetchone()
            try:
                current_version = int(current["value"]) if current is not None else 0
            except (TypeError, ValueError) as exc:
                raise RuntimeError("State database schema version is invalid") from exc
            if current_version > SCHEMA_VERSION:
                raise RuntimeError("State database was created by a newer worker")

            tables = {
                str(row["name"])
                for row in self.connection.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                ).fetchall()
            }
            if current_version < SCHEMA_VERSION and "search_runs" in tables:
                suffix = f"legacy_v{current_version}"
                legacy_names = {
                    table: f"{table}_{suffix}"
                    for table in ("run_items", "seen_items", "search_runs")
                    if table in tables
                }
                if any(name in tables for name in legacy_names.values()):
                    raise RuntimeError("Legacy state archive already exists")
                columns = {
                    str(row["name"])
                    for row in self.connection.execute(
                        "PRAGMA table_info(search_runs)"
                    ).fetchall()
                }
                if {"pending_delivery", "last_error_code"}.issubset(columns):
                    self.connection.execute(
                        """
                        UPDATE search_runs
                        SET pending_delivery = 0,
                            last_error_code = 'STATE_CONTRACT_MIGRATED'
                        WHERE pending_delivery = 1
                        """
                    )
                for table in ("run_items", "seen_items", "search_runs"):
                    legacy = legacy_names.get(table)
                    if legacy:
                        self.connection.execute(
                            f'ALTER TABLE "{table}" RENAME TO "{legacy}"'
                        )

            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS search_runs (
                    run_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    target_binding_version TEXT NOT NULL,
                    targets_json TEXT NOT NULL,
                    query TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    status TEXT NOT NULL
                        CHECK(status IN ('running', 'collected', 'failed', 'abandoned')),
                    coverage_json TEXT,
                    pending_delivery INTEGER NOT NULL DEFAULT 0
                        CHECK(pending_delivery IN (0, 1)),
                    delivered_at TEXT,
                    delivery_attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TEXT,
                    last_error_code TEXT
                )
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_search_runs_v3_pending
                ON search_runs(pending_delivery, next_attempt_at, started_at)
                """
            )
            self.connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_search_runs_v3_started
                ON search_runs(started_at)
                """
            )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS seen_items (
                    job_id TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    canonical_url TEXT NOT NULL,
                    payload_hash TEXT NOT NULL,
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    first_run_id TEXT NOT NULL,
                    delivered_at TEXT,
                    invalidated_at TEXT,
                    PRIMARY KEY(job_id, external_id),
                    FOREIGN KEY(first_run_id) REFERENCES search_runs(run_id)
                )
                """
            )
            seen_columns = {
                str(row["name"])
                for row in self.connection.execute(
                    "PRAGMA table_info(seen_items)"
                ).fetchall()
            }
            if "invalidated_at" not in seen_columns:
                self.connection.execute(
                    "ALTER TABLE seen_items ADD COLUMN invalidated_at TEXT"
                )
            self.connection.execute(
                """
                CREATE TABLE IF NOT EXISTS run_items (
                    run_id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(run_id, job_id, external_id),
                    FOREIGN KEY(run_id) REFERENCES search_runs(run_id) ON DELETE CASCADE,
                    FOREIGN KEY(job_id, external_id)
                        REFERENCES seen_items(job_id, external_id)
                )
                """
            )
            self.connection.execute(
                """
                INSERT INTO schema_metadata(key, value)
                VALUES ('schema_version', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (str(SCHEMA_VERSION),),
            )

    def recover_abandoned_runs(self) -> int:
        """Mark runs interrupted before their transactional finalization."""

        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET status = 'abandoned',
                    finished_at = ?,
                    pending_delivery = 0,
                    last_error_code = 'WORKER_INTERRUPTED'
                WHERE status = 'running'
                """,
                (isoformat(),),
            )
        return cursor.rowcount

    def begin_run(
        self,
        run_id: str,
        job_id: str,
        target_binding_version: str,
        targets: Iterable[Mapping[str, Any]],
        query: str,
        started_at: str,
    ) -> None:
        if target_binding_version != TARGET_BINDING_VERSION:
            raise ValueError("Unsupported target binding version")
        target_list = validated_targets(targets)
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO search_runs(
                    run_id, job_id, target_binding_version, targets_json,
                    query, started_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'running')
                """,
                (
                    run_id,
                    job_id,
                    target_binding_version,
                    canonical_json(target_list),
                    query,
                    started_at,
                ),
            )

    def fail_run(self, run_id: str, error_code: str, finished_at: str | None = None) -> None:
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET status = 'failed',
                    finished_at = ?,
                    pending_delivery = 0,
                    last_error_code = ?
                WHERE run_id = ? AND status = 'running'
                """,
                (finished_at or isoformat(), safe_error_code(error_code), run_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Cannot fail a run that is not active")

    def finalize_blocked_run(
        self,
        run_id: str,
        error_code: str,
        *,
        recent_posts_verified: bool = False,
        finished_at: str | None = None,
    ) -> None:
        completed_at = finished_at or isoformat()
        coverage = {
            "deliveryStatus": "BLOCKED",
            "deliveryReason": safe_error_code(error_code),
            "articlesObserved": 0,
            "recentPostsVerified": recent_posts_verified,
            "stopReason": "blocked",
            "newItems": 0,
            "duplicateItems": 0,
        }
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET status = 'collected',
                    finished_at = ?,
                    coverage_json = ?,
                    pending_delivery = 1,
                    next_attempt_at = ?,
                    last_error_code = ?
                WHERE run_id = ? AND status = 'running'
                """,
                (
                    completed_at,
                    canonical_json(coverage),
                    completed_at,
                    safe_error_code(error_code),
                    run_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Cannot block a run that is not active")

    def finalize_run(
        self,
        run_id: str,
        coverage: Mapping[str, Any],
        items: Iterable[Mapping[str, Any]],
        finished_at: str | None = None,
    ) -> tuple[int, int]:
        """Atomically dedupe items and make the completed run deliverable.

        Returns ``(queued_items, duplicate_items)``. Changed semantic content is
        queued once as an update. A run remains deliverable even when it
        contains no items so the server still receives coverage diagnostics.
        """

        completed_at = finished_at or isoformat()
        materialized = [dict(item) for item in items]
        if coverage.get("recentPostsVerified") is not True:
            raise ValueError("Completed collection must verify Recent posts")
        new_items = 0
        updated_items = 0
        duplicates = 0
        omitted_for_budget = 0
        with self.connection:
            active = self.connection.execute(
                """
                SELECT job_id, target_binding_version, targets_json, query, started_at
                FROM search_runs
                WHERE run_id = ? AND status = 'running'
                """,
                (run_id,),
            ).fetchone()
            if active is None:
                raise RuntimeError("Cannot finalize a run that is not active")
            job_id = str(active["job_id"])
            targets = json.loads(active["targets_json"])
            if not isinstance(targets, list):
                raise RuntimeError("Stored target binding is invalid")
            target_list = validated_targets(targets)

            candidates: list[
                tuple[dict[str, Any], str, str, str, bool]
            ] = []
            batch_ids: set[str] = set()
            for item in materialized:
                external_id = item.get("externalId")
                canonical_url = item.get("permalink")
                if not isinstance(external_id, str) or not external_id:
                    raise ValueError("Every item requires externalId")
                if not isinstance(canonical_url, str) or not canonical_url:
                    raise ValueError("Every item requires permalink")
                if external_id in batch_ids:
                    duplicates += 1
                    continue
                batch_ids.add(external_id)
                serialized = canonical_json(item)
                digest = semantic_payload_hash(item)
                existing = self.connection.execute(
                    """
                    SELECT payload_hash, invalidated_at
                    FROM seen_items
                    WHERE job_id = ? AND external_id = ?
                    """,
                    (job_id, external_id),
                ).fetchone()
                if (
                    existing is not None
                    and existing["invalidated_at"] is None
                    and existing["payload_hash"] == digest
                ):
                    duplicates += 1
                    self.connection.execute(
                        """
                        UPDATE seen_items
                        SET last_seen_at = ?
                        WHERE job_id = ? AND external_id = ?
                        """,
                        (completed_at, job_id, external_id),
                    )
                    continue
                candidates.append(
                    (
                        item,
                        serialized,
                        digest,
                        canonical_url,
                        existing is not None,
                    )
                )

            selected: list[tuple[dict[str, Any], str, str, str, bool]] = []
            conservative_coverage = dict(coverage)
            conservative_coverage.update(
                {
                    "deliveryStatus": "PARTIAL",
                    "deliveryReason": "LOCAL_PAYLOAD_BUDGET_REACHED",
                }
            )
            for candidate in candidates:
                proposed_items = [record[0] for record in selected] + [candidate[0]]
                proposed = PendingDelivery(
                    job_id=job_id,
                    run_id=run_id,
                    started_at=active["started_at"],
                    finished_at=completed_at,
                    target_binding_version=active["target_binding_version"],
                    targets=target_list,
                    query=active["query"],
                    coverage=conservative_coverage,
                    items=proposed_items,
                    attempts=0,
                ).as_request()
                if delivery_payload_size(proposed) <= MAX_DELIVERY_PAYLOAD_BYTES:
                    selected.append(candidate)
                else:
                    omitted_for_budget += 1

            for item, serialized, digest, canonical_url, is_update in selected:
                external_id = str(item["externalId"])
                if is_update:
                    self.connection.execute(
                        """
                        UPDATE seen_items
                        SET canonical_url = ?,
                            payload_hash = ?,
                            last_seen_at = ?,
                            delivered_at = NULL,
                            invalidated_at = NULL
                        WHERE job_id = ? AND external_id = ?
                        """,
                        (
                            canonical_url,
                            digest,
                            completed_at,
                            job_id,
                            external_id,
                        ),
                    )
                    updated_items += 1
                else:
                    self.connection.execute(
                        """
                        INSERT INTO seen_items(
                            job_id, external_id, canonical_url, payload_hash,
                            first_seen_at, last_seen_at, first_run_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            job_id,
                            external_id,
                            canonical_url,
                            digest,
                            completed_at,
                            completed_at,
                            run_id,
                        ),
                    )
                    new_items += 1
                self.connection.execute(
                    """
                    INSERT INTO run_items(
                        run_id, job_id, external_id, payload_json
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (run_id, job_id, external_id, serialized),
                )

            final_coverage = dict(coverage)
            final_coverage["newItems"] = new_items
            final_coverage["updatedItems"] = updated_items
            final_coverage["duplicateItems"] = (
                int(final_coverage.get("duplicateItems", 0)) + duplicates
            )
            final_coverage["omittedPayloadBudgetItems"] = omitted_for_budget
            if omitted_for_budget:
                final_coverage["deliveryStatus"] = "PARTIAL"
                final_coverage["deliveryReason"] = "LOCAL_PAYLOAD_BUDGET_REACHED"
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET status = 'collected',
                    finished_at = ?,
                    coverage_json = ?,
                    pending_delivery = 1,
                    next_attempt_at = ?
                WHERE run_id = ? AND status = 'running'
                """,
                (
                    completed_at,
                    canonical_json(final_coverage),
                    completed_at,
                    run_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Run state changed during finalization")
            final_request = PendingDelivery(
                job_id=job_id,
                run_id=run_id,
                started_at=active["started_at"],
                finished_at=completed_at,
                target_binding_version=active["target_binding_version"],
                targets=target_list,
                query=active["query"],
                coverage=final_coverage,
                items=[record[0] for record in selected],
                attempts=0,
            ).as_request()
            if delivery_payload_size(final_request) > MAX_DELIVERY_PAYLOAD_BYTES:
                raise RuntimeError("Delivery payload budget invariant failed")
        return new_items + updated_items, duplicates

    def pending_deliveries(
        self,
        limit: int,
        now: datetime | None = None,
    ) -> list[PendingDelivery]:
        current = isoformat(now)
        rows = self.connection.execute(
            """
            SELECT *
            FROM search_runs
            WHERE status = 'collected'
              AND pending_delivery = 1
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY started_at ASC
            LIMIT ?
            """,
            (current, limit),
        ).fetchall()
        deliveries: list[PendingDelivery] = []
        for row in rows:
            raw_targets = json.loads(row["targets_json"])
            if not isinstance(raw_targets, list):
                raise RuntimeError("Stored target binding is invalid")
            targets = validated_targets(raw_targets)
            item_rows = self.connection.execute(
                """
                SELECT payload_json
                FROM run_items
                WHERE run_id = ?
                ORDER BY external_id ASC
                """,
                (row["run_id"],),
            ).fetchall()
            deliveries.append(
                PendingDelivery(
                    job_id=row["job_id"],
                    run_id=row["run_id"],
                    started_at=row["started_at"],
                    finished_at=row["finished_at"],
                    target_binding_version=row["target_binding_version"],
                    targets=targets,
                    query=row["query"],
                    coverage=json.loads(row["coverage_json"]),
                    items=[json.loads(item["payload_json"]) for item in item_rows],
                    attempts=row["delivery_attempts"],
                )
            )
        return deliveries

    def mark_delivery_succeeded(
        self,
        run_id: str,
        delivered_at: str | None = None,
    ) -> None:
        timestamp = delivered_at or isoformat()
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET pending_delivery = 0,
                    delivered_at = ?,
                    last_error_code = NULL
                WHERE run_id = ?
                  AND status = 'collected'
                  AND pending_delivery = 1
                """,
                (timestamp, run_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Delivery is no longer pending")
            self.connection.execute(
                """
                UPDATE seen_items
                SET delivered_at = COALESCE(delivered_at, ?)
                WHERE (job_id, external_id) IN (
                    SELECT job_id, external_id
                    FROM run_items
                    WHERE run_id = ?
                )
                """,
                (timestamp, run_id),
            )

    def mark_delivery_failed(
        self,
        run_id: str,
        error_code: str,
        now: datetime | None = None,
    ) -> datetime:
        timestamp = now or utc_now()
        row = self.connection.execute(
            "SELECT delivery_attempts FROM search_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise RuntimeError("Unknown delivery run")
        attempts = int(row["delivery_attempts"]) + 1
        delay_seconds = min(3600, 30 * (2 ** min(attempts - 1, 7)))
        next_attempt = timestamp + timedelta(seconds=delay_seconds)
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET delivery_attempts = ?,
                    next_attempt_at = ?,
                    last_error_code = ?
                WHERE run_id = ?
                  AND status = 'collected'
                  AND pending_delivery = 1
                """,
                (
                    attempts,
                    isoformat(next_attempt),
                    safe_error_code(error_code),
                    run_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Delivery is no longer pending")
        return next_attempt

    def mark_delivery_obsolete(
        self,
        run_id: str,
        error_code: str = "HTTP_410",
        invalidated_at: str | None = None,
    ) -> None:
        """Permanently retire a stale target binding without wedging the outbox."""

        timestamp = invalidated_at or isoformat()
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE search_runs
                SET status = 'abandoned',
                    pending_delivery = 0,
                    next_attempt_at = NULL,
                    last_error_code = ?
                WHERE run_id = ?
                  AND status = 'collected'
                  AND pending_delivery = 1
                """,
                (safe_error_code(error_code), run_id),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Delivery is no longer pending")
            self.connection.execute(
                """
                UPDATE seen_items
                SET invalidated_at = ?
                WHERE (job_id, external_id) IN (
                    SELECT job_id, external_id
                    FROM run_items
                    WHERE run_id = ?
                )
                """,
                (timestamp, run_id),
            )

    def runs_started_since(self, since: datetime) -> int:
        row = self.connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM search_runs
            WHERE started_at >= ?
              AND status IN ('running', 'collected', 'failed', 'abandoned')
            """,
            (isoformat(since),),
        ).fetchone()
        return int(row["count"])

    def latest_run_started_at(self) -> datetime | None:
        row = self.connection.execute(
            "SELECT started_at FROM search_runs ORDER BY started_at DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        value = str(row["started_at"]).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def latest_start_by_job(self, job_ids: Iterable[str]) -> dict[str, str]:
        unique = list(dict.fromkeys(job_ids))
        if not unique:
            return {}
        placeholders = ",".join("?" for _ in unique)
        rows = self.connection.execute(
            f"""
            SELECT job_id, MAX(started_at) AS latest
            FROM search_runs
            WHERE job_id IN ({placeholders})
            GROUP BY job_id
            """,
            unique,
        ).fetchall()
        return {str(row["job_id"]): str(row["latest"]) for row in rows}

    def pending_delivery_count(self) -> int:
        row = self.connection.execute(
            "SELECT COUNT(*) AS count FROM search_runs WHERE pending_delivery = 1"
        ).fetchone()
        return int(row["count"])
