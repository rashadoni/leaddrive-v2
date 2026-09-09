# Operational setup — TT §3/§4/§5/§8 modules

This doc covers env vars and external-platform setup for the segmentation / web
chat widget / surveys / social monitoring modules. All code ships — these
instructions are what a sysadmin needs to turn each feature on.

## Quick env reference

Add these to `.env` on the target server (or to the client override file under
`clients/<name>/.env`):

```env
# Required for AI auto-reply in web chat AND AI sentiment in social monitoring
ANTHROPIC_API_KEY=sk-ant-...

# Cron secret for /api/cron/social-poll
CRON_SECRET=<random-32-chars>

# Optional: app URL for survey email links (falls back to NEXTAUTH_URL)
APP_URL=https://app.example.com

# Twitter / X OAuth (§5)
TWITTER_CLIENT_ID=...
TWITTER_CLIENT_SECRET=...              # only for confidential clients
TWITTER_REDIRECT_URI=https://app.example.com/api/v1/social/oauth/twitter/callback

# TikTok Login Kit (§5)
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_REDIRECT_URI=https://app.example.com/api/v1/social/oauth/tiktok/callback

# YouTube / Google (§5)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=https://app.example.com/api/v1/social/oauth/youtube/callback

# VK public-post monitoring (§5)
VK_SERVICE_TOKEN=...                   # service token from a VK Mini-App or public page
                                       # no OAuth round-trip needed

# Telegram channel scanning (§5)
TELEGRAM_BOT_TOKEN=...                 # same bot that handles DMs
                                       # add it as a member of the channel you want
                                       # to monitor (public channels work out-of-box)

# Meta Graph (§5 — Facebook + Instagram Business)
META_WEBHOOK_VERIFY_TOKEN=<random>     # sent to Meta during webhook verification
META_WEBHOOK_SECRET=...                # App Secret from Meta Developer Console
```

---

## §4 Web chat widget — embed on customer website

1. Agent opens `/settings/web-chat`, configures title/color/working hours.
2. Copy the `<script>` snippet and paste it on the customer website before `</body>`.
3. Optional: pass `data-lang="ru"` (or `en`/`az`) on the script tag to pre-select
   the widget language; otherwise English.
4. CORS: add each exact origin (scheme + host, no path) to the "Allowed origins"
   list. Leave empty for initial testing.
5. File uploads land in `public/uploads/web-chat/<orgId>/<randomId>-<name>` on the
   VDS filesystem. **No antivirus by default** — extension blocklist + MIME check
   only. Plug in ClamAV if needed (see `src/app/api/v1/public/web-chat/upload/route.ts`).

Working hours JSON schema (stored in `WebChatWidget.workingHours`):
```json
{ "timezone": "Europe/Warsaw",
  "mon": [["09:00","18:00"]], "tue": [["09:00","18:00"]],
  "wed": [], "thu": [["09:00","13:00"],["14:00","18:00"]],
  "fri": [["09:00","18:00"]], "sat": [], "sun": [] }
```
When offline, AI auto-reply is paused and the visitor sees `offlineMessage`.

---

## §5 Social monitoring — connecting platforms

Each integration can be enabled independently. The sidebar page
`/social-monitoring` exposes "Connect …" buttons that redirect to the OAuth start
URL; after consent the provider redirects back to `…/callback` and the account
shows up in the monitored-handles list.

### Twitter / X
1. In https://developer.twitter.com/, create a project/app with **OAuth 2.0 User
   Context** enabled. Add `Confidential client` and set Type = "Web App".
2. Callback URL: `https://<your-app>/api/v1/social/oauth/twitter/callback`.
3. Scopes: `tweet.read`, `users.read`, `offline.access`.
4. Copy Client ID / Secret into env.
5. Click **Connect Twitter** on `/social-monitoring`.
6. Polling uses `/2/tweets/search/recent` — requires at least Basic tier for
   production volumes. Free tier allows testing up to 50 requests / 15 min.

### TikTok
1. Developer console: https://developers.tiktok.com/apps/
2. Enable **Login Kit** + scopes `user.info.basic`, `video.list`.
3. Set redirect URI: `https://<your-app>/api/v1/social/oauth/tiktok/callback`.
4. Copy Client Key / Secret into env.
5. Poller lists authorized user's own videos (TikTok has no public mention
   search). Each video upserts a SocialMention row.

### YouTube
1. https://console.cloud.google.com/ — create OAuth client ID (Web).
2. Authorized redirect URI: `https://<your-app>/api/v1/social/oauth/youtube/callback`.
3. Enable **YouTube Data API v3** on the project.
4. Scope: `https://www.googleapis.com/auth/youtube.readonly`.
5. Poller reads recent comment threads on the connected channel.

### VK (Вконтакте)
1. https://vk.com/apps?act=manage → Standalone App → create.
2. Generate a **Service token** (no OAuth).
3. Put into `VK_SERVICE_TOKEN`.
4. Register the brand/handle you want monitored as a SocialAccount
   (`platform: "vkontakte"`). `newsfeed.search` queries `handle` + keywords.

### Telegram
1. Talk to @BotFather and create a bot. Copy token into `TELEGRAM_BOT_TOKEN`
   (same bot used for DMs).
2. Add the bot as a **member** of any channel you want monitored
   (public or private — bot needs admin to read messages in private channels).
3. Register the channel as a SocialAccount with `handle = "@channelusername"`.
4. `scanTelegramForOrg` uses `getUpdates` with `allowed_updates=["channel_post"]`.
   Because updates share a global offset per bot token, make sure no other
   process is consuming the same bot's updates.

### Facebook / Instagram (Meta Graph)
1. https://developers.facebook.com/apps/ — create a Business app.
2. Add **Webhooks** product. Subscribe the desired object:
   - `page` + fields `feed` / `mentions` for Facebook pages
   - `instagram` + fields `comments` / `mentions` for IG Business
3. Callback URL: `https://<your-app>/api/v1/webhooks/meta-social`
   Verify token: whatever you set in `META_WEBHOOK_VERIFY_TOKEN`.
4. Paste the App Secret into `META_WEBHOOK_SECRET`. Signatures are verified with
   HMAC-SHA256 in the receiver.
5. Register each FB page / IG Business as a SocialAccount where
   `handle = <page_id>` or `<ig_business_account_id>` — that's what Meta sends
   in the webhook's `entry.id`.

### Cron polling
Point any cron runner (GitHub Actions, systemd timer, Vercel cron, a bare
`curl`) at:
```
POST https://<your-app>/api/cron/social-poll
Authorization: Bearer <CRON_SECRET>
```
Recommended cadence: every 15 min. Runs Twitter + TikTok + YouTube + VK +
Telegram + spike detection in parallel.

### Spike alert thresholds (per-org)
Default: fire when the last hour has ≥ 5 negative mentions AND the count
exceeds 3× the trailing-24h hourly baseline. Override per org by setting
`Organization.settings.socialSpike = { minAbsolute: N, multiplier: M }`.

---

## §8 Surveys — SMS + unsubscribe wiring

### SMS channel
Uses the existing `sendSms()` provider registry (Twilio / Vonage / ATL, selected
in `ChannelConfig(voip).settings.smsProvider`). If no provider is configured,
SMS sends fail cleanly with `"SMS provider not configured"`.

### SMS STOP handling (TCPA/CAN-SPAM)
1. In your SMS provider's console, set the **inbound SMS webhook** to:
   ```
   POST https://<your-app>/api/v1/webhooks/sms-inbound?orgId=<ORG_ID>
   ```
2. The webhook parses `From` + `Body`, and if the first word matches any of
   `stop / stopall / unsubscribe / cancel / end / quit / стоп / отписаться` it
   inserts a row into `survey_unsubscribes` with `phone = From` and
   `surveyId = null`. Future SMS sends via `sendSurveyInvite` are suppressed.
3. All outgoing survey SMS automatically include `"Reply STOP to unsubscribe."`.

### Unsubscribe link in emails
Each survey email includes a signed link to `/s/unsubscribe?s=<surveyId>&e=<email>&t=<hmac>`.
HMAC key is derived from `NEXTAUTH_SECRET`. Upon visit, the email is added to
`SurveyUnsubscribe` with `surveyId = null` (suppresses all future survey email
to that address within the org).

### Auto-trigger after ticket resolve
Surveys with `channels` including `"email"` AND `triggers.afterTicketResolve = true`
fire automatically when a ticket's status transitions to `resolved`. The survey
is sent to the contact's email, skipping already-responded contacts per-ticket.

---

## §3 Segmentation — CSV import

The CSV import dialog (`/contacts` → Import) now recognises these header
aliases as the new fields:
- `brand` → Contact.brand
- `category` / `segment` → Contact.category

SMS attribution (`lastSmsAt`, `lastSmsCampaignId`) is populated automatically
by successful SMS campaign deliveries — no import column needed.

---

## Security notes

- **OAuth tokens** (Twitter / TikTok / YouTube) are encrypted at rest with
  AES-256-GCM (see `src/lib/secure-token.ts`). Key is derived from
  `NEXTAUTH_SECRET` via HKDF. Rotating the secret invalidates stored tokens —
  users will need to reconnect. Legacy plaintext tokens (pre-encryption) still
  decrypt via a version-tag fallback.
- **Widget file uploads**: only a MIME allowlist (11 types) plus an extension
  blocklist. No deep content scanning. For high-security deployments, add a
  ClamAV scan step to `/api/v1/public/web-chat/upload/route.ts` after
  `writeFile`.
- **Rate limits** (in-memory sliding window, per process):
  - `/api/v1/public/web-chat/session`: 5 / min / IP
  - `/api/v1/public/web-chat/message`: 30 / min / sessionId
  - `/api/v1/public/web-chat/upload`: 5 / min / sessionId
  - `/api/v1/public/surveys/[slug]` POST: 10 / 10 min / IP
  For horizontal scaling, swap the in-memory store for Redis.
- **Role-based permissions** (via `requireAuth`):
  - Web chat admin / inbox: module `inbox`
  - Surveys: module `campaigns`
  - Social monitoring: module `campaigns`
  - OAuth connect flows: module `settings`
