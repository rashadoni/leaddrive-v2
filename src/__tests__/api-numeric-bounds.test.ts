import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pipelineStage: { findFirst: vi.fn() },
    stageValidationRule: { create: vi.fn(), findMany: vi.fn() },
    salesQuota: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_CURRENCY: "AZN",
  isManagerOrAbove: vi.fn().mockReturnValue(true),
  isAdmin: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/deal-stage-vocabulary", () => ({
  orgStageVocabulary: vi.fn().mockResolvedValue({ wonStages: ["WON"] }),
}))

import { POST as createQuota } from "@/app/api/v1/sales-quotas/route"
import { PATCH as updateQuota } from "@/app/api/v1/sales-quotas/[id]/route"
import { POST as createStageRule } from "@/app/api/v1/pipeline-stages/[id]/rules/route"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import {
  MAX_CRM_FINANCIAL_AMOUNT,
  coercedNonNegativeFinancialAmountSchema,
  nonNegativeFinancialAmountSchema,
} from "@/lib/validation/numeric"

const session = {
  orgId: "org-1",
  userId: "user-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function request(path: string, body: unknown, method = "POST") {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function requestWithDirectJson(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(session as never)
  vi.mocked(requireAuth).mockResolvedValue(session as never)
})

describe("shared CRM financial amount bounds", () => {
  it.each([-1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NaN, 1_000_000_000_000])(
    "rejects unsafe numeric value %s",
    (value) => {
      expect(nonNegativeFinancialAmountSchema.safeParse(value).success).toBe(false)
    },
  )

  it("accepts zero and the documented upper boundary", () => {
    expect(nonNegativeFinancialAmountSchema.safeParse(0).success).toBe(true)
    expect(nonNegativeFinancialAmountSchema.safeParse(MAX_CRM_FINANCIAL_AMOUNT).success).toBe(true)
  })

  it("coerces a legacy numeric string without accepting blank or infinite input", () => {
    expect(coercedNonNegativeFinancialAmountSchema.parse("1250.50")).toBe(1250.5)
    expect(coercedNonNegativeFinancialAmountSchema.safeParse("").success).toBe(false)
    expect(coercedNonNegativeFinancialAmountSchema.safeParse("Infinity").success).toBe(false)
  })
})

describe("sales quota amount validation", () => {
  it.each([-1, 1_000_000_000_000, Number.POSITIVE_INFINITY])(
    "rejects unsafe create amount %s before upsert",
    async (amount) => {
      const res = await createQuota(requestWithDirectJson({
        userId: "sales-1",
        year: 2026,
        quarter: 1,
        amount,
      }))

      expect(res.status).toBe(400)
      expect(prisma.salesQuota.upsert).not.toHaveBeenCalled()
    },
  )

  it.each([-1, 1_000_000_000_000, Number.POSITIVE_INFINITY])(
    "rejects unsafe update amount %s before loading the quota",
    async (amount) => {
      const res = await updateQuota(
        requestWithDirectJson({ amount }),
        { params: Promise.resolve({ id: "quota-1" }) },
      )

      expect(res.status).toBe(400)
      expect(prisma.salesQuota.findFirst).not.toHaveBeenCalled()
      expect(prisma.salesQuota.update).not.toHaveBeenCalled()
    },
  )

  it("accepts zero as a valid quota target", async () => {
    vi.mocked(prisma.salesQuota.upsert).mockResolvedValue({ id: "quota-1", amount: 0 } as never)

    const res = await createQuota(request("/api/v1/sales-quotas", {
      userId: "sales-1",
      year: 2026,
      quarter: 1,
      amount: 0,
    }))

    expect(res.status).toBe(200)
    expect(prisma.salesQuota.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ amount: 0 }),
      update: expect.objectContaining({ amount: 0 }),
    }))
  })
})

describe("pipeline validation rule numeric bounds", () => {
  it.each(["-80", "1000000000000", Number.POSITIVE_INFINITY])(
    "rejects unsafe monetary rule value %s",
    async (ruleValue) => {
      const res = await createStageRule(
        requestWithDirectJson({
          fieldName: "valueAmount",
          ruleType: "max_value",
          ruleValue,
          errorMessage: "Value is too high",
        }),
        { params: Promise.resolve({ id: "stage-1" }) },
      )

      expect(res.status).toBe(400)
      expect(prisma.stageValidationRule.create).not.toHaveBeenCalled()
    },
  )

  it("rejects a negative text-length rule", async () => {
    const res = await createStageRule(
      request("/api/v1/pipeline-stages/stage-1/rules", {
        fieldName: "notes",
        ruleType: "min_length",
        ruleValue: "-1",
        errorMessage: "Notes are too short",
      }),
      { params: Promise.resolve({ id: "stage-1" }) },
    )

    expect(res.status).toBe(400)
    expect(prisma.stageValidationRule.create).not.toHaveBeenCalled()
  })

  it("preserves zero rather than converting it to a missing rule value", async () => {
    vi.mocked(prisma.pipelineStage.findFirst).mockResolvedValue({ id: "stage-1" } as never)
    vi.mocked(prisma.stageValidationRule.create).mockResolvedValue({ id: "rule-1" } as never)

    const res = await createStageRule(
      request("/api/v1/pipeline-stages/stage-1/rules", {
        fieldName: "valueAmount",
        ruleType: "min_value",
        ruleValue: 0,
        errorMessage: "Value is required",
      }),
      { params: Promise.resolve({ id: "stage-1" }) },
    )

    expect(res.status).toBe(200)
    expect(prisma.stageValidationRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ruleValue: "0" }),
    })
  })
})
