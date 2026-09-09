import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { socialMention: { findMany: vi.fn() } },
}))

import { GET } from "@/app/api/v1/social/sentiment-corrections/route"
import { prisma } from "@/lib/prisma"

const findMany = vi.mocked(prisma.socialMention.findMany)

function corrected(overrides: Record<string, unknown> = {}) {
  return {
    id: "m-1",
    platform: "facebook",
    text: "Allah rəhmət eləsin, məkanı cənnət olsun",
    sentiment: "neutral",
    contentKind: "COMMENT",
    url: "https://facebook.com/x",
    sourceMetadata: {
      socialTriage: {
        sentimentSource: "operator",
        sentimentBefore: "negative",
        sentimentAfter: "neutral",
        sentimentCorrectedAt: "2026-08-04T07:58:00.000Z",
        sentimentCorrectedBy: "user-1",
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * Отчёт отвечает на вопрос владельца «учится ли система»: обучения модели нет,
 * но правки — размеченный им набор, и число расхождений с текущими правилами
 * должно падать после каждой правки правил.
 */
describe("GET /api/v1/social/sentiment-corrections", () => {
  it("берёт только записи, помеченные правкой оператора", async () => {
    findMany.mockResolvedValue([] as never)

    const response = await GET(new NextRequest("http://localhost/api/v1/social/sentiment-corrections"))

    expect(response.status).toBe(200)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        purgedAt: null,
        sourceMetadata: { path: ["socialTriage", "sentimentSource"], equals: "operator" },
      }),
    }))
  })

  it("считает согласие правил с оператором и направление правок", async () => {
    // Соболезнование: правила теперь помечают его «не про риск», оператор снял
    // негатив — это согласие.
    findMany.mockResolvedValue([corrected()] as never)

    const payload = await (await GET(new NextRequest("http://localhost/api/v1/social/sentiment-corrections"))).json()

    expect(payload.data).toMatchObject({
      total: 1,
      byDirection: { "negative→neutral": 1 },
      classifier: { agrees: 1, disagrees: 0 },
    })
    expect(payload.data.disagreements).toEqual([])
  })

  it("расхождение показывает текстом — это готовая работа по правилам", async () => {
    findMany.mockResolvedValue([corrected({
      id: "m-2",
      // Явная претензия: правила держат негатив, а оператор его снял.
      text: "Arazda məhsulun vaxtı keçmişdi, xarab idi",
      sentiment: "neutral",
    })] as never)

    const payload = await (await GET(new NextRequest("http://localhost/api/v1/social/sentiment-corrections"))).json()

    expect(payload.data.classifier).toMatchObject({ agrees: 0, disagrees: 1 })
    expect(payload.data.disagreements[0]).toMatchObject({
      id: "m-2",
      operator: "neutral",
      classifier: "negative",
      evidence: "explicit_complaint",
    })
  })

  it("текст, который правила не берутся судить, в расхождения не пишет", async () => {
    findMany.mockResolvedValue([corrected({
      id: "m-3",
      // Осмысленный текст без явных признаков уходит на разбор ИИ.
      text: "Bu gün mağazada yeni kampaniya başladı deyirlər",
    })] as never)

    const payload = await (await GET(new NextRequest("http://localhost/api/v1/social/sentiment-corrections"))).json()

    expect(payload.data.classifier).toMatchObject({ agrees: 0, disagrees: 0, unknownToRules: 1 })
    expect(payload.data.disagreements).toEqual([])
  })
})
