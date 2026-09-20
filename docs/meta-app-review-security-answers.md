# Meta App Review — Data Handling & Security answers

Ready-to-paste answers for Meta app **2414060595720618**, with the evidence behind each one.

Every claim here was verified against the running system on **2026-09-20**, not inferred from code
that looks right. Where the code and production disagree, production wins and the answer says so.
Section 4 is the list of honest "no" answers — read it before filling anything in, because two of
them contradict a claim our own published Privacy Policy currently makes.

Evidence keys: **[C]** code, **[T]** test, **[P]** production observation.

---

## 1. Tenant isolation and data separation

**Q. How do you keep one customer's Meta data separate from another's?**

> Every record carries an `organizationId`. Postgres row-level security is enabled and FORCED on
> 447 of 461 tenant tables, and it fails closed — a query issued without tenant context returns zero
> rows rather than another tenant's rows. Every database path runs inside an explicit tenant scope,
> which is enforced by a static gate in CI (`find-context-gaps.py`, 0 gaps required to merge).

- [C] `src/lib/rls-context.ts`, `src/lib/prisma.ts` (`[RLS-GUARD]` runtime guard)
- [C] `scripts/rls/find-context-gaps.py` — blocking check, currently **0 gaps** [P]
- [C] `docs/rls-rollout-runbook.md` lists the remaining 14 tables

**Q. How is an inbound webhook bound to the right customer?**

> The webhook URL registered in each customer's own Meta app carries `?t=<tenant-slug>`. When that
> parameter is present the endpoint accepts **only** that tenant's own verify token and app secret;
> the shared platform credentials are refused outright, so a payload signed by our platform app and
> addressed to another tenant's slug cannot be accepted. WhatsApp additionally requires the payload's
> `phone_number_id` to belong to the addressed tenant, and drops the event when it does not.

- [C] `src/app/api/v1/webhooks/facebook/route.ts`, `.../instagram/route.ts`, `.../whatsapp/route.ts`
  — "refusing env fallback"
- [C] `resolveWhatsAppWebhookChannelConfig` — tenant ↔ `phone_number_id` binding
- [T] `src/__tests__/meta-security-gate.test.ts` → "cross-tenant isolation"
- [T] `src/__tests__/api-whatsapp-webhook-tenant-secret.test.ts`,
  `api-facebook-webhook-pageid-tenant-routing.test.ts`

**Q. When two customers claim the same Page/IG account, who receives the message?**

> A deterministic total order, oldest claim first — a later claimant cannot capture an earlier one's
> messages by entering a public Page ID. The losing claimant is shown a warning in the UI rather
> than a false "connected".

- [C] `src/lib/social/inbound-channel-ranking.ts`, `src/lib/channels/inbound-claim.ts`

---

## 2. Credential storage and access

**Q. Where are tokens and secrets stored, and who can read them?**

> Social OAuth access tokens are encrypted at rest with AES-256-GCM (keys derived per purpose via
> HKDF). Verified in production: **100 % of stored Social OAuth tokens are encrypted** (12 Facebook,
> 3 Instagram, plus TikTok/Twitter/YouTube). Channel credentials — Meta App Secret, Page/WhatsApp
> access token and webhook verify token — are **not** column-encrypted; they are protected by
> row-level security, host and database access control, and are never returned by the API.

- [C] `src/lib/secure-token.ts` (AES-256-GCM)
- [P] `social_accounts.accessToken`: 20/20 rows carry the `v1:` ciphertext prefix
- [P] `channel_configs`: 0 of the `appSecret` / `apiKey` / `accessToken` / `verifyToken` values are
  encrypted — this is disclosed in the published Privacy Policy and repeated in §4 below

**Q. Are secrets ever exposed through the API, logs or error reports?**

> No. Credentials are stripped from every API response and replaced by boolean presence flags
> (`hasAppSecret`, `hasVerifyToken`). The redaction matches on field *name*, so a newly added
> credential is dropped by default rather than needing to be added to a list. No route interpolates
> a credential into a log line. The diagnostics endpoint reports which App ID is selected and whether
> a secret exists, never a secret value — not masked, not truncated.

- [C] `src/lib/channels/public-channel-config.ts` (`looksLikeCredential`)
- [C] `src/app/api/v1/social/oauth/preflight/route.ts`
- [T] `meta-security-gate.test.ts` → "secrets never cross the API boundary" (6 assertions)

**Q. Who may change an integration's credentials?**

> Only a signed-in tenant administrator. API keys and mobile tokens are rejected outright on this
> surface, regardless of their scopes. Every create, update, disconnect and delete writes an audit
> entry naming the actor, the IP, the user agent and **which credential fields changed** — field
> names only, never values, so the audit log can never become a second copy of the secret.

- [C] `src/lib/channels-access.ts` (`requireSessionAuth`, admin/superadmin only)
- [C] `src/lib/channels/channel-credential-audit.ts`
- [T] `meta-security-gate.test.ts` → "every channel mutation writes an audit entry"

**Q. Rotation and revocation?**

> An administrator can overwrite a credential at any time from Settings → Channels; leaving a field
> blank keeps the stored value, so a rotation is an explicit act. Disconnect revokes locally by
> nulling every credential column and deactivating the row (see §3).

---

## 3. OAuth, webhooks and data lifecycle

**Q. How is the OAuth flow protected against CSRF and tampering?**

> The `state` parameter carries an HMAC-SHA256-signed payload (organization, nonce, timestamp) and is
> also set as an httpOnly, SameSite=Lax cookie. The callback verifies the signature, rejects anything
> older than 30 minutes, and cross-checks the signed organization against the live session — on the
> cookie-less path a matching session is *required*, so a logged-out Page admin cannot be tricked into
> linking their Page to someone else's workspace. Return destinations are a closed allowlist of keys,
> never caller-supplied paths, which makes an open redirect impossible by construction.

- [C] `src/app/api/v1/social/oauth/{facebook,instagram}/{start,callback}/route.ts`
- [C] `src/lib/social/oauth-return.ts`
- [T] `meta-security-gate.test.ts` → "OAuth state and redirect handling"
- [T] `api-facebook-oauth-state.test.ts`, `api-instagram-oauth-state.test.ts`

**Q. How are webhook payloads authenticated?**

> `X-Hub-Signature-256`, verified as HMAC-SHA256 over the **raw** request body with a
> constant-time comparison, before the body is parsed or acted on. If no signing secret can be
> resolved the request is rejected; there is no unsigned path in production.

- [C] `verifyFacebookSignature`, `verifyWhatsAppSignature`
- [T] `api-facebook-webhook-signature.test.ts`, `api-instagram-webhook-signature.test.ts`

**Q. Replay and duplicate events?**

> Two layers. Each inbound message is matched on the provider message id (`mid` / `wamid`) scoped to
> the tenant and skipped if already ingested; underneath, a partial unique index makes a concurrent
> redelivery fail at the database instead of inserting a second copy, which the handler treats as
> "already ingested". This matters most on WhatsApp, where an un-deduplicated redelivery would not
> merely duplicate a row but could fire the auto-reply again — sending a second real message.

- [C] `src/lib/social/meta-inbound-idempotency.ts`
- [C] `prisma/migrations/20260920160000_meta_inbound_idempotency/migration.sql`
- [T] `meta-security-gate.test.ts` → "webhook replay protection" (7 assertions)

**Q. What happens on disconnect?**

> Collection stops and the credentials are destroyed, not merely hidden: the channel is deactivated
> and `apiKey`, `appSecret`, `accessToken`, `verifyToken` and `botToken` are set to NULL; the linked
> connection record is disabled and its tokens nulled; the stored Social OAuth token is nulled and
> its account deactivated. Every statement is scoped by organization.

- [C] `src/app/api/v1/channels/[id]/route.ts` → `DELETE`
- [T] `meta-security-gate.test.ts` → "disconnect nulls every credential column"

**Q. How can a person request deletion?**

> Three routes, published at `https://www.leaddrivecrm.org/legal/data-deletion`: a tenant
> administrator can disconnect the channel in-app, a tenant can delete individual records
> (messages, contacts, leads) in the CRM, and anyone can email a request. Verified requests are
> completed in active systems within 30 calendar days.

- [P] `https://app.leaddrivecrm.org/legal/data-deletion` returns 200
- [C] `messages/{en,ru,az}.json` → `dataDeletion`

---

## 4. Answer "no" — and the two claims that must be settled first

**These are the honest negatives. Do not answer otherwise on the questionnaire.**

1. **No Meta data-deletion *callback* is implemented.** There is no endpoint that accepts Meta's
   `signed_request`. Register the **Data Deletion Instructions URL**
   (`https://www.leaddrivecrm.org/legal/data-deletion`), which is the supported alternative — do not
   register a callback URL. [C] no `signed_request` handler exists anywhere in the codebase.

2. **Channel credentials are not encrypted at rest at the column level.** Social OAuth tokens are;
   `channel_configs` credentials are not. Already disclosed in the Privacy Policy. [P]

3. **The production disk is not encrypted.** No LUKS/dm-crypt. Already disclosed. [P]

4. **No application-level or nginx rate limiting on the webhook endpoints.** Cloudflare fronts the
   domain and provides baseline protection, but no per-endpoint limit is configured. [P] `grep` over
   `/etc/nginx` finds no `limit_req`/`limit_conn`.

5. **Hosting region is not contractually pinned.** The Privacy Policy says plan-specific regions
   "remain under review". Do not state a processing region to Meta.

6. 🔴 **BLOCKER — backups are not what the Privacy Policy says they are.**
   The policy states *"encrypted backups are held under immutable retention … residual copies can
   persist for up to 400 days and are then destroyed automatically."* Production does not currently
   do that:

   | | Published claim | Verified on production 2026-09-20 |
   |---|---|---|
   | Encryption | encrypted | **not encrypted** — plain `pg_dump -Fc` custom dump |
   | Immutability | immutable retention | **mutable** — plain files copied by `rsync` over SSH |
   | Retention | 400 days, automatic destruction | 14 kept locally; **offsite copies are never pruned** |

   The repository *does* contain the compliant path — `scripts/backup/postgres-backup.sh` encrypts
   with `age`, requires an S3 bucket whose Object Lock default retention is `COMPLIANCE` mode, and
   enforces 16/63/400-day daily/weekly/monthly tiers. It is **not running**:
   `leaddrive-postgres-backup.timer` is **disabled and inactive**, and its last attempt on
   **2026-09-07 failed** (`Result=exit-code`; the restore-canary could not reach the scratch
   PostgreSQL on port 55432). What runs instead is `leaddrive-daily-backup.timer` →
   `/usr/local/sbin/leaddrive-backup.sh`, the plain unencrypted rsync job above.

   **Until this is resolved, do not answer Meta's backup/encryption questions, and do not submit.**
   Two ways out, and they are not equivalent:
   - *Restore the control* — fix the canary step and re-enable `leaddrive-postgres-backup.timer`.
     The published claim then becomes true again. Needs the S3 credentials and the offline `age`
     recipient, so it is owner work.
   - *Amend the policy* — publish what actually runs. This publicly downgrades a security claim and
     is a commercial decision, not an engineering one.

---

## 5. Notes for the reviewer submission

- The demo must be recorded against App ID **2414060595720618**. Confirm it on Meta's own consent
  screen before recording; `GET /api/v1/social/oauth/preflight` reports the App ID that *would* be
  used and why (`pinned` / `tenant` / `env`). A `source` of `env` means the recording would show the
  shared production app instead — that is the single easiest way to waste a submission.
- A Facebook consent screen is **not** evidence for an `instagram_business_*` permission. Instagram
  Login is a separate app and a separate dialog.
- Staging the app on a tenant that also holds live customer channels is safe only through the
  isolated path — see `docs/meta-app-review-isolated-tenant-setup.md`.
