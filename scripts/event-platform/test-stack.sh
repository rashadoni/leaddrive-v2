#!/usr/bin/env bash
# Disposable infrastructure smoke. Heavy services run only in GitHub CI.
set -euo pipefail

[ "${GITHUB_ACTIONS:-}" = true ] && [ "${LD_EVENT_STACK_DISPOSABLE:-}" = 1 ] || {
  echo 'FATAL: test stack runs only in the explicitly disposable GitHub job'; exit 1;
}
[[ "${LD_EVENT_STACK_PROJECT:-}" =~ ^ld-event-test-[a-z0-9][a-z0-9-]{0,40}$ ]] || {
  echo 'FATAL: an isolated test-project name is required'; exit 1;
}
[[ "${LD_EVENT_STACK_CDC:-0}" =~ ^[01]$ ]] || {
  echo 'FATAL: CDC fixture mode must be explicitly zero or one'; exit 1;
}
[[ "${LD_EVENT_STACK_DRIVER:-0}" =~ ^[01]$ ]] || {
  echo 'FATAL: broker driver fixture mode must be explicitly zero or one'; exit 1;
}
[[ "${LD_EVENT_STACK_COMBINED:-0}" =~ ^[01]$ ]] || {
  echo 'FATAL: combined database fixture mode must be explicitly zero or one'; exit 1;
}
[[ "${LD_EVENT_STACK_FULL_CDC_FUND:-0}" =~ ^[01]$ ]] || {
  echo 'FATAL: full CDC Fund mode must be explicitly zero or one'; exit 1;
}
[ "${LD_EVENT_STACK_FULL_CDC_FUND:-0}" = 0 ] || {
  [ "${LD_EVENT_STACK_CDC:-0}" = 0 ] && [ "${LD_EVENT_STACK_DRIVER:-0}" = 0 ] \
    && [ "${LD_EVENT_STACK_COMBINED:-0}" = 0 ] && [ "${FUND_SHADOW_DB_GATE:-}" = required ];
} || { echo 'FATAL: full CDC Fund requires its own isolated required-database phase'; exit 1; }
[ "${LD_EVENT_STACK_COMBINED:-0}" = 0 ] || { [ "${LD_EVENT_STACK_DRIVER:-0}" = 1 ] && [ "${FUND_SHADOW_DB_GATE:-}" = required ]; } || {
  echo 'FATAL: combined drill requires the broker phase and required database gate'; exit 1;
}
[ "${LD_EVENT_STACK_CDC:-0}" = 0 ] || [ "${LD_EVENT_STACK_DRIVER:-0}" = 0 ] || {
  echo 'FATAL: CDC and broker driver drills run as separate bounded phases'; exit 1;
}
task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
task_compose="$task_root/ops/event-platform/test/compose.yml"
compose() { docker compose -p "$LD_EVENT_STACK_PROJECT" -f "$task_compose" "$@"; }
http_get() {
  # Probe from the existing Connect container, not a host-published port.
  # Internal-only Docker bridges may suppress host port publication entirely.
  compose exec -T connect curl --fail --silent --show-error --max-time 3 "$1"
}
kafka_cli() {
  local command="$1"; shift
  compose exec -T -e KAFKA_HEAP_OPTS='-Xms32m -Xmx128m' kafka "/opt/kafka/bin/$command.sh" "$@"
}

available_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
[ "$available_kb" -ge 4194304 ] || { echo 'FATAL: test stack requires at least 4 GiB available memory'; exit 1; }
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$LD_EVENT_STACK_PROJECT")" ] || {
  echo 'FATAL: project already has containers; refusing to touch an existing run'; exit 1;
}
compose config --quiet
cleanup() {
  local task_status=$?
  if [ "$task_status" -ne 0 ]; then
    compose ps -a || true
    compose logs --no-color --tail 40 || true
  fi
  compose down --volumes --remove-orphans --timeout 10 || return 1
  return "$task_status"
}
trap cleanup EXIT

compose up -d postgres kafka
ready=0
for ((attempt=0; attempt<90; attempt++)); do
  if compose exec -T postgres pg_isready -U event_test -d event_platform_test >/dev/null 2>&1 \
    && kafka_cli kafka-broker-api-versions --bootstrap-server kafka:9092 >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo 'FATAL: test database/broker readiness deadline exceeded'; exit 1; }

[ "$(compose exec -T postgres psql -U event_test -d event_platform_test -X -qAt -c 'SHOW wal_level')" = logical ]
broker_config="$(kafka_cli kafka-configs --bootstrap-server kafka:9092 --entity-type brokers --entity-name 1 --describe --all)"
[[ "$broker_config" == *auto.create.topics.enable=false* ]]
for topic in ld.test.connect.config ld.test.connect.offset ld.test.connect.status; do
  kafka_cli kafka-topics --bootstrap-server kafka:9092 \
    --create --topic "$topic" --partitions 1 --replication-factor 1 --config cleanup.policy=compact
done
kafka_cli kafka-topics --bootstrap-server kafka:9092 \
  --create --topic ld.test.finance.events.v1 --partitions 2 --replication-factor 1

compose up -d connect registry
compose exec -T connect curl --version >/dev/null
ready=0
for ((attempt=0; attempt<120; attempt++)); do
  if http_get http://connect:8083/connectors >/dev/null 2>&1 \
    && http_get http://registry:8080/apis/registry/v3/system/info >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 2
done
[ "$ready" = 1 ] || { echo 'FATAL: test Connect/Registry readiness deadline exceeded'; exit 1; }
plugins="$(http_get http://connect:8083/connector-plugins)"
node -e 'const plugins=JSON.parse(process.argv[1]); const matches=Array.isArray(plugins)?plugins.filter(p=>p?.class==="io.debezium.connector.postgresql.PostgresConnector"):[]; if(matches.length!==1||matches[0].type!=="source"||matches[0].version!=="3.7.0.Final")process.exit(1)' "$plugins"

canary='synthetic-tenant:fund:synthetic-fund|{"scope":"synthetic-only","sequence":1}'
printf '%s\n' "$canary" | kafka_cli kafka-console-producer \
  --bootstrap-server kafka:9092 --topic ld.test.finance.events.v1 \
  --reader-property parse.key=true --reader-property 'key.separator=|' --command-property acks=all
received="$(kafka_cli kafka-console-consumer \
  --bootstrap-server kafka:9092 --topic ld.test.finance.events.v1 --from-beginning \
  --max-messages 1 --timeout-ms 15000 --formatter-property print.key=true --formatter-property 'key.separator=|')"
[ "$received" = "$canary" ] || { echo 'FATAL: test key/value transport mismatch'; exit 1; }
printf 'event_stack_scope=disposable-nonproduction\nevent_stack_topology=single-broker-not-ha\n'
printf 'event_stack_checks=logical-wal,explicit-topics,connect-postgres-plugin,registry-http,kafka-key-value\n'
printf 'event_stack_cdc_connector=not-started\nevent_stack_production_readiness=not-proven\nevent_stack_smoke=PASS\n'
if [ "${LD_EVENT_STACK_CDC:-0}" = 1 ]; then
  node "$task_root/scripts/event-platform/test-cdc.mjs"
fi
if [ "${LD_EVENT_STACK_DRIVER:-0}" = 1 ]; then
  "$task_root/ops/event-platform/driver/node_modules/.bin/tsx" "$task_root/scripts/event-platform/test-broker-driver.ts"
fi
if [ "${LD_EVENT_STACK_COMBINED:-0}" = 1 ]; then
  "$task_root/ops/event-platform/driver/node_modules/.bin/tsx" "$task_root/scripts/event-platform/test-broker-postgres.ts"
fi
if [ "${LD_EVENT_STACK_FULL_CDC_FUND:-0}" = 1 ]; then
  "$task_root/ops/event-platform/driver/node_modules/.bin/tsx" "$task_root/scripts/event-platform/test-cdc-fund-postgres.ts"
fi
