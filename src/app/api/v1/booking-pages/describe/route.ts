/**
 * «Write it for me» on the service form: POST → { description }.
 *
 * Nothing is saved here. The answer lands in the field the owner is editing and
 * is theirs to keep, change or delete before they press Save, which is why this
 * route writes no row of its own — only the usual AI interaction log, so the
 * call is visible in the organisation's AI spend like every other one.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { orgHasModule } from "@/lib/api-auth"
import { bookingAccess } from "@/lib/booking/access"
import { calculateAiCost, checkAiBudget } from "@/lib/ai/budget"
import { getAnthropicClient } from "@/lib/ai/anthropic-client"
import { cleanServiceDescription, serviceDescriptionPrompt } from "@/lib/booking/service-description"

const MODEL = "claude-haiku-4-5-20251001"

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480),
  locationType: z.enum(["office", "phone", "online"]),
  price: z.string().trim().max(20).optional().nullable(),
  currency: z.string().trim().max(8).optional().nullable(),
  current: z.string().trim().max(2000).optional().nullable(),
  locale: z.string().trim().max(8).optional().nullable(),
}).strict()

export const POST = withRlsAuth("bookings", "write", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access
  if (!access.administrator) return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
  if (!(await orgHasModule(auth.orgId, "ai"))) return NextResponse.json({ code: "AI_DISABLED" }, { status: 403 })
  // The form hides the button when the host has no key, but a second tab opened
  // before a restart would still ask: say so instead of answering with silence.
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ code: "AI_UNAVAILABLE" }, { status: 503 })

  const budget = await checkAiBudget(auth.orgId)
  if (!budget.allowed) return NextResponse.json({ code: "AI_BUDGET" }, { status: 429 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 })
  const input = parsed.data

  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: serviceDescriptionPrompt({
          title: input.title,
          category: input.category,
          durationMinutes: input.durationMinutes,
          locationType: input.locationType,
          price: input.price,
          currency: input.currency,
          current: input.current,
          locale: input.locale ?? "az",
        }),
      }],
    })
    const text = response.content[0]?.type === "text" ? response.content[0].text : ""
    const description = cleanServiceDescription(text)
    if (!description) return NextResponse.json({ code: "AI_EMPTY" }, { status: 502 })

    const promptTokens = response.usage?.input_tokens ?? 0
    const completionTokens = response.usage?.output_tokens ?? 0
    await prisma.aiInteractionLog.create({
      data: {
        organizationId: auth.orgId,
        userMessage: `booking service description: ${input.title.slice(0, 100)}`,
        aiResponse: description,
        promptTokens,
        completionTokens,
        costUsd: calculateAiCost(MODEL, promptTokens, completionTokens),
        model: MODEL,
        agentType: "booking_service_description",
        isCopilot: true,
      },
    }).catch(() => null)

    return NextResponse.json({ success: true, data: { description } })
  } catch (error) {
    console.error("[booking] service description failed", { code: "AI_FAILED", error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ code: "AI_FAILED" }, { status: 502 })
  }
})
