import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { findFirst: vi.fn() },
    activity: { findMany: vi.fn() },
    task: { count: vi.fn() },
    aiInteractionLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
  requireAuth: vi.fn(),
  getOrgModuleContext: vi.fn(),
  isAuthError: vi.fn().mockImplementation((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(),
}))

vi.mock("@/lib/ai/predictive", () => ({
  calculateChurnRisk: vi.fn(),
  predictDealWin: vi.fn(),
  dealVelocityAnalysis: vi.fn(),
}))

vi.mock("@/lib/ai/budget", () => ({
  checkAiBudget: vi.fn(),
  calculateAiCost: vi.fn(),
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: vi.fn(),
}))

import { GET as churnRiskGET } from "@/app/api/v1/analytics/churn-risk/route"
import { GET as dealPredictionGET } from "@/app/api/v1/analytics/deal-prediction/route"
import { GET as dealVelocityGET } from "@/app/api/v1/analytics/deal-velocity/route"
import { GET as dealSuggestionsGET } from "@/app/api/v1/deals/ai-suggestions/route"
import { prisma } from "@/lib/prisma"
import { getOrgModuleContext, requireAuth, type AuthResult } from "@/lib/api-auth"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { calculateChurnRisk, dealVelocityAnalysis, predictDealWin } from "@/lib/ai/predictive"
import { checkAiBudget } from "@/lib/ai/budget"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import type { Role } from "@/lib/permissions"

const ADMIN: AuthResult = {
  orgId: "org-1",
  userId: "admin-1",
  role: "admin",
  email: "admin@example.com",
  name: "Admin",
}

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"))
}

function withRole(role: Role, userId = `${role}-1`) {
  vi.mocked(requireAuth).mockResolvedValue({ ...ADMIN, role, userId })
}

function setModules(modules: Record<string, boolean>) {
  vi.mocked(getOrgModuleContext).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    modules,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(ADMIN)
  setModules({ sales: true, analytics: true })
  vi.mocked(applyRecordFilter).mockImplementation(async (_orgId, _userId, _role, _entity, where) => ({
    ...where,
    OR: [{ assignedTo: "visible-user" }],
  }))
  vi.mocked(checkAiBudget).mockResolvedValue({ allowed: true, spent: 0, limit: 5, remaining: 5 })
})

describe("org-wide predictive analytics access", () => {
  it.each([
    ["churn risk", churnRiskGET, calculateChurnRisk],
    ["deal velocity", dealVelocityGET, dealVelocityAnalysis],
  ])("rejects non-manager access to %s before module/data work", async (_name, handler, predictor) => {
    withRole("sales")

    const response = await handler(request(`/api/v1/analytics/${_name === "churn risk" ? "churn-risk" : "deal-velocity"}`))

    expect(response.status).toBe(403)
    expect(getOrgModuleContext).not.toHaveBeenCalled()
    expect(predictor).not.toHaveBeenCalled()
  })

  it.each([
    ["churn risk", churnRiskGET, calculateChurnRisk],
    ["deal velocity", dealVelocityGET, dealVelocityAnalysis],
  ])("requires both Analytics and Sales for %s", async (_name, handler, predictor) => {
    setModules({ analytics: true, sales: false })

    const response = await handler(request(`/api/v1/analytics/${_name === "churn risk" ? "churn-risk" : "deal-velocity"}`))

    expect(response.status).toBe(403)
    expect(predictor).not.toHaveBeenCalled()
  })
})

describe("deal prediction record access", () => {
  it("rejects a role without deals:read before module/record/provider work", async () => {
    withRole("ticketing")

    const response = await dealPredictionGET(request("/api/v1/analytics/deal-prediction?dealId=deal-1"))

    expect(response.status).toBe(403)
    expect(getOrgModuleContext).not.toHaveBeenCalled()
    expect(applyRecordFilter).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(predictDealWin).not.toHaveBeenCalled()
  })

  it("requires Analytics as well as Sales before record/provider work", async () => {
    setModules({ sales: true, analytics: false })

    const response = await dealPredictionGET(request("/api/v1/analytics/deal-prediction?dealId=deal-1"))

    expect(response.status).toBe(403)
    expect(applyRecordFilter).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(predictDealWin).not.toHaveBeenCalled()
  })

  it("uses canonical sharing and hides an inaccessible deal before prediction", async () => {
    withRole("sales", "sales-1")
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null)

    const response = await dealPredictionGET(request("/api/v1/analytics/deal-prediction?dealId=deal-1"))

    expect(response.status).toBe(404)
    expect(applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "sales-1",
      "sales",
      "deal",
      { id: "deal-1", organizationId: "org-1" },
    )
    expect(prisma.deal.findFirst).toHaveBeenCalledWith({
      where: {
        id: "deal-1",
        organizationId: "org-1",
        OR: [{ assignedTo: "visible-user" }],
      },
      select: { id: true },
    })
    expect(predictDealWin).not.toHaveBeenCalled()
  })

  it("predicts only the deal confirmed visible by the sharing query", async () => {
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ id: "visible-deal" } as never)
    vi.mocked(predictDealWin).mockResolvedValue({
      winProbability: 71,
      expectedCloseDate: null,
      riskFactors: [],
      positiveFactors: [],
      confidence: 80,
    })

    const response = await dealPredictionGET(request("/api/v1/analytics/deal-prediction?dealId=deal-1"))

    expect(response.status).toBe(200)
    expect(predictDealWin).toHaveBeenCalledWith("visible-deal", "org-1")
  })
})

describe("deal AI suggestions record access", () => {
  it("rejects a role without deals:read before module/DB/budget/provider work", async () => {
    withRole("ticketing")

    const response = await dealSuggestionsGET(request("/api/v1/deals/ai-suggestions?dealId=deal-1"))

    expect(response.status).toBe(403)
    expect(getOrgModuleContext).not.toHaveBeenCalled()
    expect(applyRecordFilter).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(checkAiBudget).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })

  it("rejects a disabled Sales module before record/budget/provider work", async () => {
    setModules({ sales: false, analytics: true })

    const response = await dealSuggestionsGET(request("/api/v1/deals/ai-suggestions?dealId=deal-1"))

    expect(response.status).toBe(403)
    expect(applyRecordFilter).not.toHaveBeenCalled()
    expect(prisma.deal.findFirst).not.toHaveBeenCalled()
    expect(checkAiBudget).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })

  it("hides an inaccessible deal before budget and provider work", async () => {
    withRole("sales", "sales-1")
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null)

    const response = await dealSuggestionsGET(request("/api/v1/deals/ai-suggestions?dealId=deal-1"))

    expect(response.status).toBe(404)
    expect(applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "sales-1",
      "sales",
      "deal",
      { id: "deal-1", organizationId: "org-1" },
    )
    expect(checkAiBudget).not.toHaveBeenCalled()
    expect(predictDealWin).not.toHaveBeenCalled()
    expect(getAnthropicClient).not.toHaveBeenCalled()
  })
})
