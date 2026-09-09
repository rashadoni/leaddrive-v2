/**
 * D8 Loyalty — promo-code redemption helpers (Phase D).
 *
 * Two primitives the future public-checkout flow and the operator
 * manual-redemption endpoint will both call into:
 *
 *   1. `acquirePromoCodeLock(tx, codeId)` — issues `SELECT ... FOR UPDATE`
 *      against the parent PromoCode row inside the caller's transaction,
 *      serializing concurrent redemption checks. Without this, two
 *      simultaneous redemptions of a single-use code can BOTH pass the
 *      "usageLimit - count > 0" check and BOTH write redemption rows,
 *      blowing past the cap. Architect / design-doc P0:
 *      `memory/project_loyalty_slice2_design.md` item 3.
 *
 *   2. `gateAnonymousRedemption(code, contactId)` — refuses anonymous
 *      redemption when the code has a `perCustomerLimit`. An anonymous
 *      caller has no identity to count against, so allowing redemption
 *      effectively makes the limit infinite per session/IP/cookie. The
 *      checkout layer is expected to either enforce a contactId OR
 *      surface a guest-session identifier to the validator BEFORE
 *      calling redemption. Architect / design-doc P0: item 4.
 *
 * Both helpers are pure (no transitive DB calls) except where noted.
 * Tests cover the pure helper; the lock function's runtime behavior
 * needs DB integration tests, which Phase D defers to a later round.
 */
import type { Prisma } from "@prisma/client"

/**
 * The fields the lock + gate helpers need to know about a PromoCode.
 * Mirrors the Prisma select shape so caller can pass either a full row
 * or a slim one.
 */
export interface PromoCodeLockable {
  id: string
  perCustomerLimit: number | null
  usageLimit: number | null
}

/* ─── 1. acquirePromoCodeLock ───────────────────────────────────────── */

/**
 * Issue `SELECT ... FOR UPDATE` against the PromoCode row inside the
 * caller's transaction. The row remains locked until the transaction
 * commits or rolls back — concurrent redemptions on the same code will
 * queue behind this lock.
 *
 * Pattern at call site:
 *
 *   await prisma.$transaction(async (tx) => {
 *     await acquirePromoCodeLock(tx, codeId)
 *     // ↑ blocks if another tx is mid-redeem against the same code
 *     const code = await tx.promoCode.findUnique({ where: { id: codeId }})
 *     const counts = await tx.promoCodeRedemption.aggregate(...)
 *     const result = validatePromoApplication({ code, order, counts })
 *     if (!result.ok) throw ...
 *     await tx.promoCodeRedemption.create(...)
 *   })
 *
 * Throws if codeId not found or org mismatch (use orgId-scoped findFirst
 * BEFORE this call to surface a clean 404).
 */
export async function acquirePromoCodeLock(
  tx: Prisma.TransactionClient,
  codeId: string,
): Promise<void> {
  // $queryRaw is the only way to express FOR UPDATE through Prisma —
  // the high-level Client API doesn't surface it. The SELECT itself
  // takes a row-level exclusive lock; we discard the result (the
  // caller re-reads via findUnique/findFirst within the same tx for
  // type-safe access).
  //
  // Why `1` literal: we don't care about row contents — only the
  // side-effect of acquiring the lock. SELECT 1 avoids transferring
  // the whole row over the wire twice.
  await tx.$queryRaw`SELECT 1 FROM "promo_codes" WHERE "id" = ${codeId} FOR UPDATE`
}

/* ─── 2. gateAnonymousRedemption ────────────────────────────────────── */

export type AnonymousGateResult =
  | { ok: true }
  | { ok: false; reason: AnonymousRejectionReason; message: string }

export type AnonymousRejectionReason =
  | "per_customer_limit_requires_identity"
  | "rate_limit_required"

/**
 * Decide whether an anonymous (no-contactId) redemption is allowed for
 * this code. Returns `{ok: true}` when:
 *   - contactId is non-null (caller has identity — gate doesn't apply), OR
 *   - perCustomerLimit is null (no per-customer cap, anonymous fine).
 *
 * Returns `{ok: false, reason: "per_customer_limit_requires_identity"}`
 * when the code restricts per-customer redemptions AND no contactId
 * is supplied. The route layer should 403 with this reason — UX guidance
 * is "please sign in to use this code."
 *
 * Pure — no DB. Call BEFORE acquirePromoCodeLock.
 */
export function gateAnonymousRedemption(
  code: PromoCodeLockable,
  contactId: string | null,
): AnonymousGateResult {
  // Identified caller — no gate applies.
  if (contactId !== null && contactId !== "") return { ok: true }

  // Anonymous + no per-customer cap — safe (global cap still enforced
  // via usageLimit + the lock).
  if (code.perCustomerLimit === null) return { ok: true }

  // Anonymous + per-customer cap — refuse. Without identity we can't
  // count redemptions per-customer, so the cap is effectively infinite
  // per anonymous session.
  return {
    ok: false,
    reason: "per_customer_limit_requires_identity",
    message:
      "This code has a per-customer redemption cap and requires sign-in to apply.",
  }
}

/* ─── 3. Rate-limit primitive (placeholder for checkout) ────────────── */

/**
 * Suggested rate-limit budget for anonymous public-checkout calls that
 * lack identity. Public-facing endpoints that allow anonymous-without-
 * contactId (the OTHER half of the fraud-gate) should clamp redemption
 * attempts per (IP, fingerprint) to these values.
 *
 * NOT enforced here — the actual middleware lives next to the public
 * route. This module exposes the budget so the route + this helper agree.
 */
export const ANON_REDEMPTION_RATE_LIMITS = {
  /** Max redemption-validation attempts per IP per window. */
  perIpPerHour: 20,
  /** Max successful redemptions per IP per day. */
  perIpPerDay: 5,
} as const
