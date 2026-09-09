#!/usr/bin/env bash
# Provider-neutral TypeScript gate preserving crash/OOM blocking semantics.
set -Eeuo pipefail

REPORT_DIR="${LEADDRIVE_CI_REPORT_DIR:-${RUNNER_TEMP:-${AGENT_TEMPDIRECTORY:-/tmp}}}"
mkdir -p "$REPORT_DIR"
HEAP_MIB="${LEADDRIVE_TYPECHECK_HEAP_MIB:-11264}"
[[ "$HEAP_MIB" =~ ^[0-9]+$ ]] || { echo "typecheck: LEADDRIVE_TYPECHECK_HEAP_MIB must be numeric" >&2; exit 2; }

if [ "${LEADDRIVE_DEPS_READY:-0}" = "1" ]; then
    test -d node_modules/.prisma/client
  elif [ "${LEADDRIVE_USE_WARM_INSTALL:-1}" = "1" ] && [ -f scripts/ci/self-hosted-warm-install.sh ]; then
  RUNNER_ENVIRONMENT=self-hosted bash scripts/ci/self-hosted-warm-install.sh deps
  RUNNER_ENVIRONMENT=self-hosted bash scripts/ci/self-hosted-warm-install.sh prisma prisma/schema.prisma node_modules/.prisma/client
else
  npm ci --include=dev
  npx prisma generate
fi

ulimit -c 0 || true
set +e
NODE_OPTIONS="--max-old-space-size=${HEAP_MIB}" npx tsc --noEmit 2>&1 | tee "$REPORT_DIR/tsc-output.log"
tsc_status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$tsc_status" > "$REPORT_DIR/tsc-exit-code"
cp "$REPORT_DIR/tsc-output.log" tsc-output.log
cp "$REPORT_DIR/tsc-exit-code" tsc-exit-code
bash scripts/ci/check-typecheck-gate.sh tsc-output.log tsc-exit-code
node scripts/ci/check-typecheck-baseline.mjs tsc-output.log
