#!/usr/bin/env bash
# Layer 1 of docs/DELIVERY-ARCHITECTURE.md, as a script rather than a promise.
#
# The agent review of the pull request that introduced this architecture made
# the point that killed the previous design: a replacement control that is only
# described is not a control. So the enforcement lives here, is version
# controlled, is re-runnable, and is what every other repository copies.
#
# What it configures on `main`:
#   - changes arrive only through a pull request (no direct push, no force push,
#     no branch deletion)
#   - the checks GitHub itself runs must be green before merge: `pr-scope`,
#     `static-checks`, `typecheck`, `runner-policy`, `scan`
#   - no required approvals: the owner works alone, and a rule nobody can
#     satisfy is how production became undeployable in the first place
#
# 2026-09-11, решение владельца: обязательная проверка `agent-review` снята
# вместе со своим workflow. Её завели, когда искали, как сэкономить на старом
# аккаунте, и без секрета `ANTHROPIC_API_KEY` она намеренно зеленела вхолостую.
# Хуже того, она была ЕДИНСТВЕННОЙ обязательной: тесты и тайпчек обязательными
# не были вовсе, и красный PR проходил гейт. Теперь обязательно то, что
# реально проверяет код.
#
# Usage:  bash scripts/ci/configure-main-protection.sh [owner/repo]
set -euo pipefail

REPO="${1:-rashadoni/leaddrive-v2}"
BRANCH="${BRANCH:-main}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }

echo "Configuring branch protection on ${REPO}@${BRANCH}"

# Каждый из пяти контекстов обязан появляться на КАЖДОМ PR, иначе PR вне его
# путей навсегда повиснет на «Expected — waiting for status». Поэтому:
#   - `pr-checks.yml` запускается без path-фильтров, а тяжёлые `static-checks`
#     и `typecheck` пропускаются через `pr-scope`, если PR — только документация
#     (пропуск засчитывается как успех);
#   - `pr-scope` сам обязателен: упади он — зависимые джобы пропустились бы,
#     и пропуск открыл бы main для любого кода;
#   - `runner-policy` и `scan` (gitleaks) и так идут на каждом PR в main.
# Path-фильтрованные workflow (social-monitoring, tenant-delete) обязательными
# быть не могут и не являются.
gh api -X PUT "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["pr-scope", "static-checks", "typecheck", "runner-policy", "scan"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": false,
  "block_creations": false
}
JSON

echo
echo "Applied. Current state:"
gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --jq '{
    pull_request_only: (.required_status_checks != null),
    required_checks: .required_status_checks.contexts,
    force_pushes: .allow_force_pushes.enabled,
    deletions: .allow_deletions.enabled
  }'

echo
echo "Note: enforce_admins is false on purpose. The owner must retain a way to"
echo "recover production when a check itself is broken — that is a break-glass"
echo "path, not a routine one. Using it is worth saying out loud in the report."
