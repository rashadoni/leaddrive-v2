/**
 * Loyalty module — public SERVER interface.
 *
 * The single entry point external (non-loyalty) server code should import from:
 *   import { applyAutoEarn } from "@/lib/loyalty"
 * instead of reaching into individual files. This makes the module boundary
 * explicit and auditable (see ./README.md).
 *
 * ⚠️ SERVER-ONLY. This barrel re-exports `auto-earn` etc. which pull in Prisma,
 * so importing it from a `"use client"` component breaks `next build`
 * (node:async_hooks). Client components must import the PURE leaf files directly:
 *   `./tier-colors`, `./limits`, `./types`, `./preview`  (no Prisma, client-safe).
 */

// ── Core: rule-driven earn from a CRM event (the main entry point) + reversal ──
export { applyAutoEarn, reverseAutoEarn } from "./auto-earn"
export type { ApplyAutoEarnInput, ApplyAutoEarnResult, ReverseAutoEarnResult } from "./auto-earn"

// ── Scheduled jobs (cron entry points) ──
export { runLoyaltyExpiry } from "./expiry-cron"
export type { ExpiryPrismaClient, OrgExpiryCronResult } from "./expiry-cron"
export { runLoyaltyBirthday } from "./birthday-cron"
export type { BirthdayCronResult } from "./birthday-cron"

// ── Points ledger mutations ──
export { earnPoints, redeemPoints, expirePoints, adjustPoints } from "./points-engine"

// ── Promo validation + discount + redemption guards ──
export { validatePromoApplication } from "./promo-validator"
export { calculateDiscount } from "./discount-calculator"
export { acquirePromoCodeLock, gateAnonymousRedemption, ANON_REDEMPTION_RATE_LIMITS } from "./redemption-helpers"
export type { AnonymousGateResult, AnonymousRejectionReason } from "./redemption-helpers"

// ── Tier resolution (loads tiers from the DB → server) ──
export { resolveTier, resolveTierFromList, loadActiveTiers, newTierCache, applyTierMultiplier } from "./tier-resolver"
export type { ActiveTierRow, ResolvedTier } from "./tier-resolver"

// ── One-click earn-rule templates ──
export { LOYALTY_TEMPLATES, getLoyaltyTemplateById } from "./templates"
export type { LoyaltyTemplate, LoyaltyEarnRulePayload } from "./templates"
