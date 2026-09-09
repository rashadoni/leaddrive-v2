import { prisma } from "@/lib/prisma"
import {
  previewSelectedVoiceQueue,
  VOICE_QUEUE_MAX_SELECTED_LEADS,
} from "@/lib/voice-agent/queue-service"
import { z } from "zod"

import {
  privateJson,
  resolveQueueOwner,
  voiceQueueErrorResponse,
  withVoiceQueueReadAuth,
} from "../_shared"

export const dynamic = "force-dynamic"

const previewSchema = z.object({
  leadIds: z.array(z.string().trim().min(1).max(200))
    .min(1)
    .max(VOICE_QUEUE_MAX_SELECTED_LEADS)
    .refine((values) => new Set(values).size === values.length, "Duplicate lead IDs are not allowed"),
  ownerUserId: z.string().trim().min(1).max(200).optional(),
}).strict()

export const POST = withVoiceQueueReadAuth(async (request, auth) => {
  const body = await request.json().catch(() => null)
  const parsed = previewSchema.safeParse(body)
  if (!parsed.success) {
    return privateJson(
      { error: "Invalid request", code: "invalid_selection" },
      { status: 400 },
    )
  }

  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response

  try {
    const preview = await previewSelectedVoiceQueue({
      db: prisma,
      auth,
      ownerUserId: owner.ownerUserId,
      leadIds: parsed.data.leadIds,
    })
    const eligible = preview.items
      .filter((item) => item.eligible)
      .map((item, position) => ({ leadId: item.leadId, position: position + 1 }))
    const excluded = preview.items.flatMap((item) => {
      if (item.eligible) return []
      const code = item.blockers[0]
      return code ? [{ leadId: item.leadId, code }] : []
    })
    const grouped = new Map<string, number>()
    for (const item of excluded) grouped.set(item.code, (grouped.get(item.code) ?? 0) + 1)

    return privateJson({
      success: true,
      data: {
        ownerUserId: preview.ownerUserId,
        requestedCount: preview.total,
        eligible,
        excluded,
        excludedGroups: Array.from(grouped, ([code, count]) => ({ code, count })),
        blockers: preview.blocker ? [preview.blocker] : [],
      },
    })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})
