import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock prisma with dynamic model access
const mockFindMany = vi.fn()
const mockGroupBy = vi.fn()
const mockCount = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_target, prop) => {
      if (typeof prop === "string" && !prop.startsWith("_")) {
        return {
          findMany: mockFindMany,
          groupBy: mockGroupBy,
          count: mockCount,
        }
      }
    },
  }),
}))

import { executeReport, getEntityConfigs, type ReportConfig } from "@/lib/report-engine"

describe("report-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([])
    mockGroupBy.mockResolvedValue([])
  })

  describe("getEntityConfigs", () => {
    it("returns all 7 entity types", () => {
      const configs = getEntityConfigs()
      expect(Object.keys(configs)).toHaveLength(7)
      expect(configs).toHaveProperty("deals")
      expect(configs).toHaveProperty("contacts")
      expect(configs).toHaveProperty("companies")
      expect(configs).toHaveProperty("leads")
      expect(configs).toHaveProperty("tickets")
      expect(configs).toHaveProperty("tasks")
      expect(configs).toHaveProperty("activities")
    })

    it("every config has model name and fields array", () => {
      const configs = getEntityConfigs()
      for (const [key, config] of Object.entries(configs)) {
        expect(config.model, `${key} missing model`).toBeTruthy()
        expect(config.fields.length, `${key} has no fields`).toBeGreaterThan(0)
      }
    })

    it("deals config uses correct Prisma field names", () => {
      const configs = getEntityConfigs()
      const dealFields = configs.deals.fields.map(f => f.name)
      expect(dealFields).toContain("valueAmount")
      expect(dealFields).toContain("name")
      expect(dealFields).toContain("stage")
      expect(dealFields).not.toContain("value") // wrong name
    })

    it("contacts config uses fullName", () => {
      const configs = getEntityConfigs()
      const contactFields = configs.contacts.fields.map(f => f.name)
      expect(contactFields).toContain("fullName")
      expect(contactFields).not.toContain("firstName")
    })

    it("leads config uses contactName", () => {
      const configs = getEntityConfigs()
      const leadFields = configs.leads.fields.map(f => f.name)
      expect(leadFields).toContain("contactName")
    })
  })

  describe("executeReport — flat queries", () => {
    it("throws on unknown entity type", async () => {
      const config: ReportConfig = {
        entityType: "nonexistent",
        columns: [{ field: "name" }],
        filters: [],
      }
      await expect(executeReport("org-1", config)).rejects.toThrow("Unknown entity type")
    })

    it("queries with organizationId filter", async () => {
      mockFindMany.mockResolvedValue([{ id: "1", name: "Test" }])

      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [],
      }
      await executeReport("org-1", config)

      expect(mockFindMany).toHaveBeenCalledTimes(1)
      const callArgs = mockFindMany.mock.calls[0][0]
      expect(callArgs.where.organizationId).toBe("org-1")
    })

    it("applies eq filter", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [{ field: "stage", op: "eq", value: "won" }],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.stage).toBe("won")
    })

    it("applies neq filter", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [{ field: "status", op: "neq", value: "lost" }],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.status).toEqual({ not: "lost" })
    })

    it("applies contains filter (case insensitive)", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "contacts",
        columns: [{ field: "fullName" }],
        filters: [{ field: "fullName", op: "contains", value: "john" }],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.fullName).toEqual({ contains: "john", mode: "insensitive" })
    })

    it("applies in filter with array value", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "tickets",
        columns: [{ field: "subject" }],
        filters: [{ field: "priority", op: "in", value: ["high", "critical"] }],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.priority).toEqual({ in: ["high", "critical"] })
    })

    it("applies between filter for date range", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [{ field: "createdAt", op: "between", value: { from: "2026-01-01", to: "2026-12-31" } }],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.createdAt.gte).toBeInstanceOf(Date)
      expect(where.createdAt.lte).toBeInstanceOf(Date)
    })

    it("handles relation fields with dot notation", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }, { field: "company.name" }],
        filters: [],
      }
      await executeReport("org-1", config)

      const callArgs = mockFindMany.mock.calls[0][0]
      // Should have select with company include
      expect(callArgs.select?.name).toBe(true)
      expect(callArgs.select?.company?.select?.name).toBe(true)
    })

    it("returns flat result type", async () => {
      mockFindMany.mockResolvedValue([{ id: "1", name: "Deal A" }])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [],
      }
      const result = await executeReport("org-1", config)
      expect(result.type).toBe("flat")
      expect(result.data).toHaveLength(1)
    })

    it("respects custom sort order", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [],
        sortBy: "valueAmount",
        sortOrder: "asc",
      }
      await executeReport("org-1", config)

      const callArgs = mockFindMany.mock.calls[0][0]
      expect(callArgs.orderBy).toEqual({ valueAmount: "asc" })
    })

    it("defaults to limit 500 for flat queries", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "name" }],
        filters: [],
      }
      await executeReport("org-1", config)

      expect(mockFindMany.mock.calls[0][0].take).toBe(500)
    })
  })

  describe("executeReport — grouped queries", () => {
    it("uses groupBy when specified", async () => {
      mockGroupBy.mockResolvedValue([
        { stage: "won", _count: { id: 5 } },
        { stage: "lost", _count: { id: 3 } },
      ])

      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "stage" }, { field: "id", aggregate: "count" }],
        filters: [],
        groupBy: "stage",
      }
      const result = await executeReport("org-1", config)

      expect(result.type).toBe("grouped")
      expect(result.groupBy).toBe("stage")
      expect(mockGroupBy).toHaveBeenCalledTimes(1)
      expect(mockGroupBy.mock.calls[0][0].by).toEqual(["stage"])
    })

    it("defaults to limit 100 for grouped queries", async () => {
      mockGroupBy.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [{ field: "stage" }],
        filters: [],
        groupBy: "stage",
      }
      await executeReport("org-1", config)

      expect(mockGroupBy.mock.calls[0][0].take).toBe(100)
    })

    it("includes aggregates in groupBy query", async () => {
      mockGroupBy.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "deals",
        columns: [
          { field: "stage" },
          { field: "valueAmount", aggregate: "sum" },
          { field: "valueAmount", aggregate: "avg" },
        ],
        filters: [],
        groupBy: "stage",
      }
      await executeReport("org-1", config)

      const callArgs = mockGroupBy.mock.calls[0][0]
      expect(callArgs._sum).toEqual({ valueAmount: true })
      expect(callArgs._avg).toEqual({ valueAmount: true })
    })
  })

  describe("executeReport — multiple filters combined", () => {
    it("applies all filters to where clause", async () => {
      mockFindMany.mockResolvedValue([])
      const config: ReportConfig = {
        entityType: "leads",
        columns: [{ field: "contactName" }],
        filters: [
          { field: "status", op: "eq", value: "qualified" },
          { field: "score", op: "gt", value: 50 },
          { field: "source", op: "in", value: ["website", "referral"] },
        ],
      }
      await executeReport("org-1", config)

      const where = mockFindMany.mock.calls[0][0].where
      expect(where.status).toBe("qualified")
      expect(where.score).toEqual({ gt: 50 })
      expect(where.source).toEqual({ in: ["website", "referral"] })
    })
  })
})
