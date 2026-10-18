# Kafka infrastructure readiness — append-only session journal

## 2026-10-19 — scope and baseline
- User requests A4 preparation with no new servers/services/costs; limited validators, tests and runbook. No production, firewall, PostgreSQL/WAL/slot, consumer, offset or replay changes; no merge/deploy. Overall delivery remains with «Проверить защиту Kafka-консюмера».
- Read AGENTS.md and ran codex-project-context in canonical checkout and dedicated worktree. Dirty canonical checkout preserved.
- Fetched origin/main; baseline 226dde0e77c0c36a4de991bb703ba8f8416c5a64. Branch codex/kafka-infrastructure-readiness; worktree /mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-infrastructure-readiness.
- Origin https://github.com/rashadoni/leaddrive-v2.git. Registry/deployment agree on 13.140.132.245:/opt/leaddrive-v2, GitHub Actions main -> SHA-bound artifact. AGENTS historical Hetzner wording is superseded by host contract and current deployment docs.
- Plan: reconcile repository evidence; strengthen finite budget and topology/security admission; run sequential bounded checks; checkpoint source and report activation blockers. No live production inspection is claimed.
