#!/usr/bin/env python3
"""Derive one inbound selector from agreeing station-local PJSIP fields.

The helper never accepts or prints the selector.  It reads live Asterisk CLI
reports in memory and succeeds only when one registered object has a numeric
``contact_user`` and ``client_uri`` user that both equal the provider
endpoint's ``from_user``.  The resulting root-local file is linked into place
atomically without overwriting any existing path.
"""

from __future__ import annotations

from collections.abc import Callable
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


PROVIDER_ENDPOINT = "fanum-provider"
SELECTOR_PATH = Path("/etc/fanum-inbound-browser.did")
SELECTOR_RE = re.compile(r"[0-9]{5,20}")
REGISTRATION_LINE_RE = re.compile(
    r"^\s*(?P<name>[A-Za-z0-9_.-]+)/sip:\S+.*\bRegistered\b\s*$",
    re.IGNORECASE,
)


class SelectorDiscoveryRefused(Exception):
    """The live PBX evidence is not singular and internally consistent."""


def _field_values(report: str, field: str) -> list[str]:
    pattern = re.compile(
        rf"^\s*{re.escape(field)}\s*:\s*(?P<value>.*?)\s*$",
        re.IGNORECASE,
    )
    values: list[str] = []
    for line in report.splitlines():
        match = pattern.fullmatch(line)
        if match:
            values.append(match.group("value"))
    return values


def _single_field(report: str, field: str, refusal: str) -> str:
    values = _field_values(report, field)
    if len(values) != 1:
        raise SelectorDiscoveryRefused(refusal)
    return values[0]


def discover_selector(run_cli: Callable[[str], str]) -> str:
    """Return the selector only when three independent live fields agree."""

    endpoint_report = run_cli(f"pjsip show endpoint {PROVIDER_ENDPOINT}")
    selector = _single_field(
        endpoint_report,
        "from_user",
        "provider endpoint must expose exactly one from_user field",
    )
    if not SELECTOR_RE.fullmatch(selector):
        raise SelectorDiscoveryRefused(
            "provider endpoint from_user is not a 5-20 digit selector",
        )

    registrations_report = run_cli("pjsip show registrations")
    registration_names = [
        match.group("name")
        for line in registrations_report.splitlines()
        if (match := REGISTRATION_LINE_RE.fullmatch(line))
    ]
    if len(registration_names) != 1:
        raise SelectorDiscoveryRefused(
            "exactly one registered PJSIP object is required",
        )

    registration_name = registration_names[0]
    registration_report = run_cli(
        f"pjsip show registration {registration_name}",
    )
    contact_user = _single_field(
        registration_report,
        "contact_user",
        "registered object must expose exactly one contact_user field",
    )
    client_uri = _single_field(
        registration_report,
        "client_uri",
        "registered object must expose exactly one client_uri field",
    )
    client_match = re.fullmatch(
        r"sips?:(?P<user>[^@;<>\s]+)@[^<>\s]+",
        client_uri,
        re.IGNORECASE,
    )
    if (
        contact_user != selector
        or client_match is None
        or client_match.group("user") != selector
    ):
        raise SelectorDiscoveryRefused(
            "registered contact_user, client_uri, and endpoint from_user disagree",
        )
    return selector


def write_selector_atomic(path: str | Path, selector: str) -> None:
    """Create one private LF-terminated selector without replacing a path."""

    if not SELECTOR_RE.fullmatch(selector):
        raise SelectorDiscoveryRefused("refusing to write an invalid selector")

    target = Path(path)
    if os.path.lexists(target):
        raise SelectorDiscoveryRefused("selector destination already exists")
    directory = target.parent
    try:
        directory_stat = directory.lstat()
    except OSError as error:
        raise SelectorDiscoveryRefused(
            "selector destination directory is unavailable",
        ) from error
    if not stat.S_ISDIR(directory_stat.st_mode) or directory.is_symlink():
        raise SelectorDiscoveryRefused(
            "selector destination directory has an unsafe type",
        )

    descriptor = -1
    temporary_path = ""
    try:
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=f".{target.name}.",
            dir=directory,
        )
        os.fchmod(descriptor, 0o600)
        if os.geteuid() == 0:
            os.fchown(descriptor, 0, 0)
        with os.fdopen(descriptor, "wb", closefd=True) as handle:
            descriptor = -1
            handle.write(selector.encode("ascii") + b"\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary_path, target)
        os.unlink(temporary_path)
        temporary_path = ""

        directory_descriptor = os.open(
            directory,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
        )
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except (OSError, UnicodeError) as error:
        raise SelectorDiscoveryRefused(
            "could not create the selector atomically",
        ) from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary_path and os.path.lexists(temporary_path):
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def run_asterisk(command: str) -> str:
    """Capture a fixed-shape Asterisk report without echoing either stream."""

    try:
        completed = subprocess.run(
            ["asterisk", "-rx", command],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="strict",
            timeout=20,
            check=False,
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "LC_ALL": "C",
                "LANG": "C",
            },
        )
    except (OSError, subprocess.SubprocessError, UnicodeError) as error:
        raise SelectorDiscoveryRefused(
            "could not read live PJSIP state",
        ) from error
    if completed.returncode != 0:
        raise SelectorDiscoveryRefused("Asterisk rejected a PJSIP state query")
    return completed.stdout


def main(arguments: list[str] | None = None) -> int:
    argv = sys.argv[1:] if arguments is None else arguments
    if argv:
        print(
            "fanum-inbound-selector-discover: takes no arguments",
            file=sys.stderr,
        )
        return 2
    if os.geteuid() != 0:
        print(
            "fanum-inbound-selector-discover: must run as root",
            file=sys.stderr,
        )
        return 1
    try:
        selector = discover_selector(run_asterisk)
        write_selector_atomic(SELECTOR_PATH, selector)
    except SelectorDiscoveryRefused as error:
        print(f"fanum-inbound-selector-discover: {error}", file=sys.stderr)
        return 1
    print(
        "station-local inbound selector derived from three matching PJSIP fields",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
