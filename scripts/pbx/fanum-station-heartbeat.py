#!/usr/bin/env python3
"""Tell the CRM once a minute that this PBX station is there.

Owner, 2026-10-29 («исправь из списка что осталось»): the line watch saw the
CRM but not the station behind Fanum's VPN. Each run posts two facts to
/api/internal/asterisk/station-heartbeat — whether the trunk is registered with
the operator (the 2026-10-25 outage) and whether the voice program runs — by
the same road and token the call events use. The CRM keeps the last report;
the line watch alarms when it is three minutes old or says something is down.
Nothing else leaves the station: no numbers, no calls, no configuration.
"""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = "/etc/fanum-pbx-coordinator.env"
HEARTBEAT_PATH = "/api/internal/asterisk/station-heartbeat"
TIMEOUT_SECONDS = 10


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_config(path=CONFIG_PATH):
    """The two keys the call events use, read as data; the file is never sourced."""
    values = {}
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key in ("VOICE_CRM_HUMAN_LIFECYCLE_URL", "VOICE_CRM_RUNTIME_TOKEN"):
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                    value = value[1:-1]
                values[key] = value
    lifecycle = urllib.parse.urlsplit(values.get("VOICE_CRM_HUMAN_LIFECYCLE_URL", ""))
    token = values.get("VOICE_CRM_RUNTIME_TOKEN", "")
    if lifecycle.scheme != "https" or not lifecycle.hostname or lifecycle.username or lifecycle.password or not token:
        raise ValueError("station_config_invalid")
    return urllib.parse.urlunsplit(("https", lifecycle.netloc, HEARTBEAT_PATH, "", "")), token


def trunk_registered(run=subprocess.run):
    """Any outbound registration Asterisk reports as Registered."""
    try:
        out = run(["asterisk", "-rx", "pjsip show registrations"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return any(re.search(r"\bRegistered\b", line) and not re.search(r"\b(Unregistered|Rejected)\b", line)
               for line in out.splitlines())


def voice_active(run=subprocess.run):
    try:
        return run(["systemctl", "is-active", "--quiet", "fanum-voice.service"], timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def report(url, token, body, opener=None):
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with (opener or urllib.request.build_opener(NoRedirect())).open(request, timeout=TIMEOUT_SECONDS) as response:
        return response.status


def main():
    try:
        url, token = read_config()
    except (OSError, ValueError):
        print("station_heartbeat config_invalid", file=sys.stderr)
        return 1
    body = {"trunkRegistered": trunk_registered(), "voiceActive": voice_active()}
    try:
        status = report(url, token, body)
    except urllib.error.HTTPError as error:
        print("station_heartbeat http_%d" % error.code, file=sys.stderr)
        return 1
    except (OSError, urllib.error.URLError) as error:
        print("station_heartbeat %s" % type(error).__name__, file=sys.stderr)
        return 1
    print("station_heartbeat sent trunk=%s voice=%s status=%d" % (body["trunkRegistered"], body["voiceActive"], status))
    return 0


if __name__ == "__main__":
    sys.exit(main())
