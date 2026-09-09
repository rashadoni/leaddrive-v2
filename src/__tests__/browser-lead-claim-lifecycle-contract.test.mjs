import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const root = process.cwd()
const lifecycleRoutePath = join(root, "src/app/api/v1/calls/[id]/lead-claim/route.ts")
const asteriskLifecycleRoutePath = join(root, "src/app/api/internal/asterisk/call-lifecycle/route.ts")
const actionPath = join(root, "src/components/leads/lead-browser-call-action.tsx")
const listPath = join(root, "src/app/(dashboard)/leads/page.tsx")

test("a live browser call renews only its own lease and cannot revive an ended call", () => {
  assert.ok(existsSync(lifecycleRoutePath), "browser lead-claim lifecycle route must exist")
  const source = readFileSync(lifecycleRoutePath, "utf8")

  assert.match(source, /export const PATCH = withRlsAuth\("voip", "write"/)
  assert.match(source, /browserCallClaimToken: token/)
  assert.match(source, /browserCallClaimExpiresAt: \{ gt: now \}/)
  assert.match(source, /browserCallClaimExpiresAt: new Date\(now\.getTime\(\) \+ BROWSER_LEAD_CALL_CLAIM_LEASE_MS\)/)
  assert.match(source, /endedAt: null/)
  assert.match(source, /ownedActiveBrowserLeadCall\(id, auth\.orgId, auth\.userId\)/)
  assert.doesNotMatch(source, /export const DELETE/)
})

test("only the PBX-confirmed terminal lifecycle releases the server lease", () => {
  assert.ok(existsSync(asteriskLifecycleRoutePath), "Asterisk lifecycle route must exist")
  const lifecycle = readFileSync(asteriskLifecycleRoutePath, "utf8")

  assert.match(lifecycle, /leadCallClaimToken: true/)
  assert.match(lifecycle, /browserCallClaimToken: call\.leadCallClaimToken/)
  assert.match(lifecycle, /browserCallClaimedByUserId: null/)
})

test("the row action keeps one shared capability request and stops renewing after onEnded", () => {
  const action = readFileSync(actionPath, "utf8")
  const list = readFileSync(listPath, "utf8")

  assert.match(action, /let browserCallAvailabilityPromise: Promise<boolean> \| null = null/)
  assert.match(action, /leadCallClaimToken/)
  assert.match(action, /method: "PATCH"/)
  assert.match(action, /setInterval/)
  assert.match(action, /onEnded: \(reason\) => \{[\s\S]*stopLeadClaim/)
  assert.doesNotMatch(action, /method: "DELETE"/)

  assert.match(list, /import \{ LeadBrowserCallAction \} from "@\/components\/leads\/lead-browser-call-action"/)
  const listActions = list.match(/<LeadBrowserCallAction leadId=\{lead\.id\} phone=\{lead\.phone\} \/>/g) ?? []
  assert.ok(listActions.length >= 2, "both mobile and desktop list rows must expose browser calling")
})
