# Bright Data TikTok positive-path canary — operator runbook

Owner decision (updated 2026-07-21): TikTok and Facebook are **Bright Data-only**.
Instagram discovery/comments have a separate pinned Apify carve-out; it is not
part of this TikTok canary. `TT-SD-016` is **not fully proven** until the Bright
Data **comments** stage passes a positive-path production canary. This runbook
executes that canary safely, for the **brandprotection tenant only**.

> **This runbook requires production access + admin credentials + a temporary
> routing flip + real (bounded) Bright Data spend.** It was authored, but **NOT
> executed**, in the harness session that landed the code hardening: that
> session had no production SSH access (blocked) and no admin password. Execute
> it from a session/operator that has production access, or hand it to the owner.

## Hard safety rails (do not skip)

- Tenant: **brandprotection only.** Never add any other org to the allowlist.
  No Mars/AFI.
- **Never print** the Bright Data API token, admin password, or any secret.
- Live routing is enabled **only** for the bounded canary and **must** be
  returned to `0` immediately after (Step 6, mandatory).
- Comments provider runs **only** for `MATCHED` / opted-in `PROBABLE`
  publications. Never for `REVIEW` / `REJECTED`.
- External replies stay **disabled** for the entire canary.
- The Bright Data API token was exposed earlier in chat/screenshot — **reissue
  it before spend** (does not block read-only steps 0).

Let `ORG` = the brandprotection organization id. Let `SRC` =
`cmrlscyhx0036506ruferpk9c` (existing TikTok keyword source `araz supermarket`).
All API calls are authenticated as a brandprotection **admin/superadmin** against
`https://app.leaddrivecrm.org`.

## Step 0 — Read-only audit (no spend, safe to run anytime)

Confirm the starting posture and find any Apify residue to invalidate.

```sql
-- Any Apify route plan for the TikTok/FB Bright Data-only platforms (expect 0 ACTIVE):
SELECT id, platform, capability, "primaryAdapter", "fallbackAdapters",
       "acquisitionMode", status
FROM source_route_plans
WHERE "organizationId" = :ORG
  AND platform IN ('tiktok','facebook')
  AND (status <> 'INVALIDATED')
  AND ('APIFY_ASYNC' = ANY("fallbackAdapters")
       OR "primaryAdapter" = 'APIFY_ASYNC'
       OR "acquisitionMode" = 'APIFY_FALLBACK');

-- Any Apify capability proof for these platforms (should not be VERIFIED/usable):
SELECT id, platform, capability, "providerKey", "adapterKey", status
FROM social_provider_capability_proofs
WHERE "organizationId" = :ORG
  AND platform IN ('tiktok','facebook')
  AND ("providerKey" ILIKE '%apify%' OR "adapterKey" ILIKE '%apify%');
```

Run read-only DB access through `scripts/_rls.mjs → makeScriptPrisma` or a
BYPASSRLS role (standalone scripts are not RLS-wrapped). Record the row counts.

## Step 1 — Invalidate any Apify residue (recompile)

Recompiling applies `enforceBrightDataOnlyPolicy` (this branch), which fails any
Apify primary closed to a manual task and strips Apify fallbacks for these
platforms. `compileOrganizationSourceRoutePlans(ORG)` also stamps stale route
keys `INVALIDATED`. This is triggered automatically by Step 2's verify call, or
can be run directly. After it runs, re-run the Step 0 audit and confirm **0**
active Apify rows for tiktok/instagram/facebook.

## Step 2 — Create + verify the Bright Data comments capability proof

Only do this if no `VERIFIED`, unexpired `READ_EXTERNAL_COMMENTS` Bright Data
proof exists for `tiktok`. Evidence source: the `TT-SD-009` live proof
(discovery hash `3f0435c9e31f`, comments snapshot hash `72056e6e968d`,
`collect_replies=true`, 100/100 top-level + 114/114 nested reply IDs, zero
provider errors).

**2a. Create the DRAFT proof** — `POST /api/v1/social/provider-capabilities`:

```json
{
  "providerKey": "bright-data",
  "adapterKey": "BRIGHT_DATA_SNAPSHOT",
  "platform": "tiktok",
  "capability": "READ_EXTERNAL_COMMENTS",
  "contentScopes": ["PUBLIC"],
  "schemaVersion": "tiktok-comment-2026-07-18",
  "endpointHost": "api.brightdata.com",
  "retentionDays": 30,
  "attributionRequired": false
}
```

**2b. Verify it** — `POST /api/v1/social/provider-capabilities/{id}/verify`:

```json
{
  "confirm": "VERIFIED_IN_CONTRACT_AND_SANDBOX",
  "contractVersion": "social-provider-capabilities-v1",
  "contractDocumentRef": "TT-SD-009 Bright Data comments snapshot 72056e6e968d (collect_replies=true, 100/100 + 114/114 unique IDs, 0 provider errors)",
  "sandboxRunRef": "brightdata-comments-snapshot-72056e6e968d",
  "readAllowed": true,
  "replyAllowed": false,
  "aiProcessingAllowed": false,
  "exportAllowed": true,
  "expiresAt": "2026-10-19T00:00:00.000Z"
}
```

Notes: `readAllowed` + `exportAllowed` must both be `true` for the comment READ
route to compile (see `validProof` in `source-route-plan.ts`). `replyAllowed`
stays `false` (external replies disabled). The verify handler recompiles routes
(Step 1). Confirm a matching discovery (`DISCOVER_POSTS`) and enrichment
(`ENRICH_CONTENT`) Bright Data proof also exist; create/verify them the same way
if missing.

## Step 3 — Open the bounded routing window

- Set a **small hard budget** via `PATCH /api/v1/social/paid-run-policy`:
  `{ "manualRunsEnabled": true, "emergencyStopped": false, "maxPerRunUsd": 0.5, "dailyBudgetUsd": 0.5, "monthlyBudgetUsd": 0.5 }`
  (keep the ceiling at or below the TT-SD-016 `$0.50` precedent).
- Enable live routing for **brandprotection only** (server env, do not print):
  `SOCIAL_BRIGHT_DATA_LIVE_ROUTING=1`, `SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS=<ORG>`.
- Re-run Step 0 audit: still **0** Apify rows; confirm the tiktok
  `READ_EXTERNAL_COMMENTS` route is now `ACTIVE` with
  `primaryAdapter=BRIGHT_DATA_SNAPSHOT`.

## Step 4 — Run the positive path, once

Trigger one bounded run of the existing source:
`POST /api/v1/social/monitoring-sources/{SRC}/run`.

Expected pipeline: tenant query → **Bright Data discovery** → relevance gate →
**Bright Data comments only for MATCHED/opted-PROBABLE** publications →
actionable/context filtering → tenant-isolated persistence/dedup/watermark → UI.

Fail-closed expectations: comment provider runs appear **only** for `ACCEPTED`
parents; `REVIEW`/`REJECTED` produce zero comment provider runs; zero external
replies.

## Step 5 — Verify evidence

- **Provider ledger** (`social_provider_runs`): one `DISCOVER_CANDIDATE_POSTS`
  run and, for each accepted publication, one `EXTRACT_COMMENTS_FROM_CANDIDATES`
  run; `actualChargeUsd` within budget; no run bound to a REVIEW/REJECTED parent.
- **Observation invariants**: gather the day's rows (collector runs, route plans,
  provider runs, ingest envelopes, external replies) for `ORG` and feed them to
  `evaluateSelectiveDiscoveryObservationDay`
  (`src/lib/social/selective-discovery-observation.ts`). All seven invariants
  must pass — in particular `no_apify_external_routes`,
  `comments_only_for_matched`, `no_review_rejected_dispatch`,
  `dedup_and_watermark`, `external_replies_zero`.
- **UI**: authenticated Social Monitoring smoke shows the run, the accepted
  publications, and the actionable/context comments; external sends visibly
  disabled.
- Record hashes/counts in `docs/SELECTIVE-DISCOVERY-OBSERVATION-LOG.md` and mark
  the `TT-SD-016` comments stage proven only after this passes.

### Evidence to hand back (so the result can be verified + recorded)

Paste these back (no secrets — no tokens, passwords, or raw comment text/authors):

1. **Production SHA + deploy workflow id** the canary ran on, and `/api/v1/ping`
   status.
2. **Capability proof**: the `READ_EXTERNAL_COMMENTS` proof id, `status`
   (`VERIFIED`), `providerKey`/`adapterKey` (`bright-data`/`BRIGHT_DATA_SNAPSHOT`),
   `readAllowed`/`exportAllowed`/`replyAllowed`, `expiresAt`.
3. **Discovery run** (`social_provider_runs`, phase `DISCOVER_CANDIDATE_POSTS`):
   id, `status`, `receivedCount`/`acceptedCount`/`reviewCount`/`rejectedCount`/
   `duplicateCount`, `actualChargeUsd`.
4. **Relevance ledger**: how many candidates became `ACCEPTED` (MATCHED /
   opted-PROBABLE) vs `REVIEW` vs `REJECTED`.
5. **Comment run(s)** (`social_provider_runs`, phase
   `EXTRACT_COMMENTS_FROM_CANDIDATES`): for each — id, the parent publication's
   relevance status (must be `ACCEPTED`), `status`, received/accepted/duplicate
   counts, `actualChargeUsd`, and confirmation the parent came from an accepted
   candidate envelope. **Count of comment runs bound to REVIEW/REJECTED parents
   must be 0.**
6. **Dedup/watermark**: duplicate count on the collector run; whether the
   watermark advanced only on complete traversal (or a truthful partial).
7. **External replies**: confirm 0 dispatched and no active `REPLY_EXTERNAL`
   live route.
8. **Apify audit** (Step 0 query result): 0 active Apify rows for
   tiktok/instagram/facebook.
9. **UI**: one line on what the authenticated Social Monitoring smoke showed
   (run, accepted publications, actionable/context comments; external sends
   disabled). A screenshot is optional.
10. **Teardown confirmation** (Step 6): routing back to 0, budgets 0, emergency
    stop on, ping 200.

With that, the seven observation invariants can be evaluated
(`evaluateSelectiveDiscoveryObservationDay`) and `TT-SD-016` finalized.

## Step 6 — Mandatory teardown (do not leave routing on)

1. `SOCIAL_BRIGHT_DATA_LIVE_ROUTING=0`; clear `SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS`.
2. `PATCH /api/v1/social/paid-run-policy`:
   `{ "manualRunsEnabled": false, "emergencyStopped": true, "maxPerRunUsd": 0, "dailyBudgetUsd": 0, "monthlyBudgetUsd": 0 }`.
3. Confirm `GET /api/v1/v1/ping` (or `/api/v1/ping`) returns 200 and PM2 is online.
4. Re-run Step 0 audit: 0 active Apify rows; Bright Data comment route no longer
   compiles as ACTIVE (routing gate closed). Record teardown in the observation
   log.

## Rollback (if anything misbehaves mid-canary)

Execute Step 6 immediately. Rollback pauses the discovery source, disables the
provider route, and leaves already-imported observations to normal retention —
it must not delete accounts, scenarios, audit records, or billing evidence.
