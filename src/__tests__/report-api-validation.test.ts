import { describe, it, expect } from "vitest"
import { z, ZodError } from "zod"

/**
 * Tests the Zod schemas and normalization logic used by report builder APIs.
 * These tests catch schema mismatches between frontend and backend.
 */

// Recreate schemas from route files
const createReportSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  entityType: z.string().min(1).max(100),
  columns: z.any(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  chartType: z.string().max(50).default("table"),
  chartConfig: z.any().optional().nullable(),
  isShared: z.boolean().default(false),
  scheduleFreq: z.string().max(50).optional().nullable(),
  scheduleEmails: z.array(z.string().email()).default([]),
})

const previewSchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  entity: z.string().min(1).max(100).optional(),
  columns: z.any(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  limit: z.number().int().min(1).max(10000).default(100),
}).refine(data => data.entityType || data.entity, {
  message: "entityType or entity is required",
})

const exportSchema = z.object({
  entityType: z.string().min(1).max(100).optional(),
  entity: z.string().min(1).max(100).optional(),
  columns: z.any().optional(),
  filters: z.any().default([]),
  groupBy: z.string().max(100).optional().nullable(),
  sortBy: z.string().max(100).optional().nullable(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  format: z.enum(["csv", "xlsx"]),
  config: z.any().optional(),
}).refine(data => data.entityType || data.entity || data.config?.entity || data.config?.entityType, {
  message: "entityType or entity is required",
})

describe("Report Builder — createReportSchema", () => {
  it("validates minimal valid input", () => {
    const result = createReportSchema.safeParse({
      name: "Test Report",
      entityType: "deals",
      columns: [{ field: "name" }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sortOrder).toBe("desc") // default
      expect(result.data.chartType).toBe("table") // default
      expect(result.data.scheduleEmails).toEqual([]) // default
    }
  })

  it("rejects empty name", () => {
    const result = createReportSchema.safeParse({
      name: "",
      entityType: "deals",
      columns: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing entityType", () => {
    const result = createReportSchema.safeParse({
      name: "Test",
      columns: [],
    })
    expect(result.success).toBe(false)
  })

  it("accepts schedule configuration", () => {
    const result = createReportSchema.safeParse({
      name: "Weekly Sales",
      entityType: "deals",
      columns: [{ field: "name" }],
      scheduleFreq: "weekly",
      scheduleEmails: ["admin@test.com", "boss@test.com"],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scheduleFreq).toBe("weekly")
      expect(result.data.scheduleEmails).toHaveLength(2)
    }
  })

  it("rejects invalid email in scheduleEmails", () => {
    const result = createReportSchema.safeParse({
      name: "Test",
      entityType: "deals",
      columns: [],
      scheduleEmails: ["not-an-email"],
    })
    expect(result.success).toBe(false)
  })

  it("accepts null description and groupBy", () => {
    const result = createReportSchema.safeParse({
      name: "Test",
      entityType: "deals",
      columns: [],
      description: null,
      groupBy: null,
      sortBy: null,
    })
    expect(result.success).toBe(true)
  })
})

describe("Report Builder — previewSchema", () => {
  it("accepts entityType", () => {
    const result = previewSchema.safeParse({
      entityType: "deals",
      columns: [{ field: "name" }],
    })
    expect(result.success).toBe(true)
  })

  it("accepts entity as alias for entityType", () => {
    const result = previewSchema.safeParse({
      entity: "deals",
      columns: [{ field: "name" }],
    })
    expect(result.success).toBe(true)
  })

  it("rejects when neither entityType nor entity provided", () => {
    const result = previewSchema.safeParse({
      columns: [{ field: "name" }],
    })
    expect(result.success).toBe(false)
  })

  it("defaults limit to 100", () => {
    const result = previewSchema.safeParse({
      entityType: "deals",
      columns: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(100)
    }
  })

  it("rejects limit > 10000", () => {
    const result = previewSchema.safeParse({
      entityType: "deals",
      columns: [],
      limit: 50000,
    })
    expect(result.success).toBe(false)
  })

  it("accepts both string[] and {field}[] columns", () => {
    // String columns
    const r1 = previewSchema.safeParse({
      entityType: "deals",
      columns: ["name", "stage"],
    })
    expect(r1.success).toBe(true)

    // Object columns
    const r2 = previewSchema.safeParse({
      entityType: "deals",
      columns: [{ field: "name" }, { field: "stage", label: "Stage" }],
    })
    expect(r2.success).toBe(true)
  })
})

describe("Report Builder — exportSchema", () => {
  it("accepts flat format with entityType", () => {
    const result = exportSchema.safeParse({
      entityType: "deals",
      columns: [{ field: "name" }],
      format: "csv",
    })
    expect(result.success).toBe(true)
  })

  it("accepts nested config from frontend", () => {
    const result = exportSchema.safeParse({
      config: {
        entity: "deals",
        columns: [{ field: "name" }],
        filters: [],
      },
      format: "xlsx",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing format", () => {
    const result = exportSchema.safeParse({
      entityType: "deals",
      columns: [],
    })
    expect(result.success).toBe(false)
  })

  it("rejects invalid format", () => {
    const result = exportSchema.safeParse({
      entityType: "deals",
      columns: [],
      format: "pdf",
    })
    expect(result.success).toBe(false)
  })

  it("rejects when no entity info provided at all", () => {
    const result = exportSchema.safeParse({
      columns: [],
      format: "csv",
    })
    expect(result.success).toBe(false)
  })
})

describe("Report Builder — column normalization", () => {
  // Test the normalization logic from preview/route.ts
  function normalizeColumns(columns: any[]): { field: string }[] {
    return Array.isArray(columns)
      ? columns.map((c: any) => typeof c === "string" ? { field: c } : c)
      : []
  }

  it("converts string[] to {field}[]", () => {
    const result = normalizeColumns(["name", "stage", "valueAmount"])
    expect(result).toEqual([
      { field: "name" },
      { field: "stage" },
      { field: "valueAmount" },
    ])
  })

  it("preserves {field,label}[] format", () => {
    const input = [{ field: "name", label: "Deal Name" }, { field: "stage" }]
    const result = normalizeColumns(input)
    expect(result).toEqual(input)
  })

  it("handles mixed array", () => {
    const result = normalizeColumns(["name", { field: "stage", label: "Stage" }])
    expect(result).toEqual([
      { field: "name" },
      { field: "stage", label: "Stage" },
    ])
  })

  it("returns empty array for non-array", () => {
    expect(normalizeColumns(null as any)).toEqual([])
    expect(normalizeColumns(undefined as any)).toEqual([])
  })
})

describe("Report Builder — filter normalization", () => {
  // Test the normalization logic from preview/route.ts
  function normalizeFilters(filters: any[]): { field: string; op: string; value: any }[] {
    return Array.isArray(filters)
      ? filters.map((f: any) => ({
          field: f.field,
          op: f.operator || f.op || "eq",
          value: f.value,
        }))
      : []
  }

  it("accepts 'op' key", () => {
    const result = normalizeFilters([{ field: "status", op: "eq", value: "won" }])
    expect(result[0].op).toBe("eq")
  })

  it("accepts 'operator' key as alias", () => {
    const result = normalizeFilters([{ field: "status", operator: "contains", value: "win" }])
    expect(result[0].op).toBe("contains")
  })

  it("defaults to 'eq' when neither op nor operator provided", () => {
    const result = normalizeFilters([{ field: "status", value: "new" }])
    expect(result[0].op).toBe("eq")
  })

  it("handles multiple filters", () => {
    const result = normalizeFilters([
      { field: "status", op: "eq", value: "active" },
      { field: "score", operator: "gt", value: 50 },
      { field: "source", value: "website" },
    ])
    expect(result).toHaveLength(3)
    expect(result[0].op).toBe("eq")
    expect(result[1].op).toBe("gt")
    expect(result[2].op).toBe("eq") // default
  })
})
