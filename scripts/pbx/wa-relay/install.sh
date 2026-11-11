#!/bin/bash
# WhatsApp calls for the phone-order line (owner 2026-11-12): the station registers to
# LeadDrive's relay wa-sip.leaddrivecrm.org (13.140.132.245) over TLS and answers what
# arrives there with the same AI route as its operator DID (dialplan-wa-relay.conf, made
# by make-wa-dialplan.py from fanum-inbound-browser.conf). Package in ~/wa-relay:
# install.sh, pjsip-wa-relay.conf, dialplan-wa-relay.conf, station.secret (the relay's
# password for zeytun-station, from prod /etc/asterisk-secrets/station-zeytun).
# Run as root: sudo bash ~/wa-relay/install.sh      Undo: sudo bash ~/wa-relay/install.sh --undo
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STAMP=$(date +%Y%m%d%H%M%S)
PJ=/etc/asterisk/pjsip.conf
DP=/etc/asterisk/extensions_fanum.conf
BEGIN="; BEGIN LEADDRIVE WHATSAPP RELAY - managed"
END="; END LEADDRIVE WHATSAPP RELAY - managed"
strip() { python3 - "$1" "$BEGIN" "$END" <<'PY'
import sys
path, begin, end = sys.argv[1:4]
lines, out, skip = open(path).read().split("\n"), [], False
for line in lines:
    if line == begin: skip = True; continue
    if line == end: skip = False; continue
    if not skip: out.append(line)
text = "\n".join(out).rstrip("\n") + "\n"
open(path, "w").write(text)
PY
}
active_calls() { /usr/sbin/asterisk -rx "core show channels count" | awk '/active call/ {print $1}'; }
if [ "${1:-}" = "--undo" ]; then
  cp -p "$PJ" "$PJ.bak.wa-relay-undo-$STAMP"; cp -p "$DP" "$DP.bak.wa-relay-undo-$STAMP"
  strip "$PJ"; strip "$DP"
  /usr/sbin/asterisk -rx "module reload res_pjsip.so" >/dev/null; /usr/sbin/asterisk -rx "dialplan reload" >/dev/null
  echo "removed; backups *.bak.wa-relay-undo-$STAMP"; exit 0
fi
SECRET="$(tr -d '\n' < "$HERE/station.secret")"
[ "${#SECRET}" -ge 20 ] || { echo "station.secret missing"; exit 1; }
cp -p "$PJ" "$PJ.bak.wa-relay-$STAMP"; cp -p "$DP" "$DP.bak.wa-relay-$STAMP"
strip "$PJ"; strip "$DP"
umask 027
{
  echo "$BEGIN"
  sed "s|__STATION_PASSWORD__|$SECRET|" "$HERE/pjsip-wa-relay.conf"
  echo "$END"
} >> "$PJ"
{ echo "$BEGIN"; cat "$HERE/dialplan-wa-relay.conf"; echo "$END"; } >> "$DP"
chown asterisk:asterisk "$PJ"; chmod 640 "$PJ"
# The AI leg marks WhatsApp calls here for the voice core (zeytun_whatsapp_call); a day keeps them.
echo "d /run/fanum-whatsapp-calls 0755 asterisk asterisk 1d" > /etc/tmpfiles.d/fanum-whatsapp-calls.conf
systemd-tmpfiles --create /etc/tmpfiles.d/fanum-whatsapp-calls.conf
/usr/sbin/asterisk -rx "dialplan reload" >/dev/null
/usr/sbin/asterisk -rx "module reload res_pjsip.so" >/dev/null
sleep 4
echo "--- transports";    /usr/sbin/asterisk -rx "pjsip show transports" | grep -E "transport-" || true
echo "--- registrations"; /usr/sbin/asterisk -rx "pjsip show registrations" | grep -E "Registered|Rejected|Unregistered|Trying" || true
echo "--- dialplan";      for c in from-wa-relay fanum-wa-inbound fanum-wa-ai-leg; do echo "$c: $(/usr/sbin/asterisk -rx "dialplan show $c" | grep -c "^ *\[\| [0-9]*\. ")"; done
echo "--- marks";         ls -ld /run/fanum-whatsapp-calls
echo "active calls now: $(active_calls)"
echo "backups: $PJ.bak.wa-relay-$STAMP $DP.bak.wa-relay-$STAMP"
