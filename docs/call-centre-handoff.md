# Call centre handoff

Date: 2026-08-26 (Asia/Baku). Repo-relative paths throughout. The PBX station is reachable only through the
owner's VPN; its own notes live outside this repository.

## Owner directive

> "мне нужен полный рабочий кол центр чтобы звонить лидам"

A salesperson should work through leads by phone all day from this CRM, talking
through their browser. Asked how many will call at once, the owner said **"сколько
захотят"** — design for N, not for two. That single answer decides most of what
follows: a shared work list needs an atomic claim, not a filter, and anything
that breaks with a second concurrent agent is broken.

Other agents are working in this repo at the same time on unrelated things
(settings navigation, budgeting removal, ISO 27001 security). Check `git status`
and open PRs before touching shared files.

---

## Ground truth — what already works

Every line here was verified against production or the station during the session
that produced this document, not read off a plan.

| Capability | Evidence |
|---|---|
| Browser softphone: dial a lead, talk from the browser | Real call 2026-08-25: relay logged `paired`, then `first_audio` from **both** sides; browser sent 118 720 B (7.4 s), station 114 800 B (7.2 s); Asterisk CDR `ANSWERED`, 7 s. Owner confirmed audio audible. |
| Relay | `softphone-relay` under pm2 on the CRM host, both ports loopback-only, `wss://app.leaddrivecrm.org/softphone/browser` proxied by nginx |
| Station bridge + tunnel | `fanum-softphone-bridge` and `fanum-softphone-tunnel`, both `active/enabled`, port 9093 |
| Call recording | Per-tenant switch in VoIP settings really records now. `__FANUM_RECORD` on the originate → `MixMonitor` in `fanum-answered-evidence` → `/var/spool/asterisk/monitor`. Retention: `/etc/cron.daily/fanum-recording-retention`, 30 days. |
| Rollout by salesperson | `BROWSER_SOFTPHONE_USER_IDS` (empty = whole org). Env, not DB — a salesperson can write their own `UserPreference`. |
| AI voice calls | Unchanged and hash-pinned. Do not touch `fanum-voice-core.py`. |

**In flight:** PR #966 — the outcome prompt after a browser call. Read it before
starting slice 1; it establishes the shape (prompt raised in `onEnded`, scoped to
`startedFor`, dropped on `leadId` change).

---

## Hard rules

1. **Never place a phone call.** Only the owner does. Every claim about audio in
   this document came from synthetic frames or from a call the owner made.
2. **Never print or transport secrets.** Not in chat, not between servers. The
   owner pastes them into a terminal himself.
3. **The station needs the owner's sudo.** Stage files, hand him exactly one
   command, verify afterwards yourself.
4. **Deploys**: push to `main` deploys production. One at a time — a second push
   cancels the first deploy mid-flight.
5. **RLS is fail-closed.** Every DB path goes through `withRls`/`withRlsAuth`.
6. **Measure the test baseline yourself.** ~30 test files fail on a clean
   checkout for unrelated reasons. Never write off a failure as "known" without
   re-running it against the unmodified file — one of those "known" failures was
   the gate of the feature being shipped (see traps).

---

## What is missing, in the order that hurts most

Findings from a four-way read-only survey of the calling surface. Each names the
file that proves it.

### Slice 1 — call from a list, with a claim

Today the call button exists in exactly one place:
`src/app/(dashboard)/leads/[id]/page.tsx`. To make sixty calls a salesperson
opens sixty cards.

- Put `LeadBrowserCallAction` on the leads list rows.
- **Claim the lead for the duration of the call.** Nothing does this today:
  `grep claimedByUserId src/app/api/v1/calls/route.ts` returns nothing. With
  "сколько захотят" agents, two people ringing the same customer is not an edge
  case, it is Tuesday.
- The claim must be a single atomic `updateMany` with the release condition in
  the `where`, not read-then-write. Reference: the relay's `joinedCalls` claim
  (`scripts/softphone-relay/relay.mjs`) — round one tested before an `await` and
  added after it, and two sockets in the same instant both passed.
- A claim needs an expiry. A browser that dies must not lock a lead forever;
  everything else in this system that claims (system job leases, relay parking)
  carries a lease with a deadline, and this should match.

### Slice 2 — a callback with an hour on it

`disposition = "callback"` currently records the intent and loses the promise.

- `task-form.tsx:484` is `<Input type="date">` — **no hour**. "Call me Tuesday at
  three" cannot be expressed.
- Creating a task from a lead card takes eight or more interactions
  (`src/app/(dashboard)/leads/[id]/page.tsx` has no manual task creation; its
  Tasks tab is a Da Vinci generator).
- Nothing notifies about a hand-made task. The only cron that does
  (`src/app/api/cron/commitment-escalation/route.ts:52`) filters on
  `customFields[COMMITMENT_CALL_FIELD]` — AI-extracted commitments only.
- `Activity.scheduledAt` exists on the model and in the POST schema
  (`src/app/api/v1/activities/route.ts:17`) and the lead card never sends it.

Smallest honest version: when the outcome is `callback`, ask for a time, write it,
and make something surface it. Do not build a scheduler; make one promise come back.

### Slice 3 — one vocabulary for what happened

Three enums answer the same question and nothing maps between them:

| Field | Values | Written by |
|---|---|---|
| `CallLog.disposition` | interested / not_interested / callback / voicemail / wrong_number / no_answer / other | the new prompt (PR #966) |
| `Lead.salesCallOutcomes` | sales_contacted / interested / potential / unable_to_contact / sold / not_sold / no_result | the lead card |
| `CallLog.conversationOutcome` | — | AI/PBX paths only |

A report on one disagrees with a report on the other and nobody can say which is
right. Decide which is authoritative **before** building any reporting, or the
reporting will have to be rebuilt.

### Slice 4 — inbound calls

The expensive half is already built and mounted: `src/components/voip-call-provider.tsx`
is wrapped around the dashboard (`layout.tsx:121`), polls `/api/v1/calls/active`
every 5 s, and renders `incoming-call-popup.tsx` for a row with
`direction === "inbound" && status === "ringing"`.

Nothing on this station ever writes such a row. The only writers are the 3CX
webhook (nobody runs 3CX) and the WhatsApp webhook.

- Feed it from the station: the AGI that already reports `answered`
  (`fanum-pbx-event-agi.py`, called from `fanum-answered-evidence`) is the
  natural place, or a new dialplan hook on the inbound context.
- **The pop cannot identify a lead.** `/api/v1/calls/active` does not select
  `leadId`, and `incoming-call-popup.tsx` branches only on `contactId` — a team
  that calls leads all day gets called back by leads and would be told "no
  matching contact". Fix that at the same time; it is two small edits.
- Missed calls: no record, no list, no notification. Decide whether a missed
  inbound becomes a task or a filter before writing either.

### Slice 5 — the manager's view, and listening

- No screen anywhere reports on calls. `call_logs` is read by the inbox page and
  nothing else under `src/app/(dashboard)`.
- **Recording playback is nearly free and nobody noticed.** The route already
  exists with access control: `src/app/api/v1/calls/[id]/recording/route.ts`.
  Nothing in any `.tsx` references `recordingUrl`. What is missing is a player in
  the UI and a way to get the file off the station — see open questions.

---

## Traps found the hard way

Each of these cost real production time. None is theoretical.

1. **`enable --now` is a no-op on a running service.** The station installer
   shipped a fixed bridge, printed "служба работает", and left the old process
   running for twelve hours. Use `restart`.
2. **pm2 keeps the environment from its first start.** `pm2 restart --update-env`
   takes the *invoking shell's* environment, not `/etc/leaddrive/app.env`. After editing
   the canonical app environment,
   restart with the file parsed into the child env, and verify through
   `/proc/<pid>/environ`. Confirmed twice.
3. **`/etc/leaddrive/app.env` is not safe to `source`.** Line 46 holds an unquoted value with
   spaces; `set -a; . /etc/leaddrive/app.env` executes a word from the middle of it and `set -e`
   then kills the rest of the command. Parse it, do not source it.
4. **A missing route in the middleware allowlist is invisible.** `/api/internal/…`
   not listed in `VOICE_AGENT_INTERNAL_PATHS` (`src/proxy.ts`) is answered with a
   307 to the sign-in page. The relay read that as "ticket not verified" and
   refused the browser; a real customer connected and sat in silence in both
   directions. The test that catches this was already red and was written off as
   pre-existing noise.
5. **The deploy's migration quiet window used to be one minute** and periodic
   jobs are never all absent in one particular minute. Three deploys died there.
   Now five minutes (`MIGRATION_WINDOW_ATTEMPTS`).
6. **The build ships only `.next/standalone`.** A file under `scripts/` that a
   pm2 app points at does not exist on the server unless the workflow copies it
   in. `/opt/leaddrive-v2` is a stale checkout; do not trust anything in it.
7. **A `curl` over https uses HTTP/2, where `Upgrade` does not exist.** Testing a
   WebSocket route without `--http1.1` reports a false 404.
8. **Component state survives navigation between leads.** The card is reused and
   only `leadId` changes; cleanup keyed to unmount never runs. A call's state
   followed the salesperson to the next lead and the button read "end call".
9. **The disposition widget breaks with two agents.** `call-widget.tsx:60-76`
   polls `/api/v1/calls?limit=1` and does `find(c => c.id === callLogId)`; any
   other call logged in the org between ticks pushes it out of the window and the
   selector never renders. It is designed to fail exactly when a call centre has
   more than one person in it. Do not build on that widget.

---

## Verification recipes

```bash
# Relay on the CRM host matches the repo, byte for byte
shasum -a 256 scripts/softphone-relay/relay.mjs
ssh root@<crm-host> 'sha256sum /opt/leaddrive-v2/.next/standalone/scripts/softphone-relay/relay.mjs'

# The whole audio chain, without placing a call: feed the bridge a synthetic
# AudioSocket UUID frame and watch the relay park it
ssh fanum@<station> "python3 - <<'PY'
import socket, uuid
s = socket.create_connection(('127.0.0.1', 9093), timeout=6)
s.sendall(bytes([0x01, 0x00, 0x10]) + uuid.uuid4().bytes)
PY"
ssh root@<crm-host> 'tail -3 /opt/leaddrive-v2/logs/softphone-relay.log'   # expect: parked side=pbx

# AI path untouched (run before and after ANY station change)
ssh fanum@<station> 'systemctl is-active fanum-voice; sha256sum /opt/fanum-voice/fanum-voice-core.py'
```

Relay log vocabulary: `parked` → `paired` → `first_audio` (per side) → `unpaired`
with `sentByBrowser` / `sentByPbx` / `droppedFrom*`. `browser_gone_before_pairing`
means a tab died during ticket verification. A call with `first_audio` from only
one side names the half that was silent — that single line replaced a day of
guessing.

---

## Open questions for the owner

1. **Where may recordings live?** They are on the station now. Playback from a
   lead card needs them either copied to the CRM host or served through the
   tunnel. The owner's in-country server turned out to be the station itself, and
   the reason was an operator requirement for a mobile SIP number — **not** a
   data-residency law. So this is a technical choice, not a legal one.
2. **Which outcome vocabulary is authoritative** (slice 3). Reporting cannot be
   built before this is answered.
3. **Should a missed inbound call create a task**, or only appear in a list?
