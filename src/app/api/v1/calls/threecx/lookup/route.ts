import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { checkRateLimit, RATE_LIMIT_CONFIG } from "@/lib/rate-limit"
import { resolveThreeCxConfig, threeCxPhoneVariants } from "@/lib/voip/threecx-crm"
import { APP_URL } from "@/lib/domains"

/**
 * GET /api/v1/calls/threecx/lookup?orgId=…&secret=…&number=…
 *
 * Contact lookup for the 3CX CRM Integration template (Scenario Id=""). 3CX calls
 * this while the call is ringing and shows the returned name in the phone/web
 * client, with `url` opening the record in LeadDrive.
 *
 * Public endpoint (the PBX has no session) — gated ONLY by the per-org shared
 * secret stored in the voip ChannelConfig, so the secret is MANDATORY here:
 * this route turns a phone number into a person's identity and must never
 * answer without one.
 *
 * Response shape is what the generated template parses:
 *   { "contacts": [ { id, entityType, firstName, lastName, companyName, email, phone, url } ] }
 * A miss returns `{}` (no `contacts` key) so the template's `Rule Type="Any"`
 * treats it as "not found" rather than as an empty match.
 */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId")
  const secret = req.nextUrl.searchParams.get("secret")
  const number = req.nextUrl.searchParams.get("number")

  if (!orgId || !secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Bound brute-forcing of the secret and enumeration of numbers, keyed by org.
  if (!checkRateLimit(`threecx-lookup:${orgId}`, RATE_LIMIT_CONFIG.webhook)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  // RLS: channelConfig is a tenant table, and this lookup IS the org-resolution +
  // secret fetch for the ?orgId query param — with no request context it would
  // fail closed and the gate below could never pass → bypass scope, this query only.
  // ALL voip rows are read: an org that switched provider keeps the old row, and
  // only the row owning the secret may authorise the request.
  const configs = await runWithRlsBypass(() =>
    prisma.channelConfig.findMany({
      where: { organizationId: orgId, channelType: "voip" },
      select: { id: true, isActive: true, settings: true },
    })
  )

  const auth = resolveThreeCxConfig(configs, secret)
  if (auth.status === "disabled") {
    // The secret proved the caller owns this integration, so naming the actual
    // reason is safe and saves a long hunt on the PBX side.
    return NextResponse.json({ error: "VoIP integration is disabled" }, { status: 403 })
  }
  if (auth.status !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!number || !number.trim()) {
    return NextResponse.json({})
  }

  const { exact, last9 } = threeCxPhoneVariants(number)
  if (exact.length === 0) {
    return NextResponse.json({})
  }

  // RLS: org resolved and secret-gated above — all record reads run tenant-scoped.
  const match = await runWithTenant(orgId, async () => {
    const contact = await prisma.contact.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ phone: { in: exact } }, { phones: { hasSome: exact } }],
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        company: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    })
    if (contact) return { kind: "Contact" as const, record: contact }

    const lead = await prisma.lead.findFirst({
      where: {
        organizationId: orgId,
        OR: [{ phone: { in: exact } }, { phoneWhatsApp: { in: exact } }],
      },
      select: { id: true, contactName: true, companyName: true, email: true, phone: true },
      orderBy: { updatedAt: "desc" },
    })
    if (lead) return { kind: "Lead" as const, record: lead }

    // Tier 2 — last-9-digits fallback for local↔international format drift
    // (AZ "0XX XXX XX XX" vs "+994XX XXX XX XX"). Substring scan, not indexable,
    // so it only runs when the exact tier found nothing.
    if (!last9) return null

    const fuzzyContact = await prisma.contact.findFirst({
      where: { organizationId: orgId, phone: { contains: last9 } },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        company: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    })
    if (fuzzyContact) return { kind: "Contact" as const, record: fuzzyContact }

    const fuzzyLead = await prisma.lead.findFirst({
      where: { organizationId: orgId, phone: { contains: last9 } },
      select: { id: true, contactName: true, companyName: true, email: true, phone: true },
      orderBy: { updatedAt: "desc" },
    })
    if (fuzzyLead) return { kind: "Lead" as const, record: fuzzyLead }

    return null
  })

  if (!match) {
    return NextResponse.json({})
  }

  const base = APP_URL.replace(/\/$/, "")
  const displayName = match.kind === "Contact" ? match.record.fullName : match.record.contactName
  const { firstName, lastName } = splitName(displayName)

  return NextResponse.json({
    contacts: [
      {
        id: match.record.id,
        entityType: match.kind,
        firstName,
        lastName,
        companyName:
          match.kind === "Contact"
            ? match.record.company?.name ?? ""
            : match.record.companyName ?? "",
        email: match.record.email ?? "",
        phone: match.record.phone ?? "",
        url: `${base}/${match.kind === "Contact" ? "contacts" : "leads"}/${match.record.id}`,
      },
    ],
  })
}

/** 3CX renders FirstName/LastName separately; the CRM stores one display name. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: "", lastName: "" }
  if (parts.length === 1) return { firstName: parts[0], lastName: "" }
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") }
}
