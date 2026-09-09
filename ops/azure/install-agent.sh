#!/usr/bin/env bash
# Only the dedicated, already paid CI host. No production credentials.
set -Eeuo pipefail
test "$(id -u)" = 0
test "$(hostname)" = vmi3560127
: "${VSTS_AGENT_INPUT_TOKEN:?Short-lived registration token required}"
id azureci >/dev/null 2>&1 || useradd --create-home --shell /bin/bash azureci
usermod -aG docker azureci
install -d -o azureci -g azureci -m 0700 /opt/azure-agent-ci
if ! test -x /opt/azure-agent-ci/config.sh; then
  archive="$(mktemp)"
  trap 'rm -f "$archive"' EXIT
  curl --fail --location --connect-timeout 15 --max-time 180 \
    https://download.agent.dev.azure.com/agent/5.278.0/vsts-agent-linux-x64-5.278.0.tar.gz -o "$archive"
  printf 'daaee663e6557a98bb18e0d8e1d148110cca61230a68c61887748432c21a63e1  %s\n' "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C /opt/azure-agent-ci
  chown -R azureci:azureci /opt/azure-agent-ci
fi
if ! test -f /opt/azure-agent-ci/.agent; then
  runuser --preserve-environment -u azureci -- bash -c '
    export HOME=/home/azureci
    cd /opt/azure-agent-ci
    ./config.sh --unattended --url https://dev.azure.com/rashadrahimov --auth pat \
      --pool leaddrive-azure-build --agent leaddrive-azure-build-1 --work _work --acceptTeeEula
  '
fi
unset VSTS_AGENT_INPUT_TOKEN
cd /opt/azure-agent-ci
if ! test -f .service; then ./svc.sh install azureci; fi
service="$(cat .service)"
[[ "$service" = vsts.agent.*.service ]] || exit 2
install -d "/etc/systemd/system/${service}.d"
cat > "/etc/systemd/system/${service}.d/restart.conf" <<'UNIT'
[Unit]
StartLimitIntervalSec=900
StartLimitBurst=5
[Service]
Restart=on-failure
RestartSec=30
TimeoutStopSec=90
UNIT
install -o azureci -g azureci -m 0600 /dev/null /var/lock/leaddrive-azure-heavy.lock
systemctl daemon-reload
./svc.sh start
printf 'AZURE_BUILD_AGENT_READY\n'
