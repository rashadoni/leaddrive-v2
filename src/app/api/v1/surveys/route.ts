import { NextResponse } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("campaigns", "read", async (_req, auth) => {
  const orgId = auth.orgId

  const surveys = await prisma.survey.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
  })

  // Attach aggregate NPS score per survey
  type R = { category: string | null; score: number | null }
  const enriched = await Promise.all(
    surveys.map(async (s: { id: string }) => {
      const responses = await prisma.surveyResponse.findMany({
        where: { surveyId: s.id },
        select: { category: true, score: true },
      })
      const promoters = responses.filter((r: R) => r.category === "promoter").length
      const detractors = responses.filter((r: R) => r.category === "detractor").length
      const total = responses.length
      const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null
      const avgScore =
        total > 0
          ? Math.round(
              (responses.reduce((sum: number, r: R) => sum + (r.score ?? 0), 0) / total) * 10,
            ) / 10
          : null
      return { ...s, stats: { total, promoters, detractors, nps, avgScore } }
    }),
  )

  return NextResponse.json({ success: true, data: { surveys: enriched } })
})

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(["nps", "csat", "ces", "custom"]).default("nps"),
  thankYouText: z.string().max(500).optional(),
  questions: z.array(z.any()).optional(),
  channels: z.array(z.enum(["email", "sms", "link"])).optional(),
  triggers: z.record(z.string(), z.any()).optional(),
})

export const POST = withRlsAuth("campaigns", "write", async (req, auth) => {
  const orgId = auth.orgId

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const defaultQuestions =
    parsed.data.type === "nps"
      ? [{ id: "score", type: "nps", label: "How likely are you to recommend us?" }]
      : parsed.data.type === "csat"
        ? [{ id: "score", type: "rating", label: "How satisfied are you?", max: 5 }]
        : parsed.data.type === "ces"
          ? [{ id: "score", type: "rating", label: "How easy was it?", max: 7 }]
          : []

  const survey = await prisma.survey.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      type: parsed.data.type,
      thankYouText: parsed.data.thankYouText || "Thank you for your feedback!",
      questions: parsed.data.questions && parsed.data.questions.length ? parsed.data.questions : defaultQuestions,
      channels: parsed.data.channels || [],
      triggers: parsed.data.triggers || {},
      publicSlug: "sv_" + randomBytes(6).toString("hex"),
    },
  })
  logAudit(orgId, "create", "survey", survey.id, survey.name)
  return NextResponse.json({ success: true, data: survey }, { status: 201 })
})
