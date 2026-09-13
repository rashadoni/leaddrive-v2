#!/usr/bin/env python3
"""Provision or roll back the isolated PostgreSQL restore-verification cluster.

The script is streamed to the production host by a protected, dispatch-only
workflow.  It creates one PostgreSQL 16 cluster on IPv4 loopback port 55432,
with its own CA, leaf certificate, data directory, verifier role and passfile.
The cluster is left stopped outside a controlled recovery drill.  No backup,
restore, deploy, Kafka command, package installation or source-cluster restart
is performed.

Only one schema-bound, non-secret result line is printed.  Command output and
exception text are deliberately suppressed so credentials and connection
details cannot enter the Actions log.
"""

from __future__ import annotations

import fcntl
import grp
import hashlib
import json
import os
import pwd
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


PG_VERSION = "16"
CLUSTER_NAME = "leaddriverestore"
SCRATCH_HOST = "127.0.0.1"
SCRATCH_PORT = 55432
SCRATCH_ROLE = "leaddrive_restore_verifier"
SCRATCH_DATABASE = "postgres"
SCRATCH_SOCKET_DIR = "/var/run/postgresql"

ENV_PATH = Path("/etc/leaddrive/backup.env")
SOURCE_CA_PATH = Path("/etc/leaddrive/managed-postgres-ca.crt")
SCRATCH_CA_PATH = Path("/etc/leaddrive/restore-postgres-ca.crt")
SCRATCH_PGPASS_PATH = Path("/etc/leaddrive/restore-verifier.pgpass")
CONFIG_DIR = Path(f"/etc/postgresql/{PG_VERSION}/{CLUSTER_NAME}")
DATA_DIR = Path(f"/var/lib/postgresql/{PG_VERSION}/{CLUSTER_NAME}")
POSTGRES_CONF = CONFIG_DIR / "postgresql.conf"
PG_HBA = CONFIG_DIR / "pg_hba.conf"
SERVER_CERT = CONFIG_DIR / "server.crt"
SERVER_KEY = CONFIG_DIR / "server.key"
START_CONF = CONFIG_DIR / "start.conf"

LOCK_DIR = Path("/var/lib/leaddrive-recovery-runner-locks")
LOCK_PATH = LOCK_DIR / "postgres-restore-scratch-maintenance.lock"
SNAPSHOT_DIR = Path("/var/lib/leaddrive-postgres-scratch-maintenance")
SNAPSHOT_STATE = SNAPSHOT_DIR / "state.json"

MAX_ENV_BYTES = 64 * 1024
MAX_SMALL_FILE_BYTES = 256 * 1024
MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024
TARGET_ENV = {
    "VERIFY_PGHOST": SCRATCH_HOST,
    "VERIFY_PGPORT": str(SCRATCH_PORT),
    "VERIFY_PGUSER": SCRATCH_ROLE,
    "VERIFY_PGPASSFILE": str(SCRATCH_PGPASS_PATH),
    "VERIFY_PGMAINTENANCE_DB": SCRATCH_DATABASE,
    "VERIFY_PGSSLMODE": "verify-full",
    "VERIFY_PGSSLROOTCERT": str(SCRATCH_CA_PATH),
    "VERIFY_PGCONNECT_TIMEOUT": "10",
}
BACKUP_UNITS = (
    "leaddrive-postgres-backup.service",
    "leaddrive-postgres-backup.timer",
    "leaddrive-log-ship.service",
    "leaddrive-log-ship.timer",
)


class MaintenanceError(Exception):
    ALLOWED = frozenset(
        {
            "invocation",
            "lock",
            "scheduler",
            "prerequisite",
            "filesystem",
            "configuration",
            "configuration-env-file",
            "configuration-env-encoding",
            "configuration-env-duplicate",
            "configuration-pgpass-file",
            "configuration-pgpass-owner",
            "configuration-pgpass-authority",
            "configuration-ca-file",
            "configuration-rewrite",
            "source",
            "source-role-present",
            "source-role-cleanup",
            "port",
            "snapshot",
            "cluster-create",
            "tls-create",
            "cluster-config",
            "cluster-config-owner",
            "cluster-start",
            "role-create",
            "verify-full",
            "verify-role",
            "verify-role-query",
            "verify-role-attributes",
            "verify-tls",
            "verify-identity",
            "cluster-stop",
            "source-drift",
            "post-write",
            "rollback",
            "internal",
        }
    )

    def __init__(self, code: str = "internal", *, cause_code: str = "none") -> None:
        self.code = code if code in self.ALLOWED else "internal"
        self.cause_code = (
            cause_code
            if cause_code == "none" or cause_code in self.ALLOWED
            else "internal"
        )
        super().__init__()


@dataclass(frozen=True)
class FileState:
    present: bool
    uid: int = 0
    gid: int = 0
    mode: int = 0
    sha256: str = ""


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _acceptable_existing_secret_file(
    state: FileState, backup_uid: int, backup_gid: int
) -> bool:
    """Allow a controlled, non-public stale file to enter the sealed snapshot.

    ``_read_file`` has already rejected links, non-regular files, oversized
    files, and group/world-writable modes.  The provisioner replaces this file
    atomically with the canonical leaddrive-backup-owned 0600 authority before
    it ever contains the newly generated scratch credential.
    """

    root_owned = state.uid == 0 and (state.mode, state.gid) in {
        (0o400, 0),
        (0o440, 0),
        (0o600, 0),
        (0o640, 0),
        (0o400, backup_gid),
        (0o440, backup_gid),
        (0o600, backup_gid),
        (0o640, backup_gid),
    }
    backup_owned = (
        state.uid == backup_uid
        and state.gid == backup_gid
        and state.mode in {0o400, 0o600}
    )
    return root_owned or backup_owned


def _run(
    argv: list[str],
    *,
    input_bytes: bytes | None = None,
    capture: bool = False,
    env: dict[str, str] | None = None,
    code: str = "internal",
) -> bytes:
    try:
        completed = subprocess.run(
            argv,
            input=input_bytes,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise MaintenanceError(code) from exc
    if completed.returncode != 0:
        raise MaintenanceError(code)
    return completed.stdout if capture else b""


def _command(name: str) -> str:
    candidate = shutil.which(name, path="/usr/sbin:/usr/bin:/sbin:/bin")
    if not candidate:
        raise MaintenanceError("prerequisite")
    return candidate


def _assert_root_dir(path: Path, *, create: bool = False, mode: int = 0o755) -> None:
    if create and not path.exists():
        try:
            path.mkdir(mode=mode)
        except OSError as exc:
            raise MaintenanceError("filesystem") from exc
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise MaintenanceError("filesystem") from exc
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != 0
        or stat.S_IMODE(metadata.st_mode) & 0o022
    ):
        raise MaintenanceError("filesystem")


def _read_file(
    path: Path, *, maximum: int, required: bool = True
) -> tuple[bytes | None, FileState]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        if required:
            raise MaintenanceError("filesystem")
        return None, FileState(False)
    except OSError as exc:
        raise MaintenanceError("filesystem") from exc
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_nlink != 1
            or metadata.st_size > maximum
            or stat.S_IMODE(metadata.st_mode) & 0o022
        ):
            raise MaintenanceError("filesystem")
        payload = bytearray()
        while len(payload) <= maximum:
            chunk = os.read(descriptor, min(8192, maximum + 1 - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) > maximum:
            raise MaintenanceError("filesystem")
        value = bytes(payload)
        return value, FileState(
            True,
            uid=metadata.st_uid,
            gid=metadata.st_gid,
            mode=stat.S_IMODE(metadata.st_mode),
            sha256=_sha(value),
        )
    finally:
        os.close(descriptor)


def _atomic_write(
    path: Path,
    payload: bytes,
    *,
    mode: int,
    uid: int,
    gid: int,
    cluster_parent_authority: tuple[int, int] | None = None,
) -> None:
    if cluster_parent_authority is None:
        _assert_root_dir(path.parent)
    else:
        _assert_cluster_config_directory(path.parent, *cluster_parent_authority)
    descriptor = -1
    temporary = ""
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, uid, gid)
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as exc:
        raise MaintenanceError("filesystem") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass


def _parse_environment(payload: bytes) -> dict[str, str]:
    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise MaintenanceError("configuration-env-encoding") from exc
    values: dict[str, list[str]] = {}
    assignment = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export") and len(line) > 6 and line[6].isspace():
            line = line[6:].strip()
        match = assignment.fullmatch(line)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values.setdefault(match.group(1), []).append(value)
    if any(len(items) != 1 for items in values.values()):
        raise MaintenanceError("configuration-env-duplicate")
    return {key: items[0] for key, items in values.items()}


def rewrite_environment(payload: bytes, replacements: dict[str, str]) -> bytes:
    for key, value in replacements.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or any(
            char in value for char in "\r\n\0"
        ):
            raise MaintenanceError("configuration-rewrite")
    lines = payload.splitlines(keepends=True)
    seen: set[str] = set()
    output: list[bytes] = []
    target = re.compile(rb"^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=")
    for line in lines:
        match = target.match(line)
        key = match.group(1).decode("ascii") if match else ""
        if key in replacements:
            if key in seen:
                raise MaintenanceError("configuration-rewrite")
            output.append(f"{key}={replacements[key]}\n".encode())
            seen.add(key)
        else:
            output.append(line)
    if output and not output[-1].endswith((b"\n", b"\r")):
        output[-1] += b"\n"
    for key, value in replacements.items():
        if key not in seen:
            output.append(f"{key}={value}\n".encode())
    return b"".join(output)


def _file_state_dict(state: FileState) -> dict[str, object]:
    return {
        "present": state.present,
        "uid": state.uid,
        "gid": state.gid,
        "mode": state.mode,
        "sha256": state.sha256,
    }


def _state_from_dict(value: object) -> FileState:
    if not isinstance(value, dict):
        raise MaintenanceError("rollback")
    if not isinstance(value.get("present"), bool):
        raise MaintenanceError("rollback")
    try:
        state = FileState(
            value["present"],
            int(value["uid"]),
            int(value["gid"]),
            int(value["mode"]),
            str(value["sha256"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise MaintenanceError("rollback") from exc
    if state.present and not re.fullmatch(r"[0-9a-f]{64}", state.sha256):
        raise MaintenanceError("rollback")
    return state


def _write_state(state: dict[str, object]) -> None:
    payload = json.dumps(state, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    _atomic_write(SNAPSHOT_STATE, payload, mode=0o600, uid=0, gid=0)


def _load_state() -> dict[str, object]:
    payload, metadata = _read_file(SNAPSHOT_STATE, maximum=64 * 1024)
    if payload is None or metadata.uid != 0 or metadata.mode != 0o600:
        raise MaintenanceError("rollback")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MaintenanceError("rollback") from exc
    if not isinstance(value, dict) or value.get("format") != 1:
        raise MaintenanceError("rollback")
    return value


def _file_matches_state(path: Path, state: FileState, maximum: int) -> bool:
    try:
        payload, current = _read_file(path, maximum=maximum, required=False)
    except MaintenanceError:
        return False
    if current.present != state.present:
        return False
    if not state.present:
        return True
    return (
        payload is not None
        and current.uid == state.uid
        and current.gid == state.gid
        and current.mode == state.mode
        and current.sha256 == state.sha256
    )


def _retire_completed_snapshot() -> None:
    if not SNAPSHOT_DIR.exists() and not SNAPSHOT_DIR.is_symlink():
        return
    _assert_root_dir(SNAPSHOT_DIR)
    state = _load_state()
    if state.get("phase") not in {"rolled-back", "failed-rolled-back"}:
        raise MaintenanceError("snapshot")
    before = state.get("before")
    if not isinstance(before, dict) or _target_cluster_exists():
        raise MaintenanceError("snapshot")
    checks = (
        (ENV_PATH, _state_from_dict(before.get("environment")), MAX_ENV_BYTES),
        (SCRATCH_PGPASS_PATH, _state_from_dict(before.get("pgpass")), MAX_SMALL_FILE_BYTES),
        (SCRATCH_CA_PATH, _state_from_dict(before.get("ca")), MAX_SMALL_FILE_BYTES),
    )
    if not all(
        _file_matches_state(path, expected, maximum)
        for path, expected, maximum in checks
    ):
        raise MaintenanceError("snapshot")
    try:
        shutil.rmtree(SNAPSHOT_DIR)
    except OSError as exc:
        raise MaintenanceError("snapshot") from exc


def _restore_file(label: str, path: Path, state: FileState) -> None:
    if not state.present:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            raise MaintenanceError("rollback") from exc
        return
    payload, snapshot_metadata = _read_file(
        SNAPSHOT_DIR / f"{label}.before", maximum=MAX_SMALL_FILE_BYTES
    )
    if payload is None or snapshot_metadata.uid != 0 or _sha(payload) != state.sha256:
        raise MaintenanceError("rollback")
    _atomic_write(path, payload, mode=state.mode, uid=state.uid, gid=state.gid)


def _require_units_inactive() -> None:
    systemctl = _command("systemctl")
    for unit in BACKUP_UNITS:
        for verb in ("is-active", "is-enabled"):
            completed = subprocess.run(
                [systemctl, verb, "--quiet", unit],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10,
            )
            if completed.returncode == 0:
                raise MaintenanceError("scheduler")


def _cluster_lines() -> tuple[str, ...]:
    output = _run([_command("pg_lsclusters"), "--no-header"], capture=True, code="source")
    try:
        lines = output.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as exc:
        raise MaintenanceError("source") from exc
    normalized: list[str] = []
    for line in lines:
        fields = line.split()
        if len(fields) < 4:
            raise MaintenanceError("source")
        if fields[0] == PG_VERSION and fields[1] == CLUSTER_NAME:
            continue
        normalized.append(" ".join(fields))
    return tuple(sorted(normalized))


def _target_cluster_exists() -> bool:
    output = _run([_command("pg_lsclusters"), "--no-header"], capture=True, code="source")
    try:
        lines = output.decode("utf-8", errors="strict").splitlines()
    except UnicodeDecodeError as exc:
        raise MaintenanceError("source") from exc
    return any(
        len(fields := line.split()) >= 2
        and fields[0] == PG_VERSION
        and fields[1] == CLUSTER_NAME
        for line in lines
    )


def _require_port_free() -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        probe.bind((SCRATCH_HOST, SCRATCH_PORT))
    except OSError as exc:
        raise MaintenanceError("port") from exc
    finally:
        probe.close()


def _require_storage_capacity() -> None:
    storage_root = DATA_DIR.parent
    try:
        metadata = storage_root.lstat()
        free = shutil.disk_usage(storage_root).free
    except OSError as exc:
        raise MaintenanceError("prerequisite") from exc
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) & 0o022
        or free < MIN_FREE_BYTES
    ):
        raise MaintenanceError("prerequisite")


def _source_environment(config: dict[str, str]) -> dict[str, str]:
    required = ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSFILE")
    if any(not config.get(key) for key in required):
        raise MaintenanceError("source")
    source_port = config.get("PGPORT") or "5432"
    if not re.fullmatch(r"[0-9]{1,5}", source_port) or int(source_port) == SCRATCH_PORT:
        raise MaintenanceError("source")
    environment = {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C",
        "PGHOST": config["PGHOST"],
        "PGPORT": source_port,
        "PGDATABASE": config["PGDATABASE"],
        "PGUSER": config["PGUSER"],
        "PGPASSFILE": config["PGPASSFILE"],
        "PGCONNECT_TIMEOUT": config.get("PGCONNECT_TIMEOUT") or "10",
        "PGSSLMODE": config.get("PGSSLMODE") or "verify-full",
    }
    for key in ("PGHOSTADDR", "PGSSLROOTCERT"):
        if config.get(key):
            environment[key] = config[key]
    return environment


def _source_system_identifier(config: dict[str, str]) -> str:
    environment = _source_environment(config)
    output = _run(
        [_command("psql"), "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", "SELECT (pg_control_system()).system_identifier::text"],
        capture=True,
        env=environment,
        code="source",
    ).decode("ascii", errors="strict").strip()
    if not re.fullmatch(r"[0-9]{1,20}", output):
        raise MaintenanceError("source")
    return output


def _require_source_role_absent(config: dict[str, str]) -> None:
    output = _run(
        [
            _command("psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            f"SELECT count(*)::text FROM pg_roles WHERE rolname = '{SCRATCH_ROLE}'",
        ],
        capture=True,
        env=_source_environment(config),
        code="source",
    ).decode("ascii", errors="strict").strip()
    if output != "0":
        raise MaintenanceError("source-role-present")


def _cleanup_accidental_source_role(
    config: dict[str, str], source_identifier: str
) -> None:
    source_port = config.get("PGPORT") or "5432"
    if (
        not re.fullmatch(r"[0-9]{1,5}", source_port)
        or int(source_port) == SCRATCH_PORT
        or not re.fullmatch(r"[0-9]{1,20}", source_identifier)
    ):
        raise MaintenanceError("source-role-cleanup")
    sql = (
        "BEGIN;\n"
        "DO $leaddrive$\n"
        "DECLARE target_oid oid;\n"
        "BEGIN\n"
        f"  IF current_setting('port') <> '{source_port}'\n"
        "     OR (SELECT system_identifier::text FROM pg_control_system()) "
        f"<> '{source_identifier}' THEN\n"
        "    RAISE EXCEPTION 'source target identity rejected';\n"
        "  END IF;\n"
        f"  SELECT oid INTO target_oid FROM pg_roles WHERE rolname = '{SCRATCH_ROLE}';\n"
        "  IF target_oid IS NULL OR NOT EXISTS (\n"
        "    SELECT 1 FROM pg_roles\n"
        f"    WHERE oid = target_oid AND rolname = '{SCRATCH_ROLE}'\n"
        "      AND rolcanlogin AND NOT rolsuper AND NOT rolinherit\n"
        "      AND rolcreatedb AND NOT rolcreaterole AND NOT rolreplication\n"
        "      AND NOT rolbypassrls AND rolconnlimit = -1 AND rolvaliduntil IS NULL\n"
        "  ) THEN\n"
        "    RAISE EXCEPTION 'reserved role authority rejected';\n"
        "  END IF;\n"
        "  IF EXISTS (\n"
        "       SELECT 1 FROM pg_auth_members\n"
        "       WHERE roleid = target_oid OR member = target_oid OR grantor = target_oid\n"
        "     ) OR EXISTS (\n"
        "       SELECT 1 FROM pg_db_role_setting WHERE setrole = target_oid\n"
        "     ) OR EXISTS (\n"
        "       SELECT 1 FROM pg_shdepend\n"
        "       WHERE refclassid = 'pg_authid'::regclass AND refobjid = target_oid\n"
        "     ) THEN\n"
        "    RAISE EXCEPTION 'reserved role dependencies rejected';\n"
        "  END IF;\n"
        f"  EXECUTE 'DROP ROLE {SCRATCH_ROLE}';\n"
        "END\n"
        "$leaddrive$;\n"
        "COMMIT;\n"
    ).encode("ascii")
    _run(
        [
            _command("runuser"),
            "-u",
            "postgres",
            "--",
            _command("psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            SCRATCH_SOCKET_DIR,
            "-p",
            source_port,
            "-d",
            SCRATCH_DATABASE,
        ],
        input_bytes=sql,
        code="source-role-cleanup",
    )


def cleanup_source_role() -> None:
    if os.geteuid() != 0:
        raise MaintenanceError("invocation")
    _require_units_inactive()
    try:
        backup_gid = grp.getgrnam("leaddrive-backup").gr_gid
    except KeyError as exc:
        raise MaintenanceError("prerequisite") from exc
    env_payload, env_state = _read_file(ENV_PATH, maximum=MAX_ENV_BYTES)
    if (
        env_payload is None
        or env_state.uid != 0
        or (env_state.mode, env_state.gid) not in {(0o600, 0), (0o640, backup_gid)}
    ):
        raise MaintenanceError("configuration-env-file")
    config = _parse_environment(env_payload)
    source_identifier = _source_system_identifier(config)
    _cleanup_accidental_source_role(config, source_identifier)
    _require_source_role_absent(config)
    _require_units_inactive()


def _create_certificates(temp_dir: Path, postgres_uid: int, postgres_gid: int, backup_gid: int) -> None:
    openssl = _command("openssl")
    ca_key = temp_dir / "ca.key"
    ca_cert = temp_dir / "ca.crt"
    server_key = temp_dir / "server.key"
    request = temp_dir / "server.csr"
    server_cert = temp_dir / "server.crt"
    extension = temp_dir / "server.ext"
    extension.write_text(
        "basicConstraints=critical,CA:FALSE\n"
        "keyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
        f"subjectAltName=IP:{SCRATCH_HOST}\n",
        encoding="ascii",
    )
    os.chmod(extension, 0o600)
    _run(
        [openssl, "req", "-x509", "-newkey", "rsa:3072", "-sha256", "-nodes", "-days", "3650", "-subj", "/CN=LeadDrive Restore Scratch CA", "-keyout", str(ca_key), "-out", str(ca_cert)],
        code="tls-create",
    )
    _run(
        [openssl, "req", "-new", "-newkey", "rsa:3072", "-sha256", "-nodes", "-subj", f"/CN={SCRATCH_HOST}", "-keyout", str(server_key), "-out", str(request)],
        code="tls-create",
    )
    _run(
        [openssl, "x509", "-req", "-sha256", "-days", "825", "-in", str(request), "-CA", str(ca_cert), "-CAkey", str(ca_key), "-CAcreateserial", "-extfile", str(extension), "-out", str(server_cert)],
        code="tls-create",
    )
    ca_payload = ca_cert.read_bytes()
    cert_payload = server_cert.read_bytes()
    key_payload = server_key.read_bytes()
    source_ca, _ = _read_file(SOURCE_CA_PATH, maximum=MAX_SMALL_FILE_BYTES)
    if source_ca is None or _sha(source_ca) == _sha(ca_payload):
        raise MaintenanceError("tls-create")
    _atomic_write(SCRATCH_CA_PATH, ca_payload, mode=0o640, uid=0, gid=backup_gid)
    _atomic_write(
        SERVER_CERT,
        cert_payload,
        mode=0o640,
        uid=0,
        gid=postgres_gid,
        cluster_parent_authority=(postgres_uid, postgres_gid),
    )
    _atomic_write(
        SERVER_KEY,
        key_payload,
        mode=0o600,
        uid=postgres_uid,
        gid=postgres_gid,
        cluster_parent_authority=(postgres_uid, postgres_gid),
    )


def _acceptable_cluster_config_file(
    state: FileState,
    postgres_uid: int,
    postgres_gid: int,
    expected_mode: int,
) -> bool:
    return (
        state.present
        and state.uid == postgres_uid
        and state.gid == postgres_gid
        and state.mode == expected_mode
    )


def _acceptable_cluster_config_directory(
    state: FileState,
    postgres_uid: int,
    postgres_gid: int,
) -> bool:
    return (
        state.present
        and state.uid == postgres_uid
        and state.gid == postgres_gid
        and state.mode in {0o700, 0o750, 0o755}
    )


def _start_conf_is_manual(payload: bytes) -> bool:
    try:
        text = payload.decode("ascii", errors="strict")
    except UnicodeDecodeError:
        return False
    settings: list[str] = []
    for raw_line in text.splitlines():
        setting = raw_line.split("#", 1)[0].strip()
        if setting:
            settings.append(setting)
    return settings == ["manual"]


def _assert_cluster_config_directory(
    path: Path,
    postgres_uid: int,
    postgres_gid: int,
) -> None:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise MaintenanceError("cluster-config-owner") from exc
    state = FileState(
        present=True,
        uid=metadata.st_uid,
        gid=metadata.st_gid,
        mode=stat.S_IMODE(metadata.st_mode),
    )
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or not _acceptable_cluster_config_directory(
            state, postgres_uid, postgres_gid
        )
    ):
        raise MaintenanceError("cluster-config-owner")


def _configure_cluster(postgres_uid: int, postgres_gid: int) -> None:
    conf_payload, conf_state = _read_file(POSTGRES_CONF, maximum=MAX_SMALL_FILE_BYTES)
    if conf_payload is None or not _acceptable_cluster_config_file(
        conf_state, postgres_uid, postgres_gid, 0o644
    ):
        raise MaintenanceError("cluster-config-owner")
    marker = b"# BEGIN LEADDRIVE RESTORE SCRATCH\n"
    if marker in conf_payload:
        raise MaintenanceError("cluster-config")
    managed = (
        marker
        + f"listen_addresses = '{SCRATCH_HOST}'\n".encode()
        + f"port = {SCRATCH_PORT}\n".encode()
        + b"ssl = on\n"
        + f"ssl_cert_file = '{SERVER_CERT}'\n".encode()
        + f"ssl_key_file = '{SERVER_KEY}'\n".encode()
        + b"ssl_min_protocol_version = 'TLSv1.2'\n"
        + b"password_encryption = 'scram-sha-256'\n"
        + b"# END LEADDRIVE RESTORE SCRATCH\n"
    )
    if conf_payload and not conf_payload.endswith(b"\n"):
        conf_payload += b"\n"
    _atomic_write(
        POSTGRES_CONF,
        conf_payload + managed,
        mode=conf_state.mode,
        uid=conf_state.uid,
        gid=conf_state.gid,
        cluster_parent_authority=(postgres_uid, postgres_gid),
    )
    hba = (
        "# Managed LeadDrive restore scratch authentication\n"
        "local all postgres peer\n"
        "local all all reject\n"
        f"hostssl all {SCRATCH_ROLE} {SCRATCH_HOST}/32 scram-sha-256\n"
        f"host all all {SCRATCH_HOST}/32 reject\n"
        "host all all 0.0.0.0/0 reject\n"
        "host all all ::0/0 reject\n"
    ).encode()
    hba_payload, hba_state = _read_file(PG_HBA, maximum=MAX_SMALL_FILE_BYTES)
    if hba_payload is None or not _acceptable_cluster_config_file(
        hba_state, postgres_uid, postgres_gid, 0o640
    ):
        raise MaintenanceError("cluster-config-owner")
    _atomic_write(
        PG_HBA,
        hba,
        mode=hba_state.mode,
        uid=hba_state.uid,
        gid=hba_state.gid,
        cluster_parent_authority=(postgres_uid, postgres_gid),
    )
    start_payload, start_state = _read_file(START_CONF, maximum=MAX_SMALL_FILE_BYTES)
    if (
        start_payload is None
        or not _start_conf_is_manual(start_payload)
        or not _acceptable_cluster_config_file(
            start_state, postgres_uid, postgres_gid, 0o644
        )
    ):
        raise MaintenanceError("cluster-config-owner")


def _scratch_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "LC_ALL": "C",
        "PGHOST": SCRATCH_HOST,
        "PGPORT": str(SCRATCH_PORT),
        "PGDATABASE": SCRATCH_DATABASE,
        "PGUSER": SCRATCH_ROLE,
        "PGPASSFILE": str(SCRATCH_PGPASS_PATH),
        "PGCONNECT_TIMEOUT": "10",
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": str(SCRATCH_CA_PATH),
    }


def _write_scratch_passfile(
    payload: bytes, backup_uid: int, backup_gid: int
) -> None:
    # libpq deliberately ignores a password file when group or world permissions
    # are present.  The service account owns this 0600 file so both provisioning
    # verification and later recovery drills use the same valid authority.
    _atomic_write(
        SCRATCH_PGPASS_PATH,
        payload,
        mode=0o600,
        uid=backup_uid,
        gid=backup_gid,
    )


def _start_cluster() -> None:
    _run([_command("pg_ctlcluster"), PG_VERSION, CLUSTER_NAME, "start"], code="cluster-start")


def _stop_cluster(code: str = "cluster-stop") -> None:
    _run([_command("pg_ctlcluster"), PG_VERSION, CLUSTER_NAME, "stop"], code=code)


def _create_role(password: str, source_identifier: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{40,100}", password):
        raise MaintenanceError("role-create")
    if not re.fullmatch(r"[0-9]{1,20}", source_identifier):
        raise MaintenanceError("role-create")
    sql = (
        "BEGIN;\n"
        "DO $leaddrive$\n"
        "BEGIN\n"
        f"  IF current_setting('port') <> '{SCRATCH_PORT}'\n"
        "     OR (SELECT system_identifier::text FROM pg_control_system()) "
        f"= '{source_identifier}' THEN\n"
        "    RAISE EXCEPTION 'scratch target identity rejected';\n"
        "  END IF;\n"
        "END\n"
        "$leaddrive$;\n"
        f"CREATE ROLE {SCRATCH_ROLE} LOGIN NOSUPERUSER NOINHERIT CREATEDB "
        f"NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{password}';\n"
        "COMMIT;\n"
    ).encode("ascii")
    _run(
        [
            _command("runuser"),
            "-u",
            "postgres",
            "--",
            _command("psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            SCRATCH_SOCKET_DIR,
            "-p",
            str(SCRATCH_PORT),
            "-d",
            SCRATCH_DATABASE,
        ],
        input_bytes=sql,
        code="role-create",
    )


def _verify_scratch(source_identifier: str) -> None:
    environment = _scratch_environment()
    role_state = _run(
        [
            _command("psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-AtF",
            "|",
            "-c",
            "SELECT CASE WHEN rolsuper THEN 1 ELSE 0 END, "
            "CASE WHEN rolcreatedb THEN 1 ELSE 0 END, "
            "CASE WHEN rolcreaterole THEN 1 ELSE 0 END, "
            "CASE WHEN rolreplication THEN 1 ELSE 0 END, "
            "CASE WHEN rolbypassrls THEN 1 ELSE 0 END "
            "FROM pg_roles WHERE rolname = session_user",
        ],
        capture=True,
        env=environment,
        code="verify-role-query",
    ).decode("ascii", errors="strict").strip()
    if role_state != "0|1|0|0|0":
        raise MaintenanceError("verify-role-attributes")
    tls_state = _run(
        [_command("psql"), "-X", "-v", "ON_ERROR_STOP=1", "-AtF", "|", "-c", "SELECT CASE WHEN ssl THEN 1 ELSE 0 END, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"],
        capture=True,
        env=environment,
        code="verify-tls",
    ).decode("ascii", errors="strict").strip()
    if not re.fullmatch(r"1\|TLSv1\.[23]", tls_state):
        raise MaintenanceError("verify-tls")
    identifier = _run(
        [_command("psql"), "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", "SELECT (pg_control_system()).system_identifier::text"],
        capture=True,
        env=environment,
        code="verify-identity",
    ).decode("ascii", errors="strict").strip()
    if not re.fullmatch(r"[0-9]{1,20}", identifier) or identifier == source_identifier:
        raise MaintenanceError("verify-identity")


def _current_target_hashes() -> dict[str, str]:
    result: dict[str, str] = {}
    for label, path, maximum in (
        ("environment", ENV_PATH, MAX_ENV_BYTES),
        ("pgpass", SCRATCH_PGPASS_PATH, MAX_SMALL_FILE_BYTES),
        ("ca", SCRATCH_CA_PATH, MAX_SMALL_FILE_BYTES),
    ):
        payload, _ = _read_file(path, maximum=maximum)
        if payload is None:
            raise MaintenanceError("post-write")
        result[label] = _sha(payload)
    return result


def _create_snapshot(
    env_state: FileState,
    env_payload: bytes,
    pgpass_state: FileState,
    pgpass_payload: bytes | None,
    ca_state: FileState,
    ca_payload: bytes | None,
) -> dict[str, object]:
    _retire_completed_snapshot()
    _assert_root_dir(SNAPSHOT_DIR.parent)
    if SNAPSHOT_DIR.exists() or SNAPSHOT_DIR.is_symlink():
        raise MaintenanceError("snapshot")
    try:
        SNAPSHOT_DIR.mkdir(mode=0o700)
    except OSError as exc:
        raise MaintenanceError("snapshot") from exc
    for label, payload in (
        ("environment", env_payload),
        ("pgpass", pgpass_payload),
        ("ca", ca_payload),
    ):
        if payload is not None:
            _atomic_write(SNAPSHOT_DIR / f"{label}.before", payload, mode=0o600, uid=0, gid=0)
    state: dict[str, object] = {
        "format": 1,
        "phase": "prepared",
        "cluster": {"version": PG_VERSION, "name": CLUSTER_NAME, "port": SCRATCH_PORT},
        "before": {
            "environment": _file_state_dict(env_state),
            "pgpass": _file_state_dict(pgpass_state),
            "ca": _file_state_dict(ca_state),
        },
        "after": {},
    }
    _write_state(state)
    return state


def _remove_partial_cluster_path(path: Path, allowed_uids: set[int]) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    except OSError as exc:
        raise MaintenanceError("rollback") from exc
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid not in allowed_uids
        or stat.S_IMODE(metadata.st_mode) & 0o002
    ):
        raise MaintenanceError("rollback")
    try:
        shutil.rmtree(path)
    except OSError as exc:
        raise MaintenanceError("rollback") from exc


def _remove_cluster_if_present(*, allow_partial: bool = False) -> None:
    if _target_cluster_exists():
        _run([_command("pg_dropcluster"), "--stop", PG_VERSION, CLUSTER_NAME], code="rollback")
    elif allow_partial:
        try:
            postgres_uid = pwd.getpwnam("postgres").pw_uid
        except KeyError as exc:
            raise MaintenanceError("rollback") from exc
        # Debian's pg_createcluster may hand the cluster config directory to
        # postgres before the cluster is visible to pg_lsclusters.  Accept the
        # same tightly-scoped postgres authority that configuration writes
        # validate, otherwise a fail-closed apply can strand its own partial
        # directory and mask the original failure as a rollback failure.
        _remove_partial_cluster_path(CONFIG_DIR, {0, postgres_uid})
        _remove_partial_cluster_path(DATA_DIR, {0, postgres_uid})
    for path in (CONFIG_DIR, DATA_DIR):
        if path.exists() or path.is_symlink():
            raise MaintenanceError("rollback")


def _restore_before(state: dict[str, object]) -> None:
    before = state.get("before")
    if not isinstance(before, dict):
        raise MaintenanceError("rollback")
    _restore_file("environment", ENV_PATH, _state_from_dict(before.get("environment")))
    _restore_file("pgpass", SCRATCH_PGPASS_PATH, _state_from_dict(before.get("pgpass")))
    _restore_file("ca", SCRATCH_CA_PATH, _state_from_dict(before.get("ca")))


def apply() -> None:
    if os.geteuid() != 0:
        raise MaintenanceError("invocation")
    for name in (
        "openssl", "pg_createcluster", "pg_dropcluster", "pg_ctlcluster",
        "pg_lsclusters", "psql", "runuser", "systemctl",
    ):
        _command(name)
    _assert_root_dir(ENV_PATH.parent)
    _assert_root_dir(LOCK_DIR, create=True, mode=0o700)
    if _target_cluster_exists() or CONFIG_DIR.exists() or DATA_DIR.exists():
        raise MaintenanceError("prerequisite")
    _require_port_free()
    _require_storage_capacity()
    _require_units_inactive()

    try:
        backup_gid = grp.getgrnam("leaddrive-backup").gr_gid
        backup_user = pwd.getpwnam("leaddrive-backup")
    except KeyError as exc:
        raise MaintenanceError("prerequisite") from exc
    if backup_user.pw_gid != backup_gid:
        raise MaintenanceError("prerequisite")
    backup_uid = backup_user.pw_uid
    env_payload, env_state = _read_file(ENV_PATH, maximum=MAX_ENV_BYTES)
    if (
        env_payload is None
        or env_state.uid != 0
        or (env_state.mode, env_state.gid) not in {(0o600, 0), (0o640, backup_gid)}
    ):
        raise MaintenanceError("configuration-env-file")
    config = _parse_environment(env_payload)
    source_identifier = _source_system_identifier(config)
    _require_source_role_absent(config)
    source_before = _cluster_lines()
    pgpass_payload, pgpass_state = _read_file(
        SCRATCH_PGPASS_PATH, maximum=MAX_SMALL_FILE_BYTES, required=False
    )
    ca_payload, ca_state = _read_file(
        SCRATCH_CA_PATH, maximum=MAX_SMALL_FILE_BYTES, required=False
    )
    if pgpass_state.present and pgpass_state.uid not in {0, backup_uid}:
        raise MaintenanceError("configuration-pgpass-owner")
    if pgpass_state.present and not _acceptable_existing_secret_file(
        pgpass_state, backup_uid, backup_gid
    ):
        raise MaintenanceError("configuration-pgpass-authority")
    if ca_state.present and (
        ca_state.uid != 0
        or ca_state.mode not in {0o400, 0o440, 0o444, 0o600, 0o640, 0o644}
    ):
        raise MaintenanceError("configuration-ca-file")
    state = _create_snapshot(
        env_state, env_payload, pgpass_state, pgpass_payload, ca_state, ca_payload
    )
    try:
        postgres = pwd.getpwnam("postgres")
        _run(
            [
                _command("pg_createcluster"),
                "--datadir", str(DATA_DIR),
                "--port", str(SCRATCH_PORT),
                "--start-conf=manual",
                PG_VERSION,
                CLUSTER_NAME,
                "--",
                "--auth-local=peer",
                "--auth-host=scram-sha-256",
            ],
            code="cluster-create",
        )
        _configure_cluster(postgres.pw_uid, postgres.pw_gid)
        with tempfile.TemporaryDirectory(prefix="leaddrive-scratch-tls.", dir="/run") as temporary:
            os.chmod(temporary, 0o700)
            _create_certificates(
                Path(temporary), postgres.pw_uid, postgres.pw_gid, backup_gid
            )
        password = secrets.token_urlsafe(48)
        passfile = f"{SCRATCH_HOST}:{SCRATCH_PORT}:{SCRATCH_DATABASE}:{SCRATCH_ROLE}:{password}\n".encode()
        _write_scratch_passfile(passfile, backup_uid, backup_gid)
        rewritten = rewrite_environment(env_payload, TARGET_ENV)
        _atomic_write(
            ENV_PATH,
            rewritten,
            mode=env_state.mode,
            uid=env_state.uid,
            gid=env_state.gid,
        )
        _start_cluster()
        _create_role(password, source_identifier)
        _verify_scratch(source_identifier)
        _stop_cluster()
        _require_port_free()
        _require_units_inactive()
        if _cluster_lines() != source_before:
            raise MaintenanceError("source-drift")
        current = _current_target_hashes()
        state["phase"] = "applied"
        state["after"] = current
        _write_state(state)
    except Exception as exc:
        cause_code = exc.code if isinstance(exc, MaintenanceError) else "internal"
        try:
            _remove_cluster_if_present(allow_partial=True)
            _restore_before(state)
            state["phase"] = "failed-rolled-back"
            state["after"] = {}
            _write_state(state)
        except Exception as rollback_exc:
            raise MaintenanceError("rollback", cause_code=cause_code) from rollback_exc
        if isinstance(exc, MaintenanceError):
            raise
        raise MaintenanceError("internal") from exc


def rollback() -> None:
    if os.geteuid() != 0:
        raise MaintenanceError("invocation")
    _require_units_inactive()
    state = _load_state()
    phase = state.get("phase")
    if phase not in {"prepared", "applied", "failed-rolled-back"}:
        raise MaintenanceError("rollback")
    if phase == "applied":
        after = state.get("after")
        if (
            not isinstance(after, dict)
            or _current_target_hashes() != after
            or not _target_cluster_exists()
        ):
            raise MaintenanceError("rollback")
    if phase == "failed-rolled-back":
        before = state.get("before")
        if not isinstance(before, dict) or _target_cluster_exists():
            raise MaintenanceError("rollback")
        checks = (
            (ENV_PATH, _state_from_dict(before.get("environment")), MAX_ENV_BYTES),
            (SCRATCH_PGPASS_PATH, _state_from_dict(before.get("pgpass")), MAX_SMALL_FILE_BYTES),
            (SCRATCH_CA_PATH, _state_from_dict(before.get("ca")), MAX_SMALL_FILE_BYTES),
        )
        if not all(
            _file_matches_state(path, expected, maximum)
            for path, expected, maximum in checks
        ):
            raise MaintenanceError("rollback")
    source_before = _cluster_lines()
    _remove_cluster_if_present(allow_partial=phase == "prepared")
    _restore_before(state)
    _require_port_free()
    _require_units_inactive()
    if _cluster_lines() != source_before:
        raise MaintenanceError("source-drift")
    state["phase"] = "rolled-back"
    state["after"] = {}
    _write_state(state)


def _acquire_lock() -> int:
    _assert_root_dir(LOCK_DIR, create=True, mode=0o700)
    try:
        descriptor = os.open(
            LOCK_PATH,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
            raise MaintenanceError("lock")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return descriptor
    except (OSError, BlockingIOError) as exc:
        raise MaintenanceError("lock") from exc


def main() -> int:
    operation = sys.argv[1] if len(sys.argv) == 2 else "unknown"
    status = "failed"
    verify_full = "unknown"
    scratch_state = "unknown"
    snapshot = "unknown"
    stage = "invocation"
    cause_stage = "none"
    lock = -1
    try:
        if operation not in {"apply", "rollback", "cleanup-source-role"}:
            raise MaintenanceError("invocation")
        lock = _acquire_lock()
        if operation == "apply":
            apply()
            status = "applied"
            verify_full = "yes"
        elif operation == "rollback":
            rollback()
            status = "rolled-back"
            verify_full = "not-tested"
        else:
            cleanup_source_role()
            status = "source-role-removed"
            verify_full = "not-tested"
        scratch_state = "stopped"
        snapshot = "retained"
        stage = "none"
        return 0
    except MaintenanceError as exc:
        stage = exc.code
        cause_stage = exc.cause_code
        snapshot = "retained" if SNAPSHOT_STATE.exists() else "unknown"
        return 1
    except Exception:
        stage = "internal"
        snapshot = "retained" if SNAPSHOT_STATE.exists() else "unknown"
        return 1
    finally:
        if lock >= 0:
            os.close(lock)
        safe_operation = (
            operation
            if operation in {"apply", "rollback", "cleanup-source-role"}
            else "unknown"
        )
        print(
            "scratch_postgres_maintenance "
            f"operation={safe_operation} status={status} "
            "source_restart=no backup_run=no restore_run=no kafka_change=no "
            f"scratch_port={SCRATCH_PORT} scratch_state={scratch_state} "
            f"effective_verify_full={verify_full} rollback_snapshot={snapshot} "
            f"failure_stage={stage} cause_stage={cause_stage}"
        )


if __name__ == "__main__":
    raise SystemExit(main())
