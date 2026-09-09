/**
 * D8 Loyalty — LoyaltyTier CRUD (list + create + seed defaults).
 *
 * GET /api/v1/loyalty-tiers — list tenant's tiers, ordered by
 *   minLifetimePoints asc (cron order).
 * POST /api/v1/loyalty-tiers — create one tier.
 * POST /api/v1/loyalty-tiers?seedDefaults=true — bootstrap a tenant
 *   with bronze/silver/gold/platinum/diamond defaults if no tiers
 *   exist yet (idempotent — no-op if any tier already configured).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  MAX_TIER_MULTIPLIER as MAX_MULTIPLIER,
  MAX_TIER_CODE_LEN as MAX_CODE_LEN,
  MAX_NAME_LEN,
  MAX_DESC_LEN,
  TIER_CODE_RE as CODE_RE,
} from "@/lib/loyalty/limits"
import { normalizeTierRow } from "@/lib/prisma-decimal"

// Default tier ladder seeded for new tenants on demand. Thresholds
// are an opinionated starting point (broadly mirrors Sephora Beauty
// Insider / Delta SkyMiles tiers); admins edit freely after seed.
const DEFAULT_TIERS = [
  { code: "bronze",   name: "Bronze",   minLifetimePoints: 0,      multiplier: 1.0, description: "Entry tier — every new member starts here." },
  { code: "silver",   name: "Silver",   minLifetimePoints: 1000,   multiplier: 1.1, description: "Engaged customers (≥1,000 lifetime points)." },
  { code: "gold",     name: "Gold",     minLifetimePoints: 10000,  multiplier: 1.25, description: "Loyal customers (≥10,000 lifetime points)." },
  { code: "platinum", name: "Platinum", minLifetimePoints: 50000,  multiplier: 1.5,  description: "Top-tier customers (≥50,000 lifetime points)." },
  { code: "diamond",  name: "Diamond",  minLifetimePoints: 250000, multiplier: 2.0,  description: "VIPs (≥250,000 lifetime points). Concierge support." },
]

export const GET = withRlsAuth("loyalty", "read", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  try {
    const rows = await prisma.loyaltyTier.findMany({
      where: { organizationId: orgId },
      orderBy: [{ minLifetimePoints: "asc" }, { code: "asc" }],
    })
    // Normalize Decimal(6,4) multiplier → number so API clients receive a JSON
    // number, not a string. Prisma.Decimal.toJSON() returns "1.25", not 1.25.
    const tiers = rows.map((t: (typeof rows)[number]) => normalizeTierRow(t))
    return NextResponse.json({ tiers, total: tiers.length })
  } catch (err) {
    console.error("[loyalty-tiers] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load tiers" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  code?: unknown
  name?: unknown
  description?: unknown
  minLifetimePoints?: unknown
  multiplier?: unknown
  benefits?: unknown
  isActive?: unknown
}

export const POST = withRlsAuth("loyalty", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const seedDefaults = searchParams.get("seedDefaults") === "true"

  if (seedDefaults) {
    try {
      // Idempotent: only seed when zero tiers exist for this org.
      const existing = await prisma.loyaltyTier.count({
        where: { organizationId: orgId },
      })
      if (existing > 0) {
        return NextResponse.json(
          {
            error: "Defaults can only be seeded when no tiers exist yet",
            existing,
          },
          { status: 409 },
        )
      }
      const created = await prisma.$transaction(
        DEFAULT_TIERS.map((t) =>
          prisma.loyaltyTier.create({
            data: {
              organizationId: orgId,
              code: t.code,
              name: t.name,
              description: t.description,
              minLifetimePoints: t.minLifetimePoints,
              multiplier: t.multiplier,
              isActive: true,
              createdBy: auth.userId,
            },
          }),
        ),
      )
      return NextResponse.json({ seeded: created.length, tiers: created.map(normalizeTierRow) })
    } catch (err) {
      console.error("[loyalty-tiers] seed error:", err)
      return NextResponse.json(
        { error: "Failed to seed defaults" },
        { status: 500 },
      )
    }
  }

  // Regular create path.
  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Field validation — mirror DB CHECK constraints client-side so
  // operator gets a friendly message instead of a Postgres error.
  if (typeof body.code !== "string" || !CODE_RE.test(body.code) || body.code.length > MAX_CODE_LEN) {
    return NextResponse.json(
      {
        error:
          "Invalid `code` — must be lowercase a-z / 0-9 / underscore, start with letter, up to 32 chars",
      },
      { status: 400 },
    )
  }
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: "Invalid `name` — required, up to 100 chars" },
      { status: 400 },
    )
  }
  if (
    typeof body.minLifetimePoints !== "number" ||
    !Number.isInteger(body.minLifetimePoints) ||
    body.minLifetimePoints < 0
  ) {
    return NextResponse.json(
      { error: "Invalid `minLifetimePoints` — non-negative integer required" },
      { status: 400 },
    )
  }
  const multiplier =
    typeof body.multiplier === "number" && Number.isFinite(body.multiplier)
      ? body.multiplier
      : 1.0
  if (multiplier <= 0 || multiplier > MAX_MULTIPLIER) {
    return NextResponse.json(
      { error: `Invalid \`multiplier\` — must be > 0 and ≤ ${MAX_MULTIPLIER}` },
      { status: 400 },
    )
  }
  const description =
    typeof body.description === "string"
      ? body.description.slice(0, MAX_DESC_LEN)
      : null
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true

  try {
    const tier = await prisma.loyaltyTier.create({
      data: {
        organizationId: orgId,
        code: body.code,
        name: body.name.trim(),
        description,
        minLifetimePoints: body.minLifetimePoints,
        multiplier,
        isActive,
        createdBy: auth.userId,
      },
    })
    return NextResponse.json({ tier: normalizeTierRow(tier) }, { status: 201 })
  } catch (err) {
    // P2002 = unique constraint violation (code already exists per-org).
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A tier with this `code` already exists for your tenant" },
        { status: 409 },
      )
    }
    console.error("[loyalty-tiers] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create tier" },
      { status: 500 },
    )
  }
})
