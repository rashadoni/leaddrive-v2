#!/usr/bin/env bash
# Publish the independent-review gate only for the current head of a pull
# request. This script does not perform the review; it is for the separate
# reviewing agent after that review has actually finished.
set -euo pipefail

REPO="${REPO:-rashadoni/leaddrive-v2}"
PR_NUMBER="${1:?usage: $0 PR_NUMBER HEAD_SHA STATE DESCRIPTION [TARGET_URL]}"
HEAD_SHA="${2:?usage: $0 PR_NUMBER HEAD_SHA STATE DESCRIPTION [TARGET_URL]}"
STATE="${3:?usage: $0 PR_NUMBER HEAD_SHA STATE DESCRIPTION [TARGET_URL]}"
DESCRIPTION="${4:?usage: $0 PR_NUMBER HEAD_SHA STATE DESCRIPTION [TARGET_URL]}"
TARGET_URL="${5:-https://github.com/${REPO}/pull/${PR_NUMBER}}"

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }

if [[ ! "${PR_NUMBER}" =~ ^[1-9][0-9]*$ ]]; then
  echo "PR_NUMBER must be a positive integer" >&2
  exit 1
fi

if [[ ! "${HEAD_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "HEAD_SHA must be a full lowercase 40-character commit SHA" >&2
  exit 1
fi

case "${STATE}" in
  pending|success|failure|error) ;;
  *) echo "state must be pending, success, failure, or error" >&2; exit 1 ;;
esac

if [[ -z "${DESCRIPTION}" || ${#DESCRIPTION} -gt 140 ]]; then
  echo "DESCRIPTION must contain 1-140 characters" >&2
  exit 1
fi

if ! PR_DATA="$(
  gh api "repos/${REPO}/pulls/${PR_NUMBER}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    --jq '[.head.sha, .base.ref, .state] | @tsv'
)"; then
  echo "could not query the pull request" >&2
  exit 1
fi

IFS=$'\t' read -r CURRENT_HEAD BASE_REF PR_STATE <<<"${PR_DATA}"

if [[ -z "${CURRENT_HEAD:-}" || -z "${BASE_REF:-}" || -z "${PR_STATE:-}" ]]; then
  echo "could not read the pull request head, base, and state" >&2
  exit 1
fi

if [[ "${PR_STATE}" != "open" ]]; then
  echo "refusing review status for non-open PR: state is ${PR_STATE}" >&2
  exit 1
fi

if [[ "${BASE_REF}" != "main" ]]; then
  echo "refusing review status for PR targeting ${BASE_REF}, not main" >&2
  exit 1
fi

if [[ "${CURRENT_HEAD}" != "${HEAD_SHA}" ]]; then
  echo "refusing stale review: PR head is ${CURRENT_HEAD}, not ${HEAD_SHA}" >&2
  exit 1
fi

gh api -X POST "repos/${REPO}/statuses/${HEAD_SHA}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -f state="${STATE}" \
  -f context=agent-review \
  -f description="${DESCRIPTION}" \
  -f target_url="${TARGET_URL}" >/dev/null

echo "Published agent-review=${STATE} for ${REPO}#${PR_NUMBER}@${HEAD_SHA}"
