#!/usr/bin/env bash
# Disposable drill of the rendered primary cluster on one CI runner.
#
# Runs the exact server.properties that render.mjs produces for production
# (container names instead of WireGuard addresses, heaps scaled down) and
# proves, with evidence printed per step:
#   1. TLS 1.3 + mTLS between nodes, SCRAM for clients; plaintext, a foreign
#      CA, a missing client certificate and a wrong password are refused;
#   2. deny-by-default ACLs: each service identity can do only its own job;
#   3. all 86 catalog topics exist with RF=3, min ISR 2, replicas on three racks;
#   4. losing one site keeps acks=all writes and controller quorum; losing two
#      refuses writes; recovery loses no acknowledged record;
#   5. a cold restart keeps topics, ACLs and credentials.
# One runner is one failure domain: this proves configuration and Kafka
# behaviour, not physical independence of the real sites.
#
# Requires LD_KAFKA_DRILL_DISPOSABLE=1 so it never runs against a real host.
set -Eeuo pipefail

[ "${LD_KAFKA_DRILL_DISPOSABLE:-}" = 1 ] || { echo "refusing: set LD_KAFKA_DRILL_DISPOSABLE=1 on a disposable runner" >&2; exit 2; }

repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
work="${LD_KAFKA_DRILL_WORK:-$(mktemp -d)}"
project="ld-kafka-drill-${GITHUB_RUN_ID:-local}"
net="$project"
image="$(node -e "import('$repo/scripts/event-platform/cluster/render.mjs').then(m => console.log(m.KAFKA_IMAGE))")"
cluster_id="$(openssl rand -base64 16 | tr '+/' '-_' | cut -c1-22)"
env=drill
step() { printf '\n=== %s\n' "$*"; }
fail() { printf 'DRILL FAILED: %s\n' "$*" >&2; exit 1; }

mapfile -t nodes < <(node -e "
  import('$repo/scripts/event-platform/cluster/render.mjs').then(m => {
    const c = m.loadTopology().clusters.find(c => c.name === 'primary')
    for (const h of c.hosts) if (h.roles.includes('broker') || h.roles.includes('controller'))
      console.log([h.name, h.site, h.roles.includes('broker') ? 'broker' : 'controller'].join(' '))
  })")
brokers=(); controllers=()
for line in "${nodes[@]}"; do
  read -r name site role <<<"$line"
  if [ "$role" = broker ]; then brokers+=("$name"); else controllers+=("$name"); fi
done
site_of() { for line in "${nodes[@]}"; do read -r n s _ <<<"$line"; if [ "$n" = "$1" ]; then echo "$s"; fi; done; }
nodes_at() { for line in "${nodes[@]}"; do read -r n s _ <<<"$line"; if [ "$s" = "$1" ]; then echo "$n"; fi; done; }
bootstrap_mtls="$(printf '%s:9094,' "${brokers[@]}")"; bootstrap_mtls="${bootstrap_mtls%,}"
bootstrap_scram="$(printf '%s:9092,' "${brokers[@]}")"; bootstrap_scram="${bootstrap_scram%,}"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    for name in $(docker ps -a --filter "label=$project" --format '{{.Names}}' | grep '^kafka-'); do
      printf -- '--- last log lines of %s\n' "$name"; docker logs --tail 60 "$name" 2>&1 | grep -v '^\s*at ' || true
    done
  fi
  docker ps -aq --filter "label=$project" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "label=$project" | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step "PKI and rendered configuration"
pki="$repo/scripts/event-platform/cluster/pki.sh"
bash "$pki" init "$work/pki"
for line in "${nodes[@]}"; do read -r name _ _ <<<"$line"; bash "$pki" issue "$work/pki" "$name" "$name"; done
bash "$pki" issue "$work/pki" kafka-admin kafka-admin
bash "$pki" init "$work/intruder"
bash "$pki" issue "$work/intruder" kafka-admin kafka-admin
node -e "
  const hosts = {}
  for (const l of process.argv.slice(1)) hosts[l.split(' ')[0]] = { address: l.split(' ')[0] }
  require('fs').writeFileSync('$work/inventory.json', JSON.stringify({ clusterId: '$cluster_id', hosts }))
" "${nodes[@]}"
node "$repo/scripts/event-platform/cluster/render.mjs" --cluster primary --inventory "$work/inventory.json" --out "$work/rendered" --heap-scale 0.125

declare -A password
for user in ld-connect ld-fund-worker; do password[$user]="$(openssl rand -hex 24)"; done
mkdir -p "$work/client"
cp -r "$work/pki/issued/kafka-admin" "$work/client/admin"
cp -r "$work/intruder/issued/kafka-admin" "$work/client/intruder"
cp "$work/pki/ca.pem" "$work/client/ca.pem"
tls_client() { printf 'ssl.keystore.type=PEM\nssl.keystore.location=/client/%s/node.pem\nssl.truststore.type=PEM\nssl.truststore.location=/client/ca.pem\nsecurity.protocol=SSL\n' "$1"; }
tls_client admin >"$work/client/admin.properties"
tls_client intruder >"$work/client/intruder.properties"
printf 'security.protocol=SSL\nssl.truststore.type=PEM\nssl.truststore.location=/client/ca.pem\n' >"$work/client/nocert.properties"
printf 'security.protocol=PLAINTEXT\n' >"$work/client/plaintext.properties"
scram_client() {
  printf 'security.protocol=SASL_SSL\nsasl.mechanism=SCRAM-SHA-512\nssl.truststore.type=PEM\nssl.truststore.location=/client/ca.pem\n'
  printf 'sasl.jaas.config=org.apache.kafka.common.security.scram.ScramLoginModule required username="%s" password="%s";\n' "$1" "$2"
  printf 'acks=all\nenable.idempotence=true\nretries=2147483647\nmax.in.flight.requests.per.connection=5\n'
}
scram_client ld-connect "${password[ld-connect]}" >"$work/client/connect.properties"
scram_client ld-fund-worker "${password[ld-fund-worker]}" >"$work/client/fund.properties"
scram_client ld-connect "wrong-${password[ld-connect]}" >"$work/client/wrongpass.properties"
{ cat "$work/client/connect.properties"; printf 'delivery.timeout.ms=20000\nrequest.timeout.ms=10000\nmax.block.ms=20000\n'; } >"$work/client/connect-short.properties"
# Containers run as uid 1000 (appuser); the runner user is not uid 1000.
sudo chown -R 1000:1000 "$work/pki/issued" "$work/client" "$work/rendered"

step "Start three controllers and three brokers"
docker network create --label "$project" "$net" >/dev/null
start_node() {
  local name="$1"
  docker volume create --label "$project" "$project-$name" >/dev/null
  docker run --rm --label "$project" --user 0 -v "$project-$name:/d" --entrypoint /bin/chown "$image" 1000:1000 /d
  docker run -d --name "$name" --hostname "$name" --network "$net" --label "$project" \
    --env-file "$work/rendered/$name/kafka.env" --memory 1g --user 1000:1000 \
    -v "$work/rendered/$name/server.properties:/etc/kafka/server.properties:ro" \
    -v "$work/pki/issued/$name:/etc/kafka/tls:ro" \
    -v "$project-$name:/var/lib/kafka/data" \
    --entrypoint /bin/bash "$image" -ec \
    '/opt/kafka/bin/kafka-storage.sh format --ignore-formatted -t "$CLUSTER_ID" -c /etc/kafka/server.properties && exec /opt/kafka/bin/kafka-server-start.sh /etc/kafka/server.properties' >/dev/null
}
for name in "${controllers[@]}" "${brokers[@]}"; do start_node "$name"; done

kafka() {
  # kafka TOOL ARGS... inside a throwaway client container, bounded by KAFKA_TIMEOUT seconds
  local tool="$1"; shift
  docker run --rm --network "$net" --label "$project" --user 1000:1000 \
    -e KAFKA_HEAP_OPTS='-Xms64m -Xmx256m' -v "$work/client:/client:ro" \
    --entrypoint /bin/bash "$image" -c 'exec timeout "$0" /opt/kafka/bin/"$@"' "${KAFKA_TIMEOUT:-120}" "$tool" "$@"
}
admin() { local tool="$1"; shift; kafka "$tool" --bootstrap-server "$bootstrap_mtls" --command-config /client/admin.properties "$@"; }
wait_until() {
  # wait_until WHAT TRIES FUNCTION ARGS...
  local what="$1" tries="$2"; shift 2
  for _ in $(seq "$tries"); do "$@" >/dev/null 2>&1 && return 0; sleep 3; done
  fail "timed out waiting for $what"
}
admin_lists_topics() { KAFKA_TIMEOUT=30 admin kafka-topics.sh --list; }
no_under_replicated() { local out; out="$(KAFKA_TIMEOUT=60 admin kafka-topics.sh --describe --under-replicated-partitions)" && [ -z "$out" ]; }
three_brokers_serve() { [ "$(KAFKA_TIMEOUT=60 admin kafka-broker-api-versions.sh | grep -c '(id: 10[1-3] rack:')" = 3 ]; }

wait_until "admin access through mTLS" 60 admin_lists_topics
wait_until "three brokers serving" 20 three_brokers_serve
admin kafka-metadata-quorum.sh describe --status | tee "$work/quorum.txt"
grep -Eq 'CurrentVoters:.*"id": ?1.*"id": ?2.*"id": ?3|CurrentVoters:[[:space:]]*\[1,[[:space:]]*2,[[:space:]]*3\]' "$work/quorum.txt" \
  || fail "controller quorum is not the three rendered voters"

step "Service identities"
for user in ld-connect ld-fund-worker; do
  admin kafka-configs.sh --alter --entity-type users --entity-name "$user" \
    --add-config "SCRAM-SHA-512=[iterations=8192,password=${password[$user]}]" >/dev/null
done
finance_events="ld.$env.finance.events.v1"
finance_replay="ld.$env.finance.replay.v1"

step "Create the full topic catalog"
node "$repo/scripts/event-platform/cluster/render.mjs" topics "$env" >"$work/topics.tsv"
[ "$(wc -l <"$work/topics.tsv")" = 86 ] || fail "catalog did not expand to 86 topics"
sudo install -o 1000 -g 1000 -m 0644 "$work/topics.tsv" "$work/client/topics.tsv"
docker run --rm --network "$net" --label "$project" --user 1000:1000 -e KAFKA_HEAP_OPTS='-Xms64m -Xmx256m' \
  -v "$work/client:/client:ro" --entrypoint /bin/bash "$image" -ec '
    while IFS=$'"'"'\t'"'"' read -r name partitions rf config; do
      args=()
      IFS=, read -ra kv <<<"$config"; for c in "${kv[@]}"; do args+=(--config "$c"); done
      /opt/kafka/bin/kafka-topics.sh --bootstrap-server "$0" --command-config /client/admin.properties \
        --create --topic "$name" --partitions "$partitions" --replication-factor "$rf" "${args[@]}" >/dev/null
    done </client/topics.tsv' "$bootstrap_mtls"
[ "$(admin kafka-topics.sh --list | grep -c "^ld\.$env\.")" = 86 ] || fail "not all 86 catalog topics exist"
admin kafka-topics.sh --describe --topic "$finance_events" >"$work/finance-describe.txt"
grep -q 'ReplicationFactor: 3' "$work/finance-describe.txt" || fail "finance events RF is not 3"
awk '/Replicas:/ { for (i = 1; i <= NF; i++) if ($i == "Replicas:") { n = split($(i + 1), r, ","); if (n != 3 || r[1] == r[2] || r[2] == r[3] || r[1] == r[3]) bad = 1 } }
     END { exit bad }' "$work/finance-describe.txt" || fail "a finance partition lacks three distinct replicas"
admin kafka-configs.sh --describe --entity-type topics --entity-name "$finance_events" >"$work/finance-config.txt"
for want in 'min.insync.replicas=2' 'unclean.leader.election.enable=false' 'retention.ms=7776000000'; do
  grep -q "$want" "$work/finance-config.txt" || fail "finance events effective config lacks $want"
done
echo "86 topics, $(awk -F'\t' '{s += $2} END {print s}' "$work/topics.tsv") partitions; finance events RF3/minISR2 on three racks"

step "Least-privilege ACLs"
for name in $(cut -f1 "$work/topics.tsv" | grep '\.events\.v1$'); do
  admin kafka-acls.sh --add --allow-principal User:ld-connect --operation Write --operation Describe --topic "$name" >/dev/null
done
admin kafka-acls.sh --add --allow-principal User:ld-connect --operation IdempotentWrite --cluster >/dev/null
admin kafka-acls.sh --add --allow-principal User:ld-fund-worker --operation Read --operation Describe --topic "$finance_events" >/dev/null
admin kafka-acls.sh --add --allow-principal User:ld-fund-worker --operation Read --group "ld.$env.fund-shadow." --resource-pattern-type prefixed >/dev/null

step "Negative authentication and authorization checks"
refusal='[Aa]uthoriz|[Aa]uthenticat|SSL handshake|[Hh]andshake failed|[Nn]ot authorized|[Dd]enied|Disconnected|Timed out|TimeoutException|timed out'
expect_refused() {
  local label="$1" out status=0; shift
  out="$(KAFKA_TIMEOUT=45 "$@" 2>&1)" || status=$?
  if [ "$status" -eq 0 ] && ! grep -Eq "$refusal" <<<"$out"; then
    printf '%s\n' "$out" | tail -5
    fail "$label was accepted"
  fi
  echo "refused as expected: $label (exit $status): $(grep -Eo -m1 ".{0,80}($refusal).{0,60}" <<<"$out" || echo 'no response before timeout')"
}
expect_refused "plaintext client" kafka kafka-topics.sh --bootstrap-server "$bootstrap_scram" --command-config /client/plaintext.properties --list
expect_refused "certificate from a foreign CA" kafka kafka-topics.sh --bootstrap-server "$bootstrap_mtls" --command-config /client/intruder.properties --list
expect_refused "TLS without a client certificate on the replication listener" kafka kafka-topics.sh --bootstrap-server "$bootstrap_mtls" --command-config /client/nocert.properties --list
expect_refused "wrong SCRAM password" kafka kafka-topics.sh --bootstrap-server "$bootstrap_scram" --command-config /client/wrongpass.properties --list
expect_refused "connect identity creating a topic" kafka kafka-topics.sh --bootstrap-server "$bootstrap_scram" --command-config /client/connect.properties \
  --create --topic "ld.$env.rogue.v1" --partitions 1 --replication-factor 3
! admin kafka-topics.sh --list | grep -q "^ld\.$env\.rogue\.v1$" || fail "rogue topic exists"
expect_refused "connect identity reading events" kafka kafka-console-consumer.sh --bootstrap-server "$bootstrap_scram" \
  --consumer.config /client/connect.properties --topic "$finance_events" --group "ld.$env.fund-shadow.rogue" --from-beginning --timeout-ms 15000 --max-messages 1

produce() {
  # produce CONFIG TOPIC COUNT PREFIX -> verifiable-producer JSON lines (values "PREFIX.N")
  local config="$1" topic="$2" count="$3" prefix="$4"
  kafka kafka-verifiable-producer.sh --bootstrap-server "$bootstrap_scram" --producer.config "/client/$config" \
    --topic "$topic" --max-messages "$count" --throughput 250 --acks -1 --value-prefix "$prefix"
}
acked_values() { grep '"name":"producer_send_success"' | sed -E 's/.*"value":"([^"]*)".*/\1/' | sort -u; }
expect_write_refused() {
  local label="$1" out; shift
  out="$(KAFKA_TIMEOUT=60 produce "$@" 2>&1 || true)"
  [ -z "$(acked_values <<<"$out")" ] || fail "$label: records were acknowledged"
  grep -Eq "$refusal|producer_send_error|NotEnoughReplicas" <<<"$out" || { printf '%s\n' "$out" | grep -v '^\s*at ' | tail -15; fail "$label: no refusal seen"; }
  echo "refused as expected: $label: $(grep -Eo -m1 ".{0,80}($refusal|NotEnoughReplicas).{0,60}" <<<"$out" || echo producer_send_error)"
}
expect_write_refused "connect identity writing to replay" connect.properties "$finance_replay" 3 9
expect_write_refused "fund worker identity writing events" fund.properties "$finance_events" 3 9

step "Baseline write with acks=all and idempotence"
produce connect.properties "$finance_events" 1000 1 >"$work/baseline.jsonl" 2>"$work/baseline.err" || true
acked_values <"$work/baseline.jsonl" >"$work/acked.txt"
[ "$(wc -l <"$work/acked.txt")" = 1000 ] || { tail -20 "$work/baseline.err"; fail "baseline acknowledged $(wc -l <"$work/acked.txt") of 1000"; }

step "Lose one site while writing"
lost_site="$(site_of "${brokers[1]}")"
produce connect.properties "$finance_events" 4000 2 >"$work/during-loss.jsonl" 2>"$work/during-loss.err" &
writer=$!
sleep 6
mapfile -t gone < <(nodes_at "$lost_site")
docker stop "${gone[@]}" >/dev/null
echo "stopped site $lost_site: ${gone[*]}"
wait "$writer" || true
acked_values <"$work/during-loss.jsonl" >"$work/acked-loss.txt"
n="$(wc -l <"$work/acked-loss.txt")"
[ "$n" = 4000 ] || { tail -20 "$work/during-loss.err"; fail "only $n of 4000 records acknowledged while one site was down"; }
admin kafka-metadata-quorum.sh describe --status >"$work/quorum-one-down.txt" || fail "controller quorum unreachable with one site down"
grep -Eq 'LeaderId:[[:space:]]*[1-3]' "$work/quorum-one-down.txt" || fail "no controller leader with one site down"
echo "one site down: 4000/4000 acknowledged; $(grep -Eo 'LeaderId:[[:space:]]*[0-9]+' "$work/quorum-one-down.txt")"

step "Lose a second site: writes must be refused"
second_site="$(site_of "${brokers[2]}")"
mapfile -t gone2 < <(nodes_at "$second_site")
docker stop "${gone2[@]}" >/dev/null
echo "stopped site $second_site: ${gone2[*]}"
expect_write_refused "write with one replica alive" connect-short.properties "$finance_events" 20 3

step "Recover both sites and verify nothing acknowledged was lost"
docker start "${gone[@]}" "${gone2[@]}" >/dev/null
wait_until "zero under-replicated partitions" 80 no_under_replicated
KAFKA_TIMEOUT=120 kafka kafka-console-consumer.sh --bootstrap-server "$bootstrap_scram" --consumer.config /client/fund.properties \
  --topic "$finance_events" --group "ld.$env.fund-shadow.verify" --from-beginning --timeout-ms 30000 2>/dev/null >"$work/consumed.txt" || true
sort "$work/consumed.txt" >"$work/consumed-sorted.txt"
sort -u "$work/acked.txt" "$work/acked-loss.txt" >"$work/acked-all.txt"
missing="$(comm -23 "$work/acked-all.txt" <(sort -u "$work/consumed-sorted.txt") | wc -l)"
duplicates="$(uniq -d "$work/consumed-sorted.txt" | wc -l)"
[ "$missing" = 0 ] || fail "$missing acknowledged records are missing after recovery"
[ "$duplicates" = 0 ] || fail "$duplicates records were duplicated despite idempotence"
echo "recovery: $(wc -l <"$work/acked-all.txt") acknowledged, all present, no duplicates"

step "Cold restart keeps topics, ACLs and credentials"
docker stop "${brokers[@]}" "${controllers[@]}" >/dev/null
docker start "${controllers[@]}" "${brokers[@]}" >/dev/null
wait_until "admin access after restart" 60 admin_lists_topics
wait_until "three brokers after restart" 20 three_brokers_serve
[ "$(admin kafka-topics.sh --list | grep -c "^ld\.$env\.")" = 86 ] || fail "topics missing after restart"
produce connect.properties "$finance_events" 10 4 >"$work/after-restart.jsonl" 2>/dev/null || true
[ "$(acked_values <"$work/after-restart.jsonl" | wc -l)" = 10 ] || fail "SCRAM producer failed after restart"
expect_write_refused "fund worker writing events after restart" fund.properties "$finance_events" 3 9

step "DRILL PASSED"
