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
#   5. a cold restart keeps topics, ACLs and credentials;
#   6. the watch (health.mjs) reads this Kafka's own answers correctly: silent
#      when healthy, names the lost site, calls two lost sites critical;
#   7. the CDC slot keeps moving while only other tables change, and no
#      outbox row is lost across a connector restart in the middle of that.
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
uid="$(node -e "import('$repo/scripts/event-platform/cluster/render.mjs').then(m => console.log(m.KAFKA_UID))")"
# Like Kafka's Uuid.randomUuid(): never start with "-", which CLIs read as an option.
cluster_id="-"; while [ "${cluster_id#-}" != "$cluster_id" ]; do cluster_id="$(openssl rand -base64 16 | tr '+/' '-_' | cut -c1-22)"; done
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
    for name in $(docker ps -a --filter "label=$project" --format '{{.Names}}' | grep -E '^(kafka-|ld-drill-)'); do
      printf -- '--- errors of %s\n' "$name"; docker logs "$name" 2>&1 | grep -E 'ERROR|FATAL|Caused by|Exception:' | grep -v '^\s*at ' | tail -25 || true
      printf -- '--- last log lines of %s\n' "$name"; docker logs --tail 15 "$name" 2>&1 | grep -v '^\s*at ' || true
    done
  fi
  if [ "$status" -ne 0 ]; then
    for name in "${brokers[@]}"; do
      printf -- '--- authorization denials on %s\n' "$name"
      docker exec "$name" sh -c 'cat /tmp/kafka-logs/kafka-authorizer.log 2>/dev/null' | grep -i denied | sed -E 's/.*(Principal = [^ ]+).*(operation = [A-Za-z]+).*(resource = [^ ]+).*/\1 \2 \3/' | sort | uniq -c | tail -15 || true
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
bash "$pki" issue "$work/pki" ld-drill-postgres ld-drill-postgres
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
{ cat "$work/client/connect.properties"; printf 'delivery.timeout.ms=20000\nrequest.timeout.ms=10000\nmax.block.ms=5000\n'; } >"$work/client/connect-short.properties"
# Nodes run as the production Kafka uid; client tools as the image's appuser.
sudo chown -R "$uid:$uid" "$work/pki/issued" "$work/rendered"
sudo chown -R 1000:1000 "$work/client"

step "Start three controllers and three brokers"
docker network create --label "$project" "$net" >/dev/null
start_node() {
  local name="$1"
  docker volume create --label "$project" "$project-$name" >/dev/null
  # nocopy below keeps Docker from copying the image's appuser-owned data
  # directory (and its ownership) into the volume; production bind-mounts a
  # host directory owned by the Kafka uid instead.
  docker run --rm --label "$project" --user 0 -v "$project-$name:/d" --entrypoint /bin/chown "$image" "$uid:$uid" /d
  docker run -d --name "$name" --hostname "$name" --network "$net" --label "$project" \
    --env-file "$work/rendered/$name/kafka.env" --memory 1g --user "$uid:$uid" \
    -v "$work/rendered/$name/server.properties:/etc/kafka/server.properties:ro" \
    -v "$work/pki/issued/$name:/etc/kafka/tls:ro" \
    --mount "type=volume,src=$project-$name,dst=/var/lib/kafka/data,volume-nocopy=true" \
    --entrypoint /bin/bash "$image" -ec \
    '/opt/kafka/bin/kafka-storage.sh format --ignore-formatted --cluster-id="$CLUSTER_ID" -c /etc/kafka/server.properties && exec /opt/kafka/bin/kafka-server-start.sh /etc/kafka/server.properties' >/dev/null
}
for name in "${controllers[@]}" "${brokers[@]}"; do start_node "$name"; done

kafka() {
  # kafka TOOL ARGS... inside a throwaway client container, bounded by KAFKA_TIMEOUT seconds
  local tool="$1"; shift
  docker run --rm --network "$net" --label "$project" --user 1000:1000 \
    -e KAFKA_HEAP_OPTS='-Xms64m -Xmx256m' -v "$work/client:/client:ro" \
    --entrypoint /bin/bash "$image" -c 'exec timeout -k 10 "$0" /opt/kafka/bin/"$@"' "${KAFKA_TIMEOUT:-120}" "$tool" "$@"
}
admin() { local tool="$1"; shift; kafka "$tool" --bootstrap-server "$bootstrap_mtls" --command-config /client/admin.properties "$@"; }
wait_until() {
  # wait_until WHAT TRIES FUNCTION ARGS... (fails at once if a node container has exited)
  local what="$1" tries="$2"; shift 2
  for _ in $(seq "$tries"); do
    "$@" >/dev/null 2>&1 && return 0
    exited="$(docker ps -a --filter "label=$project" --filter status=exited --format '{{.Names}}' | grep '^kafka-' || true)"
    [ -z "$exited" ] || [ -n "${ALLOW_STOPPED:-}" ] || fail "node container exited while waiting for $what: $exited"
    sleep 3
  done
  fail "timed out waiting for $what"
}
admin_lists_topics() { KAFKA_TIMEOUT=15 admin kafka-topics.sh --list; }
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

step "The watch reads a healthy cluster as healthy"
watch_view() { # watch_view TAG -> "id severity" lines the watch would raise from the cluster's own answers
  KAFKA_TIMEOUT=40 admin kafka-metadata-quorum.sh describe --status >"$work/watch-$1-status.txt" 2>/dev/null || true
  KAFKA_TIMEOUT=40 admin kafka-metadata-quorum.sh describe --replication >"$work/watch-$1-replication.txt" 2>/dev/null || true
  KAFKA_TIMEOUT=60 admin kafka-topics.sh --describe >"$work/watch-$1-topics.txt" 2>/dev/null || true
  node "$repo/scripts/event-platform/cluster/health.mjs" cluster "$work/watch-$1-status.txt" "$work/watch-$1-replication.txt" "$work/watch-$1-topics.txt"
}
out="$(watch_view healthy)"
[ -z "$out" ] || { printf '%s\n' "$out"; fail "the watch sees problems on a healthy cluster"; }
echo "watch: no problems on $(grep -c 'Partition:' "$work/watch-healthy-topics.txt") healthy partitions"

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
  # Refused means: the producer really started and nothing was acknowledged.
  # A producer blocked on an unreachable quorum may be killed before it can
  # print an error, so silence after startup_complete also counts.
  grep -Eq "$refusal|producer_send_error|NotEnoughReplicas|startup_complete" <<<"$out" || { printf '%s\n' "$out" | grep -v '^\s*at ' | tail -15; fail "$label: producer never started"; }
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
lost_broker="${brokers[1]}"
lost_controller="$(for n in "${gone[@]}"; do [[ " ${controllers[*]} " == *" $n "* ]] && echo "$n"; done)"
watch_names_lost_site() {
  local out; out="$(watch_view one-down)"
  grep -q "^broker:$lost_broker warning$" <<<"$out" && grep -q "^controller:$lost_controller warning$" <<<"$out" \
    && grep -q '^partitions-under-replicated warning$' <<<"$out"
}
ALLOW_STOPPED=1 wait_until "the watch to name the lost site" 20 watch_names_lost_site
! grep -q ' critical$' <<<"$(watch_view one-down)" || { cat "$work/watch-one-down-status.txt"; fail "one lost site must not read as critical"; }
echo "watch with $lost_site down: $(watch_view one-down | tr '\n' ';')"

step "Lose a second site: writes must be refused"
second_site="$(site_of "${brokers[2]}")"
mapfile -t gone2 < <(nodes_at "$second_site")
docker stop "${gone2[@]}" >/dev/null
echo "stopped site $second_site: ${gone2[*]}"
expect_write_refused "write with one replica alive" connect-short.properties "$finance_events" 5 3
out="$(watch_view two-down)"
grep -q ' critical$' <<<"$out" || { printf '%s\n' "$out"; fail "two lost sites must read as critical"; }
echo "watch with two sites down: $(tr '\n' ';' <<<"$out")"

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

step "Platform topics and every service ACL from the policy"
services="$repo/scripts/event-platform/cluster/services.mjs"
node --input-type=module -e "
  import { infraTopics } from '$services'
  for (const t of infraTopics('$env')) console.log([t.name, t.partitions, t.replicationFactor, Object.entries(t.config).map(([k, v]) => k + '=' + v).join(',')].join('\t'))
" >"$work/infra-topics.tsv"
sudo install -o 1000 -g 1000 -m 0644 "$work/infra-topics.tsv" "$work/client/infra-topics.tsv"
docker run --rm --network "$net" --label "$project" --user 1000:1000 -e KAFKA_HEAP_OPTS='-Xms64m -Xmx256m' \
  -v "$work/client:/client:ro" --entrypoint /bin/bash "$image" -ec '
    while IFS=$'"'"'\t'"'"' read -r name partitions rf config; do
      args=(); IFS=, read -ra kv <<<"$config"; for c in "${kv[@]}"; do args+=(--config "$c"); done
      /opt/kafka/bin/kafka-topics.sh --bootstrap-server "$0" --command-config /client/admin.properties \
        --create --if-not-exists --topic "$name" --partitions "$partitions" --replication-factor "$rf" "${args[@]}" >/dev/null
    done </client/infra-topics.tsv' "$bootstrap_mtls"
password[ld-registry]="$(openssl rand -hex 24)"
admin kafka-configs.sh --alter --entity-type users --entity-name ld-registry \
  --add-config "SCRAM-SHA-512=[iterations=8192,password=${password[ld-registry]}]" >/dev/null
node --input-type=module -e "
  import { aclBindings } from '$services'
  import { expandCatalog, loadCatalog } from '$repo/scripts/event-platform/cluster/render.mjs'
  for (const args of aclBindings('$env', expandCatalog(loadCatalog(), '$env'))) console.log(JSON.stringify(args))
" >"$work/acls.jsonl"
while read -r line; do
  mapfile -t acl < <(node -e 'for (const a of JSON.parse(process.argv[1])) console.log(a)' "$line")
  admin kafka-acls.sh --add "${acl[@]}" >/dev/null
done <"$work/acls.jsonl"
echo "$(wc -l <"$work/acls.jsonl") ACL bindings applied from services.mjs"

step "PostgreSQL source with TLS and an INSERT-only outbox publication"
pg=ld-drill-postgres
mkdir -p "$work/pgtls"
# issued/ belongs to the Kafka uid by now; read the PostgreSQL pair as root.
sudo cat "$work/pki/issued/$pg/node.pem" | awk '/BEGIN PRIVATE KEY/,/END PRIVATE KEY/' >"$work/pgtls/server.key"
sudo cat "$work/pki/issued/$pg/node.pem" | awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' >"$work/pgtls/server.crt"
sudo chown -R 70:70 "$work/pgtls"; sudo chmod 0600 "$work/pgtls/server.key"
pg_password="$(openssl rand -hex 16)"; cdc_password="$(openssl rand -hex 16)"
docker run -d --name "$pg" --hostname "$pg" --network "$net" --label "$project" \
  -e POSTGRES_PASSWORD="$pg_password" -e POSTGRES_DB=leaddrive -v "$work/pgtls:/tls:ro" \
  postgres:16.13-alpine@sha256:4941ef97aaa2633ce9808f7766f8b8d746dd039ce8c51ca6da185c3dc63ab579 \
  -c wal_level=logical -c max_replication_slots=4 -c max_wal_senders=4 -c max_slot_wal_keep_size=256MB \
  -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key >/dev/null
pg_ready() { docker exec "$pg" pg_isready -U postgres -d leaddrive >/dev/null 2>&1; }
wait_until "PostgreSQL" 40 pg_ready
# Logical replication connections need their own pg_hba line; TLS is mandatory for it.
docker exec "$pg" sh -c 'echo "hostssl replication leaddrive_event_cdc all scram-sha-256" >>"$PGDATA/pg_hba.conf"'
docker exec "$pg" psql -qU postgres -c 'SELECT pg_reload_conf()' >/dev/null
outbox_row() { # outbox_row N -> one INSERT for a finance event of tenant A or B
  local n="$1" org="org-$(( $1 % 2 ))" key="org-$(( $1 % 2 )):fund:fund-1"
  printf "INSERT INTO \"event_outbox\" (\"organizationId\", \"eventId\", \"eventType\", topic, \"partitionKey\", envelope, \"payloadHash\") VALUES ('%s', gen_random_uuid(), 'finance.fund-transaction-recorded.v1', 'leaddrive.domain.finance.v1', '%s', jsonb_build_object('aggregateversion', %d, 'n', %d), encode(sha256(convert_to('%d', 'UTF8')), 'hex'));\n" "$org" "$key" "$n" "$n" "$n"
}
{
  # The exact table definition from the foundation migration: column types
  # decide how Debezium encodes each field (TIMESTAMP(3) -> INT64 for EventRouter).
  awk '/CREATE TABLE "event_outbox"/,/\);/' "$repo/prisma/migrations/20260901090000_event_platform_foundation/migration.sql"
  cat <<SQL
CREATE ROLE leaddrive_event_cdc LOGIN REPLICATION PASSWORD '$cdc_password';
GRANT SELECT ON public.event_outbox TO leaddrive_event_cdc;
CREATE PUBLICATION leaddrive_event_outbox FOR TABLE public.event_outbox WITH (publish = 'insert');
SQL
  for n in 1 2 3; do outbox_row "$n"; done
} | docker exec -i "$pg" psql -v ON_ERROR_STOP=1 -qU postgres -d leaddrive >/dev/null

step "Debezium Connect worker and Apicurio Registry over SCRAM/TLS"
inventory_services="$work/inventory-services.json"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ hosts: {
  'kafka-p-broker-eu': { address: 'kafka-p-broker-eu' }, 'kafka-p-broker-uk': { address: 'kafka-p-broker-uk' },
  'kafka-p-broker-gra': { address: 'kafka-p-broker-gra' }, 'kafka-p-connect-eu': { address: 'kafka-p-connect-eu' } } }))" "$inventory_services"
mkdir -p "$work/svc"
node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'node:fs'
  import { renderServiceHost, connectSecretEnv, registrySecretEnv } from '$services'
  import { loadTopology } from '$repo/scripts/event-platform/cluster/render.mjs'
  const files = renderServiceHost({ topology: loadTopology(), inventory: JSON.parse(readFileSync('$inventory_services', 'utf8')),
    clusterName: 'primary', envName: '$env', hostName: 'kafka-p-connect-eu', heap: { connect: 512, registry: 256 } })
  for (const [k, v] of Object.entries(files)) writeFileSync('$work/svc/' + k, v)
  writeFileSync('$work/svc/connect.secret.env', connectSecretEnv('${password[ld-connect]}'))
  writeFileSync('$work/svc/registry.secret.env', registrySecretEnv('${password[ld-registry]}'))
"
docker run -d --name kafka-p-connect-eu --hostname kafka-p-connect-eu --network "$net" --label "$project" --memory 1g \
  --env-file "$work/svc/connect.env" --env-file "$work/svc/connect.secret.env" \
  -v "$work/client/ca.pem:/etc/kafka/tls/ca.pem:ro" \
  ghcr.io/rashadoni/debezium-connect:3.7.0.Final-8107474c18d5@sha256:8107474c18d56317c007dd930f2782c9636198a895144a0c1dddd6d6a7536d6e >/dev/null
# One host name cannot belong to two containers here; production binds both to the host's overlay address.
docker run -d --name kafka-p-connect-eu-registry --network "$net" --label "$project" --memory 768m \
  --env-file "$work/svc/registry.env" --env-file "$work/svc/registry.secret.env" -e QUARKUS_HTTP_HOST=0.0.0.0 \
  -v "$work/client/ca.pem:/etc/kafka/tls/ca.pem:ro" \
  apicurio/apicurio-registry:3.3.0@sha256:25b302bc1ecf53cb01bda4f39749f175c94f3f6d27dcc57123d25714e4a0b117 >/dev/null
connect_up() { docker exec kafka-p-connect-eu curl -fsS http://kafka-p-connect-eu:8083/connectors >/dev/null; }
registry_up() { docker exec kafka-p-connect-eu curl -fsS http://kafka-p-connect-eu-registry:8080/apis/registry/v3/system/info >/dev/null; }
wait_until "Connect REST against the secured cluster" 60 connect_up
wait_until "Registry on KafkaSQL storage" 60 registry_up

step "Outbox rows flow PostgreSQL -> Debezium -> Kafka with keys and headers"
node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
  const s = JSON.stringify(t).replaceAll("__ENV__", process.argv[2]).replaceAll("__PGHOST__", "ld-drill-postgres")
    .replaceAll("__PGDATABASE__", "leaddrive").replaceAll("__SECRET_FROM_PROVIDER__", process.argv[3])
    .replaceAll("__PG_SSL_ROOT_CERT_PATH__", "/etc/kafka/tls/ca.pem")
  if (/__[A-Z_]+__/.test(s)) throw new Error("unresolved placeholder in connector")
  const c = JSON.parse(s)
  import(process.argv[4]).then((m) => { Object.assign(c.config, m.slotHeartbeat(process.argv[2])); process.stdout.write(JSON.stringify(c)) })
' "$repo/ops/event-platform/debezium/event-outbox-connector.template.json" "$env" "$cdc_password" "$services" >"$work/connector.json"
docker exec -i kafka-p-connect-eu curl -fsS -X POST -H 'Content-Type: application/json' --data @- \
  http://kafka-p-connect-eu:8083/connectors <"$work/connector.json" >/dev/null || fail "connector registration rejected"
connector_status() { docker exec kafka-p-connect-eu curl -fsS "http://kafka-p-connect-eu:8083/connectors/leaddrive-event-outbox-$env/status"; }
# Connector and its single task both report RUNNING.
connector_running() { [ "$(connector_status | grep -o '"state" *: *"RUNNING"' | wc -l)" -ge 2 ]; }
for _ in $(seq 40); do connector_running && break; sleep 3; done
connector_running || { connector_status | cut -c1-1500; echo; fail "connector task is not RUNNING"; }
for n in 4 5 6; do outbox_row "$n"; done | docker exec -i "$pg" psql -v ON_ERROR_STOP=1 -qU postgres -d leaddrive >/dev/null
sleep 10
KAFKA_TIMEOUT=90 kafka kafka-console-consumer.sh --bootstrap-server "$bootstrap_scram" --consumer.config /client/fund.properties \
  --topic "$finance_events" --group "ld.$env.fund-shadow.cdc" --from-beginning --timeout-ms 20000 \
  --property print.key=true --property print.headers=true 2>/dev/null | grep '"aggregateversion"' >"$work/cdc.txt" || true
[ "$(wc -l <"$work/cdc.txt")" = 6 ] || { cat "$work/cdc.txt"; fail "expected 6 outbox events in Kafka (3 snapshot + 3 streamed), got $(wc -l <"$work/cdc.txt")"; }
grep -q 'eventtype:finance.fund-transaction-recorded.v1' "$work/cdc.txt" || fail "eventtype header missing"
grep -q 'organizationid:org-1' "$work/cdc.txt" || fail "organizationid header missing"
grep -Eq '(^|[[:space:]])org-0:fund:fund-1[[:space:]]' "$work/cdc.txt" || fail "partition key is not the outbox partitionKey"
echo "6/6 outbox rows (3 snapshot, 3 streamed) arrived over SCRAM/TLS from a verify-full PostgreSQL source, with key and headers"

step "The CDC slot keeps moving while only other tables change"
pgq() { docker exec -i "$pg" psql -XAtq -v ON_ERROR_STOP=1 -U postgres -d leaddrive "$@"; }
other_traffic() { pgq -c 'INSERT INTO other_traffic (pad) SELECT repeat(md5(g::text), 32) FROM generate_series(1, 20000) g' >/dev/null; }
pgq -c 'CREATE TABLE other_traffic (id bigserial PRIMARY KEY, pad text)' >/dev/null
other_traffic
target="$(pgq -c 'select pg_current_wal_lsn()')"
slot_sql="from pg_replication_slots where slot_name = 'leaddrive_event_outbox_$env'"
slot_caught_up() { [ "$(pgq -c "select pg_wal_lsn_diff(confirmed_flush_lsn, '$target') >= 0 $slot_sql")" = t ]; }
for _ in $(seq 40); do slot_caught_up && break; sleep 3; done
slot_caught_up || { pgq -c "select slot_name, active, confirmed_flush_lsn, pg_current_wal_lsn() $slot_sql"; fail "the slot did not confirm WAL written to other tables (target $target)"; }
echo "slot confirmed past $target with no outbox row; it now holds $(pgq -c "select pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) $slot_sql") of WAL"

# Confirming positions nobody subscribes to must never skip an outbox row:
# interleave rows with other traffic and restart the task in the middle.
for n in 7 8 9; do outbox_row "$n"; done | pgq >/dev/null
other_traffic
docker exec kafka-p-connect-eu curl -fsS -X POST "http://kafka-p-connect-eu:8083/connectors/leaddrive-event-outbox-$env/restart?includeTasks=true" >/dev/null \
  || fail "connector restart rejected"
other_traffic
for n in 10 11 12; do outbox_row "$n"; done | pgq >/dev/null
other_traffic
for _ in $(seq 40); do connector_running && break; sleep 3; done
connector_running || { connector_status | cut -c1-1500; echo; fail "connector task is not RUNNING after restart"; }
sleep 15
KAFKA_TIMEOUT=90 kafka kafka-console-consumer.sh --bootstrap-server "$bootstrap_scram" --consumer.config /client/fund.properties \
  --topic "$finance_events" --group "ld.$env.fund-shadow.cdc-restart" --from-beginning --timeout-ms 20000 2>/dev/null \
  | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' | sort -n | uniq >"$work/cdc-restart.txt" || true
missing="$(comm -23 <(seq 1 12 | sort) <(sort "$work/cdc-restart.txt"))"
[ -z "$missing" ] || fail "outbox rows missing after the restart: $(tr '\n' ' ' <<<"$missing")"
slot_caught_up || fail "the slot fell behind after the restart"
echo "12/12 outbox rows in Kafka across a task restart amid other traffic"

step "A foreign logical-decoding message neither kills the task nor reaches Kafka"
# Production 2026-10-25 13:04 UTC: one message with an unexcluded prefix was
# routed to the unwritable cdc-source.message topic and killed the task.
pgq -c "select pg_logical_emit_message(true, 'drill-foreign-prefix', 'must not leave PostgreSQL')" >/dev/null
outbox_row 13 | pgq >/dev/null
sleep 15
connector_running || { connector_status | cut -c1-1500; echo; fail "a foreign logical message killed the connector task"; }
KAFKA_TIMEOUT=90 kafka kafka-console-consumer.sh --bootstrap-server "$bootstrap_scram" --consumer.config /client/fund.properties \
  --topic "$finance_events" --group "ld.$env.fund-shadow.cdc-foreign" --from-beginning --timeout-ms 20000 2>/dev/null \
  | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' | sort -n | uniq >"$work/cdc-foreign.txt" || true
grep -qx 13 "$work/cdc-foreign.txt" || fail "the outbox row after the foreign message did not reach Kafka"
slot_caught_up || fail "the slot fell behind after the foreign message"
echo "foreign message skipped; task RUNNING; the next outbox row arrived"

step "Registry keeps schemas in Kafka across a restart"
schema='{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","required":["amount"],"properties":{"amount":{"type":"string"}}}'
body="$(node -e 'console.log(JSON.stringify({ artifactId: "fund-transaction-recorded", artifactType: "JSON", firstVersion: { content: { content: process.argv[1], contentType: "application/json" } } }))' "$schema")"
printf '%s' "$body" | docker exec -i kafka-p-connect-eu curl -fsS -X POST -H 'Content-Type: application/json' --data @- \
  "http://kafka-p-connect-eu-registry:8080/apis/registry/v3/groups/drill/artifacts" >/dev/null || fail "registry rejected the schema"
schema_content() { docker exec kafka-p-connect-eu curl -fsS "http://kafka-p-connect-eu-registry:8080/apis/registry/v3/groups/drill/artifacts/fund-transaction-recorded/versions/branch=latest/content"; }
wait_until "schema readable before restart" 20 schema_content
docker restart kafka-p-connect-eu-registry >/dev/null
wait_until "Registry after restart" 60 registry_up
# The HTTP endpoint answers before KafkaSQL has replayed its journal.
for _ in $(seq 30); do schema_content >/dev/null 2>&1 && break; sleep 3; done
fetched="$(schema_content)" || fail "schema lost after registry restart"
grep -q '"amount"' <<<"$fetched" || fail "schema content changed after restart"
echo "schema registered, registry restarted, schema read back from the KafkaSQL journal"

step "DRILL PASSED"
