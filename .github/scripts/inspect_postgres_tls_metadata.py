#!/usr/bin/env python3
"""Emit only anonymized PostgreSQL endpoint and TLS metadata.

The production workflow streams this file to ``python3 -`` over SSH. It reads
seven allowlisted keys from the fixed backup environment without evaluating the
file, performs DNS/TCP/PostgreSQL TLS negotiation without authenticating, and
prints exactly two schema-constrained lines. Raw addresses, certificate names,
configuration values, credentials, URLs, and exception messages are never
written to stdout or stderr.
"""

from __future__ import annotations

import hashlib
import grp
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import stat
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


CONFIG_PATH = Path("/etc/leaddrive/backup.env")
SOURCE_CA_PATH = Path("/etc/leaddrive/managed-postgres-ca.crt")
CONFIG_KEYS = frozenset(
    {
        "PGHOST",
        "PGHOSTADDR",
        "PGPORT",
        "PGSSLMODE",
        "PGSSLROOTCERT",
        "VERIFY_PGHOST",
        "VERIFY_PGPORT",
    }
)
MAX_CONFIG_BYTES = 64 * 1024
CONNECT_TIMEOUT_SECONDS = 6
POSTGRES_SSL_REQUEST = struct.pack("!II", 8, 80877103)

PROVIDER_SUFFIXES = (
    (".postgres.database.azure.com", "azure-postgresql"),
    (".cloudsql.googleusercontent.com", "gcp-cloud-sql"),
    (".ondigitalocean.com", "digitalocean"),
    (".rds.amazonaws.com", "aws-rds"),
    (".aivencloud.com", "aiven"),
    (".pooler.supabase.com", "supabase"),
    (".supabase.com", "supabase"),
    (".supabase.co", "supabase"),
    (".neon.tech", "neon"),
    (".render.com", "render"),
    (".railway.app", "railway"),
    (".heroku.com", "heroku"),
    (".contaboserver.net", "contabo"),
)
PROVIDERS = frozenset(
    {
        "self-hosted",
        "azure-postgresql",
        "gcp-cloud-sql",
        "digitalocean",
        "aws-rds",
        "aiven",
        "supabase",
        "neon",
        "render",
        "railway",
        "heroku",
        "contabo",
        "unknown",
    }
)
ISSUER_VENDORS = frozenset(
    {
        "lets-encrypt",
        "digicert",
        "amazon-trust-services",
        "google-trust-services",
        "sectigo",
        "aiven",
        "digitalocean",
        "microsoft",
        "globalsign",
        "entrust",
        "other",
    }
)
TLS_STATES = frozenset(
    {
        "available",
        "not-supported",
        "unreachable",
        "handshake-failed",
        "protocol-error",
        "not-applicable",
        "not-tested",
    }
)
ADDRESS_TYPES = frozenset({"local", "private", "public", "unknown"})
MATCH_STATES = frozenset({"yes", "no", "unknown", "unavailable"})
BOOLEAN_STATES = frozenset({"yes", "no", "unavailable"})
SCRATCH_MECHANISMS = frozenset(
    {
        "separate-postgresql-cluster",
        "docker-compose",
        "docker",
        "custom-systemd",
        "ambiguous",
        "not-configured",
        "unknown",
    }
)
SCRATCH_DEFINITION_STATES = frozenset({"present", "absent", "unknown"})
SCRATCH_RUNTIME_STATES = frozenset(
    {"running", "stopped", "not-created", "absent", "unknown"}
)


class SafeDiagnosticError(Exception):
    """A deliberately message-free failure that cannot disclose input data."""


@dataclass(frozen=True)
class NormalizedHost:
    value: str
    kind: str
    address_type: str
    provider: str


@dataclass(frozen=True)
class CertificateMetadata:
    issuer: str
    san_dns: str
    san_ip: str
    san_wildcard: str
    san_endpoint_match: str
    fingerprint_prefix: str


@dataclass(frozen=True)
class EndpointResult:
    endpoint: str
    address_type: str
    provider: str
    port: str
    tls: str
    issuer: str
    san_dns: str
    san_ip: str
    san_wildcard: str
    san_endpoint_match: str
    fingerprint_prefix: str


@dataclass(frozen=True)
class SourceSanResult:
    dns_san_count: str
    san_matches_server_name: str
    san_resolves_local: str
    verify_full_at_source_endpoint: str
    verify_full_via_san_name: str
    client_hostaddr_configured: str
    effective_verify_full: str
    remediation_without_restart: str


@dataclass(frozen=True)
class ScratchLaunchResult:
    port: str
    launch_mechanism: str
    definition: str
    runtime_state: str
    cluster_probe: str
    docker_probe: str
    compose_probe: str
    systemd_probe: str


EMPTY_CERTIFICATE = CertificateMetadata(
    issuer="unavailable",
    san_dns="unavailable",
    san_ip="unavailable",
    san_wildcard="unavailable",
    san_endpoint_match="unavailable",
    fingerprint_prefix="unavailable",
)


def _trim_literal(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def read_static_config(path: Path, *, require_root: bool = True) -> dict[str, str]:
    """Read only allowlisted literal KEY=VALUE entries without shell evaluation."""

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise SafeDiagnosticError from exc

    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_CONFIG_BYTES:
            raise SafeDiagnosticError
        if require_root:
            mode = stat.S_IMODE(metadata.st_mode)
            try:
                backup_group = grp.getgrnam("leaddrive-backup").gr_gid
            except KeyError:
                backup_group = -1
            reviewed_authority = (
                metadata.st_uid == 0
                and (
                    (mode == 0o600 and metadata.st_gid == 0)
                    or (mode == 0o640 and metadata.st_gid == backup_group)
                )
            )
            if not reviewed_authority:
                raise SafeDiagnosticError

        payload = bytearray()
        while len(payload) <= MAX_CONFIG_BYTES:
            chunk = os.read(fd, min(8192, MAX_CONFIG_BYTES + 1 - len(payload)))
            if not chunk:
                break
            payload.extend(chunk)
        if len(payload) > MAX_CONFIG_BYTES:
            raise SafeDiagnosticError
    finally:
        os.close(fd)

    try:
        text = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise SafeDiagnosticError from exc

    found: dict[str, list[str]] = {key: [] for key in CONFIG_KEYS}
    assignment = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export") and len(line) > 6 and line[6].isspace():
            line = line[6:].strip()
        match = assignment.fullmatch(line)
        if not match or match.group(1) not in CONFIG_KEYS:
            continue
        found[match.group(1)].append(_trim_literal(match.group(2)))

    result: dict[str, str] = {}
    for key, values in found.items():
        if len(values) > 1:
            raise SafeDiagnosticError
        result[key] = values[0] if values else ""
    return result


def _classify_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    if address.is_loopback:
        return "local"
    if address.is_private or address.is_link_local:
        return "private"
    if address.is_global:
        return "public"
    return "unknown"


def _provider_for_domain(domain: str) -> str:
    lowered = domain.lower().rstrip(".")
    for suffix, provider in PROVIDER_SUFFIXES:
        if lowered == suffix[1:] or lowered.endswith(suffix):
            return provider
    return "unknown"


def _resolved_address_type(host: str) -> str:
    try:
        records = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return "unknown"

    classes: set[str] = set()
    for record in records:
        try:
            classes.add(_classify_ip(ipaddress.ip_address(record[4][0])))
        except ValueError:
            continue
    if "public" in classes:
        return "public"
    if classes and classes <= {"local"}:
        return "local"
    if classes and classes <= {"local", "private"} and "private" in classes:
        return "private"
    return "unknown"


def normalize_host(raw_host: str) -> NormalizedHost:
    if not raw_host or len(raw_host) > 253 or any(ord(char) < 33 for char in raw_host):
        raise SafeDiagnosticError
    if "://" in raw_host or "@" in raw_host:
        raise SafeDiagnosticError
    if raw_host.startswith("/"):
        return NormalizedHost(raw_host, "unix", "local", "self-hosted")

    candidate = raw_host
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        domain = candidate.rstrip(".").lower()
        labels = domain.split(".")
        if not domain or any(
            not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            for label in labels
        ):
            raise SafeDiagnosticError
        address_type = "local" if domain == "localhost" else _resolved_address_type(domain)
        provider = "self-hosted" if address_type == "local" else _provider_for_domain(domain)
        return NormalizedHost(domain, "dns", address_type, provider)

    address_type = _classify_ip(address)
    provider = "self-hosted" if address_type == "local" else "unknown"
    return NormalizedHost(candidate, "ip", address_type, provider)


def normalize_port(raw_port: str, *, allow_default: bool) -> tuple[int, str]:
    value = raw_port or ("5432" if allow_default else "")
    if not re.fullmatch(r"[0-9]{1,5}", value):
        raise SafeDiagnosticError
    port = int(value, 10)
    if port < 1 or port > 65535:
        raise SafeDiagnosticError
    return port, str(port)


def _postgres_tls_socket(
    host: NormalizedHost,
    port: int,
    context: ssl.SSLContext,
    *,
    server_name_override: str | None = None,
) -> tuple[str, ssl.SSLSocket | None]:
    try:
        connection = socket.create_connection(
            (host.value, port), timeout=CONNECT_TIMEOUT_SECONDS
        )
    except (OSError, UnicodeError):
        return "unreachable", None

    try:
        connection.settimeout(CONNECT_TIMEOUT_SECONDS)
        connection.sendall(POSTGRES_SSL_REQUEST)
        response = connection.recv(1)
        if response == b"N":
            connection.close()
            return "not-supported", None
        if response != b"S":
            connection.close()
            return "protocol-error", None
        server_name = (
            server_name_override
            if server_name_override is not None
            else (host.value if host.kind == "dns" else None)
        )
        secured = context.wrap_socket(connection, server_hostname=server_name)
        return "available", secured
    except (OSError, ssl.SSLError, ValueError):
        connection.close()
        return "handshake-failed", None


def _system_trusts_endpoint(host: NormalizedHost, port: int) -> bool:
    context = ssl.create_default_context()
    context.check_hostname = False
    state, secured = _postgres_tls_socket(host, port, context)
    if secured is not None:
        secured.close()
    return state == "available"


def _openssl_x509(certificate_der: bytes, arguments: Iterable[str]) -> str:
    executable = shutil.which("openssl", path="/usr/bin:/bin")
    if executable is None:
        return ""
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
    except (OSError, subprocess.SubprocessError):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="replace")


def _issuer_vendor(issuer: str) -> str:
    lowered = issuer.lower()
    mappings = (
        (("let's encrypt", "lets encrypt"), "lets-encrypt"),
        (("digicert",), "digicert"),
        (("amazon",), "amazon-trust-services"),
        (("google trust",), "google-trust-services"),
        (("sectigo", "comodo"), "sectigo"),
        (("aiven",), "aiven"),
        (("digitalocean",), "digitalocean"),
        (("microsoft",), "microsoft"),
        (("globalsign",), "globalsign"),
        (("entrust",), "entrust"),
    )
    for needles, vendor in mappings:
        if any(needle in lowered for needle in needles):
            return vendor
    return "other"


def _endpoint_matches_san(host: NormalizedHost, dns_names: list[str], ip_names: list[str]) -> str:
    if not dns_names and not ip_names:
        return "unknown"

    try:
        address = ipaddress.ip_address(host.value)
    except ValueError:
        endpoint_labels = host.value.lower().rstrip(".").split(".")
        for raw_pattern in dns_names:
            pattern_labels = raw_pattern.lower().rstrip(".").split(".")
            if pattern_labels == endpoint_labels:
                return "yes"
            if (
                pattern_labels
                and pattern_labels[0] == "*"
                and all("*" not in label for label in pattern_labels[1:])
                and len(pattern_labels) == len(endpoint_labels)
                and pattern_labels[1:] == endpoint_labels[1:]
            ):
                return "yes"
        return "no"

    for raw_ip in ip_names:
        try:
            if ipaddress.ip_address(raw_ip) == address:
                return "yes"
        except ValueError:
            continue
    return "no"


def certificate_metadata(
    certificate_der: bytes,
    host: NormalizedHost,
    *,
    system_trusted: bool,
) -> CertificateMetadata:
    fingerprint = hashlib.sha256(certificate_der).hexdigest()[:12]
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

    if issuer and subject and issuer == subject:
        issuer_class = "self-signed"
    elif issuer:
        vendor = _issuer_vendor(issuer)
        trust_class = "public-ca" if system_trusted else "private-or-untrusted"
        issuer_class = f"{trust_class}:{vendor}"
    else:
        issuer_class = "unavailable"

    san_text = _openssl_x509(certificate_der, ("-ext", "subjectAltName"))
    if not san_text:
        return CertificateMetadata(
            issuer=issuer_class,
            san_dns="unavailable",
            san_ip="unavailable",
            san_wildcard="unavailable",
            san_endpoint_match="unavailable",
            fingerprint_prefix=fingerprint,
        )

    dns_names = re.findall(r"DNS:([^,\s]+)", san_text)
    ip_names = re.findall(r"IP Address:([^,\s]+)", san_text)
    wildcard_count = sum(1 for name in dns_names if "*" in name)
    return CertificateMetadata(
        issuer=issuer_class,
        san_dns=str(len(dns_names)),
        san_ip=str(len(ip_names)),
        san_wildcard=str(wildcard_count),
        san_endpoint_match=_endpoint_matches_san(host, dns_names, ip_names),
        fingerprint_prefix=fingerprint,
    )


def _certificate_dns_sans(certificate_der: bytes) -> list[str]:
    san_text = _openssl_x509(certificate_der, ("-ext", "subjectAltName"))
    if not san_text:
        return []
    return re.findall(r"DNS:([^,\s]+)", san_text)


def _dns_pattern_matches(pattern: str, name: str) -> bool:
    pattern_labels = pattern.lower().rstrip(".").split(".")
    name_labels = name.lower().rstrip(".").split(".")
    if pattern_labels == name_labels:
        return True
    return bool(
        pattern_labels
        and pattern_labels[0] == "*"
        and all("*" not in label for label in pattern_labels[1:])
        and len(pattern_labels) == len(name_labels)
        and pattern_labels[1:] == name_labels[1:]
    )


def _production_server_names() -> list[str]:
    candidates: list[str] = []
    for value in (socket.gethostname(), socket.getfqdn()):
        normalized = value.strip().lower().rstrip(".")
        if normalized and normalized not in candidates:
            candidates.append(normalized)
    return candidates


def _local_interface_addresses() -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    addresses: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = {
        ipaddress.ip_address("127.0.0.1"),
        ipaddress.ip_address("::1"),
    }
    executable = shutil.which("ip", path="/usr/sbin:/usr/bin:/sbin:/bin")
    if executable is not None:
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
        except (OSError, subprocess.SubprocessError, UnicodeDecodeError, json.JSONDecodeError):
            pass

    return addresses


def _name_resolves_to_local(name: str) -> str:
    if "*" in name:
        return "no"
    try:
        records = socket.getaddrinfo(name, None, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return "no"
    local_addresses = _local_interface_addresses()
    for record in records:
        try:
            resolved = ipaddress.ip_address(record[4][0])
        except ValueError:
            continue
        if resolved.is_loopback or resolved in local_addresses:
            return "yes"
    return "no"


def _verify_full_with_presented_certificate(
    host: NormalizedHost,
    port: int,
    verification_name: str,
    certificate_der: bytes,
) -> str:
    try:
        context = ssl.create_default_context(
            cadata=ssl.DER_cert_to_PEM_cert(certificate_der)
        )
        context.check_hostname = True
        state, secured = _postgres_tls_socket(
            host,
            port,
            context,
            server_name_override=verification_name,
        )
    except (OSError, ssl.SSLError, ValueError):
        return "no"
    if secured is not None:
        secured.close()
    return "yes" if state == "available" else "no"


def _source_ca_matches(certificate_der: bytes, config: dict[str, str]) -> bool:
    if config.get("PGSSLMODE") != "verify-full":
        return False
    if config.get("PGSSLROOTCERT") != str(SOURCE_CA_PATH):
        return False
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(SOURCE_CA_PATH, flags)
    except OSError:
        return False
    try:
        metadata = os.fstat(fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0
            or metadata.st_size > 256 * 1024
            or stat.S_IMODE(metadata.st_mode) & 0o022
        ):
            return False
        payload = os.read(fd, 256 * 1024 + 1)
    finally:
        os.close(fd)
    expected = ssl.DER_cert_to_PEM_cert(certificate_der).encode("ascii").strip()
    return payload.strip() == expected


def inspect_source_san(config: dict[str, str]) -> SourceSanResult:
    unavailable = SourceSanResult(
        dns_san_count="unavailable",
        san_matches_server_name="unavailable",
        san_resolves_local="unavailable",
        verify_full_at_source_endpoint="unavailable",
        verify_full_via_san_name="unavailable",
        client_hostaddr_configured="unavailable",
        effective_verify_full="unavailable",
        remediation_without_restart="not-proven",
    )
    try:
        identity_host = normalize_host(config["PGHOST"])
        configured_hostaddr = config.get("PGHOSTADDR", "")
        route_host = normalize_host(configured_hostaddr or config["PGHOST"])
        port, _ = normalize_port(config["PGPORT"], allow_default=True)
    except (KeyError, SafeDiagnosticError):
        return unavailable
    if identity_host.kind == "unix" or route_host.kind == "unix":
        return unavailable

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    tls_state, secured = _postgres_tls_socket(route_host, port, context)
    if tls_state != "available" or secured is None:
        return unavailable
    try:
        certificate_der = secured.getpeercert(binary_form=True)
    except (OSError, ssl.SSLError, ValueError):
        return unavailable
    finally:
        secured.close()
    if not certificate_der:
        return unavailable

    dns_sans = _certificate_dns_sans(certificate_der)
    dns_count = str(len(dns_sans))
    if len(dns_sans) != 1:
        return SourceSanResult(
            dns_san_count=dns_count,
            san_matches_server_name="unavailable",
            san_resolves_local="unavailable",
            verify_full_at_source_endpoint="unavailable",
            verify_full_via_san_name="unavailable",
            client_hostaddr_configured=("yes" if configured_hostaddr else "no"),
            effective_verify_full="unavailable",
            remediation_without_restart="not-proven",
        )

    san = dns_sans[0]
    server_names = _production_server_names()
    matching_server_names = [name for name in server_names if _dns_pattern_matches(san, name)]
    matches_server_name = "yes" if matching_server_names else "no"
    verification_name = matching_server_names[0] if matching_server_names else san
    resolves_local = _name_resolves_to_local(verification_name)
    verifies_at_source = _verify_full_with_presented_certificate(
        route_host, port, verification_name, certificate_der
    )
    verifies_via_name = "unavailable"
    if resolves_local == "yes":
        try:
            verification_host = normalize_host(verification_name)
        except SafeDiagnosticError:
            verification_host = None
        if verification_host is not None:
            verifies_via_name = _verify_full_with_presented_certificate(
                verification_host, port, verification_name, certificate_der
            )
    client_hostaddr_configured = "yes" if configured_hostaddr else "no"
    effective_verify_full = "no"
    if identity_host.kind == "dns" and _source_ca_matches(certificate_der, config):
        effective_verify_full = _verify_full_with_presented_certificate(
            route_host, port, identity_host.value, certificate_der
        )
    if (
        matches_server_name == "yes"
        and resolves_local == "yes"
        and verifies_via_name == "yes"
    ):
        remediation = "direct-dns"
    elif (
        matches_server_name == "yes"
        and resolves_local == "yes"
        and verifies_at_source == "yes"
    ):
        remediation = "client-hostaddr-required"
    else:
        remediation = "not-proven"
    return SourceSanResult(
        dns_san_count=dns_count,
        san_matches_server_name=matches_server_name,
        san_resolves_local=resolves_local,
        verify_full_at_source_endpoint=verifies_at_source,
        verify_full_via_san_name=verifies_via_name,
        client_hostaddr_configured=client_hostaddr_configured,
        effective_verify_full=effective_verify_full,
        remediation_without_restart=remediation,
    )


def _run_read_only(arguments: list[str], *, timeout: int = 8) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            arguments,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "LC_ALL": "C",
            },
        )
    except (OSError, subprocess.SubprocessError):
        return False, ""
    return result.returncode == 0, result.stdout.decode("utf-8", errors="replace")


def _detect_postgresql_cluster(port: int) -> tuple[bool, str, bool]:
    executable = shutil.which("pg_lsclusters", path="/usr/bin:/bin")
    command_succeeded = False
    if executable is not None:
        success, output = _run_read_only([executable, "--no-header"])
        if success:
            command_succeeded = True
            for line in output.splitlines():
                fields = line.split(None, 4)
                if len(fields) >= 4 and fields[2] == str(port):
                    state = "running" if fields[3] == "online" else "stopped"
                    return True, state, True

    root = Path("/etc/postgresql")
    try:
        candidates = list(root.glob("*/*/postgresql.conf")) if root.is_dir() else []
    except OSError:
        return False, "unknown", command_succeeded
    port_pattern = re.compile(rf"^\s*port\s*=\s*{port}(?:\s|#|$)", re.MULTILINE)
    for candidate in candidates[:64]:
        try:
            if candidate.is_symlink() or candidate.stat().st_size > 1024 * 1024:
                continue
            contents = candidate.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeDecodeError):
            continue
        if port_pattern.search(contents):
            return True, "stopped", True
    if executable is None:
        return False, "absent", True
    return False, "absent", command_succeeded or root.exists()


def _detect_docker(port: int) -> tuple[set[str], list[str], bool]:
    executable = shutil.which("docker", path="/usr/bin:/usr/local/bin:/bin")
    if executable is None:
        return set(), [], True
    success, identifiers = _run_read_only([executable, "ps", "-aq"])
    if not success:
        return set(), [], False

    mechanisms: set[str] = set()
    states: list[str] = []
    inspection_complete = True
    for identifier in identifiers.splitlines()[:256]:
        if not re.fullmatch(r"[0-9a-f]{12,64}", identifier):
            inspection_complete = False
            continue
        inspected, payload = _run_read_only([executable, "inspect", identifier])
        if not inspected:
            inspection_complete = False
            continue
        try:
            entries = json.loads(payload)
            entry = entries[0]
            bindings = entry.get("HostConfig", {}).get("PortBindings", {}) or {}
            labels = entry.get("Config", {}).get("Labels", {}) or {}
            running = bool(entry.get("State", {}).get("Running"))
        except (IndexError, KeyError, TypeError, json.JSONDecodeError):
            inspection_complete = False
            continue
        matched = any(
            isinstance(binding, dict) and binding.get("HostPort") == str(port)
            for values in bindings.values()
            for binding in (values or [])
        )
        if not matched:
            continue
        mechanisms.add(
            "docker-compose" if "com.docker.compose.project" in labels else "docker"
        )
        states.append("running" if running else "stopped")
    if len(identifiers.splitlines()) > 256:
        inspection_complete = False
    return mechanisms, states, inspection_complete


def _compose_definition_exists(port: int) -> tuple[bool, bool]:
    roots = (
        Path("/etc/leaddrive"),
        Path("/opt/leaddrive-v2"),
        Path("/usr/local/lib/leaddrive-v2"),
    )
    inspected_any = True
    inspected_files = 0
    inspected_directories = 0
    scan_errors: list[OSError] = []
    excluded_directories = frozenset(
        {".git", ".next", "node_modules", "releases", "tmp", "var"}
    )
    port_pattern = re.compile(rf"(?<![0-9]){port}(?![0-9])")
    for root in roots:
        if not root.is_dir():
            continue
        try:
            walker = os.walk(root, followlinks=False, onerror=scan_errors.append)
            for directory, subdirectories, filenames in walker:
                inspected_directories += 1
                if inspected_directories > 512:
                    return False, False
                subdirectories[:] = [
                    name
                    for name in subdirectories
                    if name not in excluded_directories
                    and not Path(directory, name).is_symlink()
                ]
                relative_depth = len(Path(directory).relative_to(root).parts)
                if relative_depth >= 5:
                    subdirectories[:] = []
                for filename in filenames:
                    lowered = filename.lower()
                    if not (
                        lowered
                        in {
                            "compose.yml",
                            "compose.yaml",
                            "docker-compose.yml",
                            "docker-compose.yaml",
                        }
                        or lowered.startswith("docker-compose.")
                    ):
                        continue
                    inspected_files += 1
                    if inspected_files > 128:
                        return False, False
                    candidate = Path(directory, filename)
                    try:
                        if candidate.is_symlink() or candidate.stat().st_size > 1024 * 1024:
                            continue
                        contents = candidate.read_text(encoding="utf-8", errors="strict")
                    except (OSError, UnicodeDecodeError):
                        continue
                    lowered_contents = contents.lower()
                    if "postgres" in lowered_contents and (
                        port_pattern.search(contents) or "verify_pgport" in lowered_contents
                    ):
                        return True, True
        except OSError:
            scan_errors.append(OSError())
    return False, inspected_any and not scan_errors


def _detect_custom_systemd(port: int) -> tuple[bool, str, bool]:
    executable = shutil.which("systemctl", path="/usr/bin:/bin")
    if executable is None:
        return False, "absent", True
    success, units = _run_read_only(
        [executable, "list-unit-files", "--type=service", "--no-legend", "--no-pager"]
    )
    if not success:
        return False, "unknown", False
    inspection_complete = True
    port_pattern = re.compile(rf"(?<![0-9]){port}(?![0-9])")
    for line in units.splitlines():
        fields = line.split()
        if not fields:
            continue
        unit = fields[0]
        lowered_unit = unit.lower()
        if not any(
            token in lowered_unit
            for token in ("postgres", "scratch", "restore", "leaddrive")
        ):
            continue
        inspected, fragment = _run_read_only([executable, "cat", unit])
        if not inspected:
            inspection_complete = False
            continue
        lowered_fragment = fragment.lower()
        if not (
            (port_pattern.search(fragment) or "verify_pgport" in lowered_fragment)
            and "postgres" in lowered_fragment
        ):
            continue
        active, _ = _run_read_only([executable, "is-active", "--quiet", unit])
        return True, "running" if active else "stopped", True
    return False, "absent", inspection_complete


def inspect_scratch_launch(config: dict[str, str]) -> ScratchLaunchResult:
    try:
        port, printable_port = normalize_port(
            config["VERIFY_PGPORT"], allow_default=False
        )
    except (KeyError, SafeDiagnosticError):
        return ScratchLaunchResult(
            "invalid",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
            "unknown",
        )

    mechanisms: set[str] = set()
    states: list[str] = []
    inspections: list[bool] = []

    cluster_found, cluster_state, cluster_inspected = _detect_postgresql_cluster(port)
    inspections.append(cluster_inspected)
    if cluster_found:
        mechanisms.add("separate-postgresql-cluster")
        states.append(cluster_state)

    docker_mechanisms, docker_states, docker_inspected = _detect_docker(port)
    inspections.append(docker_inspected)
    mechanisms.update(docker_mechanisms)
    states.extend(docker_states)

    compose_found, compose_inspected = _compose_definition_exists(port)
    inspections.append(compose_inspected)
    if compose_found:
        mechanisms.add("docker-compose")
        if "docker-compose" not in docker_mechanisms:
            states.append("not-created")

    systemd_found, systemd_state, systemd_inspected = _detect_custom_systemd(port)
    inspections.append(systemd_inspected)
    if systemd_found and not cluster_found:
        mechanisms.add("custom-systemd")
        states.append(systemd_state)

    if len(mechanisms) > 1:
        mechanism = "ambiguous"
    elif mechanisms:
        mechanism = next(iter(mechanisms))
    elif all(inspections):
        mechanism = "not-configured"
    else:
        mechanism = "unknown"

    definition = (
        "present"
        if mechanisms
        else ("absent" if mechanism == "not-configured" else "unknown")
    )
    if "running" in states:
        runtime_state = "running"
    elif "stopped" in states:
        runtime_state = "stopped"
    elif "not-created" in states:
        runtime_state = "not-created"
    elif mechanism == "not-configured":
        runtime_state = "absent"
    else:
        runtime_state = "unknown"
    def probe_state(found: bool, inspected: bool) -> str:
        return "present" if found else ("absent" if inspected else "unknown")

    return ScratchLaunchResult(
        printable_port,
        mechanism,
        definition,
        runtime_state,
        probe_state(cluster_found, cluster_inspected),
        probe_state(bool(docker_mechanisms), docker_inspected),
        probe_state(compose_found, compose_inspected),
        probe_state(systemd_found, systemd_inspected),
    )


def inspect_endpoint(endpoint: str, raw_host: str, raw_port: str) -> EndpointResult:
    try:
        host = normalize_host(raw_host)
        port, printable_port = normalize_port(
            raw_port, allow_default=endpoint == "source"
        )
    except SafeDiagnosticError:
        return empty_result(endpoint)

    if host.kind == "unix":
        return EndpointResult(
            endpoint=endpoint,
            address_type=host.address_type,
            provider=host.provider,
            port=printable_port,
            tls="not-applicable",
            issuer=EMPTY_CERTIFICATE.issuer,
            san_dns=EMPTY_CERTIFICATE.san_dns,
            san_ip=EMPTY_CERTIFICATE.san_ip,
            san_wildcard=EMPTY_CERTIFICATE.san_wildcard,
            san_endpoint_match=EMPTY_CERTIFICATE.san_endpoint_match,
            fingerprint_prefix=EMPTY_CERTIFICATE.fingerprint_prefix,
        )

    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    tls_state, secured = _postgres_tls_socket(host, port, context)
    metadata = EMPTY_CERTIFICATE
    if secured is not None:
        try:
            certificate_der = secured.getpeercert(binary_form=True)
        except (OSError, ssl.SSLError, ValueError):
            certificate_der = None
        finally:
            secured.close()
        if certificate_der:
            metadata = certificate_metadata(
                certificate_der,
                host,
                system_trusted=_system_trusts_endpoint(host, port),
            )

    return EndpointResult(
        endpoint=endpoint,
        address_type=host.address_type,
        provider=host.provider,
        port=printable_port,
        tls=tls_state,
        issuer=metadata.issuer,
        san_dns=metadata.san_dns,
        san_ip=metadata.san_ip,
        san_wildcard=metadata.san_wildcard,
        san_endpoint_match=metadata.san_endpoint_match,
        fingerprint_prefix=metadata.fingerprint_prefix,
    )


def empty_result(endpoint: str) -> EndpointResult:
    return EndpointResult(
        endpoint=endpoint,
        address_type="unknown",
        provider="unknown",
        port="invalid",
        tls="not-tested",
        issuer=EMPTY_CERTIFICATE.issuer,
        san_dns=EMPTY_CERTIFICATE.san_dns,
        san_ip=EMPTY_CERTIFICATE.san_ip,
        san_wildcard=EMPTY_CERTIFICATE.san_wildcard,
        san_endpoint_match=EMPTY_CERTIFICATE.san_endpoint_match,
        fingerprint_prefix=EMPTY_CERTIFICATE.fingerprint_prefix,
    )


def _valid_count(value: str) -> bool:
    return value == "unavailable" or bool(re.fullmatch(r"[0-9]+", value))


def format_result(result: EndpointResult) -> str:
    if result.endpoint not in {"source", "restore-scratch"}:
        raise SafeDiagnosticError
    if result.address_type not in ADDRESS_TYPES or result.provider not in PROVIDERS:
        raise SafeDiagnosticError
    if result.tls not in TLS_STATES or result.san_endpoint_match not in MATCH_STATES:
        raise SafeDiagnosticError
    if result.port != "invalid":
        if not result.port.isdigit() or not 1 <= int(result.port, 10) <= 65535:
            raise SafeDiagnosticError
    if not all(_valid_count(value) for value in (result.san_dns, result.san_ip, result.san_wildcard)):
        raise SafeDiagnosticError
    issuer_valid = result.issuer in {"self-signed", "unavailable"}
    if not issuer_valid and ":" in result.issuer:
        trust_class, vendor = result.issuer.split(":", 1)
        issuer_valid = trust_class in {"public-ca", "private-or-untrusted"} and vendor in ISSUER_VENDORS
    if not issuer_valid:
        raise SafeDiagnosticError
    if result.fingerprint_prefix != "unavailable" and not re.fullmatch(
        r"[0-9a-f]{12}", result.fingerprint_prefix
    ):
        raise SafeDiagnosticError

    return (
        f"endpoint={result.endpoint} "
        f"address_type={result.address_type} "
        f"provider={result.provider} "
        f"port={result.port} "
        f"tls={result.tls} "
        f"issuer={result.issuer} "
        f"san_dns={result.san_dns} "
        f"san_ip={result.san_ip} "
        f"san_wildcard={result.san_wildcard} "
        f"san_endpoint_match={result.san_endpoint_match} "
        f"fingerprint_sha256_prefix={result.fingerprint_prefix}"
    )


def empty_source_san_result() -> SourceSanResult:
    return SourceSanResult(
        dns_san_count="unavailable",
        san_matches_server_name="unavailable",
        san_resolves_local="unavailable",
        verify_full_at_source_endpoint="unavailable",
        verify_full_via_san_name="unavailable",
        client_hostaddr_configured="unavailable",
        effective_verify_full="unavailable",
        remediation_without_restart="not-proven",
    )


def empty_scratch_launch_result() -> ScratchLaunchResult:
    return ScratchLaunchResult(
        port="invalid",
        launch_mechanism="unknown",
        definition="unknown",
        runtime_state="unknown",
        cluster_probe="unknown",
        docker_probe="unknown",
        compose_probe="unknown",
        systemd_probe="unknown",
    )


def format_source_san_result(result: SourceSanResult) -> str:
    if not _valid_count(result.dns_san_count):
        raise SafeDiagnosticError
    if any(
        value not in BOOLEAN_STATES
        for value in (
            result.san_matches_server_name,
            result.san_resolves_local,
            result.verify_full_at_source_endpoint,
            result.verify_full_via_san_name,
            result.client_hostaddr_configured,
            result.effective_verify_full,
        )
    ):
        raise SafeDiagnosticError
    if result.remediation_without_restart not in {
        "direct-dns",
        "client-hostaddr-required",
        "not-proven",
    }:
        raise SafeDiagnosticError
    return (
        f"source_san dns_san_count={result.dns_san_count} "
        f"san_matches_server_name={result.san_matches_server_name} "
        f"san_resolves_local={result.san_resolves_local} "
        "verify_full_at_source_endpoint="
        f"{result.verify_full_at_source_endpoint} "
        f"verify_full_via_san_name={result.verify_full_via_san_name} "
        f"client_hostaddr_configured={result.client_hostaddr_configured} "
        f"effective_verify_full={result.effective_verify_full} "
        "remediation_without_postgres_restart="
        f"{result.remediation_without_restart}"
    )


def format_scratch_launch_result(result: ScratchLaunchResult) -> str:
    if result.port != "invalid":
        if not result.port.isdigit() or not 1 <= int(result.port, 10) <= 65535:
            raise SafeDiagnosticError
    if result.launch_mechanism not in SCRATCH_MECHANISMS:
        raise SafeDiagnosticError
    if result.definition not in SCRATCH_DEFINITION_STATES:
        raise SafeDiagnosticError
    if result.runtime_state not in SCRATCH_RUNTIME_STATES:
        raise SafeDiagnosticError
    if any(
        value not in SCRATCH_DEFINITION_STATES
        for value in (
            result.cluster_probe,
            result.docker_probe,
            result.compose_probe,
            result.systemd_probe,
        )
    ):
        raise SafeDiagnosticError
    return (
        f"scratch port={result.port} "
        f"launch_mechanism={result.launch_mechanism} "
        f"definition={result.definition} "
        f"runtime_state={result.runtime_state} "
        f"cluster_probe={result.cluster_probe} "
        f"docker_probe={result.docker_probe} "
        f"compose_probe={result.compose_probe} "
        f"systemd_probe={result.systemd_probe}"
    )


def main() -> int:
    try:
        config = read_static_config(CONFIG_PATH)
    except Exception:
        results = (empty_result("source"), empty_result("restore-scratch"))
        for result in results:
            print(format_result(result))
        return 1

    try:
        results = (
            inspect_endpoint(
                "source", config.get("PGHOSTADDR") or config["PGHOST"], config["PGPORT"]
            ),
            inspect_endpoint(
                "restore-scratch", config["VERIFY_PGHOST"], config["VERIFY_PGPORT"]
            ),
        )
    except Exception:
        results = (empty_result("source"), empty_result("restore-scratch"))
        status = 1
    else:
        status = 0

    try:
        for result in results:
            print(format_result(result))
    except Exception:
        return 1
    return status


def san_scratch_main() -> int:
    try:
        config = read_static_config(CONFIG_PATH)
    except Exception:
        results = (empty_source_san_result(), empty_scratch_launch_result())
        status = 1
    else:
        try:
            results = (inspect_source_san(config), inspect_scratch_launch(config))
        except Exception:
            results = (empty_source_san_result(), empty_scratch_launch_result())
            status = 1
        else:
            status = 0

    try:
        print(format_source_san_result(results[0]))
        print(format_scratch_launch_result(results[1]))
    except Exception:
        return 1
    return status


def dispatch_main(arguments: list[str]) -> int:
    if not arguments:
        return main()
    if arguments == ["san-scratch-audit"]:
        return san_scratch_main()
    return 1


if __name__ == "__main__":
    sys.exit(dispatch_main(sys.argv[1:]))
