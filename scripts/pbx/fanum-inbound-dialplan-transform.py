#!/usr/bin/env python3
"""Add one station-selected exact inbound route beside a reviewed wildcard.

The selector is read from a station-local file and is never printed.  The
provider's five-step wildcard remains byte-for-byte intact; only one exact
extension is inserted, and it passes a fixed non-sensitive alias to LeadDrive.
"""

from __future__ import annotations

from pathlib import Path
import re
import sys


PROVIDER_CONTEXT = "from-fanum-provider"
DESTINATION_ALIAS = "fanum-inbound-browser"
TARGET_APPLICATION = f"Gosub(fanum-inbound-browser,s,1({DESTINATION_ALIAS}))"
PROVIDER_SOURCE = "extensions_fanum.conf"

SELECTOR_BYTES_RE = re.compile(rb"[0-9]{5,20}\n")
SELECTOR_TEXT_RE = re.compile(r"[0-9]{5,20}")
REVIEWED_WILDCARD_PATTERN = "_X."
REVIEWED_WILDCARD_APPLICATIONS = (
    "NoOp(Fanum provider catch-all)",
    "Set(CHANNEL(language)=az)",
    "Set(DENOISE(rx)=on)",
    "Set(AGC(rx)=5000)",
    "Hangup()",
)
SECTION_RE = re.compile(r"^\s*\[([^]]+)]\s*(?:;[^\r\n]*)?(?:\r?\n)?$")
SOURCE_EXTEN_RE = re.compile(
    r"^\s*exten\s*=>\s*(?P<extension>[^,;\s]+)\s*,\s*"
    r"(?P<priority>[^,;\s]+)\s*,\s*"
    r"(?P<application>[^;\r\n]+?)(?:\s*;[^\r\n]*)?(?:\r?\n)?$",
    re.IGNORECASE,
)
SOURCE_SAME_RE = re.compile(
    r"^\s*same\s*=>\s*(?P<priority>[^,;\s]+)\s*,\s*"
    r"(?P<application>[^;\r\n]+?)(?:\s*;[^\r\n]*)?(?:\r?\n)?$",
    re.IGNORECASE,
)

LOADED_CONTEXT_HEADER_RE = re.compile(
    r"^\s*\[ Context '([^']+)' created by '([^']+)' ]\s*$",
)
LOADED_PRIORITY_RE = re.compile(
    r"^\s*(?:(?:'(?P<extension>[^']+)'\s*=>)|"
    r"(?:\[(?P<label>[A-Za-z0-9_.-]+)]))?\s*"
    r"(?P<priority>[1-9][0-9]*)\.\s*"
    r"(?P<application>.+)\s+"
    r"\[(?P<source>[^][:\s]+):(?P<line>[1-9][0-9]*)]\s*$",
)
PROVIDER_SUMMARY_RE = re.compile(
    r"^\s*-=\s*2 extensions \(6 priorities\) in 1 context\.\s*=-\s*$",
    re.IGNORECASE,
)

BROWSER_CONTEXT = "fanum-inbound-browser"
TERMINAL_CONTEXT = "fanum-inbound-browser-terminal"
LOADED_SOURCE = "fanum-inbound-browser.conf"

BROWSER_PRIORITIES = (
    ("NoOp(Fanum inbound browser gate)", 9),
    ("Set(__FANUM_SAFE_CALL_ID=)", 10),
    (
        "AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,identify)",
        11,
    ),
    (
        'GotoIf($["${AGISTATUS}" = "SUCCESS"]?agi-succeeded:invalid-id)',
        12,
    ),
    (
        "GotoIf($[${LEN(${FANUM_SAFE_CALL_ID})} = 36]?identified:invalid-id)",
        13,
    ),
    ("Set(__FANUM_INBOUND_TERMINAL_STATE=no_answer)", 14),
    ("Set(CHANNEL(hangup_handler_push)=fanum-inbound-browser-terminal,s,1)", 15),
    ("Ringing()", 16),
    ("Set(FANUM_INBOUND_EVENT_OK=0)", 17),
    (
        "AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,"
        "ringing,${FANUM_SAFE_CALL_ID},${ARG1})",
        18,
    ),
    (
        'GotoIf($["${FANUM_INBOUND_EVENT_OK}" = "1"]?'
        "await-browser:registration-failed)",
        19,
    ),
    ("Set(FANUM_BROWSER_READY=0)", 20),
    (
        "AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,"
        "ready,${FANUM_SAFE_CALL_ID})",
        21,
    ),
    ('GotoIf($["${FANUM_BROWSER_READY}" = "1"]?answer:missed)', 22),
    ("Answer()", 23),
    ("Set(__FANUM_INBOUND_TERMINAL_STATE=connected)", 24),
    (
        "AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,"
        "answered,${FANUM_SAFE_CALL_ID})",
        27,
    ),
    ("Set(CHANNEL(language)=az)", 28),
    ("Set(DENOISE(rx)=on)", 29),
    ("Set(AGC(rx)=5000)", 30),
    ("AudioSocket(${FANUM_SAFE_CALL_ID},127.0.0.1:9093)", 31),
    ("Hangup()", 32),
    ("Hangup()", 33),
    ("Set(__FANUM_INBOUND_TERMINAL_STATE=failed)", 34),
    ("Hangup()", 35),
    ("Hangup()", 36),
)

TERMINAL_PRIORITIES = (
    ("NoOp(Fanum inbound browser terminal event)", 39),
    (
        'ExecIf($["${CDR(answer)}" != ""]?'
        "Set(FANUM_INBOUND_TERMINAL_STATE=connected))",
        42,
    ),
    ("Set(FANUM_INBOUND_DURATION=0)", 43),
    (
        'ExecIf($["${FANUM_INBOUND_TERMINAL_STATE}" = "connected"]?'
        "Set(FANUM_INBOUND_DURATION=${CDR(billsec)}))",
        44,
    ),
    (
        'ExecIf($["${FANUM_INBOUND_DURATION}" = ""]?'
        "Set(FANUM_INBOUND_DURATION=0))",
        45,
    ),
    (
        "AGI(/usr/local/lib/fanum-voice/fanum-inbound-browser-agi.py,"
        "terminal,${FANUM_SAFE_CALL_ID},${FANUM_INBOUND_TERMINAL_STATE},"
        "${FANUM_INBOUND_DURATION})",
        46,
    ),
    ("Return()", 47),
)

BROWSER_PRIORITY_LABELS = {
    5: "agi-succeeded",
    6: "identified",
    12: "await-browser",
    15: "answer",
    23: "missed",
    24: "registration-failed",
    26: "invalid-id",
}


class DialplanRefused(Exception):
    pass


def _checked_selector(value: str) -> str:
    if not SELECTOR_TEXT_RE.fullmatch(value):
        raise DialplanRefused("selector is invalid")
    return value


def read_selector(path: str | Path) -> str:
    raw = Path(path).read_bytes()
    if not SELECTOR_BYTES_RE.fullmatch(raw):
        raise DialplanRefused("selector file is invalid")
    return raw[:-1].decode("ascii")


def _provider_section(
    lines: list[str],
) -> tuple[int, int, list[tuple[int, str]]]:
    context_starts: list[int] = []
    headers: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = SECTION_RE.fullmatch(line)
        if not match:
            continue
        name = match.group(1).strip()
        headers.append((index, name))
        if name == PROVIDER_CONTEXT:
            context_starts.append(index)
    if len(context_starts) != 1:
        raise DialplanRefused("provider context must occur exactly once")

    start = context_starts[0]
    end = len(lines)
    for index, _name in headers:
        if index > start:
            end = index
            break

    active: list[tuple[int, str]] = []
    for index in range(start + 1, end):
        stripped = lines[index].strip()
        if not stripped or stripped.startswith(";"):
            continue
        active.append((index, lines[index]))
    return start, end, active


def _source_directive(line: str) -> tuple[str, str | None, str, str]:
    match = SOURCE_EXTEN_RE.fullmatch(line)
    if match:
        return (
            "exten",
            match.group("extension"),
            match.group("priority"),
            match.group("application").strip(),
        )
    match = SOURCE_SAME_RE.fullmatch(line)
    if match:
        return (
            "same",
            None,
            match.group("priority"),
            match.group("application").strip(),
        )
    raise DialplanRefused("provider context contains an unknown directive")


def _review_applications(applications: list[str]) -> None:
    if tuple(applications) != REVIEWED_WILDCARD_APPLICATIONS:
        raise DialplanRefused("provider wildcard applications are unexpected")


def _review_wildcard(directives: list[tuple[int, str]]) -> str:
    if len(directives) != 5:
        raise DialplanRefused("provider context must contain five wildcard directives")
    parsed = [_source_directive(line) for _index, line in directives]
    form, extension, priority, _application = parsed[0]
    if (
        form != "exten"
        or extension is None
        or extension != REVIEWED_WILDCARD_PATTERN
        or priority != "1"
    ):
        raise DialplanRefused("provider wildcard entry is unexpected")
    for next_form, next_extension, next_priority, _next_application in parsed[1:]:
        if next_form != "same" or next_extension is not None or next_priority.lower() != "n":
            raise DialplanRefused("provider wildcard priority chain is unexpected")
    _review_applications([application for _form, _extension, _priority, application in parsed])
    return extension


def _review_exact(directive: tuple[int, str], selector: str) -> None:
    form, extension, priority, application = _source_directive(directive[1])
    if (
        form != "exten"
        or extension != selector
        or priority != "1"
        or application != TARGET_APPLICATION
    ):
        raise DialplanRefused("installed exact route is unexpected")


def install_route(source: str, selector: str) -> str:
    selector = _checked_selector(selector)
    lines = source.splitlines(keepends=True)
    _start, end, directives = _provider_section(lines)
    _review_wildcard(directives)

    endings = {
        "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
        for _index, line in directives
    }
    if len(endings) != 1 or "" in endings:
        raise DialplanRefused("provider wildcard line endings are unexpected")
    newline = endings.pop()
    exact_route = f"exten => {selector},1,{TARGET_APPLICATION}{newline}"
    lines.insert(end, exact_route)
    return "".join(lines)


def verify_installed_route(source: str, selector: str) -> None:
    selector = _checked_selector(selector)
    lines = source.splitlines(keepends=True)
    _start, _end, directives = _provider_section(lines)
    if len(directives) != 6:
        raise DialplanRefused("installed provider cardinality is unexpected")
    _review_wildcard(directives[:5])
    _review_exact(directives[5], selector)


def _loaded_provider_routes(
    report: str,
) -> dict[str, list[tuple[int, str, str, int]]]:
    header = "[ Context 'from-fanum-provider' created by 'pbx_config' ]"
    if report.count(header) != 1:
        raise DialplanRefused("loaded provider context header is unexpected")

    routes: dict[str, list[tuple[int, str, str, int]]] = {}
    current_extension: str | None = None
    summary_count = 0
    for line in report.splitlines():
        if not line.strip() or line.strip() == header:
            continue
        if PROVIDER_SUMMARY_RE.fullmatch(line):
            summary_count += 1
            continue
        if re.match(r"^\s*Include\s*=>", line, re.IGNORECASE):
            raise DialplanRefused("loaded provider context contains an include")
        match = LOADED_PRIORITY_RE.fullmatch(line)
        if not match or match.group("label") is not None:
            raise DialplanRefused("loaded provider context contains an unknown directive")
        extension = match.group("extension")
        if extension is not None:
            if extension in routes:
                raise DialplanRefused("loaded provider extension is duplicated")
            current_extension = extension
            routes[current_extension] = []
        if current_extension is None:
            raise DialplanRefused("loaded provider priority has no extension")
        routes[current_extension].append(
            (
                int(match.group("priority"), 10),
                match.group("application").rstrip(),
                match.group("source"),
                int(match.group("line"), 10),
            ),
        )
    if summary_count != 1:
        raise DialplanRefused("loaded provider context summary is unexpected")
    return routes


def verify_loaded_context(report: str, selector: str) -> None:
    """Verify the effective exact selector and preserved wildcard after reload."""
    selector = _checked_selector(selector)
    routes = _loaded_provider_routes(report)
    if len(routes) != 2 or selector not in routes:
        raise DialplanRefused("loaded provider route cardinality is unexpected")
    wildcard_extensions = [extension for extension in routes if extension.startswith("_")]
    if wildcard_extensions != [REVIEWED_WILDCARD_PATTERN]:
        raise DialplanRefused("loaded provider wildcard is unexpected")

    exact = routes[selector]
    if (
        len(exact) != 1
        or exact[0][0] != 1
        or exact[0][2] != PROVIDER_SOURCE
        or exact[0][1] != TARGET_APPLICATION
    ):
        raise DialplanRefused("loaded exact provider route is unexpected")

    wildcard = routes[wildcard_extensions[0]]
    if (
        [priority for priority, _application, _source, _line in wildcard]
        != [1, 2, 3, 4, 5]
        or any(source != PROVIDER_SOURCE for _priority, _application, source, _line in wildcard)
    ):
        raise DialplanRefused("loaded provider wildcard priorities are unexpected")
    _review_applications(
        [application for _priority, application, _source, _line in wildcard],
    )


def _loaded_context_sections(report: str) -> dict[str, list[str]]:
    lines = report.splitlines()
    headers: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = LOADED_CONTEXT_HEADER_RE.fullmatch(line)
        if match:
            if match.group(2) != "pbx_config":
                raise DialplanRefused("loaded browser context registrar is unexpected")
            headers.append((index, match.group(1)))

    required = {BROWSER_CONTEXT, TERMINAL_CONTEXT}
    if len(headers) != 2 or {name for _index, name in headers} != required:
        raise DialplanRefused("loaded browser contexts must occur exactly once")

    sections: dict[str, list[str]] = {}
    for position, (start, name) in enumerate(headers):
        end = headers[position + 1][0] if position + 1 < len(headers) else len(lines)
        sections[name] = lines[start + 1:end]
    return sections


def _verify_loaded_priority_sequence(
    context: str,
    lines: list[str],
    expected: tuple[tuple[str, int], ...],
    expected_labels: dict[int, str],
) -> None:
    priorities: list[tuple[int, str | None, str, str, int]] = []
    summary_count = 0
    current_extension: str | None = None
    expected_summary = re.compile(
        rf"^\s*-=\s*1 extension \({len(expected)} priorities\) in 1 context\.\s*=-\s*$",
        re.IGNORECASE,
    )

    for line in lines:
        if not line.strip():
            continue
        if expected_summary.fullmatch(line):
            summary_count += 1
            continue
        match = LOADED_PRIORITY_RE.fullmatch(line)
        if not match:
            raise DialplanRefused("loaded browser context contains an unknown directive")
        if match.group("extension") is not None:
            current_extension = match.group("extension")
        if current_extension != "s":
            raise DialplanRefused("loaded browser context extension is unexpected")
        priorities.append(
            (
                int(match.group("priority"), 10),
                match.group("label"),
                match.group("application").rstrip(),
                match.group("source"),
                int(match.group("line"), 10),
            ),
        )

    if summary_count != 1 or len(priorities) != len(expected):
        raise DialplanRefused("loaded browser context cardinality is unexpected")
    wanted = [
        (
            priority,
            expected_labels.get(priority),
            application,
            LOADED_SOURCE,
            source_line,
        )
        for priority, (application, source_line) in enumerate(expected, start=1)
    ]
    if priorities != wanted:
        raise DialplanRefused(f"loaded browser context {context} is not the reviewed route")


def verify_loaded_browser_contexts(report: str) -> None:
    """Prove both effective browser contexts, including priority order and source."""
    sections = _loaded_context_sections(report)
    _verify_loaded_priority_sequence(
        BROWSER_CONTEXT,
        sections[BROWSER_CONTEXT],
        BROWSER_PRIORITIES,
        BROWSER_PRIORITY_LABELS,
    )
    _verify_loaded_priority_sequence(
        TERMINAL_CONTEXT,
        sections[TERMINAL_CONTEXT],
        TERMINAL_PRIORITIES,
        {},
    )


def _read(path: str) -> str:
    with Path(path).open(
        "r",
        encoding="utf-8",
        newline="",
    ) as stream:
        return stream.read()


def _write(path: str, value: str) -> None:
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        stream.write(value)


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 4 and argv[0] == "--install":
            selector = read_selector(argv[2])
            changed = install_route(_read(argv[1]), selector)
            _write(argv[3], changed)
            return 0
        if len(argv) == 3 and argv[0] == "--verify":
            verify_installed_route(_read(argv[1]), read_selector(argv[2]))
            return 0
        if len(argv) == 3 and argv[0] == "--verify-loaded":
            report = sys.stdin.read() if argv[2] == "-" else _read(argv[2])
            verify_loaded_context(report, read_selector(argv[1]))
            return 0
        if len(argv) == 2 and argv[0] == "--verify-selector":
            read_selector(argv[1])
            return 0
        if len(argv) == 2 and argv[0] == "--verify-browser-loaded":
            report = sys.stdin.read() if argv[1] == "-" else _read(argv[1])
            verify_loaded_browser_contexts(report)
            return 0
    except (DialplanRefused, OSError, UnicodeError):
        print("fanum-inbound-dialplan-transform: refused", file=sys.stderr)
        return 1
    print("fanum-inbound-dialplan-transform: invalid invocation", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
