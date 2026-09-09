# TikTok Channel Hub Plan

Updated: 2026-07-01

## Implementation Status

Code, migration, tests, production deploy, and production smoke for the first
provider-boundary slice are complete through Phase 10.

Remaining operational tasks:

1. Get TikTok Organic API approval and credentials for public comments and
   mentions.
2. Get TikTok Business API / Lead Ads access, ad account scope, and selected
   lead form IDs.
3. Clean up duplicate active TikTok Chatwoot DM configs only after confirming
   which config owns the current token and webhook secret.
4. Run live production smoke with one real TikTok DM, one public comment event,
   and one lead form event.

Live external replies remain disabled until separately approved.

## Goal

Build TikTok as one SaaS channel in the product UI, while keeping each technical
integration separate in the backend.

The user should see one `TikTok` channel with several capabilities:

- DM Inbox
- Comments & Mentions
- Lead Ads

The backend should route each capability by `platform + surface + provider`, so
TikTok DMs, public comments, mentions, and lead ads are never mixed.

## Product Model

Do not create two or three top-level TikTok channels in Settings. Create one
TikTok hub:

`Settings -> Channels -> TikTok`

Inside the hub, show capability cards:

1. `DM Inbox`
   - Provider: `chatwoot` for the current implementation.
   - Purpose: TikTok DMs and video shares.
   - Reply path: Chatwoot API.

2. `Comments & Mentions`
   - Provider: `tiktok_organic`.
   - Purpose: public post comments, comment mentions, brand mentions.
   - Reply path: TikTok API for Business Organic API, only when the account has
     the required permission.

3. `Lead Ads`
   - Provider: `tiktok_business`.
   - Purpose: TikTok lead forms, direct-message lead ads, ad-origin leads.
   - Delivery path: CRM lead pipeline.

## Canonical Routing Fields

All inbound and outbound logic should use these concepts:

```ts
platform: "tiktok"
surface: "dm" | "comment" | "mention" | "lead_ad"
provider: "chatwoot" | "tiktok_organic" | "tiktok_business"
```

Examples:

```ts
// TikTok DM via Chatwoot
platform = "tiktok"
surface = "dm"
provider = "chatwoot"

// TikTok public comment via Organic API
platform = "tiktok"
surface = "comment"
provider = "tiktok_organic"

// TikTok lead form via Business API
platform = "tiktok"
surface = "lead_ad"
provider = "tiktok_business"
```

UI badges should use the same separation:

- `TikTok · DM · Chatwoot`
- `TikTok · Comment · Organic API`
- `TikTok · Mention · Organic API`
- `TikTok · Lead · Business API`

## Recommended Data Model

Prefer a new connection model over overloading `ChannelConfig` further.

Candidate model:

```ts
ChannelConnection {
  id: string
  organizationId: string
  platform: string        // tiktok, facebook, instagram, ...
  surface: string         // dm, comment, mention, lead_ad
  provider: string        // chatwoot, tiktok_organic, tiktok_business
  displayName: string
  status: string          // connected, needs_access, error, disabled
  capabilities: Json      // { read: true, reply: false, webhook: true, importLead: false }
  settings: Json          // non-secret account ids, inbox ids, asset ids
  secretRef: string?      // optional indirection if secrets move to a vault later
  apiKey: string?
  accessToken: string?
  refreshToken: string?
  tokenExpiresAt: Date?
  lastHealthCheckAt: Date?
  lastInboundAt: Date?
  lastError: string?
  createdAt: Date
  updatedAt: Date
}
```

If schema risk is too high for the first slice, keep `ChannelConfig` temporarily
and add explicit `settings.platform`, `settings.surface`, and `settings.provider`.
The target architecture should still be `ChannelConnection`.

## Phase 1: Architecture Foundation

1. Add a short architecture note that defines:
   - `platform`
   - `surface`
   - `provider`
   - `capability`
2. Decide whether this slice creates `ChannelConnection` immediately or uses a
   compatibility layer over `ChannelConfig`.
3. Add helper functions:
   - `resolveChannelConnection({ organizationId, platform, surface, provider })`
   - `listPlatformConnections({ organizationId, platform })`
   - `connectionCan(connection, capability)`
4. Add tests for the helper functions.

Acceptance:

- The codebase has one canonical vocabulary for platform/surface/provider.
- Existing TikTok DM behavior is not changed yet.

## Phase 2: Migrate Current TikTok DM

1. Map the existing active `TikTok via Chatwoot` config to:
   - `platform=tiktok`
   - `surface=dm`
   - `provider=chatwoot`
2. Preserve existing Chatwoot fields:
   - `baseUrl`
   - `accountId`
   - `inboxId`
   - `webhookSecret`
   - `apiKey`
   - `replyMode`
3. Remove or disable duplicate active Chatwoot configs for the same tenant,
   after checking which one contains the latest token/settings.
4. Update the Chatwoot webhook mirror to write these metadata fields into
   `ChannelMessage` and `SocialMention`.
5. Keep existing external send behavior unchanged.

Acceptance:

- TikTok DMs still arrive from Chatwoot.
- TikTok video shares remain `surface=dm`, not comments.
- No public comments are faked from DM/video-share payloads.

## Phase 3: TikTok Hub Settings UI

1. Replace the current TikTok connection route with a TikTok hub screen:
   - `DM Inbox`
   - `Comments & Mentions`
   - `Lead Ads`
2. Each capability card shows:
   - connection status
   - provider
   - last inbound event
   - last health check
   - what is supported: read, reply, webhook, lead import
3. Add actions:
   - `Connect`
   - `Reconnect`
   - `Test`
   - `Disable`
4. Keep provider details visible but secondary. The primary user-facing object is
   still `TikTok`.

Acceptance:

- Admin sees one TikTok channel, not separate top-level TikTok duplicates.
- Admin can understand why DMs are connected but comments may still need access.

## Phase 4: DM Inbox Health Check

1. Add Chatwoot health check for TikTok DM:
   - base URL reachable
   - account ID reachable
   - inbox exists
   - webhook exists and points to LeadDrive
   - last inbound event timestamp exists when messages have arrived
2. Show clear failure states:
   - `Chatwoot token invalid`
   - `Inbox missing`
   - `Webhook missing`
   - `No test DM received yet`
3. Add a one-click copy button for the webhook URL.

Acceptance:

- The user can tell whether TikTok DM is really connected end to end.
- No manual DB inspection is needed for normal setup support.

## Phase 5: Comments & Mentions Provider

1. Add provider key `tiktok_organic`.
2. Add setup state for TikTok API for Business / Organic API:
   - access not requested
   - access requested
   - connected
   - connected but reply unavailable
   - error
3. Add OAuth/API credential storage for the Business/Organic API path.
4. Store the selected Business Account / TikTok asset.
5. Add webhook endpoint:
   - `/api/v1/webhooks/tiktok-organic`
6. Map incoming events:
   - comment -> `platform=tiktok`, `surface=comment`, `sourceType=comment`
   - mention -> `platform=tiktok`, `surface=mention`, `sourceType=mention`
7. Store source post/video metadata separately from comment text.
8. Add poll fallback only if the provider supports it safely.

Acceptance:

- Public comments are stored separately from DMs.
- Source video/post is context, not the message body.
- The UI can filter comments without showing DM video shares.

## Phase 6: Reply Routing

1. Replace platform-only reply routing with provider-aware routing:
   - `platform + surface + provider`
2. Routing table:
   - `tiktok + dm + chatwoot` -> Chatwoot API
   - `tiktok + comment + tiktok_organic` -> TikTok Organic API, if allowed
   - `tiktok + mention + tiktok_organic` -> TikTok Organic API, if allowed
   - `tiktok + lead_ad + tiktok_business` -> no public reply; route to CRM
3. Add capability checks before enabling the reply composer.
4. If reply is unavailable, show:
   - `Reply unavailable for this TikTok surface`
   - `Open in TikTok`

Acceptance:

- A DM reply never goes to a comment endpoint.
- A comment reply never goes through Chatwoot.
- Unsupported reply paths fail closed and explain why.

## Phase 7: Social Monitoring UI

1. Add TikTok event-type filters:
   - all TikTok
   - DM
   - comments
   - mentions
   - lead ads
2. Add source badges:
   - `TikTok · DM`
   - `TikTok · Comment`
   - `TikTok · Mention`
   - `TikTok · Lead`
3. For TikTok video shares:
   - show `TikTok video was shared in DM without text`
   - show source video separately
4. For public comments:
   - show comment text as the main body
   - show source video/post as context
5. Keep `Open Chatwoot` only for Chatwoot-backed DMs.
6. Show `Open TikTok` or `Open source post` for Organic API comments.

Acceptance:

- Operators can visually distinguish TikTok DM from TikTok comments.
- The screen no longer creates the expectation that DM video shares are comments.

## Phase 8: Lead Ads Surface

1. Add `surface=lead_ad`.
2. Add provider `tiktok_business`.
3. Add TikTok Business lead forms connection.
4. Map TikTok lead form fields to CRM lead fields.
5. Add dedupe rules:
   - phone
   - email
   - TikTok lead id
6. Add source attribution:
   - campaign
   - ad group
   - ad
   - form

Acceptance:

- TikTok ad leads enter CRM as leads, not as social comments.
- Operators can still see source attribution.

## Phase 9: Tests

1. Unit tests:
   - connection resolver
   - capability checks
   - reply routing matrix
2. API tests:
   - Chatwoot DM webhook remains working
   - TikTok Organic comment webhook creates comment mentions
   - duplicate webhook payloads are deduped
3. Migration tests:
   - existing TikTok via Chatwoot config maps to `surface=dm`
4. UI tests or browser smoke:
   - TikTok hub settings page
   - DM health check visible
   - Comments card shows needs-access before connection
   - Social Monitoring filters by TikTok event type

Acceptance:

- DM, comment, mention, and lead surfaces are covered by tests.
- Existing Chatwoot TikTok behavior does not regress.

## Phase 10: Deployment And Production Smoke

1. Deploy schema/model slice first if `ChannelConnection` is added.
2. Run production health checks:
   - `/api/v1/ping`
   - `/api/health`
3. Smoke current TikTok DM:
   - send a test TikTok DM
   - confirm Chatwoot receives it
   - confirm LeadDrive Inbox receives it
   - confirm Social Monitoring classifies it as `DM`
4. When Organic API access exists:
   - send or receive a test public comment event
   - confirm Social Monitoring classifies it as `Comment`
   - test reply only if the provider capability says reply is available

Acceptance:

- Production still supports TikTok DM after the architecture migration.
- Public comments appear only after a real comments provider is connected.

## Implementation Order

Recommended order:

1. Phase 1: Architecture Foundation
2. Phase 2: Migrate Current TikTok DM
3. Phase 3: TikTok Hub Settings UI
4. Phase 4: DM Inbox Health Check
5. Phase 7: Social Monitoring UI separation
6. Phase 5: Comments & Mentions Provider
7. Phase 6: Reply Routing
8. Phase 8: Lead Ads Surface
9. Phase 9: Tests
10. Phase 10: Deployment And Production Smoke

Reason:

- First protect the already-working Chatwoot DM path.
- Then make the settings/UI model honest.
- Only after that add the new TikTok comments provider.

## Non-Goals For The First Slice

- Do not fake TikTok post comments from Chatwoot DM video shares.
- Do not enable live external comment replies until provider capability is proven.
- Do not delete old Chatwoot configs before confirming which one contains the
  active API token and webhook secret.
- Do not expose TikTok provider complexity as separate top-level channels.

## Open Decisions

1. Should `ChannelConnection` replace `ChannelConfig` for all future channels, or
   only for multi-surface platforms first?
2. Should secrets remain on the connection row or move behind a secret reference?
3. Should TikTok Organic API setup be visible before the tenant has API access,
   or hidden behind an `Apply for access` state?
4. Should Social Monitoring default TikTok filter include DMs and comments
   together, or default to comments first once comments are connected?
