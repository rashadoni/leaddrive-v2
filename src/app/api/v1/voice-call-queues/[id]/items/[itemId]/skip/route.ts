import { prisma } from "@/lib/prisma"
import { skipVoiceQueueItem } from "@/lib/voice-agent/queue-service"
import { NextRequest } from "next/server"
import { z } from "zod"

import {
  privateJson,
  publicQueue,
  publicQueueItem,
  resolveQueueOwner,
  voiceQueueErrorResponse,
  withVoiceQueueMutationAuth,
} from "../../../../_shared"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

const skipSchema = z.object({
  ownerUserId: z.string().trim().min(1).max(200).optional(),
  reason: z.enum(["seller_skipped", "duplicate_lead", "not_relevant", "other"]),
}).strict()

export const POST = withVoiceQueueMutationAuth<RouteContext>(async (
  request: NextRequest,
  auth,
  { params },
) => {
  const body = await request.json().catch(() => null)
  const parsed = skipSchema.safeParse(body)
  if (!parsed.success) {
    return privateJson({ error: "Invalid request" }, { status: 400 })
  }
  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response
  const { id, itemId } = await params

  try {
    const result = await skipVoiceQueueItem({
      db: prisma,
      auth,
      ownerUserId: owner.ownerUserId,
      queueId: id,
      itemId,
      reason: parsed.data.reason,
    })
    const item = result.items?.find((candidate) => candidate.id === itemId) ?? null
    return privateJson({
      success: true,
      data: {
        queue: publicQueue(result),
        item: publicQueueItem(item),
      },
    })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})
