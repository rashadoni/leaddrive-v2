# Meta App Review preparation — session log

Append-only continuity log for preparing LeadDrive CRM for Meta App Review.

## 2026-09-20 — task intake and routing

- User requested public CRM privacy policy (including English), Meta-specific data-processing disclosures, public data-deletion instructions, CRM terms, in-app links, an OAuth-permission audit for Meta app `2414060595720618`, and a test-data reviewer demo covering tenant connection, inbound message, and CRM reply.
- Canonical checkout was dirty and on unrelated branch `fix/reply-matrix-ai-agent-label`; no files there were changed.
- Created dedicated worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-meta-app-review` on branch `codex/meta-app-review`, based on `origin/main` at `3e49f16f3`.
- Git remote: `https://github.com/rashadoni/leaddrive-v2.git`.
- Host contract identifies production as `13.140.132.245`, `/opt/leaddrive-v2`, with release through GitHub Actions from reviewed `main`.
- Repository `docs/DEPLOYMENT.md` and `clients/registry.json` still identify legacy Hetzner `46.224.171.53`. This conflicts with the host contract; production mutation is blocked until routing documentation is reconciled. No push, merge, or deploy was authorized or performed.
- Existing repository contains `/legal/privacy`, `/legal/terms`, and `/legal/data-deletion` source pages plus `docs/meta-app-review-submission.md`, but their content, routing, app ID, scopes, and implementation accuracy still require audit.

### Current stopping point

Audit of existing legal pages, routing, Meta OAuth scopes, persisted data, retention/deletion behavior, and reviewer demo prerequisites is in progress. No application source changes have been made yet.

## 2026-09-20 — canonical routing correction

- User confirmed that the old Hetzner host and `rashadrahimov/leaddrive-v2` are permanently retired. Canonical routing is Contabo `13.140.132.245` and `rashadoni/leaddrive-v2`.
- Correction to the earlier log entry: the dedicated worktree is based on current `origin/main`, where `docs/DEPLOYMENT.md` and `clients/registry.json` already contain the current Contabo/GitHub values. The stale values had been read from the dirty, outdated canonical checkout before the clean worktree was created.
- Strengthened `AGENTS.md`, `CLAUDE.md`, and `docs/DEPLOYMENT.md` with explicit permanent-retirement rules so future tasks cannot reuse the old repository or host.
- Production remains untouched; this task has not pushed, merged, or deployed anything.
