import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"
import { withMobileRls } from "@/lib/with-mobile-rls"

const NO_STORE = { "Cache-Control": "no-store" }

/**
 * Whether a company answers to this subdomain. True unless the organization
 * table says, definitely, that it does not: a database that blinked must not
 * close the way in for every agent — sign-in itself still checks the company.
 */
async function companyExists(slug: string): Promise<boolean> {
  try {
    // RLS: pre-login lookup. `organizations` is a global table (no policy);
    // the explicit bypass documents intent, as in public/tenant-branding.
    const organization = await runWithRlsBypass(() =>
      prisma.organization.findUnique({ where: { slug }, select: { id: true } }),
    )
    return organization !== null
  } catch (error) {
    console.warn("[MTM/mobile/ping] company lookup failed; answering as an existing company", error)
    return true
  }
}

/**
 * GET /api/v1/mtm/mobile/ping
 *
 * Server discovery for the field-agent mobile app. Anonymous by necessity:
 * the app calls this from its ServerScreen before anyone has logged in, so a
 * 401 here would leave a new device unable to find the server at all.
 *
 * Because it is anonymous, it intentionally returns no tenant, product, build,
 * or protocol metadata. It used to read
 * `organization.findFirst({ orderBy: { createdAt: "asc" } })` and return that
 * row's name; a later hardening pass replaced the row with constants, but even
 * a static version string is unnecessary reconnaissance data on a public
 * endpoint. The released Android client already treats the optional display
 * name as a convenience and falls back to the entered host.
 *
 * What it does answer is the one question the app asks here: is there a
 * company under the name the agent typed? Until 2026-10-05 it said «success»
 * under any `*.leaddrivecrm.org` name, so a misspelt company opened the sign-in
 * form and the agent was then told to check the password (found by the
 * emulator E2E of build 382; owner: «принимаю, делай»). Every released client
 * reads `success` and shows «Company not found. Check the spelling…» when it
 * is false. Whether a company exists is not a secret this endpoint adds: the
 * web login page asks `public/tenant-branding` the same thing and gets the
 * name and the logo too. The lookup is by the exact host slug and selects the
 * id alone — still no tenant row leaves the server.
 */
export async function GET(req: NextRequest) {
  // Set by the proxy from the request host, never by the caller. Absent on the
  // app host and on a tenant's own domain: there is no name to check there.
  const slug = req.headers.get("x-tenant-slug")
  if (slug && !(await companyExists(slug))) {
    return NextResponse.json(
      { success: false, error: "Company not found", code: "MTM_COMPANY_NOT_FOUND" },
      { status: 404, headers: NO_STORE },
    )
  }
  return NextResponse.json({ success: true, data: {} }, { headers: NO_STORE })
}

/**
 * POST /api/v1/mtm/mobile/ping
 *
 * Compatibility acknowledgement for older mobile clients. Presence is a GPS
 * fact, not a login/heartbeat fact: only an accepted coordinate from an
 * active workday may make an agent appear online on the manager map. Keeping
 * this endpoint write-free prevents a tablet left on a desk from pretending
 * that its owner is in the field.
 */
export const POST = withMobileRls(async (req, auth) => {
  void req
  void auth
  return NextResponse.json({ success: true, data: { presence: "GPS_REQUIRED" } })
})
