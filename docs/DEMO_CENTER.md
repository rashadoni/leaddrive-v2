# Private Demo Center

## Purpose

Demo Center lets a corporate prospect explore an administrator-selected set of
LeadDrive product stories without receiving a tenant account. Every screen uses
synthetic records. The public experience follows a guided-demo pattern: a
personalized lobby, one explicit start action, an ordered product tour, visible
progress, and a terminal completion screen.

## Operator workflow

1. A prospect submits the public form (leaddrivecrm.org or `/demo`) with an
   email and consent. The guided demo link goes to that address by itself
   (`src/lib/demo-center/auto-issue.ts`); the owner is **not** told yet —
   anyone can type any address.
2. The prospect opens the link and presses **Təsdiqlə və demonu aç**. That
   press confirms the address (`demo-access/[token]/confirm`), sets
   `DemoRequest.emailConfirmedAt`, and only then sends the owner his
   «Yeni demo sorğusu» — once per request (owner, 2026-10-18). A request whose
   link could not be sent is reported to him straight away, marked as not
   confirmed, because nobody could confirm it.
   The form also carries a solved bot check: a signed proof of work the
   visitor's browser solves while they type, refused when missing, forged,
   unsolved, younger than three seconds or already spent on another request
   (`src/lib/demo-center/form-challenge.ts`; owner, 2026-10-18).
3. A superadmin opens **Admin → Demo Center** and reviews the request.
4. The superadmin selects and orders any of the 19 approved module demos, then
   sets link validity, absolute session duration, and inactivity timeout.
5. **Preview selected** opens the current playlist in the same synthetic player
   without creating a grant, sending email, consuming a client session, or
   recording client access events. The preview remains superadmin-only.
6. **Issue access** creates a fresh capability link and sends it to the
   prospect. Reissuing revokes every earlier usable link for that request.
7. The prospect opens the link and presses the one button: it confirms the
   address and starts the session in that browser. Merely opening or scanning
   the email confirms nothing and does not consume access — mail scanners open
   links, so the confirmation is a POST from the button, never the GET. (Until
   2026-10-18 this was a six-digit code sent in a second email.)
8. Admins can follow the access event history or revoke the grant immediately.

## One-session contract

- The invitation token is stored only as a SHA-256 hash; the raw token exists
  only in the delivered URL.
- Verification and active-session credentials are HTTP-only, secure production
  cookies scoped to that invitation.
- A grant can be active in one browser only. A lost start response can be
  retried by that same verified browser without consuming another session.
- Completion, revocation, reissue, absolute timeout, inactivity timeout, or a
  sustained inability to confirm lifecycle state closes the player.
- The open demo (`/demo-open`, no request) admits only a signed-in
  superadmin since 2026-10-18; anyone else is sent to `/demo`.
- Demo URLs use `no-store`, `no-referrer`, `noindex`, redacted telemetry, and
  hashed rate-limit keys. Session Replay is disabled before a private demo route
  renders.

## Data boundary

The player never calls tenant APIs and never authenticates the prospect as an
application user. The server returns only the selected Azerbaijani synthetic
module manifests after session start. RLS keeps requests, grants, and events in
the platform control plane and permits access only through explicit superadmin
or capability handlers.

This is access control, not DRM. Any content rendered in a browser can be
photographed or copied by a determined recipient. Watermarks, one-session
expiry, and revocation deter casual sharing; they do not make screen capture
technically impossible.

## Guided journey (next content model)

The fixed «module → three cards» content of `src/lib/demo-center/catalog.ts`
is being replaced by a versioned scenario that runs through real LeadDrive
screens. The contract, coverage inventory and trust-boundary tests live in
`src/lib/demo-center/journey/` and are described in
`docs/demo-guided-journey.md`. Until the renderer lands, the player below
still serves the catalog; the access, confirmation and one-session lifecycle in this
document stay unchanged.

## Live social connections

A prospect may connect his own Facebook Page to the demo for one day, write
to it with the session's code and watch the AI answer. Unlike the WhatsApp
thread, which runs on our own number, this means holding a token to somebody
else's Page and a webhook subscription on it. So it is built release first:
the code that unbinds a Page (`src/lib/demo-center/demo-social-release.ts`,
cron `/api/cron/demo-social-release` every five minutes) shipped and ran on
production's empty table before any code that connects one.

Rules that hold for every later change:

- **Release before connect.** Nothing may create a row in
  `demo_social_connections` unless the release engine in production can undo it.
- **One function decides whether a connection is live:**
  `demoSocialReleaseReason` (`src/lib/demo-center/demo-social-connection.ts`).
  The webhook, the send path, the demo page and the cron all ask it. It reads
  timestamps and the grant's state, never the grant's status alone — a closed
  tab stays ACTIVE in the database (`access.ts` expires grants lazily). With
  the cron down, use still stops on time; only the unbinding waits.
- **Record before acting at Meta.** Store the user-token cipher right after the
  code exchange, together with the Meta user id, and the Page-token cipher
  before `POST subscribed_apps`. A crash in between then leaves a row the
  engine can undo. A user token without its Meta user id is never revoked
  (`kept_unverified`): the engine could not tell whether another live
  connection rests on the same grant.
- **Tokens only through `encryptToken`**, with the purpose
  `demoSocialTokenPurpose(rowId, "user" | "page")`; a CHECK refuses anything
  that is not `v1:` ciphertext. Every Graph call sends its token as a Bearer
  header, never in a URL or a log, and stops after 10 seconds
  (`src/lib/social/meta-unbind.ts`). Meta's `paging.next` links carry the token,
  so they are never followed.
- **Never write to a tenant.** The rows have no organisation; they are control
  plane, behind the system-bypass policy. Nothing goes into `channel_configs`,
  `social_accounts`, `channel_messages`, `social_conversations`, contacts,
  notifications or the AI log.
- **Never unsubscribe a claimed Page; never revoke a shared grant.** A Page's
  subscription to our app is shared by every organisation that uses the Page
  through it, and one grant covers every Page the person granted. Before each
  step the engine asks `claimedMetaPageIds` (`src/lib/social/meta-page-claims.ts`,
  by Page id across every organisation, under bypass) and keeps what anyone
  relies on: `kept_claimed`, `kept_shared`. If the owner tests with his own
  Facebook account, an unconditional revoke would kill LeadDrive Inc.'s Page
  tokens. Known gap: an organisation's Instagram channel rides its linked
  Page's subscription but is stored under the Instagram account's id, so a
  Page claimed only through Instagram is not seen; the connect step has to
  refuse such a Page.

What the release leaves behind: the wiped row (timestamps, reason, Meta's
answers as short codes, counts) and the `SOCIAL_*` events, whose metadata
carries no Page id, sender id, name or text. A Meta step that never answers is
retried every tick; 24 hours after the release was asked for, the row is wiped
anyway and recorded as `SOCIAL_RELEASE_INCOMPLETE`. The deploy step «Verify the
demo social release scheduler» fails when a connection is more than 30 minutes
past its end without a single attempt.

## Voice phase

The current release is intentionally silent. Narration must use the approved
external Google AI Studio workflow with credentials supplied through the
deployment environment. Do not add local TTS or commit provider credentials.

## Rollout checklist

- Apply `20260919170000_demo_center_one_session` through the normal reviewed
  migration path.
- Confirm the existing transactional email provider and public `APP_URL` are
  configured.
- Verify a request, issue, confirmation, start, completion, reissue, and revoke flow in a
  staging environment.
- Confirm the public demo route never appears in logs, analytics, referrers, or
  Sentry Replay with its raw capability token.
- Run the normal CI/typecheck/build gate away from the Contabo inspection host.
