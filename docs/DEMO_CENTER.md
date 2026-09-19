# Private Demo Center

## Purpose

Demo Center lets a corporate prospect explore an administrator-selected set of
LeadDrive product stories without receiving a tenant account. Every screen uses
synthetic records. The public experience follows a guided-demo pattern: a
personalized lobby, one explicit start action, an ordered product tour, visible
progress, and a terminal completion screen.

## Operator workflow

1. A prospect submits the public `/demo` form with a corporate email and
   consent.
2. A superadmin opens **Admin → Demo Center** and reviews the request.
3. The superadmin selects and orders any of the 19 approved module demos, then
   sets link validity, absolute session duration, and inactivity timeout.
4. **Preview selected** opens the current playlist in the same synthetic player
   without creating a grant, sending email, consuming a client session, or
   recording client access events. The preview remains superadmin-only.
5. **Issue access** creates a fresh capability link and sends it to the
   prospect. Reissuing revokes every earlier usable link for that request.
6. The prospect opens the link, receives a six-digit email code, verifies it,
   and explicitly starts the session. Merely opening or scanning the email does
   not consume access.
7. Admins can follow the access event history or revoke the grant immediately.

## One-session contract

- The invitation token is stored only as a SHA-256 hash; the raw token exists
  only in the delivered URL.
- Verification and active-session credentials are HTTP-only, secure production
  cookies scoped to that invitation.
- A grant can be active in one browser only. A lost start response can be
  retried by that same verified browser without consuming another session.
- Completion, revocation, reissue, absolute timeout, inactivity timeout, or a
  sustained inability to confirm lifecycle state closes the player.
- OTP verification has five total guesses, five total sends, and a resend
  cooldown.
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

## Voice phase

The current release is intentionally silent. Narration must use the approved
external Google AI Studio workflow with credentials supplied through the
deployment environment. Do not add local TTS or commit provider credentials.

## Rollout checklist

- Apply `20260919170000_demo_center_one_session` through the normal reviewed
  migration path.
- Confirm the existing transactional email provider and public `APP_URL` are
  configured.
- Verify a request, issue, OTP, start, completion, reissue, and revoke flow in a
  staging environment.
- Confirm the public demo route never appears in logs, analytics, referrers, or
  Sentry Replay with its raw capability token.
- Run the normal CI/typecheck/build gate away from the Contabo inspection host.
