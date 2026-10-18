# Kafka operator readiness — append-only session journal

## 2026-10-19 — scope and baseline

User requests bounded A5 preparation and exact A7 inventory for all 27 domains;
no production mutations, consumer startup, offsets/replay, business sends,
merge/deploy or changes to another session's checks. Overall delivery remains
with «Проверить защиту Kafka-консюмера».

Ran codex-project-context from canonical cwd. Preserved dirty checkout on
fix/reply-matrix-ai-agent-label. Fetched origin/main 226dde0e7 and created clean
/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-kafka-operator-readiness,
branch codex/kafka-operator-readiness. Origin rashadoni/leaddrive-v2.
Deployment docs/registry confirm 13.140.132.245:/opt/leaddrive-v2, GitHub Actions
main artifact route. Stale Hetzner wording in AGENTS is superseded by host
contract and current deployment docs; no production action is authorized.

Inspected A1/A2 checkpoint e298057d94804417d38fb105d960721bae6fc1cc:
worker-admission/artifact and full CDC fixtures are on that branch, not this
main baseline. Do not cherry-pick or duplicate them. New real integration
receipts remain NOT RUN; earlier broker/SQL receipts cover their exact scope.

Plan: audit operator/lifecycle/effect boundaries; add an inactive, offline
alert-delivery receipt gate with negative tests (no sends); document 27-domain
source/effect/rebuild gaps; run small sequential checks and checkpoint commits.
