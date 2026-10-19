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
  code exchange, and the Page-token cipher before `POST subscribed_apps`. A
  crash in between then leaves a row the engine can undo, and wipe.
- **Tokens only through `encryptToken`**, with the purpose
  `demoSocialTokenPurpose(rowId, "user" | "page")`; a CHECK refuses anything
  that is not `v1:` ciphertext. Every Graph call sends its token as a Bearer
  header, never in a URL or a log, and stops after 10 seconds
  (`src/lib/social/meta-unbind.ts`).
- **Never write to a tenant.** The rows have no organisation; they are control
  plane, behind the system-bypass policy. Nothing goes into `channel_configs`,
  `social_accounts`, `channel_messages`, `social_conversations`, contacts,
  notifications or the AI log.
- **Never unsubscribe a claimed Page.** A Page's subscription to our app is
  shared by every organisation that uses the Page through it. Before the
  unsubscribe the engine asks `claimedMetaPageIds`
  (`src/lib/social/meta-page-claims.ts`, across every organisation, under
  bypass) about the Page id and the linked Instagram account's id
  (`linkedInstagramId`), and keeps the subscription when anyone relies on
  either (`kept_claimed`). The Instagram id matters because an organisation's
  Instagram inbox channel stores it as `channel_configs.pageId`, Social
  Monitoring stores it as `social_accounts.handle`, and Instagram DMs ride the
  linked Facebook Page's subscription: an organisation using the Page only
  through Instagram must block the unsubscribe too. The connect stores
  `linkedInstagramId` whenever Meta returns the Page's
  `instagram_business_account` with the requested fields, and never fails for
  want of it (the read goes again without the field); a row without it is
  checked by its Page id alone.
- **Never revoke the person's Meta grant.** Unbinding means the Page
  unsubscribed from our app and every token and identifier of ours wiped; the
  engine sends nothing for the grant and never decrypts the user token
  (`grantRevokeOutcome` is `kept_by_design`, or `no_token` when none was
  stored). A revoke (`DELETE /me/permissions`) can never be proven safe:
  `/me/accounts` does not list Pages reached through a business portfolio
  (`src/lib/social/meta-granted-assets.ts`, observed 2026-09-20 on app
  2414060595720618), so «no Page this grant reaches is claimed» could only be
  read from `debug_token`. On the owner's own account it would kill LeadDrive
  Inc.'s staged Page tokens, and it let one row's revoke kill a due sibling's
  Page token before that sibling had unsubscribed. The authorization stays
  with the person, who can remove LeadDrive in Meta's Business Integrations.
  The connect panel links there, and the consent text
  (`src/lib/demo-center/demo-social-consent.ts`) says that the authorization
  stays with him after the demo and that he can remove LeadDrive there.
- **Only the proven sender exists** (owner, 2026-10-19). The demo shows and
  answers only the person who wrote to the Page with the session's code. Before
  the proof an event without the code is dropped unstored; the first message
  with the code proves its sender in one atomic update; from then on every
  other sender's event is dropped before anything else of it is read — not
  stored, counted, logged or answered. One proven sender per connection.

What the release leaves behind: the wiped row (timestamps, reason, Meta's
answer to the unsubscribe as a short code, counts) and the `SOCIAL_*` events,
whose metadata carries no Page id, Instagram id, sender id, name or text. At
Meta, the person's own authorization of our app stays until he removes it. An
unsubscribe that Meta never answers is retried every tick, rows never tried
first; 24 hours after the release was asked for, the row is wiped anyway and
recorded as `SOCIAL_RELEASE_INCOMPLETE`. Each attempt holds a two-minute lease
taken on the clock of the claim, so a run that started long ago cannot hand
out a lease that has already run out. The deploy step «Verify the
demo social release scheduler» fails when a connection is more than 30 minutes
past its end without a single attempt.

### Switches

The feature exists only where both are on, and only in a granted session (not
the open demo, not the admin preview), in the inbox chapters:

- **The server's:** `DEMO_SOCIAL_META_APP_CONFIG_ID` names LeadDrive Inc.'s
  staged Facebook app row (on production `channel_configs`
  `cmua55s6t03n0kpvtm63bclud`, app 2414060595720618, `appReviewOnly`), read
  inside the sales organisation through `inDemoSalesOrganization` +
  `getPinnedMetaApp`, plus the product's `FACEBOOK_REDIRECT_URI`. Unset: no
  panel, the routes answer `enabled: false` / 404, the callback binds nothing,
  the webhook's demo branch returns before it reads a row.
- **The admin's, per grant:** `demo_grants.liveSocialEnabled`, ticked at issue
  time in the request page next to the live call, exactly as that one is
  (`issue` route → `issueDemoGrant`, recorded in the ISSUED event's metadata).
  Off for every grant the public form issues. A CHECK holds it to guided-story
  grants. Re-issuing is how it changes, as for the call.

### Connecting (`demo-social-oauth.ts`, `demo-social.ts`)

- «Facebook ilə qoşun» posts the consent to
  `/api/v1/public/demo-access/[token]/social`; the server makes (or reuses)
  the grant's row under an advisory lock that also holds the ceiling of 20
  open connections, sets an httpOnly nonce cookie scoped to the callback path,
  and answers Meta's dialog address. The panel opens the tab inside the press
  and points it there.
- The dialog is the product's own for the pinned app: `config_id` when the
  row carries `settings.loginConfigId` (Facebook Login for Business), else
  exactly `public_profile,pages_show_list,pages_manage_metadata,pages_messaging`.
- The state is `ldd.<base64url {connection id, issued at}>.<hmac>`; no raw demo
  token anywhere; fifteen minutes; one use (the row's nonce hash is consumed).
  The product's callback hands it over in its first lines, and the proxy lets
  exactly that GET past the login wall — a product state is base64url and
  never contains a dot, so neither path can take the other's state.
- Code → short token → long-lived token (POST bodies), stored encrypted at
  once with `/me`'s id; then `/me/accounts`, and when that is empty the granted
  Page ids from `debug_token` read one by one, as the product does. Pages an
  organisation relies on (by Page id or linked Instagram id) or another live
  demo holds are refused. One Page left: its token is stored, then
  `POST subscribed_apps` with `subscribed_fields=messages` only. Several: their
  ids and names are kept in `pendingPages` and the panel asks by name; the
  choice is re-read from Meta and re-checked. A subscription Meta did not
  confirm asks for the release at once, and the bind keeps its lease until it
  runs out: an unconfirmed `POST` may still take effect at Meta, so the
  release's `DELETE` goes out at least two minutes after it.
- The bind holds the release's two-minute lease from the moment it stores the
  Page token until the subscribe has settled, and gives it back on every other
  way out: a release run that comes due meanwhile retries on its next tick, so
  its `DELETE subscribed_apps` comes after Meta's answer to our `POST`. If the connection
  ended while the `POST` was on its way and Meta confirmed it anyway, the bind
  unsubscribes the Page itself, at once — unless an organisation claims it or
  another live demo holds it.
- Starting again on a row that has bound no Page (a cancelled or failed
  attempt, «Yenidən başlayın») restarts its thirty-minute window and its day,
  and drops the previous attempt's Page list, user token and Meta user id.
- **One exception to the Bearer rule above:** `debug_token` takes the token it
  inspects as `input_token` and the app token as `access_token` in its query —
  Graph has no other place for them. It goes through the product's own helper
  (`grantedPageIds`, which redacts every provider answer) and only when
  `/me/accounts` came back empty. Every other call of the connect sends tokens
  as a Bearer header or a form body.

### Messages (`demo-social-inbound.ts`)

The Facebook webhook hands an entry to `handleDemoSocialEntry` only on its
«no channel» branch, for a `page` object signed with the sales organisation's
own app (`?t=<its slug>`), before any tenant work: a Page LeadDrive Inc. has as
an active channel takes the tenant path unchanged. The demo writes
`demo_social_messages` alone (idempotent by Meta's message id), never a tenant
table, and runs none of LeadDrive Inc.'s automations. The agent is the
WhatsApp demo's — the same profile, history building, commitment guard and
model — with a Messenger frame that has it speak as LeadDrive's demo agent,
never as the Page's business; at most ten answers per connection, three
seconds apart, counted on the row (tokens too, not in the tenant's AI log),
sent with the stored Page token through `sendFacebookMessage`, to the proven
sender only, and only after `demoSocialReleaseReason` is asked once more.

Both message rows — the prospect's and the agent's — are written in one
transaction that first locks the connection row, and only while it is
unscrubbed; the wipe needs the same lock, so it either deletes the new message
with the rest or comes first and nothing is written. Every release run also
deletes any message of an already wiped connection. An answer holds its slot
while it is generated and sent (`lastAiReplyAt` marked 30 seconds ahead; the
model call is bounded to one 15-second try): a message that arrives meanwhile
is stored and not answered, and the three seconds count from the moment the
last answer was sent.

The public read gives the Page's name, the code, the end of the day and the
proven sender's conversation — no id, no token; the Messenger link is a
redirect of ours (`…/social/messenger` → `m.me/<page>`). «Ayır» and «Bitir»
set the release request (`disconnected`, `finished`) — «Bitir» in the guided
story, the only player a Page can be connected in, arrives as the
`journey.completed` report; the panel then says «ayrılır…», later «ayrıldı»,
with the Business Integrations link. A poll that was on its way when a button
was pressed is dropped, so it cannot put the panel back where it was.

### Draft for the owner: privacy policy addition (not yet in `messages/*.json`)

The policy text is the owner's to approve; nothing below is published. It
would go after §8 (`privacy.p8_deletion`). English first, then Russian.

> **Demo: connecting your own Facebook Page.** In a personal LeadDrive demo you
> may connect one Facebook Page you manage, for the day of the demo. LeadDrive
> then receives Messenger messages sent to that Page through our Meta app. Only
> the person who first writes to the Page with the demo's code is answered and
> kept: his messages and the demo AI agent's replies (at most ten) are kept in
> the demo's own records — not in any customer's CRM workspace —, shown on that
> demo page, and sent to Anthropic to write the replies. Until someone has
> written with the code, each incoming message is checked only for the code.
> Messages from anyone else are discarded at once, without being stored, shown
> or answered. We keep the Page's id and name; the linked Instagram account's
> id when Meta provides it; the Meta user id of the person who connected the
> Page; the Messenger (Page-scoped) id of the person who wrote with the code;
> while you choose among several Pages, the ids and names of the Pages you
> granted (cleared once you choose one, or when the connection ends); and
> encrypted access tokens. The connection ends at 23:59 Baku time at the
> latest, or earlier when you press «Ayır», finish the demo or the demo
> session ends. Normally within five minutes the Page is unsubscribed from our
> app — unless another LeadDrive customer relies on that Page — and every
> token, identifier and message of the connection is deleted from active
> systems; if Meta does not answer, we retry for up to 24 hours and then delete
> our copy regardless. What remains is a record without identifiers (times,
> why it ended, Meta's answer as a short code, counts). Daily backups taken
> while the connection was live can still hold these records until they are
> removed (section 7). LeadDrive does not withdraw the authorisation you gave
> our app at Meta; you can remove LeadDrive in Meta's Business Integrations
> settings at any time.

> **Демо: подключение своей Facebook-страницы.** В персональном демо LeadDrive
> можно подключить одну свою Facebook-страницу на день демо. Тогда LeadDrive
> получает через наше Meta-приложение сообщения Messenger, написанные этой
> странице. Отвечаем и сохраняем только того, кто первым написал странице с
> кодом демо: его сообщения и ответы демо-ИИ-агента (не больше десяти) хранятся
> в собственных записях демо — не в CRM какого-либо клиента, — показываются на
> его странице демо и отправляются в Anthropic, чтобы составить ответы. Пока
> никто не написал с кодом, каждое входящее сообщение лишь проверяется на код;
> сообщение без кода сразу отбрасывается. Сообщения всех остальных отбрасываются сразу: не
> сохраняются, не показываются, ответа не получают. Мы храним id и название
> страницы; id связанного Instagram-аккаунта, если Meta его отдаёт; Meta-id
> человека, подключившего страницу; Messenger-id того, кто написал с кодом;
> пока вы выбираете страницу — id и названия выданных вами страниц (стираются
> после выбора или по окончании подключения); и токены доступа в
> зашифрованном виде. Подключение
> заканчивается не позже 23:59 по Баку или раньше — по «Ayır», по завершении
> демо или по окончании сессии. Обычно в течение пяти минут страница
> отписывается от нашего приложения — если на неё не опирается другой клиент
> LeadDrive — и все токены, идентификаторы и сообщения подключения удаляются из
> рабочих систем; если Meta не отвечает, мы повторяем до 24 часов, а затем
> удаляем свою копию в любом случае. Остаётся запись без идентификаторов
> (время, причина окончания, ответ Meta коротким кодом, счётчики). Ежедневные
> резервные копии, снятые, пока подключение было живо, могут хранить эти
> записи до их удаления (раздел 7). LeadDrive не отзывает разрешение, которое
> вы дали нашему приложению в Meta; удалить LeadDrive можно в любой момент в
> разделе Meta «Business Integrations».

Also for the owner to look at: the demo landing bullet «No tenant or real
customer data access» (`messages/*.json`, the demo page) stays true — the
demo still reads no tenant's data, and a Page's other customers' messages are
never kept — but it does not mention that the prospect's own Page can be
connected.

## Voice

**Recorded narration.** Every step and every prepared answer is recorded in
advance with Gemini TTS, voice Kore (`src/lib/demo-center/guide-voice.ts`,
`scripts/demo-guide/generate-voice.ts`), and shipped under
`public/sounds/demo-guide/`. Do not add local TTS or commit provider
credentials.

**Spoken answers and «Səslə soruşun»** (owner, 2026-10-20). Behind the kill
switch `DEMO_ASSISTANT_VOICE` (off unless `on`; off means no button, both
routes 404, no hash handed out, and the private page keeps `microphone=()`):

- A Da Vinci answer comes back from `/assistant` with its id (the
  `ASSISTANT_ASKED` event's) and a keyed hash of exactly its text.
  `POST …/assistant/voice` speaks only a text that hash vouches for, once,
  with the recordings' model and voice, and plays as a blob through the
  guide's one audio element. Prepared answers keep their recordings. Nothing
  is sent to be spoken while the guide's voice is switched off.
- The prospect presses and holds «Səslə soruşun» (or taps to start and stop)
  after a one-time consent line, speaks up to 15 s; the page sends a mono
  16 kHz WAV to `POST …/assistant/transcribe`; Google's `gemini-3.5-transcribe`
  (az-AZ, ru-RU, en-US) returns the text, the route returns only the text and
  keeps nothing; the page shows «Eşitdim: …» and asks it through `/assistant`,
  which masks it before Claude like a typed question. The microphone is
  released after every clip.
- Every Google call sends the key in `x-goog-api-key`, never in the address,
  and every Interactions API call says `store: false` (Google's default keeps
  an interaction, input included, for 55 days).
- Budget: 10 minutes of voice per demo (spoken answers plus heard clips) and
  300 minutes a day across demos, claimed in `demo_access_events`
  (`ASSISTANT_VOICED`, `ASSISTANT_HEARD`; metadata is seconds and an outcome,
  never text or audio) under one advisory lock before Google is called
  (`src/lib/demo-center/assistant-voice.ts`). A spoken answer's claim is an
  upper bound lowered to the audio's length afterwards; a failed call keeps
  its claim. Proven on a real Postgres in
  `demo-assistant-voice-postgres.test.ts` («Demo assistant voice budget
  database gate» in `static-checks` and in the deploy).
- Granted sessions only, through the assistant's own session check
  (`src/lib/demo-center/active-grant.ts`); the open demo and the admin preview
  never show the button.

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
