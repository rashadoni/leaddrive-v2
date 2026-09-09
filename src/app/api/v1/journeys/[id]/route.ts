import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"

const MAX_JOURNEY_STEPS = 100
const MAX_JOURNEY_WEBHOOKS = 10

const stepSchema = z.object({
  stepType: z.string(),
  stepOrder: z.number().int(),
  config: z.any().default({}),
  yesNextStepId: z.string().nullable().optional(),
  noNextStepId: z.string().nullable().optional(),
  splitPaths: z.any().nullable().optional(),
})

const updateJourneySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["draft", "active", "paused", "completed"]).optional(),
  triggerType: z.string().optional(),
  triggerConditions: z.any().optional(),
  segmentId: z.string().nullable().optional(),
  steps: z.array(stepSchema).max(MAX_JOURNEY_STEPS).optional(),
  // Goal tracking
  goalType: z.string().nullable().optional(),
  goalConditions: z.any().nullable().optional(),
  goalTarget: z.number().int().nullable().optional(),
  exitOnGoal: z.boolean().optional(),
  maxEnrollmentDays: z.number().int().nullable().optional(),
})

export const GET = withRlsAuth("journeys", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const journey = await prisma.journey.findFirst({
      where: { id, organizationId: orgId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    })
    if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: journey })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRlsAuth("journeys", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateJourneySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const { steps: rawSteps, ...journeyData } = parsed.data
  const steps = rawSteps ? [...rawSteps] : undefined
  if (steps) {
    const webhookTargets: Array<{ index: number; url: string }> = []
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]
      if (step.stepType !== "webhook") continue

      const config =
        step.config &&
        typeof step.config === "object" &&
        !Array.isArray(step.config)
          ? step.config as Record<string, unknown>
          : {}
      if (config.url === undefined || config.url === "") continue
      if (typeof config.url !== "string") {
        return NextResponse.json(
          { error: "Journey webhook URL must be a string" },
          { status: 400 },
        )
      }
      webhookTargets.push({ index, url: config.url })
    }

    if (webhookTargets.length > MAX_JOURNEY_WEBHOOKS) {
      return NextResponse.json(
        { error: `A journey can contain at most ${MAX_JOURNEY_WEBHOOKS} webhook steps` },
        { status: 400 },
      )
    }

    try {
      // Bound resolver pressure: Node DNS lookup is not reliably cancellable,
      // so validate this already-capped list sequentially instead of consuming
      // up to ten resolver workers for one request.
      for (const { index, url } of webhookTargets) {
        const target = await validateOutboundWebhookUrl(url)
        const step = steps[index]
        const config = step.config as Record<string, unknown>
        steps[index] = {
          ...step,
          config: { ...config, url: target.url.toString() },
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unsafe webhook URL"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  try {
    if (steps !== undefined) {
      // Parent update and destructive child replacement are one atomic unit.
      // A failed createMany must roll back deleteMany so a malformed/transient
      // write can never leave a live journey with all of its steps removed.
      const replaced = await prisma.$transaction(async (tx) => {
        const result = await tx.journey.updateMany({
          where: { id, organizationId: orgId },
          data: journeyData,
        })
        if (result.count === 0) return false

        await tx.journeyStep.deleteMany({ where: { journeyId: id } })
        if (steps.length > 0) {
          await tx.journeyStep.createMany({
            data: steps.map(s => ({
              journeyId: id,
              stepType: s.stepType,
              stepOrder: s.stepOrder,
              config: s.config || {},
              yesNextStepId: s.yesNextStepId || null,
              noNextStepId: s.noNextStepId || null,
              splitPaths: s.splitPaths || null,
            })),
          })
        }
        return true
      })
      if (!replaced) return NextResponse.json({ error: "Not found" }, { status: 404 })
    } else {
      const result = await prisma.journey.updateMany({
        where: { id, organizationId: orgId },
        data: journeyData,
      })
      if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.journey.findFirst({
      where: { id, organizationId: orgId },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("journeys", "delete", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const result = await prisma.journey.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
