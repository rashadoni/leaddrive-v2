/**
 * POS member resolve — scan a membership QR → identify the loyalty member.
 *
 * POST /api/v1/loyalty-accounts/resolve  body: { code }
 *
 * Staff-only (withRlsAuth "loyalty" "read"); the cashier scans the member's QR
 * card and we return who they are + their balance, so the staff can then award
 * points (`[id]/earn`) or redeem a reward (`[id]/redeem`).
 *
 * `code` is whatever the QR encoded. We resolve it two ways (org-scoped):
 *   1. exact `contactId` (the canonical/future QR payload), then
 *   2. the 8-char member-number suffix (what the CURRENT app QR encodes:
 *      `contactId.slice(-8).toUpperCase()`).
 *
 * READ-ONLY: a bare scan never writes. The account may not exist yet
 * (`accountId: null`, 0 points) — the loyalty account is created on the actual
 * POS *award* (a real points event), NOT on a scan, to avoid spurious 0/0 orphan
 * accounts (the bug pattern that bit the signup hook).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const ACCOUNT_SELECT = { id: true, points: true, lifetimePoints: true, tier: true } as const

export const POST = withRlsAuth("loyalty", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  let body: { code?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const code = typeof body.code === "string" ? body.code.trim() : ""
  if (!code) return NextResponse.json({ error: "`code` is required" }, { status: 400 })

  // 1. Resolve the contact — exact id first, then the short member-number suffix.
  let contact = await prisma.contact.findFirst({
    where: { id: code, organizationId: orgId },
    select: { id: true, fullName: true, email: true },
  })
  // memberNumber = contactId.slice(-8).toUpperCase() → length 1-8 (a short
  // contactId yields a short number; normal cuids → 8). Gate 3-8 alphanumerics
  // (avoid trivial 1-2 char collisions; >8 is a full id → the exact path above).
  // Use a LITERAL 8 in RIGHT() — a bound integer param there makes Postgres
  // unable to infer the arg type ("could not determine data type of parameter")
  // and 500s; for a short id RIGHT(id,8) returns the whole id, which still
  // equals its own (short) member number. Only the text value is parameterized.
  if (!contact && /^[A-Za-z0-9]{3,8}$/.test(code)) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "contacts"
      WHERE "organizationId" = ${orgId}
        AND UPPER(RIGHT("id", 8)) = ${code.toUpperCase()}
      LIMIT 2`
    if (rows.length > 1) {
      return NextResponse.json({ error: "ambiguous_code" }, { status: 409 })
    }
    if (rows.length === 1) {
      contact = await prisma.contact.findFirst({
        where: { id: rows[0].id, organizationId: orgId },
        select: { id: true, fullName: true, email: true },
      })
    }
  }
  if (!contact) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 })
  }

  // 2. Read the member's loyalty account (may be absent → accountId null, 0 pts).
  //    NO write here — the account is created on the actual POS award, not a scan.
  const account = await prisma.loyaltyAccount.findFirst({
    where: { organizationId: orgId, contactId: contact.id },
    select: ACCOUNT_SELECT,
  })

  return NextResponse.json({
    success: true,
    member: {
      accountId: account?.id ?? null,
      contactId: contact.id,
      name: contact.fullName,
      email: contact.email,
      points: account?.points ?? 0,
      lifetimePoints: account?.lifetimePoints ?? 0,
      tier: account?.tier ?? null,
    },
  })
})
