#!/bin/bash
# Monthly budget snapshot — run on 1st of each month at 02:00
# Saves cost model values as BudgetActual records for the PREVIOUS month
# Do not add a checkout path to crontab. If this legacy script is scheduled,
# first add it to the reviewed ops/cron/release-script-allowlist.txt and use
# /usr/local/lib/leaddrive-v2/ops/current/cron-scripts/monthly-snapshot.sh.

set -e

BASE_URL="http://localhost:3001"
LOG="/var/log/leaddrive-snapshot.log"

# Calculate previous month (the month we're snapshotting)
PREV_MONTH=$(date -d "yesterday" +%Y-%m 2>/dev/null || date -v-1d +%Y-%m)

echo "$(date) — Starting monthly snapshot for $PREV_MONTH" >> "$LOG"

# 1. Create cost model snapshot
curl -s -X POST "$BASE_URL/api/cost-model/snapshot" \
  -H "Content-Type: application/json" \
  -H "x-organization-id: auto" \
  >> "$LOG" 2>&1

echo "" >> "$LOG"

# 2. Create budget actuals from snapshot (for previous month)
RESULT=$(curl -s -X POST "$BASE_URL/api/budgeting/snapshot-actuals" \
  -H "Content-Type: application/json" \
  -d "{\"month\": \"$PREV_MONTH\"}")

echo "$(date) — Snapshot actuals result: $RESULT" >> "$LOG"
echo "---" >> "$LOG"
