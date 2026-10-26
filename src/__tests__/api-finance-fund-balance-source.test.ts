import { describe, it, expect, vi, beforeEach } from "vitest"

// The Fund screen's balance switch (owner 2026-10-26: «показывать балансы её
// фондов из Kafka, с возвратом одной кнопкой»). The SQL itself runs on a real
// PostgreSQL in scripts/event-platform/fund-shadow/pilot.integration.ts; here:
// which number each card gets, and who may flip the switch when.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    fund: { findMany: vi.fn(), findFirst: vi.fn() },
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    requireAuth: vi.fn(async (req: unknown) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "u-1", role: "admin", email: "", name: "", principalType: "session" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: vi.fn((value: unknown) => value instanceof Response),
  }
})

import { NextRequest } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"
import { FUND_BALANCE_SOURCE_SQL, KAFKA_FUND_BALANCES_SQL } from "@/lib/finance/fund-balance-source-sql"
import { GET as LIST } from "@/app/api/finance/funds/route"
import { GET as ONE } from "@/app/api/finance/funds/[id]/route"
import { GET as SOURCE, PUT as SET_SOURCE } from "@/app/api/finance/funds/balance-source/route"

const db = prisma as unknown as {
  fund: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> }
  $queryRawUnsafe: ReturnType<typeof vi.fn>
  $executeRawUnsafe: ReturnType<typeof vi.fn>
}

function fund(id: string, currentBalance: string) {
  return { id, organizationId: "org-1", name: id, currency: "AZN", targetAmount: null, currentBalance, isActive: true, rules: [] }
}

function database({ setting, available, kafka }: { setting: string | null; available: boolean; kafka?: unknown[] }) {
  db.$queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (sql === FUND_BALANCE_SOURCE_SQL) return [{ source: setting, available }]
    if (sql === KAFKA_FUND_BALANCES_SQL) return kafka ?? []
    throw new Error("unexpected SQL")
  })
}

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(url, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
})

describe("Fund balances: CRM or Kafka", () => {
  it("shows a current Kafka balance, keeps the CRM one while Kafka catches up, and says which is which", async () => {
    database({ setting: "kafka", available: true, kafka: [
      { fundId: "f-current", balance: "30000.0000", fresh: true },
      { fundId: "f-behind", balance: "5.0000", fresh: false },
    ] })
    db.fund.findMany.mockResolvedValue([fund("f-current", "29000"), fund("f-behind", "100"), fund("f-legacy", "7")])
    const json = await (await LIST(req("http://localhost/api/finance/funds"), {} as never)).json()
    const shown = Object.fromEntries(json.data.map((f: { id: string; currentBalance: number; currentBalanceExact: string; balanceSource: string }) =>
      [f.id, [f.currentBalance, f.currentBalanceExact, f.balanceSource]]))
    expect(shown).toEqual({
      "f-current": [30000, "30000.0000", "kafka"],
      // Behind the fund's last operation: never an old Kafka number.
      "f-behind": [100, "100.0000", "kafka-catching-up"],
      // Opened before the event platform: nothing in Kafka to show.
      "f-legacy": [7, "7.0000", "crm"],
    })
  })

  it("with the switch on CRM, nothing is read from Kafka", async () => {
    database({ setting: "crm", available: true })
    db.fund.findMany.mockResolvedValue([fund("f-1", "12.5")])
    const json = await (await LIST(req("http://localhost/api/finance/funds"), {} as never)).json()
    expect(json.data[0]).toMatchObject({ currentBalance: 12.5, balanceSource: "crm" })
    expect(db.$queryRawUnsafe).not.toHaveBeenCalledWith(KAFKA_FUND_BALANCES_SQL, expect.anything())
  })

  it("an organization without the Kafka pilot gets the CRM balance whatever its setting says", async () => {
    database({ setting: "kafka", available: false })
    db.fund.findMany.mockResolvedValue([fund("f-1", "12.5")])
    const json = await (await LIST(req("http://localhost/api/finance/funds"), {} as never)).json()
    expect(json.data[0]).toMatchObject({ currentBalance: 12.5, balanceSource: "crm" })
  })

  it("the fund card itself follows the same switch", async () => {
    database({ setting: "kafka", available: true, kafka: [{ fundId: "f-1", balance: "44.1200", fresh: true }] })
    db.fund.findFirst.mockResolvedValue(fund("f-1", "40"))
    const res = await ONE(req("http://localhost/api/finance/funds/f-1"), { params: Promise.resolve({ id: "f-1" }) } as never)
    expect((await res.json()).data).toMatchObject({ currentBalance: 44.12, currentBalanceExact: "44.1200", balanceSource: "kafka" })
  })
})

describe("the switch «Баланс из CRM / Kafka»", () => {
  it("reports whether the organization has it at all", async () => {
    database({ setting: null, available: false })
    expect((await (await SOURCE(req("http://localhost/api/finance/funds/balance-source"), {} as never)).json()).data)
      .toEqual({ available: false, source: "crm" })
  })

  it("turns Kafka on with an audit entry, and back with one press", async () => {
    let setting: string | null = null
    db.$queryRawUnsafe.mockImplementation(async () => [{ source: setting, available: true }])
    db.$executeRawUnsafe.mockImplementation(async (_sql: string, _org: string, value: string) => { setting = value; return 1 })
    const on = await SET_SOURCE(req("http://localhost/api/finance/funds/balance-source", "PUT", { source: "kafka" }), {} as never)
    expect((await on.json()).data).toEqual({ available: true, source: "kafka" })
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining("jsonb_set"), "org-1", "kafka")
    expect(logAudit).toHaveBeenCalledWith("org-1", "finance_fund_balance_source_changed", "organization", "org-1", "Fund balance source",
      expect.objectContaining({ oldValue: { source: "crm" }, newValue: { source: "kafka" } }))
    const off = await SET_SOURCE(req("http://localhost/api/finance/funds/balance-source", "PUT", { source: "crm" }), {} as never)
    expect((await off.json()).data).toEqual({ available: true, source: "crm" })
    expect(logAudit).toHaveBeenCalledTimes(2)
  })

  it("does not write or log when nothing changes", async () => {
    database({ setting: "kafka", available: true })
    await SET_SOURCE(req("http://localhost/api/finance/funds/balance-source", "PUT", { source: "kafka" }), {} as never)
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("refuses Kafka where there is no pilot, and anything that is not crm or kafka", async () => {
    database({ setting: null, available: false })
    const refused = await SET_SOURCE(req("http://localhost/api/finance/funds/balance-source", "PUT", { source: "kafka" }), {} as never)
    expect(refused.status).toBe(409)
    const bad = await SET_SOURCE(req("http://localhost/api/finance/funds/balance-source", "PUT", { source: "kafka", extra: 1 }), {} as never)
    expect(bad.status).toBe(400)
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
  })
})
