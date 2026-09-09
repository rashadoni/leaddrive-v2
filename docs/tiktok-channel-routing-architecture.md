# TikTok Channel Routing Architecture

Updated: 2026-06-30

LeadDrive shows TikTok as one SaaS channel, but the backend never treats every
TikTok event as the same transport.

Canonical route key:

```ts
platform: "tiktok"
surface: "dm" | "comment" | "mention" | "lead_ad"
provider: "chatwoot" | "tiktok_organic" | "tiktok_business"
```

Definitions:

- `platform`: user-facing network, for example `tiktok`.
- `surface`: the product capability and event shape inside that platform.
- `provider`: the technical integration that can read, write, or import that
  surface.
- `capability`: a boolean operation supported by a connection, currently
  `read`, `reply`, `webhook`, and `importLead`.

Current TikTok routing:

| Surface | Provider | Purpose | Reply/import behavior |
| --- | --- | --- | --- |
| `dm` | `chatwoot` | TikTok DMs and DM video shares mirrored from Chatwoot | replies go through Chatwoot |
| `comment` | `tiktok_organic` | Public post comments | blocked until Organic API access is connected |
| `mention` | `tiktok_organic` | Public mentions | blocked until Organic API access is connected |
| `lead_ad` | `tiktok_business` | TikTok lead forms and lead ads | imports CRM leads after Business API webhook is connected |

Rules:

1. Chatwoot-backed TikTok events are `surface=dm`. They must not be promoted to
   public comments from video-share attachments or Chatwoot context labels.
2. Organic API comments and mentions must enter through the `tiktok_organic`
   provider boundary.
3. Lead Ads must enter through the `tiktok_business` provider boundary and be
   deduped by TikTok lead id, phone, or email before CRM lead creation.
4. External TikTok replies stay disabled unless the matching connection has
   `capabilities.reply=true` and `status=connected`.

Product surfaces:

| LeadDrive surface | TikTok event types | Operator expectation |
| --- | --- | --- |
| Unified Inbox | `dm` via Chatwoot | Agent can reply through Chatwoot when the DM connection is active. |
| Social Monitoring | `comment` via Organic API/webhook | Feed is comments-only; DM video shares are not shown here. |
| CRM lead import | `lead_ad` via Business API | Lead forms import/dedupe CRM leads; they are not conversation replies. |

Live-send posture:

- TikTok DM replies can be live through Chatwoot when the tenant connection is
  connected and has reply capability.
- TikTok public comment replies stay unavailable until the Organic provider
  explicitly exposes `capabilities.reply=true`.
- Social Monitoring AI replies and WhatsApp group lead delivery stay dry-run
  until a separate tenant-level live confirmation is recorded.
