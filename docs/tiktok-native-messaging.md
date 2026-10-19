# Native TikTok Business Messaging

LeadDrive's native TikTok adapter uses account-holder OAuth and TikTok API for Business directly. It does not call Chatwoot. Existing Chatwoot conversations retain their original provider; the native adapter never adopts them. This initial version receives new DMs and supports manual text replies. It does not import historical conversations, download media, initiate DMs, or enable automatic replies.

## Availability and activation

Code availability is separate from TikTok approval. The developer application was submitted on 2026-10-19 and was Pending at that check; no production credential or real-message test was available. Creating an application or obtaining advertiser scopes does not grant Business Messaging access. TikTok requires the relevant access/privacy/security review and eligible regions/accounts.

After approval, an operator configures these server-only variables through the registered production deployment mechanism, never in source control or the generic channel form:

| Variable | Value |
| --- | --- |
| `TIKTOK_MESSAGING_CLIENT_ID` | Approved API for Business application ID |
| `TIKTOK_MESSAGING_CLIENT_SECRET` | Application secret |
| `TIKTOK_MESSAGING_AUTHORIZATION_URL` | App-generated **TikTok account-holder** authorization URL |
| `TIKTOK_MESSAGING_REDIRECT_URI` | `https://<canonical-crm-host>/api/v1/channels/tiktok-messaging/oauth/callback/` |
| `NEXTAUTH_SECRET` | Existing stable installation signing/encryption secret |

Register that exact account-holder redirect, including its final slash, in TikTok. It is different from the initial advertiser redirect submitted with the app. The browser may encounter Next's canonical-slash redirect; the token exchange still uses the registered URI verbatim. Start OAuth on the same canonical host so the fresh administrator session is present on return. Other tenant hostnames do not initiate this grant.

The callback verifies the account-specific token through token-info. Required scopes are `message.list.read`, `message.list.send`, `message.list.manage`, and `user.account.type`. `/business/get/` must return `has_advanced_access: true`. Missing access leaves authorization unsuccessful; there is no fallback to comments, Lead Ads or Login Kit.

Successful consent configures the app-level `DIRECT_MESSAGE` subscription to `https://<canonical-crm-host>/api/v1/webhooks/tiktok-messaging` (no trailing slash, avoiding an unverified provider redirect). A failed subscription keeps the valid account grant and exposes an explicit retry action. Subscription is shared by all accounts using the developer app; tenant disconnect never deletes it.

Open Settings → Channels → TikTok. The page reports configuration, authorization, webhook status and last inbound time without returning credentials. Generic ChannelConfig create/edit/delete cannot modify the native configuration. The first version binds one TikTok business account per workspace, and one workspace per app/account pair. Disabled bindings retain ownership to protect historical conversations. Switching accounts or transferring ownership requires a separately designed migration; reconnect the original account.

## Security and delivery behavior

- Fresh administrator session, same-origin POST, signed 10-minute state bound to both user and organization, and a persistent one-use fingerprint. An older consent cannot overwrite a later attempt or a disconnect.
- Access and refresh tokens are encrypted with an organization-specific purpose. Refresh uses returned expiry durations and persists rotated tokens even if subsequent account/scope validation is temporarily unavailable. Unverified refreshed access cannot send.
- The public receiver checks `TikTok-Signature` against the documented `timestamp + '.' + JSON.stringify(body)` HMAC-SHA256, with a local five-minute clock tolerance and a 1 MiB body limit. App ID, recipient role and business ID are checked before tenant routing. Only the signed account lookup uses RLS bypass; message writes are tenant-scoped.
- Native identifiers are namespaced by business account. Repeated inbound events do not create duplicate messages or increment unread counts. Out-of-order events do not overwrite a newer conversation preview. EU restricted notices, echoes and reactions do not invent an inbound text message. Unsupported media appears as a labeled notice; no external media URL is fetched.
- Text replies are limited to 6000 characters, an existing customer-initiated thread, and conservatively 10 CRM replies within 48 hours of the latest inbound. TikTok's documented limits conflict between pages; provider rejection remains authoritative. The local counter does not claim to count messages sent outside LeadDrive.
- Persistent outbound claims prevent double sends across retries. Disconnect, network dispatch and operator reconciliation serialize under the same account lock. Pending state is rechecked immediately before network dispatch, so queued/cancelled attempts cannot later send.
- A timeout, ambiguous response or uncertain database finalization is **unknown delivery**, not a safe retry. The inbox offers explicit operator verification in the TikTok conversation after two minutes; records include the actor, outcome and time. An uncertain attempt blocks further sends to that thread. An explicit rejection is retryable with a new operation key.
- `sent` means TikTok accepted the text, not a delivery/read receipt. Outbound echoes and historical synchronization are not implemented in this version.
- Disconnect clears both locally stored tokens and attempts short-term access-token revocation. TikTok's revoke documentation does not guarantee revocation of the entire grant/refresh token. Account owners can manage the grant in TikTok as needed. A request already dispatched before disconnect is allowed to finish before disconnect reports completion.

## Verification and rollout

Unit/route tests cover signature tampering/replay, app/account binding, OAuth state/tenant/single-use guards, token response and rotation handling, inbound deduplication, outbound claims and uncertainty, native-versus-legacy dispatch, operator reconciliation and UI status guards. Mocked-provider tests do not establish real TikTok interoperability.

Release through the normal feature PR → required CI → owner release-scope go-ahead → main → GitHub deployment route. No schema migration is required. Missing dedicated configuration leaves the connect action unavailable and the webhook returns 503. Existing channels remain on their existing transport.

After deployment and provider approval, the remaining acceptance check is: authenticate an eligible account with the four scopes; verify subscription; send one owner-approved incoming DM; confirm one tenant-local conversation; reply once; confirm the actual TikTok receipt; replay the same request/event to verify no duplicate; verify refresh and local disconnect. Do not claim live operation before this evidence exists. No credentials, provider grants, tenant settings or external messages were changed during implementation.

## Official contracts checked 2026-10-19

- [Access requirements](https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3)
- [Account-holder authorization](https://business-api.tiktok.com/portal/docs/authorization/v1.3)
- [Authentication and token lifecycle](https://business-api.tiktok.com/portal/docs/business-messaging-api-authentication/v1.3)
- [Account profile and Advanced Access](https://business-api.tiktok.com/portal/docs/get-profile-data-of-a-tiktok-account/v1.3)
- [Send a conversation message](https://business-api.tiktok.com/portal/docs/send-a-message-to-a-conversation/v1.3)
- [Messaging webhook events](https://business-api.tiktok.com/portal/docs/subscribe-to-business-messaging-webhook-events-via-webhooks-api/v1.3)
- [Webhook signature verification](https://business-api.tiktok.com/portal/docs/webhook-verification/v1.3)
- [Short-term token revocation](https://business-api.tiktok.com/portal/docs/revoke-a-short-term-access-token/v1.3)

No Messaging challenge handshake or retry schedule was verified in these sources. The receiver does not copy Meta or TikTok developer-webhook-v2 handshake assumptions.
