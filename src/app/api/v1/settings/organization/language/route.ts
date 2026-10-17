import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { locales } from "@/i18n/routing"
import { organizationLocale } from "@/lib/ticketing/customer-locale"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"

/**
 * The organization's language — what customers are written to in when nothing
 * more specific is known about them: the website chat, ticket notices,
 * renewal e-mails (`organizationLocale` in src/lib/ticketing/customer-locale.ts).
 * Stored as `Organization.settings.language`.
 *
 * Owner, 2026-10-17: one setting, in Settings → Organization, called
 * «Язык общения с клиентами». It used to be the «Язык брифинга» select of the
 * AI-delivery card, where no admin looking for the chat's language would find
 * it; that select is gone (briefings go out in each employee's own language
 * and use this one only as a fallback). Changing it stays admin-only, as it
 * was on /api/v1/settings/ai-delivery.
 */

const MAX_BODY_BYTES = 1024

const patchSchema = z.object({ language: z.enum(locales) }).strict()

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

export const GET = withRlsSessionAuth(async (_req, auth) => {
  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  return NextResponse.json({
    data: { language: organizationLocale(org?.settings), canEdit: isAdmin(auth.role) },
  })
})

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await readJsonRequestWithinLimit(req, MAX_BODY_BYTES)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = patchSchema.safeParse(body.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })

  const org = await prisma.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
  const current = settingsRecord(org?.settings)
  const settings = { ...current, language: parsed.data.language }

  await prisma.organization.update({ where: { id: auth.orgId }, data: { settings } })

  await logAudit(
    auth.orgId,
    "organization_language_updated",
    "organization",
    auth.orgId,
    "Customer language",
    {
      userId: auth.userId,
      oldValue: { language: organizationLocale(current) },
      newValue: { language: parsed.data.language },
    },
  )

  return NextResponse.json({ data: { language: organizationLocale(settings), canEdit: true } })
})
