import { NextResponse } from "next/server"
import { z } from "zod"
import { withRls } from "@/lib/with-rls"
import { sendWhatsAppMessage } from "@/lib/whatsapp"

const testSchema = z.object({
  to: z.string().min(1, "Phone number is required"),
  // Cold test sends must use a pre-approved Meta template. Meta's sample
  // `hello_world` template (language `en_US`) is auto-created for every
  // new WABA and is a safe universal default. Tenants can override via
  // the body to test one of their own approved templates.
  templateName: z.string().default("hello_world"),
  languageCode: z.string().default("en_US"),
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = testSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const result = await sendWhatsAppMessage({
    to: parsed.data.to,
    message: `[template:${parsed.data.templateName}]`,
    templateName: parsed.data.templateName,
    templateLanguage: parsed.data.languageCode,
    organizationId: orgId,
  })

  return NextResponse.json(result, { status: result.success ? 200 : 400 })
})
