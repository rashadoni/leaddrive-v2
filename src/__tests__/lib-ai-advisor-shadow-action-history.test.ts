import { describe, expect, it } from "vitest"
import { buildAdvisorShadowActionWhere } from "@/lib/ai/advisor/shadow-action-history"

describe("buildAdvisorShadowActionWhere", () => {
  it("keeps reviewed history broad enough to include approved and rejected actions", () => {
    expect(buildAdvisorShadowActionWhere({
      organizationId: "org-1",
      status: "reviewed",
    })).toMatchObject({
      organizationId: "org-1",
      AND: [{ approved: { not: null } }],
    })
  })

  it("combines status, module, owner, date and search filters without overwriting OR clauses", () => {
    const where = buildAdvisorShadowActionWhere({
      organizationId: "org-1",
      status: "reviewed",
      module: "finance",
      owner: "owner-1",
      dateFrom: "2026-06-20T00:00:00.000Z",
      dateTo: "2026-06-27T23:59:59.000Z",
      query: "invoice",
    })

    expect(where).toMatchObject({
      organizationId: "org-1",
      AND: expect.arrayContaining([
        { approved: { not: null } },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { payload: { path: ["advisor", "domain"], equals: "finance" } },
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { payload: { path: ["advisor", "ownerId"], equals: "owner-1" } },
            { reviewedBy: "owner-1" },
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { reviewedAt: expect.objectContaining({ gte: new Date("2026-06-20T00:00:00.000Z") }) },
            { createdAt: expect.objectContaining({ lte: new Date("2026-06-27T23:59:59.000Z") }) },
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { payload: { path: ["invoiceNumber"], string_contains: "invoice" } },
          ]),
        }),
      ]),
    })
  })
})
