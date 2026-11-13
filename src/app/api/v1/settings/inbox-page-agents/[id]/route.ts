import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { AI_SCHEDULES } from "@/lib/inbox/page-agent"
import { updatePageAgent } from "@/lib/inbox/page-agent-settings"

const MAX_BODY_BYTES = 64 * 1024

const agentSchema = z.object({
  systemPrompt: z.string().max(20000),
  knowledgeBase: z.string().max(20000),
  greeting: z.string().max(1000),
  replyLanguage: z.enum(["az", "ru", "en"]).nullable(),
}).strict()

const bodySchema = z.object({
  agent: agentSchema.nullable().optional(),
  aiOn: z.boolean().optional(),
  aiSchedule: z.enum(AI_SCHEDULES).optional(),
  hours: z.object({ timezone: z.string().min(1).max(64), schedule: z.record(z.string(), z.unknown()) }).strict().nullable().optional(),
}).strict()

/**
 * PUT /api/v1/settings/inbox-page-agents/<channelConfigId> — save one page's own agent, AI switch, AI
 * schedule and working hours. Only the keys sent are touched; `agent: null` and `hours: null`
 * return the page to the common agent / the platform's hours.
 */
export const PUT = withRlsSessionAuth(async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  if (!isAdmin(auth.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id } = await params
  const requestBody = await readJsonRequestWithinLimit(req, MAX_BODY_BYTES)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = bodySchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const result = await updatePageAgent({
    organizationId: auth.orgId, channelConfigId: id, userId: auth.userId ?? null, update: parsed.data,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  // What changed, never the text: rules and knowledge can hold prices and contacts.
  await logAudit(auth.orgId, "update", "inbox_page_agent", id, "Page AI agent", {
    newValue: {
      agent: parsed.data.agent === undefined ? undefined : parsed.data.agent === null ? "removed" : "saved",
      aiOn: parsed.data.aiOn,
      aiSchedule: parsed.data.aiSchedule,
      hours: parsed.data.hours === undefined ? undefined : parsed.data.hours === null ? "removed" : "saved",
    },
  }).catch(() => {})
  return NextResponse.json({ success: true })
})
