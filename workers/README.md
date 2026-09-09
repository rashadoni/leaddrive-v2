# LeadDrive Cloudflare Workers

## email-inbound

Cloudflare Email Worker that accepts every message delivered to
`*@leaddrivecrm.org` (catch-all), parses the raw MIME **inline** (no external
dependencies — works offline, no `npm install` needed), and POSTs a JSON
payload to `/api/v1/public/email-inbound` on app.leaddrivecrm.org, which then
turns the reply into a `TicketComment`.

### Production state

The worker deployed in production was uploaded via the Cloudflare API
(`PUT /accounts/{id}/workers/scripts/ld-email-inbound`). The source is this
`email-inbound.js` file — git is the source of truth.

Bindings (set in the CF dashboard or via `wrangler secret`/`wrangler.toml`):

| Name                | Type        | Example                                 |
|---------------------|-------------|-----------------------------------------|
| `API_URL`           | plain text  | `https://app.leaddrivecrm.org`          |
| `FALLBACK_INBOX`    | plain text  | `rashadrahimov@gmail.com`               |
| `CF_INBOUND_SECRET` | secret      | 64-hex-char random (must match app env) |

### Deploy updates

Production deploys use the manually triggered `Deploy Email Worker` GitHub
Actions workflow. Configure this repository Actions secret first:

- `CLOUDFLARE_API_TOKEN` — scope it to the production account with the
  **Edit Cloudflare Workers** template; never commit the value

`CLOUDFLARE_ACCOUNT_ID` is optional. When it is missing or malformed, the
workflow resolves the account automatically and refuses to continue unless the
token is restricted to exactly one account.

Then run the workflow from GitHub Actions. It deploys only the contents of this
directory with the pinned Wrangler version.

For local development, Wrangler OAuth remains available:

```bash
npm i -g wrangler          # first time only
cd workers
wrangler login             # opens browser
wrangler deploy            # uploads email-inbound.js
```

To rotate the secret:

```bash
wrangler secret put CF_INBOUND_SECRET
# paste new value — then also update /etc/leaddrive/app.env on the server
# and restart PM2
```

### Cloudflare Email Routing binding

Catch-all address `*@leaddrivecrm.org` → action **Send to a Worker** →
`ld-email-inbound`. This is managed via the Cloudflare Email Routing API and
should already be set for the zone; re-apply with:

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE/email/routing/rules/catch_all" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"matchers":[{"type":"all"}],"actions":[{"type":"worker","value":["ld-email-inbound"]}]}'
```

### What the inline parser handles

- `text/plain`, `text/html` bodies (direct or inside `multipart/*`)
- `Content-Transfer-Encoding: base64` and `quoted-printable`
- MIME-encoded `Subject:` headers (`=?UTF-8?B?...?=`, `=?UTF-8?Q?...?=`)
- Nested multipart (one level — covers Gmail/Outlook replies with
  `multipart/alternative` inside `multipart/mixed`)

### What the parser does **not** handle

- Attachments (dropped — we don't POST binary)
- Deeply nested multipart (>1 level inner)
- Unknown charsets (best-effort `TextDecoder`)
- Malformed MIME without proper `Content-Type` (falls back to treating the
  whole body as text/plain — good enough for the catch-all use case)

For 95%+ of replies from Gmail, Outlook, Apple Mail this is sufficient.
