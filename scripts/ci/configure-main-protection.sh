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
#   - `agent-review` must be published for the exact head SHA after review by
#     an agent that did not author the change
#   - no required approvals: the owner works alone, and a rule nobody can
#     satisfy is how production became undeployable in the first place
#
# Старый workflow `agent-review` не возвращается: без `ANTHROPIC_API_KEY` он
# зеленел вхолостую. Гейт теперь дополняет пять машинных проверок и публикуется
# только после фактического независимого ревью точного SHA.
#
# Usage:  bash scripts/ci/configure-main-protection.sh [owner/repo]
set -euo pipefail

REPO="${1:-rashadoni/leaddrive-v2}"
BRANCH="${BRANCH:-main}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

echo "Configuring branch protection on ${REPO}@${BRANCH}"

# Каждый из шести контекстов обязан появляться на КАЖДОМ PR, иначе PR вне его
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
  -H "X-GitHub-Api-Version: 2022-11-28" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "pr-scope", "app_id": 15368 },
      { "context": "static-checks", "app_id": 15368 },
      { "context": "typecheck", "app_id": 15368 },
      { "context": "runner-policy", "app_id": 15368 },
      { "context": "scan", "app_id": 15368 },
      { "context": "agent-review", "app_id": -1 }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": false,
  "block_creations": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

echo
echo "Applied. Verifying exact live state:"
PROTECTION_JSON="$(gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28")"

# The update API accepts app_id=-1 to explicitly allow any publisher, then
# normalizes that sentinel to app_id=null in branch-protection readback.
if ! jq -e '
  .required_status_checks.strict == false
  and (
    [.required_status_checks.checks[] | {
      context,
      app_id: (
        if .context == "agent-review" and has("app_id") and .app_id == null
        then -1
        else .app_id
        end
      )
    }] | sort_by(.context)
  ) == ([
    {"context":"pr-scope","app_id":15368},
    {"context":"static-checks","app_id":15368},
    {"context":"typecheck","app_id":15368},
    {"context":"runner-policy","app_id":15368},
    {"context":"scan","app_id":15368},
    {"context":"agent-review","app_id":-1}
  ] | sort_by(.context))
  and .enforce_admins.enabled == true
  and .required_pull_request_reviews != null
  and .required_pull_request_reviews.dismiss_stale_reviews == false
  and .required_pull_request_reviews.require_code_owner_reviews == false
  and .required_pull_request_reviews.require_last_push_approval == false
  and .required_pull_request_reviews.required_approving_review_count == 0
  and .allow_force_pushes.enabled == false
  and .allow_deletions.enabled == false
' <<<"${PROTECTION_JSON}" >/dev/null; then
  echo "branch-protection readback does not match the fail-closed contract" >&2
  jq '{
    required_checks: .required_status_checks.checks,
    enforce_admins: .enforce_admins.enabled,
    pull_request_rule: .required_pull_request_reviews,
    force_pushes: .allow_force_pushes.enabled,
    deletions: .allow_deletions.enabled
  }' <<<"${PROTECTION_JSON}" >&2
  exit 1
fi

jq '{
  required_checks: .required_status_checks.checks,
  enforce_admins: .enforce_admins.enabled,
  pull_request_only: (.required_pull_request_reviews != null),
  required_approvals: .required_pull_request_reviews.required_approving_review_count,
  force_pushes: .allow_force_pushes.enabled,
  deletions: .allow_deletions.enabled
}' <<<"${PROTECTION_JSON}"
