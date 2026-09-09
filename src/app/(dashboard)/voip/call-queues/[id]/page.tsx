"use client"

import { useParams, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { VoiceCallQueueWorkspace } from "@/components/voice-call-queues/voice-call-queue-workspace"

export default function VoiceCallQueueWorkspacePage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const queueId = typeof params?.id === "string" ? params.id : ""
  const ownerUserId = searchParams?.get("ownerUserId")?.trim() || undefined
  // A timed-out originate can create its channel after a read-only ARI 404.
  // Keep the release control hidden until PBX provider-finality/cancellation
  // proof exists; the API independently fails closed as well.
  const canResolveUncertain = false

  return (
    <VoiceCallQueueWorkspace
      key={`${queueId}:${ownerUserId ?? "self"}`}
      queueId={queueId}
      ownerUserId={ownerUserId}
      organizationId={session?.user?.organizationId}
      canResolveUncertain={canResolveUncertain}
    />
  )
}
