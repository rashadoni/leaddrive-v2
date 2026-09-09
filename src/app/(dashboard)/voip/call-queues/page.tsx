"use client"

import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { VoiceCallQueueList } from "@/components/voice-call-queues/voice-call-queue-list"

export default function VoiceCallQueueListPage() {
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const ownerUserId = searchParams?.get("ownerUserId")?.trim() || session?.user?.id || undefined

  return (
    <VoiceCallQueueList
      ownerUserId={ownerUserId}
      organizationId={session?.user?.organizationId}
    />
  )
}
