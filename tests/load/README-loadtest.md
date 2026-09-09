# Mars Overseas — Load Testing Guide (M4-1)

Target: **351 concurrent users** (national rollout headcount, effie benchmark)

---

## Prerequisites

### 1. Install k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### 2. Staging environment

**NEVER run load tests against production.**  
Use a dedicated staging server or a clone of the `mars` tenant:

```bash
# Option A: local dev server (single process, no Redis — useful for smoke only)
npm run dev
export BASE_URL=http://localhost:3000

# Option B: isolated Mars staging (preferred; never use a production tenant URL)
export BASE_URL=https://mars-staging.example.internal
export LOAD_TEST_ENVIRONMENT=staging
export CONFIRM_REMOTE_LOAD_TEST=mars-staging.example.internal
```

### 3. Seed test data

The scripts require real cuid values from the DB for `customerId` and `agentId`.  
The mars seed (`scripts/seeds/mars.mjs`) creates 5 agents and 25 customers.

```bash
# Read a unique, policy-compliant staging credential from the approved secret manager.
# Never paste it into this file or pass it as a command-line argument.
export LOAD_TEST_AGENT_PASSWORD='<read-from-secret-manager>'

# Run the Mars seed on the isolated staging DB. The confirmation is required by
# the seed for every non-local database; it does not authorize a production load test.
CONFIRM_PROD=1 SEED_PASSWORD="$LOAD_TEST_AGENT_PASSWORD" \
  node scripts/seeds/mars.mjs --slug=mars --reset-passwords

# Fetch real cuid lists for env vars
psql -h localhost leaddrive -c "
  SELECT string_agg(id, ',') FROM mtm_customers
  WHERE organization_id = (SELECT id FROM organizations WHERE slug='mars')
  LIMIT 25;" -t -A > /tmp/customer-ids.txt

psql -h localhost leaddrive -c "
  SELECT string_agg(id, ',') FROM mtm_agents
  WHERE organization_id = (SELECT id FROM organizations WHERE slug='mars');" -t -A > /tmp/agent-ids.txt
```

### 4. Obtain a test JWT

The auth endpoint accepts `{ email, password, organizationSlug }`:

```bash
# Authenticate as the staging-only seeded agent without placing its password in
# shell history or the curl process arguments. Keep the returned JWT in a 0600 file.
export LOAD_TEST_AGENT_EMAIL='farid@mars.leaddrivecrm.org'
umask 077
TOKEN_FILE="$(mktemp /tmp/mars-load-token.XXXXXX)"
trap 'rm -f "$TOKEN_FILE"' EXIT
jq -nc '{
  email: env.LOAD_TEST_AGENT_EMAIL,
  password: env.LOAD_TEST_AGENT_PASSWORD,
  organizationSlug: "mars"
}' | curl --fail-with-body --silent --show-error \
  -X POST "${BASE_URL}/api/v1/mtm/mobile/auth" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  | jq -er .token > "$TOKEN_FILE"
test -s "$TOKEN_FILE" && echo "Staging token acquired"
```

### 5. Rate limits

The photos endpoint enforces **30 uploads/min per agent** (`photos/route.ts`).  
Under 351 VUs with 60 photo VUs, expect ~429 responses during burst.

To disable rate limits on staging for load testing:
```bash
# Set in staging .env.local
LOAD_TEST_MODE=1       # disables rate limiting (implement guard in route.ts if needed)
# or raise limits:
MTM_PHOTO_RATE_LIMIT=1000   # env var in photos/route.ts rate-limit config
```

---

## Running the tests

Before every load/chaos command on this remote host, check available RAM,
swap, disk and current user-slice pressure. Do not start below 4 GiB available
RAM or while pressure is rising. Run one phase at a time, always through
`/home/codex-alt/.local/bin/codex-heavy-run`.

### Smoke test (5 VUs, 70 seconds — verify endpoints respond)

```bash
BASE_URL=http://localhost:3000 \
AGENT_TOKEN="$(< "$TOKEN_FILE")" \
AGENT_CUID_LIST="$(< /tmp/agent-ids.txt)" \
CUSTOMER_CUID_LIST="$(< /tmp/customer-ids.txt)" \
SMOKE=1 \
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run \
  tests/load/mars-overseas-full.js
```

### Full 351-user load test (15 minutes total)

```bash
BASE_URL="$BASE_URL" \
LOAD_TEST_ENVIRONMENT=staging \
CONFIRM_REMOTE_LOAD_TEST="$CONFIRM_REMOTE_LOAD_TEST" \
AGENT_TOKEN="$(< "$TOKEN_FILE")" \
AGENT_CUID_LIST="$(< /tmp/agent-ids.txt)" \
CUSTOMER_CUID_LIST="$(< /tmp/customer-ids.txt)" \
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run \
  --out json=k6-results-$(date +%Y%m%d-%H%M).json \
  tests/load/mars-overseas-full.js
```

### Individual scenario (for isolating bottlenecks)

```bash
# Location updates only
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run --env BASE_URL=... --env AGENT_TOKEN=... \
  tests/load/scenarios/location.js

# Photo uploads only (requires AGENT_CUID_LIST)
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run --env BASE_URL=... --env AGENT_TOKEN=... \
  --env AGENT_CUID_LIST=$(cat /tmp/agent-ids.txt) \
  tests/load/scenarios/photo-upload.js
```

### GPS batch cohort smoke (one approved staging device only)

The batch endpoint is cohort-gated and rate-limited by tenant/user/device.
Use an active staging workday and the **exact** device ID enrolled in the
`gps` cohort. This smoke is not a substitute for the S6 multi-tenant run.

```bash
BASE_URL="$BASE_URL" \
LOAD_TEST_ENVIRONMENT=staging \
CONFIRM_REMOTE_LOAD_TEST="$CONFIRM_REMOTE_LOAD_TEST" \
AGENT_TOKEN="$(< "$TOKEN_FILE")" \
FIELD_DEVICE_ID='approved-staging-device-id' \
MOBILE_GPS_WORKDAY_ID='active-staging-workday-id' \
GPS_BATCH_POINTS=20 \
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run tests/load/scenarios/mobile-gps-batch.js
```

Set `GPS_BATCH_REPLAY=1` only for the explicit idempotency smoke. Keep the
default bounded run under the device guard; do not target production.

### Routes v2 S6 morning sync storm (100 tenants / 5,000 distinct users)

This is an intentionally external staging fixture pool, not a seed or a
committed file. Obtain exactly-cohorted staging tokens from the approved secret
manager, save the JSON file with mode `0600`, and remove it after the run. Each
entry must contain `tenantId`, `agentId`, `deviceId`, `accessToken` and
`apkVersion`; the scenario rejects fewer than 100 tenants or 5,000 distinct
agents/devices. Do not reuse a token/device, and never point this at production.

```bash
BASE_URL="$BASE_URL" \
LOAD_TEST_ENVIRONMENT=staging \
CONFIRM_REMOTE_LOAD_TEST="$CONFIRM_REMOTE_LOAD_TEST" \
MOBILE_SYNC_V2_FIXTURE_POOL_FILE='/secure/staging/mobile-sync-v2-fixtures.json' \
/home/codex-alt/.local/bin/codex-heavy-run \
  k6 run tests/load/scenarios/mobile-sync-v2-routes.js
```

The scenario applies 0–120 seconds of login jitter, bootstraps each same
JWT/device pair to prove its declared tenant and exact routes cohort, completes
the snapshot, then makes one opaque-cursor delta pull per distinct device.
Check RAM, swap, disk and user-slice pressure immediately before starting it.
Keep the v2 device/user/tenant guard enabled. Before this gate, verify its
authenticated shared Redis topology, tenant hash-tag routing (when clustered),
key-capacity/eviction envelope and host clock synchronisation. An unavailable
guard must remain a stream-local `503`, never an in-process fallback; this
scenario cannot establish tenant fairness without that evidence.
Database failover, backup restore, process death and fault injection need
provisioned staging infrastructure and are **NOT RUN** until that exists.

---

## SLO targets

| Scenario | P95 target | P99 target | Notes |
|---|---|---|---|
| Location update | < 200 ms | < 500 ms | Upsert on indexed agentId |
| Visit check-in | < 300 ms | < 1 000 ms | INSERT + geofence check |
| Photo upload | < 1 500 ms | < 2 000 ms | Multipart + queue enqueue |
| Mobile sync/pull | < 1 000 ms | < 3 000 ms | Large JSON payload |
| Routes v2 snapshot/delta | < 500 ms | internal only | Exact device cohorts; S6 only |
| Ping | < 50 ms | < 100 ms | No DB — pure health |
| **All requests (composite)** | **< 500 ms** | **< 2 000 ms** | Overall HTTP SLO |

**Pass criteria**: error rate < 1%, all P95 thresholds green under 351 VUs for 10 minutes.

---

## VU distribution

Total VUs at peak = 351 (sum of all scenario targets):

| Scenario | VUs | % of 351 | Rationale |
|---|---|---|---|
| Location | 150 | 43% | All agents update every 30 s — concurrent at any instant |
| Visit check-in | 80 | 23% | ~80 agents checking in during busy hour |
| Photo upload | 60 | 17% | ~60 agents capturing visit evidence |
| Mobile sync | 61 | 17% | App startup / reconnect events |

k6 allocates an independent VU pool per scenario. The targets above are sized so the **total peak VU count = 351**, correctly modeling 351 concurrent users split across their real-world activities.

---

## Expected bottlenecks (pre-optimization baseline)

| Bottleneck | Impact | M4-2 fix |
|---|---|---|
| Mobile sync/pull: no pagination on customer list | Sync pull P99 > 3 000 ms at 351 users | Add `limit/offset` to pull route |
| Photo upload: disk I/O to `public/uploads/` | Photo P99 spikes under 60 concurrent | Move to object storage (S3) |
| BullMQ: single worker process | Queue depth grows under 351 uploads/min | Scale BullMQ worker replicas |

---

## Interpreting results

```bash
# Human-readable summary (k6 prints automatically at end of run)
/home/codex-alt/.local/bin/codex-heavy-run k6 run ... | tee k6-output.txt

# Extract P95 from JSON output
cat k6-results-*.json \
  | jq 'select(.type=="Point" and .metric=="http_req_duration")' \
  | jq -s 'sort_by(.data.value) | .[floor(length * 0.95)].data.value'
```

**Red flags**:
- `http_req_duration{p(95)}` > 500 ms → DB indexes needed (M4-2)
- `http_req_failed` rate > 1% → check server logs for 503/504
- `photo_success_rate` < 90% → rate-limit or BullMQ health issue
- Many 429s on photo upload → raise rate-limit per agent or add more AGENT_CUID_LIST entries

---

## CI/CD integration (GitHub Actions)

Add a smoke test after each production deploy:

```yaml
# .github/workflows/deploy.yml (extend the existing deploy job)
- name: Load test smoke
  run: |
    TOKEN="$(jq -nc '{
      email: env.LOAD_TEST_AGENT_EMAIL,
      password: env.LOAD_TEST_AGENT_PASSWORD,
      organizationSlug: "mars"
    }' | curl --fail-with-body --silent --show-error \
      -X POST "$STAGING_URL/api/v1/mtm/mobile/auth" \
      -H "Content-Type: application/json" --data-binary @- \
      | jq -er .token)"
    echo "::add-mask::$TOKEN"
    BASE_URL="$STAGING_URL" \
    LOAD_TEST_ENVIRONMENT=staging \
    CONFIRM_REMOTE_LOAD_TEST="$STAGING_HOST" \
    AGENT_TOKEN="$TOKEN" \
    AGENT_CUID_LIST="${{ secrets.MARS_AGENT_IDS }}" \
    CUSTOMER_CUID_LIST="${{ secrets.MARS_CUSTOMER_IDS }}" \
    SMOKE=1 \
    # This example runs in GitHub's isolated CI runner. On the remote host,
    # use codex-heavy-run after the required resource preflight instead.
    k6 run \
      tests/load/mars-overseas-full.js
  env:
    STAGING_URL: ${{ vars.MARS_STAGING_URL }}
    STAGING_HOST: ${{ vars.MARS_STAGING_HOST }}
    LOAD_TEST_AGENT_EMAIL: ${{ secrets.MARS_LOADTEST_AGENT_EMAIL }}
    LOAD_TEST_AGENT_PASSWORD: ${{ secrets.MARS_LOADTEST_AGENT_PASSWORD }}
```
