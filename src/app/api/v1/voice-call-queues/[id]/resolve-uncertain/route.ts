import { isManagerOrAbove } from "@/lib/constants"
import { prisma } from "@/lib/prisma"
import { resolveUncertainVoiceQueueItem } from "@/lib/voice-agent/queue-service"
import { z } from "zod"

import {
  privateJson,
  publicQueue,
  resolveQueueOwner,
  voiceQueueErrorResponse,
  withVoiceQueueMutationAuth,
} from "../../_shared"

type RouteContext = { params: Promise<{ id: string }> }

const requestSchema = z.object({
  ownerUserId: z.string().trim().min(1).max(200).optional(),
  itemId: z.string().trim().min(1).max(200),
  resolution: z.literal("unknown_no_redial"),
  acknowledgeNoRedial: z.literal(true),
}).strict()

export const POST = withVoiceQueueMutationAuth<RouteContext>(async (request, auth, { params }) => {
  if (!isManagerOrAbove(auth.role)) {
    return privateJson({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return privateJson({ error: "Invalid request" }, { status: 400 })
  }
  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response
  const { id } = await params

  try {
    const queue = await resolveUncertainVoiceQueueItem({
      db: prisma,
      auth,
      ownerUserId: owner.ownerUserId,
      queueId: id,
      itemId: parsed.data.itemId,
      acknowledgeNoRedial: parsed.data.acknowledgeNoRedial,
    })
    return privateJson({
      success: true,
      data: { queue: publicQueue(queue) },
    })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})
