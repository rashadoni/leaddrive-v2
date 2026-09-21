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

## Step 3 — update the canonical environment

The application environment is `/etc/leaddrive/app.env`, root-owned and mode
0600. `/opt/leaddrive-v2/.env` is a symlink to it, and `scripts/server-deploy.sh`
refuses to deploy if either the ownership, the mode or the symlink target is
wrong. Therefore the file is replaced through a staging file that already
carries the right posture — never with a bare `sed -i`, which rewrites the
inode and can drop the mode.

Run on the production host as root, substituting the three real values:

```bash
sudo bash -c '
set -euo pipefail
f=/etc/leaddrive/app.env
cp -a "$f" "$f.bak-$(date +%F-%H%M%S)"
tmp=$(mktemp /etc/leaddrive/.app.env.XXXXXX)
chown root:root "$tmp"; chmod 0600 "$tmp"
sed -e "s|^FACEBOOK_APP_ID=.*|FACEBOOK_APP_ID=2414060595720618|" \
    -e "s|^FACEBOOK_APP_SECRET=.*|FACEBOOK_APP_SECRET=REPLACE_FB_SECRET|" \
    -e "s|^INSTAGRAM_APP_ID=.*|INSTAGRAM_APP_ID=REPLACE_IG_APP_ID|" \
    -e "s|^INSTAGRAM_APP_SECRET=.*|INSTAGRAM_APP_SECRET=REPLACE_IG_SECRET|" \
    "$f" > "$tmp"
mv -f "$tmp" "$f"
stat -c "%U %a %n" "$f"
grep -E "^(FACEBOOK|INSTAGRAM)_APP_ID=" "$f"
'
```

The final two lines are the check: the posture must print `root 600` and the
two IDs must be the new ones. Secrets are never echoed.

## Step 4 — restart production through the gated path

Editing the file alone changes nothing at runtime. The process environment
lives in the PM2 dump and is injected when the process is created, so the
running app keeps the old app IDs until the process is recreated.

Use the normal deployment rather than a hand-rolled `pm2 restart`: it holds the
production lock, recreates the process, health-checks and rolls back by itself.

```bash
gh workflow run deploy.yml --repo rashadoni/leaddrive-v2 -f deployment_mode=normal
```

Do not re-run an older deploy run to achieve this. A re-run can consume an
artifact that the first run already took, which has made a red "Deploy
atomically" step mean nothing in the past.

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
