# Staging Meta app 2414060595720618 on one tenant, without touching production

Decision of 2026-09-20, and it **supersedes steps 3–5 of
`docs/meta-app-review-repoint-runbook.md`**. That runbook re-pointed the shared
production environment onto the app under review. This one does not: the shared
env keeps `FACEBOOK_APP_ID=1276226757359622` and
`INSTAGRAM_APP_ID=782807994549098`, every live channel keeps working through the
app it uses today, and the new app is staged on a single connection.

Steps 1, 2 and 6 of the repoint runbook (what only the owner can do in the Meta
dashboard, and how to verify) still apply and are not repeated here.

## The tenant, and why it needs isolating at all

The App Review tenant is **`leaddrive`**. That is not a guess:
`scripts/ensure-meta-review-user.mjs` pins `TENANT_SLUG = "leaddrive"`, and the
reviewer account `meta-review@leaddrivecrm.org` exists there (admin, active).

`leaddrive` is also the company's working tenant. It holds five active Facebook
rows for real customer Pages — Sport&Diet `1078733058880813`, Andrologiya.az
`182013225466892`, Nokaut.az `520731194744134`, «Мыслители прошлого»
`373662722735767` — plus a WhatsApp row already on `2414060595720618`.

Two mechanisms made "just enter the new app there" unsafe, and both are now
closed in code:

1. **`getTenantMetaApp` resolves per ORGANIZATION**, newest qualifying row
   first. A second Meta app entered anywhere in the tenant would have become the
   app every Facebook/Instagram OAuth in it runs through, including a reconnect
   of a live customer Page.
2. **The OAuth callback loops over every Page the connecting user administers.**
   For each it overwrote `apiKey` with a token minted by the connecting app,
   forced `isActive: true`, and called `subscribed_apps`. Staging the app under
   review would therefore have re-pointed real customers' DM delivery onto it,
   and switched back on the Instagram row the owner deliberately disabled on
   2026-09-11.

## How the isolation works

- A config row carrying `settings.appReviewOnly = true` is **invisible to both
  org-wide resolvers**. Adding it changes nothing for any existing channel.
- It is reachable only by naming it: `?app=<channelConfigId>` on the OAuth start.
  That path has **no env fallback** — if the row cannot be used the request
  fails with 400 instead of quietly running the shared production app.
- The id travels inside the HMAC-signed `state`, so the callback redeems the
  code against the same app that issued it.
- A pinned connect runs in **staged mode**: it only ever writes a row that is
  itself staged, and it subscribes nothing.

## Setup

1. **Create the staged row** (do not edit an existing card — that would edit a
   live customer row): open
   `/settings/channels/connect/facebook?mode=new`, or `…/instagram?mode=new` for
   the Instagram-Login surface.
2. Enter **Meta App ID**, **App Secret** and **Webhook Verify Token**. All three
   are required together; a partial triple is rejected, because the resolvers
   need the whole triple and a half-filled row would silently fall back.
3. Tick **"Staging app (Meta App Review)"**. Save.
4. Press **Connect** on that same saved row. The button adds `?app=<id>` by
   itself, so the consent screen shows the staged App ID.

The secret and the verify token are never returned to the browser afterwards —
the API answers with `hasAppSecret` / `hasVerifyToken` booleans and the field
shows a stored-value placeholder. Leaving a field blank on a later edit keeps
the stored value.

## Preflight

```
GET /api/v1/social/oauth/preflight
GET /api/v1/social/oauth/preflight?app=<channelConfigId>
```

Admin-only. Reports, per surface, the App ID that *would* be used and **why**
(`pinned` / `tenant` / `env` / `none`), whether a secret and verify token exist
(booleans only), the OAuth redirect URI, and the tenant webhook callback URL
with its `?t=<slug>`. `stagedApps` lists the staged rows with a `ready` flag and
the exact start URL that activates each.

No secret value is returned by this endpoint in any form — not masked, not
truncated. Read `source` before recording anything: `env` means the consent
screen will show the shared production app, which is the mistake this endpoint
exists to make visible.

## Subscribing

Nothing is subscribed automatically on a staged connect. Subscribe one named
Page deliberately:

```
POST /api/v1/social/oauth/subscribe   { "configId": "<channelConfigId>" }
```

It subscribes to `messages,messaging_postbacks` using the stored page token — so
the Page is attached to whichever app minted that token, and this call cannot
attach a Page to an app it was not connected through. Instagram business
accounts cannot be subscribed directly (Meta answers "(#3) Application does not
have the capability"); IG Direct rides the linked Page's subscription, so
subscribe that Page.

## Webhook callback URLs

Registered inside the staged app, per tenant:

```
https://app.leaddrivecrm.org/api/v1/webhooks/facebook?t=<org-slug>
https://app.leaddrivecrm.org/api/v1/webhooks/instagram?t=<org-slug>
https://app.leaddrivecrm.org/api/v1/webhooks/whatsapp?t=<org-slug>
```

With `?t=` present both the GET handshake and the POST signature check use the
tenant's own verify token and app secret **only** — the env pair is refused
outright, so one tenant's token can never verify another's subscription.
