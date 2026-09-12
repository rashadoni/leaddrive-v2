#!/usr/bin/env python3
"""Emit only anonymized PostgreSQL endpoint and TLS metadata.

The production workflow streams this file to ``python3 -`` over SSH. It reads
four allowlisted keys from the fixed backup environment without evaluating the
file, performs DNS/TCP/PostgreSQL TLS negotiation without authenticating, and
prints exactly two schema-constrained lines. Raw addresses, certificate names,
configuration values, credentials, URLs, and exception messages are never
written to stdout or stderr.
"""

from __future__ import annotations

import hashlib
import grp
import ipaddress
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
CONFIG_KEYS = frozenset({"PGHOST", "PGPORT", "VERIFY_PGHOST", "VERIFY_PGPORT"})
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
        server_name = host.value if host.kind == "dns" else None
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
            inspect_endpoint("source", config["PGHOST"], config["PGPORT"]),
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


if __name__ == "__main__":
    sys.exit(main())
