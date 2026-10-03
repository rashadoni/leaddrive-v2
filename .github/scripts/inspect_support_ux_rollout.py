"""Bounded, read-only production rollout metadata; never emit raw DB/config data."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit


APP_ENV = Path("/etc/leaddrive/app.env")
FLAG = "support_ux_v2_canary"
MAX_TENANTS = 1000
SLUG_RE = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?")
QUERY = """
BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
SELECT COALESCE(json_agg(row_to_json(selected)), '[]'::json)
FROM (
  SELECT o."isActive" AS active,
    CASE WHEN octet_length(o.features::text) <= 4096 THEN o.features ELSE NULL END AS features,
    COALESCE(octet_length(o.features::text), 0) > 4096 AS feature_size_exceeded,
    CASE WHEN :'support_tenant' = '' THEN NULL ELSE
      (SELECT count(*) FROM public.ticket_macros m WHERE m."organizationId" = o.id)
    END AS macro_count,
    CASE WHEN :'support_tenant' = '' THEN NULL ELSE
      CASE WHEN jsonb_typeof(o.settings->'ticketMacroCategories') = 'array'
        THEN jsonb_array_length(o.settings->'ticketMacroCategories') ELSE 0 END
    END AS stored_category_entries
  FROM public.organizations o
  WHERE :'support_tenant' = '' OR o.slug = :'support_tenant'
  ORDER BY o.id
  LIMIT 1001
) selected;
ROLLBACK;
"""
PUBLIC_KEYS = {
    "schemaVersion", "status", "observedAtUtc", "scope", "tenantSlug",
    "tenantCount", "activeTenantCount", "enabledActiveTenantCount",
    "tenantFound", "tenantActive", "flagEnabled", "featuresFormat",
    "macroCount", "storedCategoryEntries",
}
ERROR_CODES = {
    "INVALID_TENANT", "APP_ENV_UNSAFE", "APP_ENV_INVALID", "DATABASE_URL_INVALID",
    "DATABASE_OPTIONS_UNSUPPORTED", "DATABASE_QUERY_FAILED", "TENANT_LIMIT_EXCEEDED",
    "OUTPUT_INVALID", "INSPECTION_FAILED", "FEATURE_LIMIT_EXCEEDED",
}


class SafeInspectionError(Exception):
    """Messages are fixed codes, never config, SQL, database or exception text."""


def validate_slug(value: str) -> str:
    if value and not SLUG_RE.fullmatch(value):
        raise SafeInspectionError("INVALID_TENANT")
    return value


def read_database_url(path: Path = APP_ENV, *, require_root: bool = True) -> str:
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
        raise SafeInspectionError("APP_ENV_UNSAFE")
    if require_root and (info.st_uid != 0 or info.st_mode & 0o022):
        raise SafeInspectionError("APP_ENV_UNSAFE")
    matches = re.findall(
        r"^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$",
        path.read_text(encoding="utf-8"), re.MULTILINE,
    )
    if len(matches) != 1:
        raise SafeInspectionError("APP_ENV_INVALID")
    value = matches[0]
    if value[:1] in {"'", '"'}:
        if len(value) < 2 or value[-1] != value[0]:
            raise SafeInspectionError("APP_ENV_INVALID")
        value = value[1:-1]
    if not value or any(character in value for character in ("\n", "\r", "\x00")):
        raise SafeInspectionError("APP_ENV_INVALID")
    return value


def connection_environment(database_url: str) -> dict[str, str]:
    try:
        parsed = urlsplit(database_url)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise ValueError()
        if not parsed.hostname or not parsed.username or not parsed.path.strip("/") or parsed.fragment:
            raise ValueError()
        port = parsed.port if parsed.port is not None else 5432
        if not 1 <= port <= 65535:
            raise ValueError()
        pairs = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
        if len({key for key, _ in pairs}) != len(pairs):
            raise ValueError()
    except ValueError:
        raise SafeInspectionError("DATABASE_URL_INVALID") from None

    # Ignore only Prisma pool/schema controls. Preserve explicit libpq TLS
    # settings; unsupported options fail instead of silently weakening transport.
    prisma_options = {"connection_limit", "pool_timeout", "pgbouncer", "socket_timeout"}
    libpq_options = {
        "sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY",
        "sslcrl": "PGSSLCRL", "hostaddr": "PGHOSTADDR",
    }
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env.update({
        "PGHOST": parsed.hostname, "PGPORT": str(port),
        "PGDATABASE": unquote(parsed.path[1:]), "PGUSER": unquote(parsed.username),
        "PGPASSWORD": unquote(parsed.password or ""), "PGCONNECT_TIMEOUT": "5",
        "PGAPPNAME": "support-ux-rollout-read-only",
        "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
    })
    for key, value in pairs:
        if key == "schema":
            if value != "public":
                raise SafeInspectionError("DATABASE_OPTIONS_UNSUPPORTED")
            continue
        if key in prisma_options:
            continue
        if key not in libpq_options or not value:
            raise SafeInspectionError("DATABASE_OPTIONS_UNSUPPORTED")
        if key == "sslmode" and value not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise SafeInspectionError("DATABASE_OPTIONS_UNSUPPORTED")
        env[libpq_options[key]] = value
    return env


def normalized_features(value: object) -> tuple[list[str], str]:
    format_name = "array"
    if isinstance(value, str):
        format_name = "encoded-array"
        try:
            def reject_non_json_constant(_constant: str) -> None:
                raise ValueError()
            value = json.loads(value, parse_constant=reject_non_json_constant)
        except (json.JSONDecodeError, ValueError):
            return [], "unsupported"
    if not isinstance(value, list):
        return [], "unsupported"
    return [item for item in value if isinstance(item, str)], format_name


def summarize_rows(rows: object, tenant_slug: str) -> dict[str, object]:
    if not isinstance(rows, list) or len(rows) > MAX_TENANTS:
        raise SafeInspectionError("TENANT_LIMIT_EXCEEDED" if isinstance(rows, list) else "OUTPUT_INVALID")
    if tenant_slug and len(rows) > 1:
        raise SafeInspectionError("OUTPUT_INVALID")
    normalized = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"active", "features", "feature_size_exceeded", "macro_count", "stored_category_entries"}:
            raise SafeInspectionError("OUTPUT_INVALID")
        if type(row["feature_size_exceeded"]) is not bool:
            raise SafeInspectionError("OUTPUT_INVALID")
        if row["feature_size_exceeded"]:
            raise SafeInspectionError("FEATURE_LIMIT_EXCEEDED")
        if type(row["active"]) is not bool:
            raise SafeInspectionError("OUTPUT_INVALID")
        for field in ("macro_count", "stored_category_entries"):
            value = row[field]
            if tenant_slug and (type(value) is not int or value < 0):
                raise SafeInspectionError("OUTPUT_INVALID")
            if not tenant_slug and value is not None:
                raise SafeInspectionError("OUTPUT_INVALID")
        features, format_name = normalized_features(row["features"])
        normalized.append((row, FLAG in features, format_name))
    selected = normalized[0] if tenant_slug and normalized else None
    return {
        "schemaVersion": 1, "status": "ok",
        "observedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "scope": "tenant" if tenant_slug else "aggregate", "tenantSlug": tenant_slug or None,
        "tenantCount": len(rows),
        "activeTenantCount": sum(row["active"] for row, _, _ in normalized),
        "enabledActiveTenantCount": sum(row["active"] and enabled for row, enabled, _ in normalized),
        "tenantFound": bool(selected) if tenant_slug else None,
        "tenantActive": selected[0]["active"] if selected else (False if tenant_slug else None),
        "flagEnabled": selected[1] if selected else (False if tenant_slug else None),
        "featuresFormat": selected[2] if selected else ("absent" if tenant_slug else "not-applicable"),
        "macroCount": selected[0]["macro_count"] if selected else (0 if tenant_slug else None),
        "storedCategoryEntries": selected[0]["stored_category_entries"] if selected else (0 if tenant_slug else None),
    }


def validate_public_output(value: object, tenant_slug: str) -> None:
    if not isinstance(value, dict):
        raise SafeInspectionError("OUTPUT_INVALID")
    if value.get("status") == "error":
        if set(value) != {"schemaVersion", "status", "code"} or type(value.get("schemaVersion")) is not int or value.get("schemaVersion") != 1 or value.get("code") not in ERROR_CODES:
            raise SafeInspectionError("OUTPUT_INVALID")
        return
    if set(value) != PUBLIC_KEYS or type(value.get("schemaVersion")) is not int or value.get("schemaVersion") != 1 or value.get("status") != "ok":
        raise SafeInspectionError("OUTPUT_INVALID")
    if value.get("scope") != ("tenant" if tenant_slug else "aggregate") or value.get("tenantSlug") != (tenant_slug or None):
        raise SafeInspectionError("OUTPUT_INVALID")
    try:
        timestamp = dt.datetime.fromisoformat(value["observedAtUtc"].replace("Z", "+00:00"))
        if timestamp.utcoffset() != dt.timedelta(0):
            raise ValueError()
    except (AttributeError, TypeError, ValueError):
        raise SafeInspectionError("OUTPUT_INVALID") from None
    for field in ("tenantCount", "activeTenantCount", "enabledActiveTenantCount"):
        if type(value[field]) is not int or not 0 <= value[field] <= MAX_TENANTS:
            raise SafeInspectionError("OUTPUT_INVALID")
    if not value["enabledActiveTenantCount"] <= value["activeTenantCount"] <= value["tenantCount"]:
        raise SafeInspectionError("OUTPUT_INVALID")
    if tenant_slug:
        if value["tenantCount"] > 1 or any(type(value[field]) is not bool for field in ("tenantFound", "tenantActive", "flagEnabled")):
            raise SafeInspectionError("OUTPUT_INVALID")
        if value["tenantFound"] != (value["tenantCount"] == 1) or value["activeTenantCount"] != int(value["tenantActive"]):
            raise SafeInspectionError("OUTPUT_INVALID")
        if value["enabledActiveTenantCount"] != int(value["tenantActive"] and value["flagEnabled"]):
            raise SafeInspectionError("OUTPUT_INVALID")
        if value["featuresFormat"] not in {"array", "encoded-array", "unsupported", "absent"}:
            raise SafeInspectionError("OUTPUT_INVALID")
        if value["featuresFormat"] in {"unsupported", "absent"} and value["flagEnabled"]:
            raise SafeInspectionError("OUTPUT_INVALID")
        if value["tenantFound"] and value["featuresFormat"] == "absent":
            raise SafeInspectionError("OUTPUT_INVALID")
        for field in ("macroCount", "storedCategoryEntries"):
            if type(value[field]) is not int or value[field] < 0:
                raise SafeInspectionError("OUTPUT_INVALID")
        if not value["tenantFound"] and (value["flagEnabled"] or value["featuresFormat"] != "absent" or value["macroCount"] or value["storedCategoryEntries"]):
            raise SafeInspectionError("OUTPUT_INVALID")
    elif any(value[field] is not None for field in ("tenantFound", "tenantActive", "flagEnabled", "macroCount", "storedCategoryEntries")) or value["featuresFormat"] != "not-applicable":
        raise SafeInspectionError("OUTPUT_INVALID")


def inspect(tenant_slug: str) -> dict[str, object]:
    validate_slug(tenant_slug)
    env = connection_environment(read_database_url())
    try:
        result = subprocess.run(
            ["psql", "-X", "--no-password", "--quiet", "--tuples-only", "--no-align",
             "--set=ON_ERROR_STOP=1", "--set=support_tenant=" + tenant_slug],
            input=QUERY, env=env, capture_output=True, text=True, timeout=12,
        )
        if result.returncode or len(result.stdout) > 1024 * 1024:
            raise SafeInspectionError("DATABASE_QUERY_FAILED")
        rows = json.loads(result.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        raise SafeInspectionError("DATABASE_QUERY_FAILED") from None
    output = summarize_rows(rows, tenant_slug)
    validate_public_output(output, tenant_slug)
    return output


def main() -> int:
    tenant_slug = os.environ.get("SUPPORT_UX_TENANT", "")
    try:
        validate_slug(tenant_slug)
        if sys.argv[1:] == ["--validate-output"]:
            raw = sys.stdin.read(16385)
            if len(raw) > 16384:
                raise SafeInspectionError("OUTPUT_INVALID")
            output = json.loads(raw)
            validate_public_output(output, tenant_slug)
        elif not sys.argv[1:]:
            output = inspect(tenant_slug)
        else:
            raise SafeInspectionError("OUTPUT_INVALID")
    except SafeInspectionError as error:
        code = str(error) if str(error) in ERROR_CODES else "INSPECTION_FAILED"
        print(json.dumps({"schemaVersion": 1, "status": "error", "code": code}))
        return 1
    except Exception:
        print(json.dumps({"schemaVersion": 1, "status": "error", "code": "INSPECTION_FAILED"}))
        return 1
    print(json.dumps(output, separators=(",", ":"), sort_keys=True))
    return 0 if output["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
