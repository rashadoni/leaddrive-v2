#!/usr/bin/env bash
# How well the phone line hears and finds what pharmacies order, per day (Baku),
# from production — read-only: two SELECTs and the line process's own log.
# Owner, 2026-11-03: measure on live calls, not on one test call.
#
#   bash scripts/zeytun-line/quality-report.sh [days=14]
#
# Columns:
#   calls        AI calls on the line
#   orders       phone orders the calls left; confirmed / cancelled by the caller
#   lines        order lines; not_found: the agent wrote the pharmacy's words, no 1C product
#   fixed        lines a manager re-pointed to another product: a name misheard or misfound
#   lookups      catalog searches; empty: found nothing; learned: a confirmed wording led
#   per_call     lookups per call: retries and read-backs push it up
# Silence after a lookup (the station's zeytun_lookup_silence) is in the
# station journal, not here: scratchpad station-journal.sh needs the PBX tunnel.
set -euo pipefail
days=${1:-14}
[[ "$days" =~ ^[0-9]{1,3}$ ]] || { echo "days must be a number" >&2; exit 2; }
key=${LEADDRIVE_PROD_KEY:-$HOME/.ssh/leaddrive_prod_2026_09_09}

ssh -i "$key" -o BatchMode=yes root@13.140.132.245 "DAYS=$days bash -s" <<'REMOTE'
set -euo pipefail
counts=$(mktemp)
trap 'rm -f "$counts"' EXIT
sql() { sudo -u postgres psql -d leaddrive_v2 -At -F $'\t' -v ON_ERROR_STOP=1 -c "$1"; }
since="now() - interval '$DAYS days'"
# Prisma writes UTC into timestamp without time zone; the day is Baku's.
day() { echo "to_char(($1 AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baku')::date, 'YYYY-MM-DD')"; }
{
  sql "SELECT $(day '"createdAt"'), 'calls', count(*) FROM call_logs
       WHERE \"callMode\" = 'ai' AND \"createdAt\" > $since
         AND \"organizationId\" IN (SELECT DISTINCT \"organizationId\" FROM pharmacy_phone_orders) GROUP BY 1"
  sql "SELECT $(day '"createdAt"'), unnest(ARRAY['orders','confirmed','cancelled']),
              unnest(ARRAY[count(*), count(*) FILTER (WHERE status = 'confirmed'),
                           count(*) FILTER (WHERE \"rejectReason\" = 'caller_cancelled')])
       FROM pharmacy_phone_orders WHERE \"createdAt\" > $since GROUP BY 1"
  sql "SELECT $(day 'o."createdAt"'), unnest(ARRAY['lines','not_found']),
              unnest(ARRAY[count(*), count(*) FILTER (WHERE l.status = 'not_found')])
       FROM pharmacy_phone_order_lines l JOIN pharmacy_phone_orders o ON o.id = l.\"orderId\"
       WHERE o.\"createdAt\" > $since GROUP BY 1"
  sql "SELECT $(day 'o."createdAt"'), 'fixed', count(*)
       FROM pharmacy_phone_orders o, jsonb_array_elements(CASE WHEN jsonb_typeof(o.\"managerEdits\") = 'array' THEN o.\"managerEdits\" ELSE '[]' END) e
       WHERE o.\"createdAt\" > $since AND e->>'action' = 'pick_product' GROUP BY 1"
} > "$counts"
DAYS="$DAYS" python3 -I - "$counts" <<'PY'
import datetime, glob, json, os, re, sys
counts = {}
for line in open(sys.argv[1], encoding="utf-8"):
    day, name, value = line.rstrip("\n").split("\t")
    counts.setdefault(day, {})[name] = int(value)
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=int(os.environ["DAYS"]))
baku = datetime.timezone(datetime.timedelta(hours=4))
pattern = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d\d:\d\d): \[zeytun-line\] search (\{.*\})$")
for path in sorted(glob.glob("/var/lib/leaddrive-v2-logs/line-out*.log")):
    for raw in open(path, encoding="utf-8", errors="replace"):
        match = pattern.match(raw.strip())
        if not match:
            continue
        date, time, offset = match.group(1).split(" ")
        at = datetime.datetime.fromisoformat(f"{date}T{time}{offset}")
        if at < cutoff:
            continue
        entry = json.loads(match.group(2))
        day = at.astimezone(baku).strftime("%Y-%m-%d")
        row = counts.setdefault(day, {})
        row["lookups"] = row.get("lookups", 0) + 1
        row["empty"] = row.get("empty", 0) + (entry.get("found") == 0)
        row["learned"] = row.get("learned", 0) + bool(entry.get("learned"))
columns = ["calls", "orders", "confirmed", "cancelled", "lines", "not_found", "fixed", "lookups", "empty", "learned"]
print("day         " + " ".join(f"{name:>9}" for name in columns) + "  per_call")
for day in sorted(counts):
    row = counts[day]
    calls = row.get("calls", 0)
    per_call = f"{row.get('lookups', 0) / calls:.1f}" if calls else "-"
    print(f"{day}  " + " ".join(f"{row.get(name, 0):>9}" for name in columns) + f"  {per_call:>8}")
PY
REMOTE
