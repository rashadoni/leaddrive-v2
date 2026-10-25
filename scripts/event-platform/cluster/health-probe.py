#!/usr/bin/env python3
"""Read-only health probe of one Kafka platform host; prints one JSON object.

Installed by `provision.sh install-watch` as /usr/local/sbin/ld-kafka-health
and reachable only as the forced command of the watch key:

    restrict,command="/usr/local/sbin/ld-kafka-health ROLES" ssh-ed25519 ... ld-kafka-watch

ROLES comes from authorized_keys, never from the caller. The caller may ask for
"cluster" (on a broker: describe quorum and topics with the broker's own
certificate), "events" (on a broker: the ids of the events Kafka holds from the
last EVENTS_WINDOW_S, for the outbox parity check) or "heartbeat" (only on the
host of the backup watch: the main watch finished a pass); anything else is
refused. The heartbeat is the one
write: a timestamp in WATCH_DIR, which exists only where the backup runs.
Settings the probe cannot derive live in /etc/leaddrive-kafka/health.json.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

CONFIG = "/etc/leaddrive-kafka/health.json"
TLS = "/etc/leaddrive-kafka/tls"
WATCH_DIR = "/var/lib/ld-kafka-watch"
# Parity: every outbox row from the last EVENTS_WINDOW_S, except the newest
# OUTBOX_GRACE_S the connector may still be carrying, must be in Kafka. Kafka
# is read from KAFKA_MARGIN_S earlier: a record's time is its row's createdAt.
EVENTS_WINDOW_S = 3 * 3600
OUTBOX_GRACE_S = 300
KAFKA_MARGIN_S = 600
OUTBOX_LIMIT = 20000


def run(argv, timeout=20, **kw):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, **kw)
        return p.returncode, p.stdout, p.stderr
    except (subprocess.TimeoutExpired, OSError) as e:
        return 124, "", str(e)


def overlay_address():
    code, out, _ = run(["ip", "-4", "-o", "addr", "show", "wg0"], timeout=5)
    m = re.search(r"inet (10\.\d+\.\d+\.\d+)/", out) if code == 0 else None
    return m.group(1) if m else None


def tunnel(stale_after=180):
    code, out, _ = run(["wg", "show", "wg0", "dump"], timeout=5)
    if code != 0:
        return {"up": False, "peers": 0, "stale": 0, "stalePeers": []}
    now = int(time.time())
    # Peer lines: public-key preshared-key endpoint allowed-ips latest-handshake rx tx keepalive
    peers = [line.split("\t") for line in out.splitlines()[1:] if line.strip()]
    stale = [p[3].split("/")[0] for p in peers if len(p) < 5 or int(p[4]) == 0 or now - int(p[4]) > stale_after]
    return {"up": True, "peers": len(peers), "stale": len(stale), "stalePeers": stale}


def disk(path="/"):
    u = shutil.disk_usage(path)
    return {"usedPercent": round(u.used * 100 / u.total), "freeBytes": u.free}


def cert_days_left(path=f"{TLS}/node.pem"):
    if not os.path.exists(path):
        return None
    code, out, _ = run(["openssl", "x509", "-in", path, "-noout", "-enddate"], timeout=5)
    m = re.search(r"notAfter=(.*)", out) if code == 0 else None
    if not m:
        return None
    code, out, _ = run(["date", "-d", m.group(1).strip(), "+%s"], timeout=5)
    return (int(out) - int(time.time())) // 86400 if code == 0 else None


def containers():
    code, out, _ = run(["docker", "ps", "-a", "--format", "{{.Names}}\t{{.State}}"], timeout=15)
    if code != 0:
        return [{"name": "docker", "state": "unavailable"}]
    rows = [line.split("\t") for line in out.splitlines() if line.strip()]
    return [{"name": n, "state": s} for n, s in rows if n.startswith("kafka-")]


def http_json(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return True, json.loads(r.read(1 << 20))
    except Exception:  # unreachable, refused, non-JSON: all mean "not answering"
        return False, None


def cluster_view():
    """Quorum and partition state through the local broker, as the broker itself."""
    conf = open("/etc/leaddrive-kafka/server.properties").read()
    m = re.search(r"^listeners=.*REPLICATION://([0-9.]+):(\d+)", conf, re.M)
    image = re.search(r"^\s*image:\s*(\S+)", open("/etc/leaddrive-kafka/compose.yml").read(), re.M)
    uid = re.search(r'^\s*user:\s*"(\d+):', open("/etc/leaddrive-kafka/compose.yml").read(), re.M)
    if not (m and image and uid):
        return {"error": "broker configuration not found"}
    bootstrap = f"{m.group(1)}:{m.group(2)}"
    # No "set -e": with the controller quorum gone the quorum tools fail, yet the
    # broker still describes its partitions, and the watch needs both answers.
    script = (
        "printf 'security.protocol=SSL\\nssl.keystore.type=PEM\\nssl.keystore.location=/tls/node.pem\\n"
        "ssl.truststore.type=PEM\\nssl.truststore.location=/tls/ca.pem\\n' >/tmp/c.properties; "
        "b=/opt/kafka/bin; a=\"--bootstrap-server $0 --command-config /tmp/c.properties\"; "
        "echo '@@status'; timeout 40 $b/kafka-metadata-quorum.sh $a describe --status; "
        "echo '@@replication'; timeout 40 $b/kafka-metadata-quorum.sh $a describe --replication; "
        "echo '@@topics'; timeout 60 $b/kafka-topics.sh $a --describe"
    )
    code, out, err = run(["docker", "run", "--rm", "--network", "host", "--user", f"{uid.group(1)}:{uid.group(1)}",
                          "-e", "KAFKA_HEAP_OPTS=-Xms64m -Xmx256m", "-v", f"{TLS}:/tls:ro",
                          "--entrypoint", "/bin/bash", image.group(1), "-c", script, bootstrap], timeout=170)
    sections = dict(re.findall(r"^@@(\w+)\n(.*?)(?=^@@|\Z)", out, re.M | re.S))
    if code != 0 or not sections.get("topics"):
        return {"error": (err.strip().splitlines() or [f"exit {code}"])[-1][:300]}
    return {"status": sections.get("status", ""), "replication": sections.get("replication", ""), "topics": sections["topics"]}


def broker_tool_base():
    """Bootstrap address, image and uid to run Kafka tools as this broker."""
    conf = open("/etc/leaddrive-kafka/server.properties").read()
    compose = open("/etc/leaddrive-kafka/compose.yml").read()
    m = re.search(r"^listeners=.*REPLICATION://([0-9.]+):(\d+)", conf, re.M)
    image = re.search(r"^\s*image:\s*(\S+)", compose, re.M)
    uid = re.search(r'^\s*user:\s*"(\d+):', compose, re.M)
    if not (m and image and uid):
        return None
    return f"{m.group(1)}:{m.group(2)}", image.group(1), uid.group(1)


def parse_group_offsets(text):
    """kafka-consumer-groups.sh --describe rows -> {(topic, partition): (current, end)}."""
    rows = {}
    for line in text.splitlines():
        cells = line.split()
        if len(cells) >= 5 and cells[2].isdigit() and cells[4].isdigit():
            current = int(cells[3]) if cells[3].isdigit() else None
            rows[(cells[1], int(cells[2]))] = (current, int(cells[4]))
    return rows


def events_view(config):
    """Ids of the events Kafka holds from the parity window, read to the end.

    A consumer group of this host is set to the window's start by time, its
    partitions' ends are noted, every record's "id" header is read, and the
    read counts as complete only when the group got to each noted end.
    """
    base = broker_tool_base()
    if not base:
        return {"error": "broker configuration not found"}
    bootstrap, image, uid = base
    prefix = config.get("eventTopicPrefix", "ld.prod.")
    pattern = "^" + prefix.replace(".", "\\.") + "[a-z0-9-]+\\.events\\.v1$"
    since = int(time.time()) - EVENTS_WINDOW_S - KAFKA_MARGIN_S
    since_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000", time.gmtime(since))
    group = "ld-watch-parity-" + os.uname().nodename
    script = (
        "printf 'security.protocol=SSL\\nssl.keystore.type=PEM\\nssl.keystore.location=/tls/node.pem\\n"
        "ssl.truststore.type=PEM\\nssl.truststore.location=/tls/ca.pem\\n' >/tmp/c.properties; "
        "b=/opt/kafka/bin; a=\"--bootstrap-server $0 --command-config /tmp/c.properties\"; "
        "topics=$(timeout 40 $b/kafka-topics.sh $a --list | grep -E \"$1\"); "
        "[ -n \"$topics\" ] || { echo '@@error'; echo 'no event topics'; exit 0; }; "
        "args=; for t in $topics; do args=\"$args --topic $t\"; done; "
        "timeout 60 $b/kafka-consumer-groups.sh $a --group $3 --reset-offsets --to-datetime $2 $args --execute >/dev/null "
        "|| { echo '@@error'; echo 'offset reset failed'; exit 0; }; "
        "echo '@@before'; timeout 40 $b/kafka-consumer-groups.sh $a --describe --group $3 2>/dev/null; "
        "echo '@@records'; timeout 120 $b/kafka-console-consumer.sh --bootstrap-server $0 --command-config /tmp/c.properties "
        "--group $3 --include \"$1\" --timeout-ms 15000 --formatter-property print.headers=true "
        "--formatter-property print.value=false --formatter-property print.key=false 2>/dev/null; "
        "echo '@@after'; timeout 40 $b/kafka-consumer-groups.sh $a --describe --group $3 2>/dev/null"
    )
    # Two watches asking at once would split one group's partitions.
    code, out, err = run(["flock", "-w", "150", "/run/ld-kafka-parity.lock",
                          "docker", "run", "--rm", "--network", "host", "--user", f"{uid}:{uid}",
                          "-e", "KAFKA_HEAP_OPTS=-Xms64m -Xmx256m", "-v", f"{TLS}:/tls:ro",
                          "--entrypoint", "/bin/bash", image, "-c", script, bootstrap, pattern, since_iso, group], timeout=190)
    sections = dict(re.findall(r"^@@(\w+)\n(.*?)(?=^@@|\Z)", out, re.M | re.S))
    if code != 0 or "error" in sections or "after" not in sections:
        reason = sections.get("error", "").strip() or (err.strip().splitlines() or [f"exit {code}"])[-1]
        return {"error": reason[:300]}
    before = parse_group_offsets(sections.get("before", ""))
    after = parse_group_offsets(sections["after"])
    behind = [k for k, (current, end) in before.items() if (after.get(k, (None, 0))[0] or 0) < end]
    ids = sorted(set(re.findall(r"(?:^|,)id:([0-9a-f-]{36})(?:,|$)", sections.get("records", ""), re.M)))
    return {"sinceMs": since * 1000, "partitions": len(before), "complete": not behind,
            "behind": len(behind), "ids": ids}


def outbox(config):
    """Outbox rows of the parity window, oldest first, as [eventId, topic, createdAt ms]."""
    sql = (
        'select "eventId", "topic", (extract(epoch from "createdAt") * 1000)::bigint from event_outbox '
        f"where \"createdAt\" >= (now() at time zone 'utc') - interval '{EVENTS_WINDOW_S} seconds' "
        f"and \"createdAt\" <= (now() at time zone 'utc') - interval '{OUTBOX_GRACE_S} seconds' "
        f'order by "createdAt", "id" limit {OUTBOX_LIMIT}'
    )
    code, out, err = run(["sudo", "-u", "postgres", "psql", "-XAtq", "-F", "\t", "-d", config.get("database", "postgres"),
                          "-c", sql], timeout=30, cwd="/")
    if code != 0:
        return {"error": (err.strip().splitlines() or [f"exit {code}"])[-1][:300]}
    rows = [line.split("\t") for line in out.splitlines() if line.strip()]
    return {"windowSeconds": EVENTS_WINDOW_S, "graceSeconds": OUTBOX_GRACE_S, "truncated": len(rows) >= OUTBOX_LIMIT,
            "rows": [[r[0], r[1], int(r[2])] for r in rows]}


def source(config):
    slot_sql = (
        "select slot_name, active, coalesce(wal_status, ''), "
        "coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint, "
        "coalesce(safe_wal_size, -1) from pg_replication_slots"
    )
    code, out, _ = run(["sudo", "-u", "postgres", "psql", "-XAtq", "-F", "\t", "-d", config.get("database", "postgres"),
                        "-c", slot_sql], timeout=20, cwd="/")
    if code != 0:
        return None
    slots = []
    for line in out.splitlines():
        name, active, status, retained, safe = line.split("\t")
        slots.append({"name": name, "active": active == "t", "walStatus": status, "retainedBytes": int(retained),
                      "safeBytes": int(safe) if int(safe) >= 0 else None})
    return {"expectedSlot": config.get("expectedSlot"), "slots": slots, "outbox": outbox(config)}


def heartbeat():
    tmp = f"{WATCH_DIR}/primary-heartbeat.tmp"
    with open(tmp, "w") as f:
        f.write(str(int(time.time() * 1000)))
    os.replace(tmp, f"{WATCH_DIR}/primary-heartbeat")


def backup_watch():
    """When the backup watch last finished a pass (ms), as its state says."""
    try:
        return {"lastPass": json.load(open(f"{WATCH_DIR}/state/state.json")).get("lastPass")}
    except (OSError, ValueError):
        return {"lastPass": None}


def main():
    roles = set(sys.argv[1].split(",")) if len(sys.argv) > 1 else set()
    asked = os.environ.get("SSH_ORIGINAL_COMMAND", "").strip()
    if asked == "heartbeat" and os.path.isdir(WATCH_DIR):
        heartbeat()
        print(json.dumps({"ok": True}))
        return 0
    if asked not in ("", "cluster", "events") or (asked in ("cluster", "events") and "broker" not in roles):
        print(json.dumps({"error": "refused"}))
        return 2
    config = json.load(open(CONFIG)) if os.path.exists(CONFIG) else {}
    data = {"roles": sorted(roles), "time": int(time.time()), "disk": disk(), "tunnel": tunnel()}
    if "source" in roles:
        data["source"] = source(config)
    else:
        data["cert"] = {"daysLeft": cert_days_left()}
        data["containers"] = containers()
    if "connect" in roles:
        address = overlay_address()
        ok, connectors = http_json(f"http://{address}:8083/connectors?expand=status") if address else (False, None)
        data["connect"] = {"ok": ok, "connectors": connectors, "expected": config.get("expectedConnectors", [])}
        ok, _ = http_json(f"http://{address}:8080/apis/registry/v3/system/info") if address else (False, None)
        data["registry"] = {"ok": ok}
    if config.get("backupWatch"):
        data["backupWatch"] = backup_watch()
    if asked == "cluster":
        data["cluster"] = cluster_view()
    if asked == "events":
        data["events"] = events_view(config)
    print(json.dumps(data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
