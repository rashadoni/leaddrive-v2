#!/usr/bin/env bash
# Decides whether the heavy pull-request gate may be skipped because the PR is a
# draft. Called by the `pr-scope` job of pr-checks.yml; writes `draft=true` or
# `draft=false` to $GITHUB_OUTPUT.
#
# Why the event payload alone is not enough
# -----------------------------------------
# `github.event.pull_request.draft` is a snapshot taken when the event was
# built, not the state of the pull request when the job runs. On 2026-10-09
# (PR #639) a session pushed a commit to a draft and marked it ready for review
# straight away. GitHub built the two events from two different stale views:
#
#   ready_for_review  draft: false, head: the PREVIOUS commit   (run 37872939100)
#   synchronize       draft: true,  head: the new commit        (run 37872940609)
#
# The first run was cancelled by the second (same concurrency group). The
# second saw `draft: true`, skipped static-checks and typecheck, and GitHub
# counts a skipped required check as passed — so a ready pull request showed
# `mergeStateStatus: CLEAN` on a commit no test and no typecheck had seen.
# Splitting the concurrency group would not have helped: the ready_for_review
# run was bound to the previous commit, so its checks would not have landed on
# the head at all.
#
# The rule
# --------
# The gate is skipped only when BOTH the event and the live pull request say
# "draft". The event is asked first because it is free; the pull request is
# read from the API a few seconds later, when the job is already running, by
# which time a ready-for-review made alongside the push is visible. If the API
# cannot be read, the answer is "not a draft": a doubt runs the gate, it never
# skips it.
#
# Environment: EVENT_NAME, EVENT_ACTION, EVENT_DRAFT, PR_NUMBER,
# GITHUB_REPOSITORY, GITHUB_OUTPUT, GH_TOKEN (for `gh`).
set -Eeuo pipefail

readonly ATTEMPTS=3
readonly RETRY_SLEEP_SECONDS="${PR_DRAFT_RETRY_SLEEP_SECONDS:-3}"

decide() {
  echo "draft=$1" >> "$GITHUB_OUTPUT"
  echo "pr-draft-state: draft=$1 — $2"
}

if [ "${EVENT_NAME:-}" != "pull_request" ]; then
  decide false "событие ${EVENT_NAME:-?}, не pull request"
  exit 0
fi

if [ "${EVENT_DRAFT:-}" != "true" ]; then
  decide false "событие ${EVENT_ACTION:-?} само говорит, что PR не черновик"
  exit 0
fi

live=""
for attempt in $(seq 1 "$ATTEMPTS"); do
  if live="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq '.draft')"; then
    break
  fi
  live=""
  echo "pr-draft-state: не удалось прочитать PR #${PR_NUMBER} (попытка ${attempt} из ${ATTEMPTS})" >&2
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    sleep "$RETRY_SLEEP_SECONDS"
  fi
done

case "$live" in
  true)
    decide true "черновик и в событии ${EVENT_ACTION:-?}, и сейчас: тяжёлые проверки ждут ready for review"
    ;;
  false)
    echo "::notice title=pr-scope::Событие ${EVENT_ACTION:-?} пришло с draft=true, но PR #${PR_NUMBER} уже не черновик — тяжёлые проверки идут."
    decide false "в событии ${EVENT_ACTION:-?} черновик, а сейчас PR уже не черновик"
    ;;
  *)
    echo "::warning title=pr-scope::Состояние PR #${PR_NUMBER} прочитать не удалось (ответ: '${live}'). Считаем, что не черновик: сомнение решается в пользу проверки."
    decide false "состояние PR не прочитано, гейт не пропускаем"
    ;;
esac
