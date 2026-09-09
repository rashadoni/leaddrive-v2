import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

const source = readFileSync(
  join(process.cwd(), "src/app/api/v1/calls/route.ts"),
  "utf8",
)
const callAccessSource = readFileSync(
  join(process.cwd(), "src/lib/calls/access.ts"),
  "utf8",
)

test("a browser lead call is claimed by one conditional write before dispatch", () => {
  const claimStart = source.indexOf("const leadClaim = await tx.lead.updateMany({")
  const callLogCreate = source.indexOf("const created = await tx.callLog.create({")

  assert.ok(claimStart >= 0, "the browser call must acquire its lead lease with updateMany")
  assert.ok(callLogCreate > claimStart, "the lease must win before a CallLog is created or a provider can dispatch")

  const claim = source.slice(claimStart, callLogCreate)
  assert.match(claim, /OR:\s*\[\s*\{\s*browserCallClaimExpiresAt:\s*null\s*\},\s*\{\s*browserCallClaimExpiresAt:\s*\{\s*lte:\s*now\s*\}\s*\}\s*,?\s*\]/)
  assert.match(claim, /browserCallClaimToken: leadCallClaimToken/)
  assert.match(claim, /browserCallClaimedByUserId: auth\.userId/)
  assert.match(claim, /browserCallClaimExpiresAt: new Date\(now\.getTime\(\) \+ BROWSER_LEAD_CALL_CLAIM_LEASE_MS\)/)
  assert.match(claim, /if \(leadClaim\.count !== 1\) throw new LeadCallClaimedError\(\)/)
})

test("an unconfirmed provider failure cannot release a lead that may already be ringing", () => {
  assert.match(source, /browserDispatchMayExist = true[\s\S]{0,300}const result = await provider\.initiateCall\(/)
  assert.match(source, /browserDispatchMayExist = result\.success \|\| result\.failureCertainty !== "definite_rejection"/)
})

test("the opaque lease token is not exposed through call history", () => {
  assert.match(callAccessSource, /leadCallClaimToken: _leadCallClaimToken/)
})
