/**
 * D8 Loyalty — member-facing portal read API (Slice 3 step 1).
 *
 * GET /api/v1/public/portal-loyalty
 *
 * A tenant's customer (a Contact = a loyalty member) sees their own points,
 * tier, progress to the next tier, benefits, recent history, and the promo
 * codes they can still use. Auth = the portal JWT (getPortalUser) — the member
 * identity is `contactId`, taken ONLY from the verified token, never from the
 * request. Every query is org-scoped under runWithTenant (RLS), mirroring
 * /api/v1/public/portal-tickets.
 *
 * Gated by the per-tenant `loyalty_portal` feature flag: when off, returns
 * `{ enabled: false }` with no data so the portal hides the tab.
 *
 * SECURITY: contactId from the JWT only; display fields only (no createdBy /
 * internal ids); promo codes filtered to active + in-window + under the
 * member's per-customer limit. No cross-member or cross-tenant data.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { getPortalUser } from "@/lib/portal-auth"
import { resolveTierFromList, type ActiveTierRow } from "@/lib/loyalty/tier-resolver"
import { decimalToNumber } from "@/lib/prisma-decimal"
import QRCode from "qrcode"

/** Org.features is stored as a JSON string OR a native string[] depending on
 *  vintage — normalize to string[] (same as portal-tickets/portal-config). */
function parseFeatures(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw || "[]")
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : []
}

type PortalTier = {
  code: string
  name: string
  minLifetimePoints: number
  multiplier: number
  benefits: unknown
}

export async function GET() {
  const user = await getPortalUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const orgId = user.organizationId
  const contactId = user.contactId

  return runWithTenant(orgId, async () => {
    // ── feature gate ──────────────────────────────────────────────
    const org = await prisma.organization.findFirst({
      where: { id: orgId },
      select: { features: true },
    })
    const enabled = parseFeatures(org?.features).includes("loyalty_portal")
    if (!enabled) return NextResponse.json({ success: true, enabled: false })

    // ── account (synthesized zero-state if the member hasn't earned) ──
    const account = await prisma.loyaltyAccount.findFirst({
      where: { organizationId: orgId, contactId },
      select: { id: true, points: true, lifetimePoints: true, tier: true, tierUpgradedAt: true },
    })
    const points = account?.points ?? 0
    const lifetimePoints = account?.lifetimePoints ?? 0

    // ── tiers (for resolution + display) ──────────────────────────
    const tierRows = await prisma.loyaltyTier.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: [{ minLifetimePoints: "asc" }, { code: "asc" }],
      select: { code: true, name: true, minLifetimePoints: true, multiplier: true, benefits: true },
    })
    const tiers: PortalTier[] = tierRows.map(
      (t: { code: string; name: string; minLifetimePoints: number; multiplier: unknown; benefits: unknown }) => ({
        code: t.code,
        name: t.name,
        minLifetimePoints: t.minLifetimePoints,
        multiplier: decimalToNumber(t.multiplier),
        benefits: t.benefits,
      }),
    )
    const forResolve: ActiveTierRow[] = tiers.map((t) => ({
      code: t.code,
      minLifetimePoints: t.minLifetimePoints,
      multiplier: t.multiplier,
    }))
    const resolved = resolveTierFromList(forResolve, lifetimePoints)
    const currentTier = resolved.tier ? tiers.find((t) => t.code === resolved.tier) ?? null : null
    const nextTier = tiers.find((t) => t.minLifetimePoints > lifetimePoints) ?? null

    const currentMin = currentTier?.minLifetimePoints ?? 0
    const nextMin = nextTier ? nextTier.minLifetimePoints : null
    const pointsToNext = nextMin !== null ? Math.max(0, nextMin - lifetimePoints) : null
    const progressPct =
      nextMin === null
        ? 100 // top tier (or no tiers) — fully progressed
        : nextMin > currentMin
          ? // floor (not round) so 999/1000 reads 99%, not "100% with 1 to go"
            Math.min(99, Math.max(0, Math.floor(((lifetimePoints - currentMin) / (nextMin - currentMin)) * 100)))
          : 0

    // ── history (last 20, display fields only — no createdBy/referenceId/id) ──
    const history = account
      ? await prisma.loyaltyTransaction.findMany({
          where: { loyaltyAccountId: account.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { type: true, delta: true, lifetimeDelta: true, reason: true, createdAt: true },
        })
      : []

    // ── eligible promo codes (active + in-window + under per-customer limit) ──
    const now = new Date()
    const promosRaw = await prisma.promoCode.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      select: {
        id: true,
        code: true,
        description: true,
        discountType: true,
        discountValue: true,
        currency: true,
        minOrderAmount: true,
        perCustomerLimit: true,
        validUntil: true,
      },
    })
    const promoCodes: Array<Record<string, unknown>> = []
    for (const p of promosRaw as Array<{
      id: string
      code: string
      description: string | null
      discountType: string
      discountValue: unknown
      currency: string | null
      minOrderAmount: unknown
      perCustomerLimit: number | null
      validUntil: Date | null
    }>) {
      if (p.perCustomerLimit != null) {
        const used = await prisma.promoCodeRedemption.count({
          where: { organizationId: orgId, promoCodeId: p.id, contactId },
        })
        if (used >= p.perCustomerLimit) continue
      }
      promoCodes.push({
        code: p.code,
        description: p.description,
        discountType: p.discountType,
        discountValue: decimalToNumber(p.discountValue),
        currency: p.currency,
        minOrderAmount: p.minOrderAmount != null ? decimalToNumber(p.minOrderAmount) : null,
        validUntil: p.validUntil,
      })
    }

    // Digital membership card: a scannable QR encoding the member key (the
    // tenant's POS / scanner resolves it) + a short human-readable card number.
    // The card still renders if QR generation fails (qrDataUrl null).
    const memberNumber = contactId.slice(-8).toUpperCase()
    let qrDataUrl: string | null = null
    try {
      qrDataUrl = await QRCode.toDataURL(contactId, { margin: 1, width: 256 })
    } catch (e) {
      console.error("[portal-loyalty] QR generation failed", e)
    }

    // Active redeem rewards (Phase 3) — with affordability + soldOut so the UI
    // can show/disable the redeem button. Display fields only.
    const rewardRows = await prisma.loyaltyReward.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: [{ pointsCost: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, description: true, pointsCost: true, stockLimit: true },
    })
    const rewards: Array<Record<string, unknown>> = []
    for (const r of rewardRows as Array<{
      id: string
      name: string
      description: string | null
      pointsCost: number
      stockLimit: number | null
    }>) {
      let soldOut = false
      if (r.stockLimit !== null) {
        const used = await prisma.loyaltyRedemption.count({
          where: { organizationId: orgId, loyaltyRewardId: r.id },
        })
        soldOut = used >= r.stockLimit
      }
      rewards.push({
        id: r.id,
        name: r.name,
        description: r.description,
        pointsCost: r.pointsCost,
        affordable: points >= r.pointsCost,
        soldOut,
      })
    }

    return NextResponse.json({
      success: true,
      enabled: true,
      data: {
        account: {
          points,
          lifetimePoints,
          tier: account?.tier ?? null,
          tierName: currentTier?.name ?? null,
          tierUpgradedAt: account?.tierUpgradedAt ?? null,
        },
        card: {
          memberName: user.fullName || user.email || null,
          memberNumber,
          // Full member id — the canonical value the POS resolve looks up. The
          // native app should encode THIS in the QR (the short memberNumber is a
          // display label + a resolve fallback for older app builds).
          memberId: contactId,
          qrDataUrl,
        },
        tier: {
          current: currentTier
            ? { code: currentTier.code, name: currentTier.name, benefits: currentTier.benefits, multiplier: currentTier.multiplier }
            : null,
          next: nextTier ? { code: nextTier.code, name: nextTier.name, minLifetimePoints: nextTier.minLifetimePoints } : null,
          pointsToNext,
          progressPct,
        },
        benefits: currentTier?.benefits ?? null,
        history,
        promoCodes,
        rewards,
      },
    })
  })
}
