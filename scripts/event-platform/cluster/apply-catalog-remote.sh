#!/usr/bin/env bash
# Runs inside the Kafka image on a broker host (provision.sh apply-catalog).
# /client holds the admin mTLS material and topics.tsv, scram.txt, acls.txt.
# Usage: apply-catalog-remote.sh BOOTSTRAP. Idempotent.
set -Eeuo pipefail
bootstrap="$1"; cfg=/client/admin.properties; k=/opt/kafka/bin
n=0
while IFS=$'\t' read -r name partitions rf config; do
  args=(); IFS=, read -ra kv <<<"$config"; for c in "${kv[@]}"; do args+=(--config "$c"); done
  "$k/kafka-topics.sh" --bootstrap-server "$bootstrap" --command-config "$cfg" --create --if-not-exists \
    --topic "$name" --partitions "$partitions" --replication-factor "$rf" "${args[@]}" >/dev/null
  n=$((n + 1))
done </client/topics.tsv
echo "topics ensured: $n"
while read -r user pass; do
  "$k/kafka-configs.sh" --bootstrap-server "$bootstrap" --command-config "$cfg" --alter --entity-type users \
    --entity-name "$user" --add-config "SCRAM-SHA-512=[iterations=8192,password=$pass]" >/dev/null
done </client/scram.txt
echo "SCRAM identities: $(wc -l </client/scram.txt)"
n=0
while read -r -a binding; do
  "$k/kafka-acls.sh" --bootstrap-server "$bootstrap" --command-config "$cfg" --add "${binding[@]}" >/dev/null
  n=$((n + 1))
done </client/acls.txt
echo "ACL bindings ensured: $n"
echo "ld.* topics now: $("$k/kafka-topics.sh" --bootstrap-server "$bootstrap" --command-config "$cfg" --list | grep -c '^ld\.')"
