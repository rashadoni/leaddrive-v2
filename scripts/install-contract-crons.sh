#!/bin/bash
# Retired. The contract reminders (renewal alerts, approval escalations,
# milestone reminders, e-sign reminders) are installed by
# scripts/install-resilience-crons.sh, which every deploy runs; running this
# hand-run copy as well would schedule them twice. Revenue recognition posts
# append-only ledger entries and is switched on separately, by decision.
echo "install-contract-crons.sh is retired: deploys install contract reminders via install-resilience-crons.sh" >&2
exit 1
