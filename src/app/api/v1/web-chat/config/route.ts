import { NextResponse } from "next/server"
import { z } from "zod"
import { randomBytes } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

export const GET = withRlsAuth("inbox", "read", async (_req, auth) => {
  const orgId = auth.orgId

  let widget = await prisma.webChatWidget.findUnique({ where: { organizationId: orgId } })
  if (!widget) {
    widget = await prisma.webChatWidget.create({
      data: {
        organizationId: orgId,
        publicKey: "wc_" + randomBytes(9).toString("hex"),
      },
    })
  }

  return NextResponse.json({ success: true, data: widget })
})

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().max(100).optional(),
  greeting: z.string().max(500).optional(),
  primaryColor: z.string().max(20).optional(),
  position: z.enum(["bottom-right", "bottom-left"]).optional(),
  showLauncher: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
  escalateToTicket: z.boolean().optional(),
  allowedOrigins: z.array(z.string()).optional(),
  offlineMessage: z.string().max(500).nullable().optional(),
  workingHours: z.record(z.string(), z.any()).nullable().optional(),
  // A2 — AI reply policy: draft-for-review + auto-send confidence threshold (null = send all).
  aiDraftMode: z.boolean().optional(),
  aiThreshold: z.number().min(0).max(1).nullable().optional(),
  // A3 — audience rollout: share of sessions the AI answers (null = everyone).
  aiRolloutPercent: z.number().int().min(0).max(100).nullable().optional(),
  preChatForm: z.object({
    name: z.object({ enabled: z.boolean(), required: z.boolean() }),
    email: z.object({ enabled: z.boolean(), required: z.boolean() }),
    phone: z.object({ enabled: z.boolean(), required: z.boolean() }),
  }).nullable().optional(),
  // Whelp-style widget options: master onboarding toggle (off = one-click anonymous start,
  // pre-chat fields skipped), history restore, extra "know your customer" questions.
  uiOptions: z.object({
    onboardingEnabled: z.boolean().optional(),
    historyEnabled: z.boolean().optional(),
    customQuestions: z.array(z.string().min(1).max(200)).max(10).optional(),
  }).nullable().optional(),
})

export const PUT = withRlsAuth("inbox", "write", async (req, auth) => {
  const orgId = auth.orgId

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  // required ⇒ enabled: a required-but-hidden pre-chat field would deadlock the form.
  const { uiOptions, ...rest } = parsed.data
  // Json? columns can't take a bare null — map it to DbNull (uiOptions: null = "all defaults").
  const data: typeof rest & { uiOptions?: typeof uiOptions | typeof Prisma.DbNull } = {
    ...rest,
    ...(uiOptions !== undefined ? { uiOptions: uiOptions === null ? Prisma.DbNull : uiOptions } : {}),
  }
  if (data.preChatForm) {
    data.preChatForm = Object.fromEntries(
      Object.entries(data.preChatForm).map(([field, cfg]) => [
        field,
        { enabled: cfg.required || cfg.enabled, required: cfg.required },
      ]),
    ) as typeof data.preChatForm
  }

  const widget = await prisma.webChatWidget.upsert({
    where: { organizationId: orgId },
    update: data,
    create: {
      organizationId: orgId,
      publicKey: "wc_" + randomBytes(9).toString("hex"),
      ...data,
    },
  })

  return NextResponse.json({ success: true, data: widget })
})

export const POST = withRlsAuth("inbox", "admin", async (_req, auth) => {
  // Regenerate public key
  const orgId = auth.orgId

  const widget = await prisma.webChatWidget.upsert({
    where: { organizationId: orgId },
    update: { publicKey: "wc_" + randomBytes(9).toString("hex") },
    create: {
      organizationId: orgId,
      publicKey: "wc_" + randomBytes(9).toString("hex"),
    },
  })
  return NextResponse.json({ success: true, data: widget })
})
