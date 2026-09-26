# Meta App Review — Data Handling & Security answers

Ready-to-paste answers for Meta app **2414060595720618**, with the evidence behind each one.

Every claim here was verified against the running system on **2026-09-20**, not inferred from code
that looks right. Where the code and production disagree, production wins and the answer says so.
Section 4 is the list of honest "no" answers — read it before filling anything in.

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

   ⚠️ One region claim is still published and **unverified**: `privacy.p5_l1` says production runs on
   "the registered host in France". Production is the Contabo VPS `13.140.132.245`
   (`vmi3554743.contaboserver.net`). `AGENTS.md` forbids inferring a physical region from an IP
   address, and the Contabo panel is owner-only, so this was left exactly as it stands rather than
   guessed at in either direction. Verify it in the Contabo contract before repeating it to Meta or
   to a customer.

7. ✅ **Fixed in this change — the subprocessor list named a company that holds nothing.**
   `privacy.p5_l2` said *"Hetzner Online GmbH — encrypted immutable backups in Helsinki, Finland …
   16/63/400 days … destroyed automatically."* Hetzner was dropped in September 2026 and the server
   deleted, so it holds no data at all. The offsite copies are in fact on a **second Contabo host**
   — confirmed on 2026-09-20 by finding 55 backup files sitting there, the oldest from 4 September,
   i.e. never pruned, against fourteen kept on production. Every element of that sentence was wrong:
   the provider, the country, the encryption, the immutability and the retention. It now describes
   the second Contabo host, and `privacy-policy-claims.test.ts` fails if Hetzner or Helsinki returns.

6. 🟠 **Backups are weaker than the policy used to claim — policy corrected, control still off.**
   The policy stated *"encrypted backups are held under immutable retention … residual copies can
   persist for up to 400 days and are then destroyed automatically."* Production does not do that:

   | | Claim published until 2026-09-20 | Verified on production 2026-09-20 |
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

   **Owner decision, 2026-09-20: do both, in this order.**

   - ✅ *Step 1 — done in this change.* The Privacy Policy no longer claims encryption, immutability
     or a 400-day automatic destruction for backups. `privacy.p4` and `privacy.p7_note` in all three
     locales now describe what actually runs: a compressed, unencrypted dump, fourteen kept on the
     production host, copied to a separate backup host where copies are removed by an operator
     rather than on a schedule. The published text is therefore true again as of this deploy, and
     `privacy-policy-claims.test.ts` holds it there.
   - ⏳ *Step 2 — owner.* Fix the restore canary (the scratch PostgreSQL on port 55432 that the
     2026-09-07 run could not reach) and enable `leaddrive-postgres-backup.timer`. This needs the S3
     credentials and the offline `age` recipient, so it cannot be done from a session.
   - ⏳ *Step 3 — after step 2 is green.* Restore the stronger wording in a separate change, once the
     timer is enabled, succeeding, and uploading under Object Lock. The guard in
     `privacy-policy-claims.test.ts` deliberately fails if the stronger sentence comes back, so this
     step means re-verifying production, not editing a string.

   **Answering Meta:** until step 2 is green, answer the backup questions from the *current* state —
   backups are not encrypted at rest and not immutable. Do not quote the 400-day figure.

---

## 4b. Second hardening pass (2026-09-20)

Three defects found by re-auditing the first pass rather than trusting it. All fixed.

1. **A regression the first pass introduced.** The partial unique index covers
   whatsapp/facebook/instagram, but only the WhatsApp and Facebook handlers were taught to treat the
   resulting P2002 as "already ingested". The Instagram handler had only a read-then-skip guard, so a
   concurrent redelivery threw, unwound to a POST handler that answers Meta **200**, and every
   remaining message in that delivery was dropped and never redelivered. Fixed; the test for it fails
   against the pre-fix handler, which is how it was verified.
   [C] `src/app/api/v1/webhooks/instagram/route.ts` · [T] `meta-security-hardening.test.ts`

2. **A credential could reach Sentry.** `instagram-login.ts` carries the Instagram-Login token as a
   URL query parameter — the shape Meta's token endpoints require — and logged caught fetch errors
   verbatim. A thrown fetch error can carry the request URL, and this project ships errors to Sentry,
   a named subprocessor. Every log line in that module now goes through the existing redactor, and
   provider error bodies in `facebook.ts` are redacted too.
   [C] `src/lib/social/instagram-login.ts`, `src/lib/facebook.ts`, `src/lib/oauth-redaction.ts`

3. **A blank field could wipe a live credential.** `z.string().optional()` accepts `""`, and the PUT
   payload was spread straight into the update — so `{"appSecret": ""}` overwrote a stored secret
   with an empty string. The UI never sends that, but the API accepted it, and both the webhook
   signature check and the OAuth exchange fail closed on an empty secret, so the damage would have
   surfaced later as "messages stopped arriving". Blank now means *keep*; deliberate clearing stays
   on DELETE, which nulls every credential together and writes a `disconnect` audit entry.
   [C] `src/app/api/v1/channels/[id]/route.ts`

**Verified and left alone:**

- Facebook/Instagram outbound already use `Authorization: Bearer`, not a token in the URL
  ([C] `src/lib/facebook.ts`), and the page-subscribe call sends the token in the POST body
  ([C] `src/lib/social/meta-subscribe.ts`).
- The OAuth callbacks compare cookie against `state` for equality, verify the HMAC with
  `timingSafeEqual` behind a length check, enforce a 30-minute TTL, and require a matching session on
  the cookie-less path.
- The Instagram webhook binds the tenant through `?t=`, refuses the env secret when `?t` is present,
  and resolves the account by oldest claim.

## 4c. Residual risks — stated, not fixed

1. **The OAuth `state` is not single-use.** Within its 30-minute window the same signed state could be
   presented again. Exploiting that also requires an unused authorization `code`, which Meta issues
   single-use and short-lived to the registered redirect URI, so the practical window is small — but
   the guarantee is "signed, bound and expiring", not "consumed once". Closing it properly means a
   server-side nonce store with its own expiry and cleanup; that was not added late in an audit that
   had already produced one regression from a schema change.

2. **The WhatsApp WABA id (`entry.id`) is not cross-checked.** The tenant is bound by the `?t=` slug
   *and* the payload's `phone_number_id`, and the signature proves the sender holds that tenant's app
   secret — so a forged WABA id with a matching phone number id would already require the tenant's
   secret. Adding a third fail-closed check on live WhatsApp traffic was judged a worse trade than the
   marginal gain.

3. **No rate limiting on the webhook endpoints**, at either the application or the nginx layer.
   Cloudflare fronts the domain. Meta's delivery is bursty by design, so a naive per-endpoint limit
   would drop legitimate traffic; this needs a measured threshold, not a guess.

4. **`channel_configs` credentials are not column-encrypted** (§2, §4.2). Encrypting them touches
   every send path and every webhook signature check at once, on live customer connections.

5. **The Instagram-Login send path is unverified.** `src/lib/social/instagram-login.ts` says in its
   own header that the `graph.instagram.com/me/messages` shape is under-documented and should be
   confirmed against a live token. Confirming it means sending a real message, which was out of scope
   here. **The App Review demo requires an outbound Instagram reply, so verify this before recording.**

## 5. Notes for the reviewer submission

- The demo must be recorded against App ID **2414060595720618**. Confirm it on Meta's own consent
  screen before recording; `GET /api/v1/social/oauth/preflight` reports the App ID that *would* be
  used and why (`pinned` / `tenant` / `env`). A `source` of `env` means the recording would show the
  shared production app instead — that is the single easiest way to waste a submission.
- A Facebook consent screen is **not** evidence for an `instagram_business_*` permission. Instagram
  Login is a separate app and a separate dialog.
- Staging the app on a tenant that also holds live customer channels is safe only through the
  isolated path — see `docs/meta-app-review-isolated-tenant-setup.md`.
