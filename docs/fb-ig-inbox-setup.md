# Facebook Messenger + Instagram Direct → Inbox — Setup Runbook

> **Last verified live:** 2026-06-07 against Meta App **"LeadDrive CRM"** (App ID `1276226757359622`),
> Meta's "Use Cases" dashboard. Meta renames dashboard items often — if a label below doesn't match,
> re-verify (and update this doc).
>
> **Use this for every new client** so we don't re-discover the Meta steps each time.

## What this enables

A tenant's **Facebook Page Messenger** DMs and **Instagram Direct** messages flow into the LeadDrive
omni-channel **Inbox** (`/inbox` → channel filters *Facebook* / *Instagram*), where agents reply from
one place alongside WhatsApp / Telegram / SMS / Email / Web Chat.

## Architecture — TWO separate systems (do not confuse)

| | Model | Purpose |
|---|---|---|
| **Social Monitoring** | `SocialAccount` (handle = pageId, encrypted token) | Comments / mentions / public posts — **NOT** DMs |
| **Inbox DMs** | `ChannelConfig(facebook\|instagram)` (pageId + apiKey = page token) | Private messages (Messenger / IG Direct) |

> **A page being "configured in Social Monitoring" does NOT mean its DMs reach the inbox.** DMs need a
> `ChannelConfig` **and** a Meta webhook subscription
> (`POST /{page-id}/subscribed_apps?subscribed_fields=messages`), which needs **DM permissions** on the
> page token. Social Monitoring's OAuth only requests *read* (comments) scopes.

**Inbound DM flow:** Meta → `POST /api/v1/webhooks/facebook` (HMAC-verified) → resolves `ChannelConfig`
by `pageId` → `ChannelMessage(inbound)` → inbox.
**Reply flow:** inbox → `sendFacebookMessage(... ch.apiKey ...)` → Meta → visitor.

---

## Part A — One-time Meta App setup (per Meta app, NOT per tenant)

The Meta App must **offer** the DM permissions, otherwise the OAuth dialog silently drops them and the
token comes back without them.

### A1. Facebook Messenger use case → grants `pages_messaging`
The default **"Manage Pages"** use case is content/monitoring only (`pages_read_engagement`,
`pages_read_user_content`, `pages_show_list`) — it does **NOT** include `pages_messaging`.

1. `developers.facebook.com` → **My Apps** → your app → **Сценарии использования (Use Cases)**.
2. **Добавить сценарии использования (Add use cases)** → left filter **Бизнес-переписка (Business messaging)**.
3. Tick **"Взаимодействие с клиентами в Messenger from Meta"** → **Сохранить (Save)**.
4. Open its **Настроить (Configure)** → **Webhooks** → subscribe the **`messages`** (+ `messaging_postbacks`) field.

### A2. Instagram messaging use case → grants `instagram_manage_messages`
1. Use Cases → confirm **"Управление сообщениями и контентом в Instagram"** is present (its description
   includes "…и сообщения в Direct").
2. The IG account **must be Professional (Business/Creator)** AND linked to a Facebook Page.
3. Configure it → ensure `instagram_manage_messages` is added.

### A3. Webhook config (shared by FB + IG)
- **Callback URL:** `https://<tenant-domain>/api/v1/webhooks/facebook`
- **Verify token:** value of the `FACEBOOK_VERIFY_TOKEN` env (LeadDrive: `leaddrive_fb_verify`). If this
  env is unset on the server the webhook GET returns **500 "Server misconfigured"** (no hardcoded
  fallback) — a webhook that won't verify on a new tenant usually means this env is missing on its box.
- **Subscribed fields:** `messages`, `messaging_postbacks` (+ for monitoring: `feed`, comments, mentions).
- Server must have `FACEBOOK_APP_SECRET` set (the webhook HMAC-verifies `X-Hub-Signature-256`).

### A4. App Review — Advanced Access (ONLY for clients' pages you don't admin / production)
In **Dev mode** (app shows "Не опубликовано"), the messaging permissions work **only** for the app's
admins/testers and **their** pages — enough to test with our own pages, NOT real clients.

For real client pages: App Dashboard → **App Review → Permissions and Features** → **Request Advanced
Access** for `pages_messaging` + `instagram_manage_messages`. Requires Business Verification + a review
submission + a screencast of the messaging flow. See `docs/meta-app-review-submission.md`.

---

## Part B — Per-tenant setup (each new client)

### B1. New connection — auto-wires
Tenant: **Соцмониторинг → Подключить Facebook → OAuth** (their FB admin logs in, picks pages). The
callback (scope includes `pages_messaging` + `pages_manage_metadata` + `instagram_manage_messages`)
creates the `SocialAccount`, the `ChannelConfig`, and subscribes the Meta webhook → DMs flow.

### B2. Existing connection — backfill (no re-OAuth)
**Соцмониторинг → "В инбокс" button** → `POST /api/v1/social/enable-inbox` creates the ChannelConfig +
subscribes for every already-connected FB/IG page.

### B3. Reconnect banner
If the amber **"Переподключить"** banner shows on `/social-monitoring` (`subscribed:false` — an old
token without DM scopes), the tenant clicks it → re-OAuth → new token with the DM scopes. **Requires
Part A done first** (else Meta drops the scopes again).

---

## Error reference — exact Meta error → fix

| Meta error (in server logs / subscribe result) | Meaning | Fix |
|---|---|---|
| `(#200) To subscribe to the messages field, one of these permissions is needed: pages_messaging` | Page token lacks `pages_messaging` | **A1** (add Messenger use case) → re-OAuth (**B3**) |
| `(#3) Application does not have the capability to make this API call` (Instagram) | The **app** lacks IG-messaging capability | **A2** (IG use case + Professional account linked) → **A4** Advanced Access |
| `subscribed:false` in `/api/v1/social/enable-inbox` results | Subscription failed | Inspect the precise error in logs (below); usually a missing scope/use case |

**Pull the precise error from prod logs** (macOS has no `timeout` — use `head` to bound the stream):
```bash
bash scripts/client.sh logs <client> 2>&1 | head -120 | grep -iE "inbox-channel|subscribe|#200|#3"
```

---

## Verification

1. `GET /api/v1/social/enable-inbox` (authed) → `needsReconnect: false`, `subscribed === wired`.
2. Logs: no `[inbox-channel] subscribe failed …` for the page.
3. Send a **test DM** to the FB page / IG account → it appears in `/inbox` under channel *Facebook* / *Instagram*.

---

## Code references (where this is wired)

| Piece | File |
|---|---|
| OAuth DM scopes | `src/app/api/v1/social/oauth/facebook/start/route.ts` |
| OAuth callback (auto-wire) | `src/app/api/v1/social/oauth/facebook/callback/route.ts` → `ensureInboxChannelForPage` |
| Backfill (POST) + status (GET) | `src/app/api/v1/social/enable-inbox/route.ts` |
| Wire helper (ChannelConfig + subscribe, stores `settings.inboxSubscribed`) | `src/lib/social/inbox-channel.ts` |
| Subscribe helper (`subscribed_apps`) | `src/lib/social/meta-subscribe.ts` |
| Inbound webhook (HMAC-verified) | `src/app/api/v1/webhooks/facebook/route.ts` |
| Reconnect banner | `src/app/(dashboard)/social-monitoring/page.tsx` |

## TL;DR

- **FB:** Meta App → add **Messenger** use case (Бизнес-переписка) → re-OAuth. Error was `(#200) pages_messaging`.
- **IG:** Meta App → **Instagram** use case + Professional account linked + **App Review** for
  `instagram_manage_messages`. Error was `(#3) capability`.
- **Per tenant:** connect via Соцмониторинг (auto-wires) **or** click **"В инбокс"** (backfill); if the
  reconnect banner shows, re-OAuth.
