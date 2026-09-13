#!/usr/bin/env python3
"""Apply or roll back the reviewed client-only PostgreSQL TLS remediation.

This script is streamed over the pinned production SSH connection. It never
prints configuration values, hostnames, addresses, certificate identities, or
exception text. The only mutation is an atomic update of the fixed source CA
and four source-client keys in the canonical backup environment. PostgreSQL,
systemd, backup, restore, deploy, and Kafka processes are never invoked.
"""

from __future__ import annotations

import grp
import hashlib
import ipaddress
import json
import fcntl
import os
import re
import shutil
import socket
import ssl
import stat
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


ENV_PATH = Path("/etc/leaddrive/backup.env")
CA_PATH = Path("/etc/leaddrive/managed-postgres-ca.crt")
PGPASS_PATH = Path("/etc/leaddrive/backup.pgpass")
BACKUP_LOCK_PATH = Path(
    "/var/lib/leaddrive-recovery-runner-locks/postgres-backup.lock"
)
ACTIVE_BACKUP_SCRIPT_PATH = Path(
    "/usr/local/lib/leaddrive-v2/ops/current/backup/postgres-backup.sh"
)
ACTIVE_BACKUP_SERVICE_PATH = Path(
    "/etc/systemd/system/leaddrive-postgres-backup.service"
)
SNAPSHOT_PATH = Path("/var/lib/leaddrive-postgres-tls-maintenance")
SNAPSHOT_ENV_PATH = SNAPSHOT_PATH / "backup.env.before"
SNAPSHOT_CA_PATH = SNAPSHOT_PATH / "managed-postgres-ca.crt.before"
SNAPSHOT_STATE_PATH = SNAPSHOT_PATH / "state.json"
MAX_ENV_BYTES = 64 * 1024
MAX_CA_BYTES = 256 * 1024
CONNECT_TIMEOUT_SECONDS = 6
POSTGRES_SSL_REQUEST = struct.pack("!II", 8, 80877103)
TARGET_KEYS = frozenset(
    {
        "PGHOST",
        "PGHOSTADDR",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGPASSFILE",
        "PGSSLMODE",
        "PGSSLROOTCERT",
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGPASSWORD",
    }
)
APPROVED_BACKUP_SCRIPT_SHA256 = frozenset(
    {
        "ddf2142311b6c7ad561e510369925ca3f5347f667966a5c265451c0823e4e065",
        "b2b0ca62ab77afe5ff2cda88351f71a038163b791484adc886cad806fe07edff",
    }
)
APPROVED_BACKUP_SERVICE_SHA256 = (
    "33c0c203a5f30f13431a20aff96991fddb8c88e08e6428e0bbd99ea1729560f5"
)


class SafeMaintenanceError(Exception):
    """A deliberately message-free failure that cannot disclose input data."""

    ALLOWED_CODES = frozenset(
        {
            "configuration",
            "configuration-read",
            "configuration-read-file",
            "configuration-read-authority",
            "configuration-read-links",
            "configuration-read-encoding",
            "configuration-read-duplicate",
            "configuration-read-required",
            "configuration-client",
            "configuration-override",
            "configuration-rewrite",
            "invocation",
            "invocation-script-read",
            "invocation-script-missing",
            "invocation-script-unapproved",
            "invocation-unit-read",
            "invocation-unit-unapproved",
            "scheduler",
            "backup-lock",
            "file-safety",
            "snapshot-present",
            "tls-evidence",
            "pgpass",
            "post-write",
            "rollback",
            "internal",
        }
    )

    def __init__(self, code: str = "internal") -> None:
        self.code = code if code in self.ALLOWED_CODES else "internal"
        super().__init__()


@dataclass(frozen=True)
class FileAuthority:
    uid: int
    gid: int
    mode: int


@dataclass(frozen=True)
class PreparedRemediation:
    environment: bytes
    certificate_pem: bytes
    certificate_sha256: str


def _assert_root_directory(path: Path) -> None:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise SafeMaintenanceError from exc
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != 0
        or stat.S_IMODE(metadata.st_mode) & 0o022
    ):
        raise SafeMaintenanceError


def _read_regular_file(
    path: Path,
    *,
    maximum_bytes: int,
    required: bool,
    require_root_owner: bool = True,
) -> tuple[bytes | None, FileAuthority | None]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        if required:
            raise SafeMaintenanceError
        return None, None
    except OSError as exc:
        raise SafeMaintenanceError from exc

    try:
        metadata = os.fstat(fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or (require_root_owner and metadata.st_uid != 0)
            or metadata.st_nlink != 1
            or metadata.st_size > maximum_bytes
        ):
            raise SafeMaintenanceError
        mode = stat.S_IMODE(metadata.st_mode)
        if mode & 0o022:
            raise SafeMaintenanceError
        payload = bytearray()
        while len(payload) <= maximum_bytes:
            chunk = os.read(fd, min(8192, maximum_bytes + 1 - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) > maximum_bytes:
            raise SafeMaintenanceError
        return bytes(payload), FileAuthority(metadata.st_uid, metadata.st_gid, mode)
    finally:
        os.close(fd)


def read_environment(
    path: Path = ENV_PATH,
    *,
    require_production_authority: bool = True,
) -> tuple[bytes, FileAuthority, dict[str, str]]:
    try:
        payload, authority = _read_regular_file(
            path,
            maximum_bytes=MAX_ENV_BYTES,
            required=True,
            require_root_owner=require_production_authority,
        )
    except SafeMaintenanceError as exc:
        try:
            metadata = path.lstat()
        except OSError:
            raise SafeMaintenanceError("configuration-read-file") from exc
        if metadata.st_nlink != 1:
            raise SafeMaintenanceError("configuration-read-links") from exc
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_size > MAX_ENV_BYTES
        ):
            raise SafeMaintenanceError("configuration-read-file") from exc
        raise SafeMaintenanceError("configuration-read-authority") from exc
    if payload is None or authority is None:
        raise SafeMaintenanceError("configuration-read-file")
    if require_production_authority:
        try:
            backup_gid = grp.getgrnam("leaddrive-backup").gr_gid
        except KeyError as exc:
            raise SafeMaintenanceError("configuration-read-authority") from exc
        if not (
            (authority.gid == 0 and authority.mode == 0o600)
            or (authority.gid == backup_gid and authority.mode == 0o640)
        ):
            raise SafeMaintenanceError("configuration-read-authority")

    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise SafeMaintenanceError("configuration-read-encoding") from exc
    found: dict[str, list[str]] = {key: [] for key in TARGET_KEYS}
    assignment = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export") and len(line) > 6 and line[6].isspace():
            line = line[6:].strip()
        match = assignment.fullmatch(line)
        if not match or match.group(1) not in TARGET_KEYS:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        found[match.group(1)].append(value)

    result: dict[str, str] = {}
    for key, values in found.items():
        if len(values) > 1:
            raise SafeMaintenanceError("configuration-read-duplicate")
        result[key] = values[0] if values else ""
    for required_key in (
        "PGHOST",
        "PGDATABASE",
        "PGUSER",
        "PGPASSFILE",
    ):
        if not result[required_key]:
            raise SafeMaintenanceError("configuration-read-required")
    return payload, authority, result


def _valid_dns_name(value: str) -> bool:
    candidate = value.lower().rstrip(".")
    if not candidate or len(candidate) > 253 or "*" in candidate:
        return False
    return all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        is not None
        for label in candidate.split(".")
    )


def _validate_connection_host(value: str) -> None:
    if (
        not value
        or len(value) > 253
        or any(ord(char) < 33 for char in value)
        or "://" in value
        or "@" in value
        or value.startswith("/")
    ):
        raise SafeMaintenanceError


def _normalize_port(value: str) -> int:
    candidate = value or "5432"
    if not re.fullmatch(r"[0-9]{1,5}", candidate):
        raise SafeMaintenanceError
    port = int(candidate, 10)
    if not 1 <= port <= 65535:
        raise SafeMaintenanceError
    return port


def _local_interface_addresses() -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    addresses: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = {
        ipaddress.ip_address("127.0.0.1"),
        ipaddress.ip_address("::1"),
    }
    executable = shutil.which("ip", path="/usr/sbin:/usr/bin:/sbin:/bin")
    if executable is None:
        return addresses
    try:
        result = subprocess.run(
            [executable, "-j", "address", "show"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"},
        )
        interfaces = json.loads(result.stdout.decode("utf-8", errors="strict"))
        for interface in interfaces:
            for entry in interface.get("addr_info", []):
                try:
                    addresses.add(ipaddress.ip_address(entry.get("local", "")))
                except ValueError:
                    continue
    except (
        OSError,
        subprocess.SubprocessError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ):
        pass
    return addresses


def _require_local_address(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise SafeMaintenanceError from exc
    if not (address.is_loopback or address in _local_interface_addresses()):
        raise SafeMaintenanceError
    return str(address)


def _postgres_certificate(host: str, port: int) -> tuple[bytes, str]:
    _validate_connection_host(host)
    try:
        connection = socket.create_connection(
            (host, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
        connection.settimeout(CONNECT_TIMEOUT_SECONDS)
        peer_address = _require_local_address(connection.getpeername()[0])
        connection.sendall(POSTGRES_SSL_REQUEST)
        if connection.recv(1) != b"S":
            connection.close()
            raise SafeMaintenanceError
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        secured = context.wrap_socket(connection, server_hostname=None)
        try:
            certificate = secured.getpeercert(binary_form=True)
        finally:
            secured.close()
    except SafeMaintenanceError:
        raise
    except (OSError, ssl.SSLError, ValueError) as exc:
        raise SafeMaintenanceError from exc
    if not certificate:
        raise SafeMaintenanceError
    return certificate, peer_address


def _openssl_x509(certificate_der: bytes, arguments: tuple[str, ...]) -> str:
    executable = shutil.which("openssl", path="/usr/bin:/bin")
    if executable is None:
        raise SafeMaintenanceError
    try:
        result = subprocess.run(
            [executable, "x509", "-inform", "DER", "-noout", *arguments],
            input=certificate_der,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SafeMaintenanceError from exc
    if result.returncode != 0:
        raise SafeMaintenanceError
    return result.stdout.decode("utf-8", errors="strict")


def _certificate_identity(certificate_der: bytes) -> tuple[str, str, list[str]]:
    identity = _openssl_x509(
        certificate_der, ("-issuer", "-subject", "-nameopt", "RFC2253")
    )
    issuer = ""
    subject = ""
    for line in identity.splitlines():
        if line.startswith("issuer="):
            issuer = line.removeprefix("issuer=").strip()
        elif line.startswith("subject="):
            subject = line.removeprefix("subject=").strip()
    if not issuer or issuer != subject:
        raise SafeMaintenanceError

    san_text = _openssl_x509(certificate_der, ("-ext", "subjectAltName"))
    dns_sans = re.findall(r"DNS:([^,\s]+)", san_text)
    if len(dns_sans) != 1:
        raise SafeMaintenanceError
    _require_certificate_lifetime_and_purpose(certificate_der)
    return issuer, subject, dns_sans


def _require_certificate_lifetime_and_purpose(certificate_der: bytes) -> None:
    executable = shutil.which("openssl", path="/usr/bin:/bin")
    if executable is None:
        raise SafeMaintenanceError
    commands = (
        [executable, "x509", "-inform", "DER", "-noout", "-checkend", "604800"],
        [executable, "x509", "-inform", "DER", "-noout", "-purpose"],
    )
    outputs: list[bytes] = []
    for command in commands:
        try:
            result = subprocess.run(
                command,
                input=certificate_der,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SafeMaintenanceError from exc
        if result.returncode != 0:
            raise SafeMaintenanceError
        outputs.append(result.stdout)
    if b"SSL server : Yes" not in outputs[1]:
        raise SafeMaintenanceError


def _production_server_name(single_san: str) -> str:
    san = single_san.lower().rstrip(".")
    if not _valid_dns_name(san):
        raise SafeMaintenanceError
    candidates: list[str] = []
    for raw_name in (socket.gethostname(), socket.getfqdn()):
        candidate = raw_name.strip().lower().rstrip(".")
        if _valid_dns_name(candidate) and candidate not in candidates:
            candidates.append(candidate)
    if san not in candidates:
        raise SafeMaintenanceError
    try:
        records = socket.getaddrinfo(san, None, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError) as exc:
        raise SafeMaintenanceError from exc
    if not records or not any(
        _address_is_local(record[4][0]) for record in records
    ):
        raise SafeMaintenanceError
    return san


def _address_is_local(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.is_loopback or address in _local_interface_addresses()


def _verify_full(
    route_address: str,
    port: int,
    server_name: str,
    certificate_der: bytes,
) -> None:
    try:
        context = ssl.create_default_context(
            cadata=ssl.DER_cert_to_PEM_cert(certificate_der)
        )
        context.check_hostname = True
        connection = socket.create_connection(
            (route_address, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
        connection.settimeout(CONNECT_TIMEOUT_SECONDS)
        _require_local_address(connection.getpeername()[0])
        connection.sendall(POSTGRES_SSL_REQUEST)
        if connection.recv(1) != b"S":
            connection.close()
            raise SafeMaintenanceError
        secured = context.wrap_socket(connection, server_hostname=server_name)
        try:
            observed = secured.getpeercert(binary_form=True)
        finally:
            secured.close()
    except SafeMaintenanceError:
        raise
    except (OSError, ssl.SSLError, ValueError) as exc:
        raise SafeMaintenanceError from exc
    if not observed or not hashlib.sha256(observed).digest() == hashlib.sha256(
        certificate_der
    ).digest():
        raise SafeMaintenanceError


def _split_pgpass_line(line: str) -> list[str]:
    fields: list[str] = []
    field: list[str] = []
    escaped = False
    for character in line:
        if escaped:
            field.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            fields.append("".join(field))
            field = []
        else:
            field.append(character)
    if escaped:
        raise SafeMaintenanceError
    fields.append("".join(field))
    return fields


def _require_pgpass_match(config: dict[str, str], server_name: str, port: int) -> None:
    if config["PGPASSFILE"] != str(PGPASS_PATH):
        raise SafeMaintenanceError
    payload, authority = _read_regular_file(
        PGPASS_PATH, maximum_bytes=MAX_ENV_BYTES, required=True
    )
    if payload is None or authority is None:
        raise SafeMaintenanceError
    try:
        backup_gid = grp.getgrnam("leaddrive-backup").gr_gid
    except KeyError as exc:
        raise SafeMaintenanceError from exc
    if authority.gid != backup_gid or authority.mode not in {0o440, 0o640}:
        raise SafeMaintenanceError
    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise SafeMaintenanceError from exc
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = _split_pgpass_line(line)
        if len(fields) != 5 or not fields[4]:
            raise SafeMaintenanceError
        host, pg_port, database, user, _password = fields
        if (
            host in {"*", server_name}
            and pg_port in {"*", str(port)}
            and database in {"*", config["PGDATABASE"]}
            and user in {"*", config["PGUSER"]}
        ):
            return
    raise SafeMaintenanceError


def _require_reviewed_invocation() -> bool:
    try:
        script, _ = _read_regular_file(
            ACTIVE_BACKUP_SCRIPT_PATH, maximum_bytes=256 * 1024, required=False
        )
    except SafeMaintenanceError as exc:
        raise SafeMaintenanceError("invocation-script-read") from exc
    try:
        service, _ = _read_regular_file(
            ACTIVE_BACKUP_SERVICE_PATH, maximum_bytes=32 * 1024, required=False
        )
    except SafeMaintenanceError as exc:
        raise SafeMaintenanceError("invocation-unit-read") from exc
    if script is None:
        if service is None:
            return False
        raise SafeMaintenanceError("invocation-script-missing")
    if hashlib.sha256(script).hexdigest() not in APPROVED_BACKUP_SCRIPT_SHA256:
        raise SafeMaintenanceError("invocation-script-unapproved")
    if service is None:
        return False
    if hashlib.sha256(service).hexdigest() != APPROVED_BACKUP_SERVICE_SHA256:
        # A root-owned, non-writable but byte-drifted unit is not approved for
        # commissioning. Treat it like an uncommissioned unit only while the
        # independent scheduler gate proves that neither it nor its timer can
        # run during this client-only maintenance. The unit is never changed.
        return False
    return True


def _require_backup_inactive() -> None:
    executable = shutil.which("systemctl", path="/usr/bin:/bin")
    if executable is None:
        raise SafeMaintenanceError
    for unit in (
        "leaddrive-postgres-backup.service",
        "leaddrive-postgres-backup.timer",
    ):
        try:
            result = subprocess.run(
                [executable, "is-active", "--quiet", unit],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SafeMaintenanceError from exc
        if result.returncode == 0:
            raise SafeMaintenanceError
    for unit in ("leaddrive-postgres-backup.service", "leaddrive-postgres-backup.timer"):
        try:
            result = subprocess.run(
                [executable, "is-enabled", "--quiet", unit],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SafeMaintenanceError from exc
        # systemd returns 1 for disabled/static/masked units and 4 when the
        # unit does not exist. Any enabled state, or an unexpected failure to
        # classify it, keeps the maintenance fail-closed.
        if result.returncode not in {1, 4}:
            raise SafeMaintenanceError


def _acquire_backup_lock(*, required: bool) -> int | None:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(BACKUP_LOCK_PATH, flags)
        metadata = os.fstat(fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0
            or metadata.st_nlink != 1
        ):
            raise SafeMaintenanceError
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except FileNotFoundError as exc:
        if not required:
            return None
        raise SafeMaintenanceError from exc
    except Exception as exc:
        try:
            os.close(fd)
        except (OSError, UnboundLocalError):
            pass
        raise SafeMaintenanceError from exc


def _require_no_extended_attributes(path: Path) -> None:
    try:
        attributes = os.listxattr(path, follow_symlinks=False)
    except OSError as exc:
        raise SafeMaintenanceError from exc
    if attributes:
        raise SafeMaintenanceError


def rewrite_environment(payload: bytes, replacements: dict[str, str]) -> bytes:
    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise SafeMaintenanceError from exc
    for value in replacements.values():
        if not value or not re.fullmatch(r"[A-Za-z0-9_./:-]+", value):
            raise SafeMaintenanceError

    assignment = re.compile(
        r"^(?P<indent>\s*)(?:export\s+)?(?P<key>[A-Za-z_][A-Za-z0-9_]*)\s*=.*?(?P<ending>\r?\n)?$"
    )
    lines = text.splitlines(keepends=True)
    newline = "\r\n" if any(line.endswith("\r\n") for line in lines) else "\n"
    existing = {key: 0 for key in replacements}
    for line in lines:
        match = assignment.fullmatch(line)
        if match and match.group("key") in existing:
            existing[match.group("key")] += 1
    if any(count > 1 for count in existing.values()):
        raise SafeMaintenanceError

    seen = {key: 0 for key in replacements}
    output: list[str] = []
    for line in lines:
        match = assignment.fullmatch(line)
        if match and match.group("key") in replacements:
            key = match.group("key")
            seen[key] += 1
            if seen[key] > 1:
                raise SafeMaintenanceError
            ending = match.group("ending") or ""
            if (
                key == "PGHOST"
                and "PGHOSTADDR" in replacements
                and existing["PGHOSTADDR"] == 0
            ):
                separator = ending or newline
                output.append(
                    f"{match.group('indent')}{key}={replacements[key]}{separator}"
                )
                output.append(
                    f"{match.group('indent')}PGHOSTADDR={replacements['PGHOSTADDR']}{ending}"
                )
                seen["PGHOSTADDR"] += 1
            else:
                output.append(
                    f"{match.group('indent')}{key}={replacements[key]}{ending}"
                )
            continue
        output.append(line)

    if seen.get("PGHOST") != 1:
        raise SafeMaintenanceError
    for key in ("PGSSLMODE", "PGSSLROOTCERT"):
        if seen.get(key) == 0:
            if output and not output[-1].endswith(("\n", "\r")):
                output[-1] = f"{output[-1]}{newline}"
            output.append(f"{key}={replacements[key]}{newline}")
            seen[key] = 1
        if seen.get(key) != 1:
            raise SafeMaintenanceError
    if seen.get("PGHOSTADDR") != 1:
        raise SafeMaintenanceError
    result = "".join(output).encode("utf-8")
    if len(result) > MAX_ENV_BYTES:
        raise SafeMaintenanceError
    return result


def _atomic_write(path: Path, payload: bytes, authority: FileAuthority) -> None:
    prefix = f".{path.name}.tls-maintenance."
    fd, temporary_name = tempfile.mkstemp(prefix=prefix, dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(fd, authority.mode)
        os.fchown(fd, authority.uid, authority.gid)
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def _snapshot(
    environment: bytes,
    env_authority: FileAuthority,
    ca_payload: bytes | None,
    ca_authority: FileAuthority | None,
) -> dict[str, object]:
    _assert_root_directory(Path("/var"))
    _assert_root_directory(Path("/var/lib"))
    try:
        os.mkdir(SNAPSHOT_PATH, 0o700)
    except OSError as exc:
        raise SafeMaintenanceError from exc
    _atomic_write(
        SNAPSHOT_ENV_PATH, environment, FileAuthority(uid=0, gid=0, mode=0o600)
    )
    if ca_payload is not None:
        _atomic_write(
            SNAPSHOT_CA_PATH, ca_payload, FileAuthority(uid=0, gid=0, mode=0o600)
        )
    state: dict[str, object] = {
        "format": 1,
        "phase": "snapshotted",
        "env_uid": env_authority.uid,
        "env_gid": env_authority.gid,
        "env_mode": env_authority.mode,
        "env_before_sha256": hashlib.sha256(environment).hexdigest(),
        "ca_existed": ca_payload is not None,
        "ca_uid": ca_authority.uid if ca_authority is not None else 0,
        "ca_gid": ca_authority.gid if ca_authority is not None else 0,
        "ca_mode": ca_authority.mode if ca_authority is not None else 0o640,
        "ca_before_sha256": (
            hashlib.sha256(ca_payload).hexdigest() if ca_payload is not None else ""
        ),
    }
    _write_state(state)
    return state


def _write_state(state: dict[str, object]) -> None:
    payload = (json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n").encode()
    _atomic_write(
        SNAPSHOT_STATE_PATH, payload, FileAuthority(uid=0, gid=0, mode=0o600)
    )


def _load_state() -> dict[str, object]:
    payload, authority = _read_regular_file(
        SNAPSHOT_STATE_PATH, maximum_bytes=16 * 1024, required=True
    )
    if payload is None or authority != FileAuthority(uid=0, gid=0, mode=0o600):
        raise SafeMaintenanceError
    try:
        state = json.loads(payload.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SafeMaintenanceError from exc
    if not isinstance(state, dict) or state.get("format") != 1:
        raise SafeMaintenanceError
    return state


def _authority_from_state(state: dict[str, object], prefix: str) -> FileAuthority:
    values = tuple(state.get(f"{prefix}_{field}") for field in ("uid", "gid", "mode"))
    if not all(isinstance(value, int) for value in values):
        raise SafeMaintenanceError
    return FileAuthority(*values)


def _restore_snapshot(state: dict[str, object], *, require_post_state: bool) -> None:
    current_env, _, _ = read_environment()
    current_ca, _ = _read_regular_file(
        CA_PATH, maximum_bytes=MAX_CA_BYTES, required=True
    )
    if current_ca is None:
        raise SafeMaintenanceError
    if require_post_state:
        if state.get("phase") != "applied":
            raise SafeMaintenanceError
        if hashlib.sha256(current_env).hexdigest() != state.get("env_after_sha256"):
            raise SafeMaintenanceError
        if hashlib.sha256(current_ca).hexdigest() != state.get("ca_after_sha256"):
            raise SafeMaintenanceError

    previous_env, _ = _read_regular_file(
        SNAPSHOT_ENV_PATH, maximum_bytes=MAX_ENV_BYTES, required=True
    )
    if previous_env is None or hashlib.sha256(previous_env).hexdigest() != state.get(
        "env_before_sha256"
    ):
        raise SafeMaintenanceError
    _atomic_write(ENV_PATH, previous_env, _authority_from_state(state, "env"))

    if state.get("ca_existed") is True:
        previous_ca, _ = _read_regular_file(
            SNAPSHOT_CA_PATH, maximum_bytes=MAX_CA_BYTES, required=True
        )
        if previous_ca is None or hashlib.sha256(previous_ca).hexdigest() != state.get(
            "ca_before_sha256"
        ):
            raise SafeMaintenanceError
        _atomic_write(CA_PATH, previous_ca, _authority_from_state(state, "ca"))
    elif state.get("ca_existed") is False:
        metadata = CA_PATH.lstat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise SafeMaintenanceError
        CA_PATH.unlink()
    else:
        raise SafeMaintenanceError


def _prepare(environment: bytes, config: dict[str, str]) -> PreparedRemediation:
    if config["PGSSLMODE"] and config["PGSSLMODE"] not in {
        "disable",
        "allow",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
    }:
        raise SafeMaintenanceError("configuration-client")
    current_rootcert = config["PGSSLROOTCERT"]
    if current_rootcert and (
        len(current_rootcert) > 4096
        or not Path(current_rootcert).is_absolute()
        or any(ord(character) < 32 for character in current_rootcert)
        or "://" in current_rootcert
        or "@" in current_rootcert
    ):
        raise SafeMaintenanceError("configuration-client")
    if any(config[key] for key in ("PGSERVICE", "PGSERVICEFILE", "PGPASSWORD")):
        raise SafeMaintenanceError("configuration-override")
    current_host = config["PGHOST"]
    port = _normalize_port(config["PGPORT"])
    try:
        first_certificate, first_route = _postgres_certificate(current_host, port)
        second_certificate, second_route = _postgres_certificate(current_host, port)
        first_sha = hashlib.sha256(first_certificate).hexdigest()
        if first_sha != hashlib.sha256(second_certificate).hexdigest():
            raise SafeMaintenanceError
        _certificate_identity(first_certificate)
        server_name = _production_server_name(
            _certificate_identity(first_certificate)[2][0]
        )
        _verify_full(first_route, port, server_name, first_certificate)
        _verify_full(second_route, port, server_name, second_certificate)
    except Exception as exc:
        raise SafeMaintenanceError("tls-evidence") from exc
    try:
        _require_pgpass_match(config, server_name, port)
    except Exception as exc:
        raise SafeMaintenanceError("pgpass") from exc
    try:
        rewritten = rewrite_environment(
            environment,
            {
                "PGHOST": server_name,
                "PGHOSTADDR": first_route,
                "PGSSLMODE": "verify-full",
                "PGSSLROOTCERT": str(CA_PATH),
            },
        )
    except Exception as exc:
        raise SafeMaintenanceError("configuration-rewrite") from exc
    return PreparedRemediation(
        environment=rewritten,
        certificate_pem=ssl.DER_cert_to_PEM_cert(first_certificate).encode("ascii"),
        certificate_sha256=first_sha,
    )


def apply() -> str:
    if os.geteuid() != 0:
        raise SafeMaintenanceError("file-safety")
    try:
        _assert_root_directory(Path("/etc"))
        _assert_root_directory(Path("/etc/leaddrive"))
    except Exception as exc:
        raise SafeMaintenanceError("file-safety") from exc
    try:
        commissioned_invocation = _require_reviewed_invocation()
    except SafeMaintenanceError as exc:
        if exc.code.startswith("invocation-"):
            raise
        raise SafeMaintenanceError("invocation") from exc
    except Exception as exc:
        raise SafeMaintenanceError("invocation") from exc
    try:
        _require_backup_inactive()
    except Exception as exc:
        raise SafeMaintenanceError("scheduler") from exc
    try:
        lock_fd = _acquire_backup_lock(required=commissioned_invocation)
    except Exception as exc:
        raise SafeMaintenanceError("backup-lock") from exc
    try:
        try:
            environment, env_authority, config = read_environment()
        except SafeMaintenanceError as exc:
            if exc.code.startswith("configuration-read-"):
                raise
            raise SafeMaintenanceError("configuration-read") from exc
        except Exception as exc:
            raise SafeMaintenanceError("configuration-read") from exc
        try:
            ca_payload, ca_authority = _read_regular_file(
                CA_PATH, maximum_bytes=MAX_CA_BYTES, required=False
            )
            _require_no_extended_attributes(ENV_PATH)
            if ca_payload is not None:
                _require_no_extended_attributes(CA_PATH)
        except Exception as exc:
            raise SafeMaintenanceError("file-safety") from exc
        if SNAPSHOT_PATH.exists():
            raise SafeMaintenanceError("snapshot-present")
        prepared = _prepare(environment, config)
        try:
            state = _snapshot(environment, env_authority, ca_payload, ca_authority)
        except Exception as exc:
            raise SafeMaintenanceError("file-safety") from exc
        changed = False
        try:
            backup_gid = grp.getgrnam("leaddrive-backup").gr_gid
            changed = True
            _atomic_write(
                CA_PATH,
                prepared.certificate_pem,
                FileAuthority(uid=0, gid=backup_gid, mode=0o640),
            )
            _atomic_write(ENV_PATH, prepared.environment, env_authority)
            _, _, applied_config = read_environment()
            if applied_config["PGHOSTADDR"] == "":
                raise SafeMaintenanceError
            port = _normalize_port(applied_config["PGPORT"])
            observed, observed_route = _postgres_certificate(
                applied_config["PGHOSTADDR"], port
            )
            if hashlib.sha256(observed).hexdigest() != prepared.certificate_sha256:
                raise SafeMaintenanceError
            _verify_full(
                observed_route,
                port,
                applied_config["PGHOST"],
                observed,
            )
            _require_backup_inactive()
            state["phase"] = "applied"
            state["env_after_sha256"] = hashlib.sha256(prepared.environment).hexdigest()
            state["ca_after_sha256"] = hashlib.sha256(
                prepared.certificate_pem
            ).hexdigest()
            _write_state(state)
        except Exception as exc:
            rollback_failed = False
            if changed:
                try:
                    _restore_snapshot(state, require_post_state=False)
                    state["phase"] = "automatically-rolled-back"
                    _write_state(state)
                except Exception:
                    rollback_failed = True
            raise SafeMaintenanceError(
                "rollback" if rollback_failed else "post-write"
            ) from exc
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
    return "applied"


def rollback() -> str:
    if os.geteuid() != 0:
        raise SafeMaintenanceError
    _assert_root_directory(SNAPSHOT_PATH)
    commissioned_invocation = _require_reviewed_invocation()
    _require_backup_inactive()
    lock_fd = _acquire_backup_lock(required=commissioned_invocation)
    try:
        state = _load_state()
        _restore_snapshot(state, require_post_state=True)
        state["phase"] = "rolled-back"
        _write_state(state)
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
    return "rolled-back"


def main(arguments: list[str]) -> int:
    operation = arguments[0] if len(arguments) == 1 else "invalid"
    safe_operation = operation if operation in {"apply", "rollback"} else "unknown"
    try:
        if operation == "apply":
            status = apply()
        elif operation == "rollback":
            status = rollback()
        else:
            raise SafeMaintenanceError
    except SafeMaintenanceError as exc:
        print(
            f"source_tls_maintenance operation={safe_operation} status=failed "
            "pg_restart=no service_restart=no effective_verify_full=unknown "
            f"rollback_snapshot=unknown failure_stage={exc.code}"
        )
        return 1
    except Exception:
        print(
            f"source_tls_maintenance operation={safe_operation} status=failed "
            "pg_restart=no service_restart=no effective_verify_full=unknown "
            "rollback_snapshot=unknown failure_stage=internal"
        )
        return 1
    print(
        f"source_tls_maintenance operation={operation} status={status} "
        "pg_restart=no service_restart=no "
        f"effective_verify_full={'yes' if status == 'applied' else 'not-tested'} "
        "rollback_snapshot=retained failure_stage=none"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
