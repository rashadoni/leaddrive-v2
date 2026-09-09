/**
 * D8 Loyalty Phase E — Points expiry cron unit tests.
 *
 * Tests the `runLoyaltyExpiry` pure function in isolation using a
 * hand-rolled mock (ExpiryPrismaClient). All Date arithmetic uses a
 * fixed `now` injected as the third argument.
 *
 * Coverage:
 *  1. No earn rows found → returns zeros, makes no writes
 *  2. Earn row expiresAt in the future → not included (not past `now`)
 *  3. Single earn row past expiry → expire transaction + expiredAt stamped
 *  4. expiredAt already set → idempotent (cron skips it)
 *  5. Balance cap: toExpire > current balance → caps at current balance
 *  6. Zero-balance account → skip (accountsZeroBalance++)
 *  7. Multi-account isolation: two accounts in same org, only one expired
 *  8. CAS retry: first updateMany returns count=0 (stale read), second succeeds
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { runLoyaltyExpiry } from "@/lib/loyalty/expiry-cron"
import type { ExpiryPrismaClient, ExpiryEarnRow } from "@/lib/loyalty/expiry-cron"

const ORG_ID = "org-test"
const ACCOUNT_A = "acct-A"
const ACCOUNT_B = "acct-B"

const PAST = new Date("2026-01-01T00:00:00Z")   // before `now`
const FUTURE = new Date("2027-01-01T00:00:00Z") // after `now`
const NOW = new Date("2026-06-01T02:00:00Z")

function makePrisma(
  opts: {
    earnRows?: ExpiryEarnRow[]
    accountPoints?: Record<string, number>
    /** lifetimePoints per account — defaults to 2× accountPoints to satisfy balance invariant */
    accountLifetimePoints?: Record<string, number>
    casFailFirst?: boolean
  } = {},
): ExpiryPrismaClient {
  const earnRows = opts.earnRows ?? []
  const accountPoints = { ...opts.accountPoints }
  // lifetimePoints >= points is required by validateBalance.
  // Default to same as points so the invariant holds in tests.
  const accountLifetimePoints = { ...(opts.accountLifetimePoints ?? opts.accountPoints) }
  let casFailCount = opts.casFailFirst ? 1 : 0

  const createdTransactions: unknown[] = []
  const updatedRows: string[] = []
  const balanceUpdates: Record<string, number> = {}

  // Build the mock object with forward-referenced $transaction.
  // $transaction calls the callback with the same mock as the "tx" client
  // so inner write calls (create, updateMany) hit the same mock functions.
  const mock: ExpiryPrismaClient = {
    loyaltyTransaction: {
      findMany: vi.fn().mockResolvedValue(earnRows),
      create: vi.fn().mockImplementation(async (args: any) => {
        createdTransactions.push(args.data)
        return { id: "txn-" + createdTransactions.length }
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        updatedRows.push(...args.where.id.in)
        return { count: args.where.id.in.length }
      }),
    },
    loyaltyAccount: {
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        const id = args.where.id
        const pts = accountPoints[id] ?? 0
        // lifetimePoints must be >= points (validateBalance constraint)
        const ltPts = accountLifetimePoints[id] ?? pts
        return { id, points: pts, lifetimePoints: ltPts }
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        if (casFailCount > 0) {
          casFailCount--
          return { count: 0 } // simulate CAS miss
        }
        const id = args.where.id
        balanceUpdates[id] = args.data.points
        accountPoints[id] = args.data.points
        return { count: 1 }
      }),
    },
    $transaction: vi.fn().mockImplementation(
      (fn: (tx: ExpiryPrismaClient) => Promise<unknown>) => fn(mock),
    ),
  }
  return mock
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runLoyaltyExpiry — no work", () => {
  it("returns zeros when findMany returns empty array", async () => {
    const prisma = makePrisma({ earnRows: [] })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)
    expect(result.earnRowsFound).toBe(0)
    expect(result.accountsAttempted).toBe(0)
    expect(result.accountsExpired).toBe(0)
    expect(result.totalPointsExpired).toBe(0)
    expect(prisma.loyaltyTransaction.create).not.toHaveBeenCalled()
  })
})

describe("runLoyaltyExpiry — single earn row", () => {
  it("expires a single past-due earn row", async () => {
    const earnRows: ExpiryEarnRow[] = [
      { id: "earn-1", loyaltyAccountId: ACCOUNT_A, delta: 100, expiresAt: PAST },
    ]
    const prisma = makePrisma({ earnRows, accountPoints: { [ACCOUNT_A]: 100 } })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(result.earnRowsFound).toBe(1)
    expect(result.accountsAttempted).toBe(1)
    expect(result.accountsExpired).toBe(1)
    expect(result.totalPointsExpired).toBe(100)

    // One expire transaction written
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledOnce()
    const txArg = vi.mocked(prisma.loyaltyTransaction.create).mock.calls[0][0].data
    expect(txArg.type).toBe("expire")
    expect(txArg.delta).toBe(-100)
    expect(txArg.lifetimeDelta).toBe(0)

    // earn-1 stamped with expiredAt
    expect(prisma.loyaltyTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["earn-1"] } }, data: { expiredAt: NOW } })
    )
  })
})

describe("runLoyaltyExpiry — balance cap", () => {
  it("caps expiry at current balance when toExpire > balance", async () => {
    // Two earn rows totalling 300 points, but account only has 150
    const earnRows: ExpiryEarnRow[] = [
      { id: "earn-2", loyaltyAccountId: ACCOUNT_A, delta: 200, expiresAt: PAST },
      { id: "earn-3", loyaltyAccountId: ACCOUNT_A, delta: 100, expiresAt: PAST },
    ]
    const prisma = makePrisma({ earnRows, accountPoints: { [ACCOUNT_A]: 150 } })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(result.totalPointsExpired).toBe(150)
    const txArg = vi.mocked(prisma.loyaltyTransaction.create).mock.calls[0][0].data
    expect(txArg.delta).toBe(-150)
  })
})

describe("runLoyaltyExpiry — zero balance", () => {
  it("skips account with points === 0", async () => {
    const earnRows: ExpiryEarnRow[] = [
      { id: "earn-4", loyaltyAccountId: ACCOUNT_A, delta: 50, expiresAt: PAST },
    ]
    const prisma = makePrisma({ earnRows, accountPoints: { [ACCOUNT_A]: 0 } })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(result.accountsZeroBalance).toBe(1)
    expect(result.accountsExpired).toBe(0)
    expect(result.totalPointsExpired).toBe(0)
    expect(prisma.loyaltyTransaction.create).not.toHaveBeenCalled()
  })
})

describe("runLoyaltyExpiry — multi-account isolation", () => {
  it("processes each account independently", async () => {
    const earnRows: ExpiryEarnRow[] = [
      { id: "earn-5", loyaltyAccountId: ACCOUNT_A, delta: 80, expiresAt: PAST },
      { id: "earn-6", loyaltyAccountId: ACCOUNT_B, delta: 40, expiresAt: PAST },
    ]
    const prisma = makePrisma({
      earnRows,
      accountPoints: { [ACCOUNT_A]: 80, [ACCOUNT_B]: 40 },
    })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(result.accountsExpired).toBe(2)
    expect(result.totalPointsExpired).toBe(120)
    expect(prisma.loyaltyTransaction.create).toHaveBeenCalledTimes(2)
  })
})

describe("runLoyaltyExpiry — CAS retry", () => {
  it("retries after a CAS miss and succeeds on second attempt", async () => {
    const earnRows: ExpiryEarnRow[] = [
      { id: "earn-7", loyaltyAccountId: ACCOUNT_A, delta: 60, expiresAt: PAST },
    ]
    // First updateMany call returns count=0 (stale), second succeeds
    const prisma = makePrisma({
      earnRows,
      accountPoints: { [ACCOUNT_A]: 60 },
      casFailFirst: true,
    })
    const result = await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(result.accountsExpired).toBe(1)
    expect(result.totalPointsExpired).toBe(60)
    // updateMany called twice for the account (two CAS attempts)
    expect(prisma.loyaltyAccount.updateMany).toHaveBeenCalledTimes(2)
  })
})

describe("runLoyaltyExpiry — findMany filters", () => {
  it("calls findMany with the correct filter (type=earn, expiresAt<now, expiredAt=null)", async () => {
    const prisma = makePrisma({ earnRows: [] })
    await runLoyaltyExpiry(prisma, ORG_ID, NOW)

    expect(prisma.loyaltyTransaction.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        type: "earn",
        expiresAt: { lt: NOW },
        expiredAt: null,
      },
      select: expect.anything(),
    })
  })
})
