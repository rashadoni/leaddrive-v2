import { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import twilio from "twilio"
import { prisma } from "@/lib/prisma"
import { trackContactEvent } from "@/lib/contact-events"
import { executeWorkflows } from "@/lib/workflow-engine"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call"
import { normalizeVoipSettings } from "@/lib/voip/configs"

function publicCallbackUrl(req: NextRequest): string {
  const base = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/u, "")
  return base
    ? `${base}${req.nextUrl.pathname}${req.nextUrl.search}`
    : req.url
}

function terminalHumanOutcome(status: string): {
  wasAnswered: boolean
  providerOutcome: "connected" | "no_answer" | "busy" | "failed" | "cancelled"
} | null {
  switch (status) {
    case "completed":
      return { wasAnswered: true, providerOutcome: "connected" }
    case "no-answer":
      return { wasAnswered: false, providerOutcome: "no_answer" }
    case "busy":
      return { wasAnswered: false, providerOutcome: "busy" }
    case "failed":
      return { wasAnswered: false, providerOutcome: "failed" }
    case "canceled":
      return { wasAnswered: false, providerOutcome: "cancelled" }
    default:
      return null
  }
}

// POST — Twilio status callback (public endpoint, no auth required)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const formParams = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : value.name,
      ]),
    )
    const callSid = formData.get("CallSid") as string
    const status = formData.get("CallStatus") as string
    const duration = formData.get("CallDuration") as string | null
    const recordingUrl = formData.get("RecordingUrl") as string | null

    if (!callSid) {
      return new Response("Missing CallSid", { status: 400 })
    }

    // RLS: this lookup IS the org resolution (Twilio CallSid is an external identifier) → bypass scope.
    const callLog = await runWithRlsBypass(() => prisma.callLog.findFirst({
      where: { callSid, provider: "twilio", callMode: { not: "ai" } },
    }))
    if (!callLog) {
      return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })
    }

    const channelConfig = callLog.channelConfigId
      ? await runWithRlsBypass(() => prisma.channelConfig.findFirst({
          where: {
            id: callLog.channelConfigId as string,
            organizationId: callLog.organizationId,
            channelType: "voip",
          },
          select: {
            id: true,
            configName: true,
            phoneNumber: true,
            apiKey: true,
            settings: true,
            isActive: true,
          },
        }))
      : null
    const twilioSettings = channelConfig ? normalizeVoipSettings(channelConfig) : null
    const signature = req.headers.get("x-twilio-signature")?.trim() || ""
    if (
      twilioSettings?.provider !== "twilio"
      || !signature
      || !twilio.validateRequest(
        twilioSettings.authToken,
        signature,
        publicCallbackUrl(req),
        formParams,
      )
    ) {
      return new Response("Forbidden", { status: 403 })
    }

    // RLS: org resolved — ALL remaining handler work runs tenant-scoped.
    return await runWithTenant(callLog.organizationId, async () => {

    const externalNumber = callLog.direction === "outbound"
      ? callLog.toNumber
      : callLog.direction === "inbound"
        ? callLog.fromNumber
        : null
    const targetPhoneE164 = externalNumber
      ? normalizeManualLeadPhone(externalNumber)?.e164 ?? null
      : null
    const updateData: Prisma.CallLogUncheckedUpdateInput = {
      status,
      ...(targetPhoneE164 ? { targetPhoneE164 } : {}),
    }
    if (duration) updateData.duration = parseInt(duration)
    if (recordingUrl) updateData.recordingUrl = recordingUrl

    const terminalStatuses = ["completed", "busy", "no-answer", "failed", "canceled"]
    if (terminalStatuses.includes(status)) {
      updateData.endedAt = new Date()
      const outcome = terminalHumanOutcome(status)
      if (outcome) {
        updateData.wasAnswered = outcome.wasAnswered
        updateData.providerOutcome = outcome.providerOutcome
      }

      // Auto-create Activity record
      try {
        const activity = await prisma.activity.create({
          data: {
            organizationId: callLog.organizationId,
            type: "call",
            subject: `${callLog.direction === "outbound" ? "Outbound" : "Inbound"} call (${duration || 0}s)`,
            description: `Call to ${callLog.toNumber}. Status: ${status}. Duration: ${duration || 0}s`,
            contactId: callLog.contactId,
            companyId: callLog.companyId,
            createdBy: callLog.userId,
            completedAt: new Date(),
          },
        })
        updateData.activityId = activity.id
      } catch { /* ignore activity creation errors */ }

      // Track contact event
      if (callLog.contactId) {
        trackContactEvent(callLog.organizationId, callLog.contactId, "call_logged", {
          direction: callLog.direction,
          duration: duration ? parseInt(duration) : 0,
          status,
        }).catch(() => {})
      }
    }

    await prisma.callLog.update({ where: { id: callLog.id }, data: updateData })

    // Fire missed-call workflow trigger (e.g. auto-SMS to caller).
    // Only for inbound calls that weren't answered.
    if (status === "no-answer" && callLog.direction === "inbound") {
      const updated = await prisma.callLog.findUnique({ where: { id: callLog.id } })
      if (updated) {
        executeWorkflows(callLog.organizationId, "call", "missed", {
          id: updated.id,
          direction: updated.direction,
          fromNumber: updated.fromNumber,
          toNumber: updated.toNumber,
          phone: updated.fromNumber, // alias so send_sms picks it up
          contactId: updated.contactId,
          status: updated.status,
          duration: updated.duration,
        }).catch(err => console.error("[call.missed workflow]", err))
      }
    }

    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })

    }) // end runWithTenant (tenant-scoped handler body)
  } catch (e) {
    console.error("Call webhook error:", e)
    return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } })
  }
}
