import { NextResponse } from "next/server"
import { z } from "zod"
import { createWhatsAppTemplateInMeta, listApprovedTemplates, syncTemplatesFromMeta } from "@/lib/whatsapp"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

const createTemplateSchema = z.object({
  action: z.literal("create").optional(),
  name: z.string().min(1).max(512),
  language: z.string().min(2).max(20).default("az"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).default("MARKETING"),
  bodyText: z.string().min(1).max(1024),
  footerText: z.string().max(60).optional().nullable(),
  sampleValues: z.array(z.string().max(100)).max(20).optional(),
})

// GET /api/v1/whatsapp/templates
// Query: status=APPROVED|PENDING|REJECTED|all (default "all" for admin UI,
//        "APPROVED" when called from Lead detail picker)
//        language=en|ru|az (optional)
//        category=MARKETING|UTILITY|AUTHENTICATION (optional)
export const GET = withRls(async (req, { orgId }) => {

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status") || "all"
  const language = searchParams.get("language") || undefined
  const category = searchParams.get("category") || undefined

  // Summary of the channel config for the admin UI — stale sync/validate
  // timestamps are useful to spot tenants that haven't pulled Meta changes.
  const cfg = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: {
      accessToken: true, apiKey: true,
      phoneNumberId: true, phoneNumber: true,
      displayName: true,
      lastValidatedAt: true, lastTemplateSyncAt: true,
    },
  })
  const meta = {
    hasConfig: !!(cfg && (cfg.accessToken || cfg.apiKey) && (cfg.phoneNumberId || cfg.phoneNumber)),
    phoneNumberId: cfg?.phoneNumberId || cfg?.phoneNumber || null,
    displayName: cfg?.displayName || null,
    lastValidatedAt: cfg?.lastValidatedAt?.toISOString() || null,
    lastTemplateSyncAt: cfg?.lastTemplateSyncAt?.toISOString() || null,
  }

  if (status === "APPROVED") {
    const data = await listApprovedTemplates(orgId, { language, category })
    return NextResponse.json({ success: true, data, meta })
  }

  const data = await prisma.whatsAppTemplate.findMany({
    where: {
      organizationId: orgId,
      ...(status !== "all" ? { status } : {}),
      ...(language ? { language } : {}),
      ...(category ? { category } : {}),
    },
    orderBy: [{ status: "asc" }, { category: "asc" }, { name: "asc" }],
  })
  return NextResponse.json({ success: true, data, meta })
})

// POST /api/v1/whatsapp/templates
// No body: sync templates from Meta.
// Body { action: "create", ... }: submit a new template to Meta for approval.
export const POST = withRls(async (req, { orgId }) => {
  const raw = await req.text()
  if (raw.trim()) {
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ success: false, error: "Malformed JSON body" }, { status: 400 })
    }

    const parsed = createTemplateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid template payload" },
        { status: 400 },
      )
    }

    const result = await createWhatsAppTemplateInMeta(orgId, parsed.data)
    return NextResponse.json(result, { status: result.success ? 201 : 502 })
  }

  const result = await syncTemplatesFromMeta(orgId)
  return NextResponse.json(result, { status: result.success ? 200 : 502 })
})
