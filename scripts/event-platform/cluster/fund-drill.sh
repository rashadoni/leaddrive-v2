#!/usr/bin/env bash
# Synthetic Fund drill on the REAL primary cluster (A2 on real brokers/TLS/ACL).
# Runs on the operator workstation next to provision.sh and owns only these
# names; production topics, identities, ACLs and the prod connector are never
# touched:
#   topic      ld.testbroker.finance.events.v1 (RF=3, minISR=2, 1 partition, 1 day)
#   identity   ld-drill-worker (SCRAM), groups ld-testbroker-*
#   ACLs       ld-connect WRITE/DESCRIBE + ld-drill-worker READ/DESCRIBE/DESCRIBE_CONFIGS on prefix
#              ld.testbroker., ld-drill-worker READ on group prefix ld-testbroker-
#   host       kafka-p-connect-eu: container ld-drill-pg (host network,
#              10.88.0.16:55432 only), nft rule tagged "ld-drill" admitting
#              10.88.0.17 to it, /opt/ld-drill (bridge classes + client config)
#   connector  leaddrive-event-outbox-test-fund (created/deleted by fund-drill.ts)
#
#   fund-drill.sh up       create everything above (idempotent)
#   fund-drill.sh status   show what exists and the prod connector state
#   fund-drill.sh down     remove everything above, including connector offsets
set -Eeuo pipefail
umask 077

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
here="$repo/scripts/event-platform/cluster"
state="${LD_KAFKA_STATE:-$HOME/.leaddrive-kafka}"
provision="$here/provision.sh"
die() { printf 'fund-drill: %s\n' "$*" >&2; exit 1; }

HOST=kafka-p-connect-eu
OVERLAY=10.88.0.16
PEER=10.88.0.17
PG_PORT=55432
TOPIC=ld.testbroker.finance.events.v1
USER_NAME=ld-drill-worker
CONNECTOR=leaddrive-event-outbox-test-fund
PG_IMAGE='postgres:16.13-alpine@sha256:4941ef97aaa2633ce9808f7766f8b8d746dd039ce8c51ca6da185c3dc63ab579'
secret="$state/secrets/drill-$USER_NAME"

public_ip="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).hosts[process.argv[2]].publicAddress)' "$state/inventory.json" "$HOST")"
ssh_opts=(-i "${LD_KAFKA_SSH_KEY:-$HOME/.ssh/leaddrive_kafka_ops}" -o IdentitiesOnly=yes -o ControlMaster=no -o ControlPath=none
  -o UserKnownHostsFile="$state/known_hosts" -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o BatchMode=yes)
on() { ssh "${ssh_opts[@]}" "root@$public_ip" "$@"; }
admin() { "$provision" admin kafka-p-broker-eu "$@"; }
connect_image() { on "docker inspect -f '{{.Config.Image}}' $HOST-connect"; }

prod_connector() {
  on "curl -fsS -m 5 http://$OVERLAY:8083/connectors/leaddrive-event-outbox-prod/status" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("prod connector:",j.connector.state,j.tasks.map(t=>t.state).join(","))})'
}

case "${1:-}" in
  up)
    prod_connector
    mkdir -p "$state/secrets"
    [ -s "$secret" ] || openssl rand -hex 24 >"$secret"
    admin kafka-topics.sh --create --if-not-exists --topic "$TOPIC" --partitions 1 --replication-factor 3 \
      --config min.insync.replicas=2 --config retention.ms=86400000 --config cleanup.policy=delete \
      --config unclean.leader.election.enable=false >/dev/null
    admin kafka-configs.sh --alter --entity-type users --entity-name "$USER_NAME" \
      --add-config "SCRAM-SHA-512=[iterations=8192,password=$(cat "$secret")]" >/dev/null
    admin kafka-acls.sh --add --allow-principal User:ld-connect --operation Write --operation Describe \
      --topic ld.testbroker. --resource-pattern-type prefixed >/dev/null
    # The bridge verifies the topic's cleanup.policy at start: DescribeConfigs.
    admin kafka-acls.sh --add --allow-principal "User:$USER_NAME" --operation Read --operation Describe --operation DescribeConfigs \
      --topic ld.testbroker. --resource-pattern-type prefixed >/dev/null
    admin kafka-acls.sh --add --allow-principal "User:$USER_NAME" --operation Read \
      --group ld-testbroker- --resource-pattern-type prefixed >/dev/null
    echo "kafka: topic, $USER_NAME, ACLs ensured"
    image="$(connect_image)"
    on "nft -a list chain inet ld_kafka input | grep -q 'comment \"ld-drill\"' \
        || nft add rule inet ld_kafka input iifname wg0 ip saddr $PEER tcp dport $PG_PORT accept comment '\"ld-drill\"'"
    on "docker inspect ld-drill-pg >/dev/null 2>&1 || docker run -d --name ld-drill-pg --network host --restart no \
        --memory 384m --memory-swap 384m --pids-limit 128 \
        -e POSTGRES_USER=event_test -e POSTGRES_PASSWORD=synthetic-fixture-only -e POSTGRES_DB=event_platform_test \
        -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 '$PG_IMAGE' postgres \
        -c listen_addresses=$OVERLAY -c port=$PG_PORT -c wal_level=logical -c max_replication_slots=4 -c max_wal_senders=4 \
        -c max_slot_wal_keep_size=4096MB -c shared_buffers=32MB -c max_connections=30 >/dev/null"
    on "install -d -m 0700 /opt/ld-drill /opt/ld-drill/src /opt/ld-drill/classes"
    on "install -m 0600 /dev/stdin /opt/ld-drill/src/KafkaPartitionBridge.java" <"$repo/ops/event-platform/driver/KafkaPartitionBridge.java"
    # javac.Main does not expand classpath wildcards (only the launcher does).
    on "docker run --rm --user 0 -v /opt/ld-drill:/drill --entrypoint sh '$image' -c 'java -Xmx256m -m jdk.compiler/com.sun.tools.javac.Main \
        -cp \"\$(echo /kafka/libs/*.jar | tr \" \" :)\" -d /drill/classes /drill/src/KafkaPartitionBridge.java'"
    printf 'status=OFF\nrootLogger.level=OFF\n' | on "install -m 0600 /dev/stdin /opt/ld-drill/log4j2.properties"
    echo "host: rule, ld-drill-pg, bridge classes ready on $HOST"
    ;;
  status)
    prod_connector
    admin kafka-topics.sh --list | grep -E '^ld\.testbroker\.' || echo "no ld.testbroker topics"
    admin kafka-acls.sh --list --principal "User:$USER_NAME" | { grep -c 'permissionType=ALLOW' || true; } | sed 's/^/drill worker ACL entries: /'
    on "docker ps -a --filter name=ld-drill --format '{{.Names}} {{.Status}}'; nft -a list chain inet ld_kafka input | grep 'ld-drill' || echo 'no ld-drill rule'; ls /opt/ld-drill 2>/dev/null || echo 'no /opt/ld-drill'; curl -fsS -m 5 http://$OVERLAY:8083/connectors"
    echo
    ;;
  down)
    rc=0
    # The connector must be gone (and its offsets with it) before its topic.
    if on "curl -fsS -m 5 -o /dev/null http://$OVERLAY:8083/connectors/$CONNECTOR"; then
      on "curl -fsS -m 5 -X PUT http://$OVERLAY:8083/connectors/$CONNECTOR/stop; sleep 5; \
          curl -fsS -m 10 -X DELETE http://$OVERLAY:8083/connectors/$CONNECTOR/offsets; \
          curl -fsS -m 5 -X DELETE http://$OVERLAY:8083/connectors/$CONNECTOR" >/dev/null || rc=1
    fi
    on "docker rm -f \$(docker ps -aq --filter name=ld-drill-bridge) ld-drill-pg >/dev/null 2>&1; rm -rf /opt/ld-drill; \
        for h in \$(nft -a list chain inet ld_kafka input | sed -n 's/.*comment \"ld-drill\" # handle \([0-9]*\)/\1/p'); do nft delete rule inet ld_kafka input handle \$h; done" || rc=1
    for group in ld-testbroker-finance ld-testbroker-finance-corrected; do
      admin kafka-consumer-groups.sh --delete --group "$group" >/dev/null 2>&1 || true
    done
    admin kafka-topics.sh --delete --if-exists --topic "$TOPIC" >/dev/null || rc=1
    admin kafka-acls.sh --remove --force --allow-principal User:ld-connect --operation Write --operation Describe \
      --topic ld.testbroker. --resource-pattern-type prefixed >/dev/null || rc=1
    admin kafka-acls.sh --remove --force --allow-principal "User:$USER_NAME" --operation Read --operation Describe --operation DescribeConfigs \
      --topic ld.testbroker. --resource-pattern-type prefixed >/dev/null || rc=1
    admin kafka-acls.sh --remove --force --allow-principal "User:$USER_NAME" --operation Read \
      --group ld-testbroker- --resource-pattern-type prefixed >/dev/null || rc=1
    admin kafka-configs.sh --alter --entity-type users --entity-name "$USER_NAME" --delete-config SCRAM-SHA-512 >/dev/null || rc=1
    rm -f "$secret"
    prod_connector
    [ "$rc" = 0 ] && echo "drill removed" || die "cleanup incomplete; run status"
    ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
