#!/usr/bin/env node
/**
 * scripts/seeds/demo-journey-clips-rescore.mjs
 * =====================================================================
 * Lets the product score the demo stand's leads.
 *
 * scripts/seeds/demo-journey-clips.mjs writes its leads unscored on purpose.
 * This saves each of them once through the app's own API, signed in as the
 * help-video recorder account, and that save runs the scoring every saved
 * lead gets (src/lib/crm-commands/lead/update-lead.ts → scoreLeadNow). The
 * numbers a clip then shows are the product's, with the factors behind them.
 *
 * Touches only leads the legend names, found by exact name, and refuses any
 * recorder account that does not sign into the demo organisation. The save
 * rewrites a lead's own notes unchanged and nothing else.
 *
 *   CONFIRM_REMOTE_HELP_VIDEO=app.leaddrivecrm.org \
 *   HELP_VIDEO_EMAIL=… HELP_VIDEO_PASSWORD=… HELP_VIDEO_ORG_SLUG=demo \
 *   node scripts/seeds/demo-journey-clips-rescore.mjs https://app.leaddrivecrm.org
 * =====================================================================
 */
import { request } from "playwright"
import { requireHelpVideoAuth } from "../help-video/auth-config.mjs"
import { LEADS } from "./demo-journey-legend.mjs"

const auth = requireHelpVideoAuth(process.argv[2] || process.env.HELP_VIDEO_BASE_URL || "http://127.0.0.1:3000")
if (auth.organizationSlug !== "demo") {
  console.error(`FATAL: the recorder signs into "${auth.organizationSlug}", not the demo organisation`)
  process.exit(1)
}

const api = await request.newContext({ baseURL: auth.baseUrl, extraHTTPHeaders: { Origin: auth.baseUrl } })
const csrf = await (await api.get("/api/auth/csrf")).json()
await api.post("/api/auth/callback/credentials", {
  form: {
    csrfToken: csrf.csrfToken,
    email: auth.email,
    password: auth.password,
    organizationSlug: auth.organizationSlug,
    redirect: "false",
    json: "true",
  },
  maxRedirects: 0,
})
const session = await (await api.get("/api/auth/session")).json().catch(() => ({}))
if (!session?.user) {
  console.error("FATAL: sign-in failed")
  process.exit(1)
}

let failed = 0
for (const { contactName } of LEADS) {
  const list = await api.get(`/api/v1/leads?search=${encodeURIComponent(contactName)}&includeConverted=true&limit=10`)
  const found = ((await list.json().catch(() => null))?.data?.leads ?? []).filter((l) => l.contactName === contactName)
  if (found.length !== 1) {
    console.error(`  ✖ ${contactName}: ${found.length} leads by that name — skipped`)
    failed += 1
    continue
  }
  const [lead] = found
  const saved = await api.patch(`/api/v1/leads/${lead.id}`, { data: { notes: lead.notes ?? null } })
  if (!saved.ok()) {
    console.error(`  ✖ ${contactName}: save answered ${saved.status()}`)
    failed += 1
    continue
  }
  const after = (await (await api.get(`/api/v1/leads/${lead.id}`)).json().catch(() => null))?.data
  console.log(`  ✓ ${contactName}: ${after?.score ?? "?"}${after?.lastScoredAt ? "" : " (not stamped)"}`)
}

await api.dispose()
if (failed) {
  console.error(`${failed} lead(s) not scored`)
  process.exit(1)
}
