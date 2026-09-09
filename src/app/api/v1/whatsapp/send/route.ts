import { NextResponse } from "next/server"
import { z } from "zod"
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp"
import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"
import { withRls } from "@/lib/with-rls"

const sendSchema = z.object({
  to: z.string().min(1, "Phone number is required"),
  message: z.string().optional(),
  templateName: z.string().optional(),
  languageCode: z.string().optional(),
  variables: z.union([
    z.array(z.string()),
    z.record(z.string(), z.string()),
  ]).optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
})

export const POST = withRls(async (req, { orgId }) => {
  const body = await req.json()
  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { to, message, templateName, languageCode, variables, contactId: rawContactId, leadId: rawLeadId } = parsed.data
  // Drop any lead/contact id that isn't in this org (forged/cross-tenant ref guard).
  const { contactId, leadId } = await sanitizeOwnedRefs(orgId, { contactId: rawContactId, leadId: rawLeadId })

  if (templateName) {
    const result = await sendWhatsAppTemplate({
      to,
      templateName,
      languageCode,
      variables,
      organizationId: orgId,
      contactId,
      leadId,
    })
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  }

  if (!message) {
    return NextResponse.json({ error: "Message or templateName is required" }, { status: 400 })
  }

  const result = await sendWhatsAppMessage({
    to,
    message,
    organizationId: orgId,
    contactId,
    leadId,
  })

  return NextResponse.json(result, { status: result.success ? 200 : 400 })
})
