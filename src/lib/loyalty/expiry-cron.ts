/**
 * D8 Loyalty Phase E — Points expiry cron helper.
 *
 * Sweeps earn rows whose `expiresAt < now` and `expiredAt IS NULL`,
 * groups them by account, and for each account:
 *   1. Reads current balance from `LoyaltyAccount.points`.
 *   2. Calls `expirePoints()` pure helper (caps at current balance).
 *   3. In one $transaction:
 *      a. CAS-updates `LoyaltyAccount.points` (prevents over-draft).
 *      b. Writes an `expire` `LoyaltyTransaction` audit row.
 *      c. Stamps `expiredAt = now` on all processed earn rows.
 *
 * Pure in the sense that the business logic lives here and the route
 * is a thin HTTP adapter. Takes a `PrismaClient` (or
 * `Prisma.TransactionClient` for testability) and a `now` timestamp
 * so tests can inject a deterministic clock.
 *
 * Idempotency: the `expiredAt IS NULL` guard ensures repeated cron
 * runs never double-expire. CAS prevents stale-read races when two
 * concurrent cron invocations run for the same org (unlikely but safe).
 */

import { expirePoints } from "./points-engine"

/* ─── Types ────────────────────────────────────────────────────────── */

export interface ExpiryPrismaClient {
  loyaltyTransaction: {
    findMany(args: {
      where: {
        organizationId: string
        type: string
        expiresAt: { lt: Date }
        expiredAt: null
      }
      select: {
        id: boolean
        loyaltyAccountId: boolean
        delta: boolean
        expiresAt: boolean
      }
    }): Promise<ExpiryEarnRow[]>
    create(args: {
      data: {
        organizationId: string
        loyaltyAccountId: string
        type: string
        delta: number
        lifetimeDelta: number
        reason: string
      }
    }): Promise<{ id: string }>
    updateMany(args: {
      where: { id: { in: string[] } }
      data: { expiredAt: Date }
    }): Promise<{ count: number }>
  }
  loyaltyAccount: {
    findFirst(args: {
      where: { id: string; organizationId: string }
      select: { id: boolean; points: boolean; lifetimePoints: boolean }
    }): Promise<{ id: string; points: number; lifetimePoints: number } | null>
    updateMany(args: {
      where: { id: string; organizationId: string; points: number }
      data: { points: number }
    }): Promise<{ count: number }>
  }
  /**
   * Interactive transaction — used to atomically commit the three writes
   * (balance CAS, audit expire row, earn-row expiredAt stamp) together.
   */
  $transaction<T>(fn: (tx: ExpiryPrismaClient) => Promise<T>): Promise<T>
}

export interface ExpiryEarnRow {
  id: string
  loyaltyAccountId: string
  /** Negative of points to expire (earn delta is positive). */
  delta: number
  expiresAt: Date
}

export interface OrgExpiryCronResult {
  /** Earn rows that passed the filter (expiresAt < now, expiredAt IS NULL). */
  earnRowsFound: number
  /** Accounts that had at least one earn row to process. */
  accountsAttempted: number
  /** Accounts where `expirePoints()` succeeded and the transaction was written. */
  accountsExpired: number
  /** Accounts skipped because current balance was already 0. */
  accountsZeroBalance: number
  /** Total points expired across all accounts. */
  totalPointsExpired: number
}

/* ─── Constants ────────────────────────────────────────────────────── */

const MAX_CAS_RETRIES = 3

/* ─── Core ──────────────────────────────────────────────────────────── */

/**
 * Run the expiry sweep for a single organization.
 *
 * @param prisma  - Prisma client or transaction client.
 * @param orgId   - Target organization.
 * @param now     - Clock injection for testability.
 */
export async function runLoyaltyExpiry(
  prisma: ExpiryPrismaClient,
  orgId: string,
  now: Date,
): Promise<OrgExpiryCronResult> {
  const result: OrgExpiryCronResult = {
    earnRowsFound: 0,
    accountsAttempted: 0,
    accountsExpired: 0,
    accountsZeroBalance: 0,
    totalPointsExpired: 0,
  }

  // 1. Find all un-processed earn rows that have passed their expiry.
  const earnRows = await prisma.loyaltyTransaction.findMany({
    where: {
      organizationId: orgId,
      type: "earn",
      expiresAt: { lt: now },
      expiredAt: null,
    },
    select: { id: true, loyaltyAccountId: true, delta: true, expiresAt: true },
  })
  result.earnRowsFound = earnRows.length
  if (earnRows.length === 0) return result

  // 2. Group earn rows by account so we write one expire transaction per
  //    account (rather than one per earn row — cleaner audit log).
  const byAccount = new Map<string, ExpiryEarnRow[]>()
  for (const row of earnRows) {
    const list = byAccount.get(row.loyaltyAccountId) ?? []
    list.push(row)
    byAccount.set(row.loyaltyAccountId, list)
  }
  result.accountsAttempted = byAccount.size

  // 3. Process each account independently (failure of one doesn't block
  //    others — per-account try/catch).
  for (const [accountId, rows] of byAccount) {
    try {
      await expireAccountPoints(prisma, orgId, accountId, rows, now, result)
    } catch (e) {
      console.error(
        `[loyalty-expiry] account ${accountId} (org ${orgId}) error:`,
        e,
      )
    }
  }

  return result
}

async function expireAccountPoints(
  prisma: ExpiryPrismaClient,
  orgId: string,
  accountId: string,
  rows: ExpiryEarnRow[],
  now: Date,
  result: OrgExpiryCronResult,
): Promise<void> {
  // Sum points to expire from the earn rows (each delta is positive).
  const toExpire = rows.reduce((sum, r) => sum + r.delta, 0)
  if (toExpire <= 0) return // guard — shouldn't happen, earn deltas > 0

  // CAS retry loop — account balance may change between read and write.
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const account = await prisma.loyaltyAccount.findFirst({
      where: { id: accountId, organizationId: orgId },
      select: { id: true, points: true, lifetimePoints: true },
    })
    if (!account) return // account deleted since cron started
    if (account.points <= 0) {
      result.accountsZeroBalance++
      return // nothing to expire
    }

    // Cap: can't expire more than the current balance (FIFO semantics).
    // expirePoints rejects when requested > balance, so we clamp first.
    // Must pass real lifetimePoints — validateBalance requires lifetimePoints >= points.
    const clampedToExpire = Math.min(toExpire, account.points)
    const expireResult = expirePoints({
      current: { points: account.points, lifetimePoints: account.lifetimePoints },
      points: clampedToExpire,
    })
    if (!expireResult.ok) {
      console.error(`[loyalty-expiry] expirePoints error for ${accountId}:`, expireResult.error)
      return
    }

    const actualExpired = Math.abs(expireResult.delta) // delta is negative

    // Atomic commit: CAS balance debit + audit expire row + earn-row stamp.
    // All three in one $transaction so a crash between writes doesn't
    // leave the balance debited without the earn rows stamped (double-expiry).
    // If the CAS WHERE clause fails (concurrent write changed balance), the
    // whole transaction rolls back → we retry the outer loop.
    let casSucceeded = false
    await prisma.$transaction(async (tx) => {
      const cas = await tx.loyaltyAccount.updateMany({
        where: { id: accountId, organizationId: orgId, points: account.points },
        data: { points: account.points - actualExpired },
      })
      if (cas.count === 0) {
        // Stale read — abort this transaction and signal retry.
        return
      }
      casSucceeded = true

      await tx.loyaltyTransaction.create({
        data: {
          organizationId: orgId,
          loyaltyAccountId: accountId,
          type: expireResult.type,
          delta: expireResult.delta,
          lifetimeDelta: expireResult.lifetimeDelta,
          reason: `Automated expiry: ${rows.length} earn row(s) past expiresAt`,
        },
      })

      await tx.loyaltyTransaction.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { expiredAt: now },
      })
    })

    if (!casSucceeded) continue // lost the race → retry

    result.accountsExpired++
    result.totalPointsExpired += actualExpired
    return // success
  }

  // Exhausted CAS retries — log and move on.
  console.error(
    `[loyalty-expiry] CAS exhausted for account ${accountId} after ${MAX_CAS_RETRIES} attempts`,
  )
}
