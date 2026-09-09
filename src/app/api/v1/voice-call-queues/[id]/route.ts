import { prisma } from "@/lib/prisma"
import {
  evaluateVoiceQueueFeature,
  getVoiceQueue,
} from "@/lib/voice-agent/queue-service"
import { NextRequest } from "next/server"
import { z } from "zod"

import {
  privateJson,
  publicQueue,
  publicQueueItem,
  resolveQueueOwner,
  voiceQueueErrorResponse,
  withVoiceQueueReadAuth,
} from "../_shared"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

const querySchema = z.object({
  ownerUserId: z.string().trim().min(1).max(200).optional(),
}).strict()

export const GET = withVoiceQueueReadAuth<RouteContext>(async (request: NextRequest, auth, { params }) => {
  const { id } = await params
  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    ownerUserId: url.searchParams.get("ownerUserId") || undefined,
  })
  if (!parsed.success) {
    return privateJson({ error: "Invalid request" }, { status: 400 })
  }

  const owner = resolveQueueOwner(auth, parsed.data.ownerUserId)
  if (!owner.ok) return owner.response

  try {
    const [queue, feature] = await Promise.all([
      getVoiceQueue({
        db: prisma,
        auth,
        ownerUserId: owner.ownerUserId,
        queueId: id,
      }),
      evaluateVoiceQueueFeature({ db: prisma, organizationId: auth.orgId }),
    ])
    return privateJson({
      success: true,
      data: {
        queue: publicQueue(queue),
        items: (queue.items ?? []).flatMap((item) => publicQueueItem(item) ?? []),
        blockers: feature.blocker ? [feature.blocker] : [],
      },
    })
  } catch (error) {
    return voiceQueueErrorResponse(error)
  }
})
