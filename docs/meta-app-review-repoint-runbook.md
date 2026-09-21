# Re-pointing production to Meta app 2414060595720618

Decision of 2026-09-20: production moves onto the app that the "FANUM" MMC
business verification was filed under, so the filed verification keeps its
meaning. This runbook is the deterministic path.

Current state, read from production on 2026-09-20 and recorded in
`docs/meta-app-review-session-log.md`:

| Key | Now | Target |
|---|---|---|
| `FACEBOOK_APP_ID` | `1276226757359622` | `2414060595720618` |
| `FACEBOOK_APP_SECRET` | set (32 chars) | secret of `2414060595720618` |
| `INSTAGRAM_APP_ID` | `782807994549098` | see step 2 — **not** the Facebook app |
| `INSTAGRAM_APP_SECRET` | set (32 chars) | secret of that Instagram app |

`FACEBOOK_REDIRECT_URI` and `INSTAGRAM_REDIRECT_URI` already hold the correct
values and do not change. They do, however, have to be registered inside the
new app.

## Step 1 — read this before planning the Instagram side

`INSTAGRAM_APP_ID` **cannot** be set to `2414060595720618`, but no second Meta
app is needed either.

Verified in the Meta dashboard on 2026-09-21: the Instagram side of the review
app is the **Instagram product inside `2414060595720618`** ("Instagram API
setup" → "Instagram app ID / Instagram app secret"). That product has its own
ID and secret, and that ID is `782807994549098` — the value production already
carries in `INSTAGRAM_APP_ID`. It sits in the "Lead Drive" portfolio because the
parent app does. The staged Instagram-Login configuration row for the review
uses exactly this pair, and the Instagram Login consent screen it opens names
the app "CRM-IG" with client_id `782807994549098`.

The resolver split still matters: `getTenantInstagramLoginApp` in
`src/lib/social/tenant-meta-app.ts` exists so an Instagram-Login OAuth never
picks up the Facebook-Login credentials, and
`src/app/api/v1/social/oauth/instagram/start/route.ts` says so in its header
comment. "Separate credentials" is the rule — not "separate Meta app".

## Step 2 — owner-only preparation in the Meta dashboard

Nothing below can be done from a session; all of it needs the owner's account.

1. Confirm in the dashboard that `2414060595720618` really is in the "Lead
   Drive" portfolio (`1170592885027596`) and that the FANUM business
   verification is attached to that portfolio. The whole point of this
   direction is that pairing — if it does not hold, stop and re-decide.
2. Copy the App Secret of `2414060595720618`.
3. Resolve the Instagram-Login app per step 1 and copy its ID and secret.
4. In `2414060595720618`, register the Valid OAuth Redirect URI
   `https://app.leaddrivecrm.org/api/v1/social/oauth/facebook/callback`.
5. In the Instagram-Login app, register
   `https://app.leaddrivecrm.org/api/v1/social/oauth/instagram/callback`.
6. Enable the reviewed permissions under Use Cases in each app. The Facebook
   dialog silently drops any scope the app has not enabled and then returns
   without a `code`, so a missing permission here looks like a broken login,
   not a configuration error.

## Step 3 — deliver the new credentials through the operator job

Do **not** edit the production environment over SSH. The repository already has
an operator job for exactly this, `.github/workflows/set-social-app-secrets.yml`,
and it now carries the Facebook keys as well. It asserts the env-file posture,
takes the app-env lock, stages the replacement atomically, restarts PM2 with the
merged environment and pings `/api/v1/ping` afterwards. Secrets never reach a
log — the job prints only which keys were set or skipped.

This also means no production secret is ever pasted into a terminal.

1. Repo → Settings → Secrets and variables → Actions. Add or update:
   - `FACEBOOK_APP_ID` = `2414060595720618`
   - `FACEBOOK_APP_SECRET` = that app's secret
   - `INSTAGRAM_APP_ID` = the Instagram-Login app from step 1
   - `INSTAGRAM_APP_SECRET` = that app's secret
2. Run the job:

```bash
gh workflow run set-social-app-secrets.yml --repo rashadoni/leaddrive-v2
```

Keys whose secret is unset are skipped, so the job is inert until the secrets
exist and it can be re-run safely for rotation.

The run's log is the confirmation: each key prints either `staged for canonical
app env` or `secret not set — skipped`, and the tail prints `ping HTTP 200`.

## Step 4 — confirm the running process actually changed

The job restarts PM2 with `--update-env`, so the change is live immediately. It
is still worth confirming that the running process, not just the file, moved:

```bash
ssh root@13.140.132.245 "pm2 jlist | python3 -c \"
import json,sys
for a in json.load(sys.stdin):
    e=a.get('pm2_env',{})
    for k in ('FACEBOOK_APP_ID','INSTAGRAM_APP_ID'):
        if k in e: print(a.get('name'), k, '=', e[k])
\""
```

Both IDs must be the new ones. Reading `/etc/leaddrive/app.env` alone does not
prove this: the process environment is injected when the process is created, so
a file that has been updated and a process that has not is exactly the failure
this check catches.

No separate deploy is needed for the credential change. The next ordinary
deploy will recreate the process from the same updated file, so the two stay
consistent.

## Step 5 — re-point the tenant side

Production is not the only place holding an app ID.

- The `leaddrive` tenant has five active Facebook channel rows, four on
  `1276226757359622` and one on the unidentified `520731194744134`. Each row
  carries `appId` and `appSecret` but no `verifyToken`, which is why both
  resolvers currently fall through to the environment. Decide which single row
  is the reviewer row and retire the rest; leaving stale rows means the
  resolver's `updatedAt DESC` ordering picks the winner, not you.
- The `leaddrive` Instagram row is `isActive = false`. The Instagram Login flow
  is exactly what has to be recorded for `instagram_business_*`, so this row
  has to be connected and active before any recording.
- Re-subscribe the Page to the `messages` webhook from inside the new app.
  A subscription made by the old app does not carry over.

## Step 6 — verify before recording anything

The one check that matters is what the consent screen shows. Start the
Facebook connect from Settings → Channels on the `leaddrive` tenant and read
the app identity on Meta's own dialog; then do the same on the Instagram card
and confirm the dialog is Instagram's, not Facebook's, and that it lists
`instagram_business_basic` and `instagram_business_manage_messages`.

A Facebook consent screen is not evidence for an `instagram_business_*`
permission. That distinction has already been written into
`docs/meta-app-review-submission.md`; it is repeated here because it is the
single easiest way to waste a submission.

Then re-run the cheap external checks:

```bash
curl -s https://app.leaddrivecrm.org/api/v1/ping
for d in privacy terms data-deletion; do
  curl -s -o /dev/null -L -w "$d %{http_code}\n" "https://www.leaddrivecrm.org/legal/$d"
done
```

## Unrelated observation, recorded so it is not lost

`META_WEBHOOK_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` are referenced by
`src/app/api/v1/webhooks/meta-social/route.ts` but are absent from
`/etc/leaddrive/app.env`. That route fails closed without them, so this is not
a security hole, and it is not on the App Review recording path — the recording
uses `/api/v1/webhooks/facebook` and `/api/v1/webhooks/instagram`, both of
which are live and correctly reject a wrong verify token. It is listed here
only because it was found during the same audit.
