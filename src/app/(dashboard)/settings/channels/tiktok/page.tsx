import { Suspense } from "react"
import { TikTokNativeMessagingSettings } from "@/components/channels/tiktok-native-messaging-settings"

export default function TikTokMessagingPage() {
  return (
    <Suspense fallback={<div className="min-h-64 rounded-xl border bg-card" aria-busy="true" />}>
      <TikTokNativeMessagingSettings />
    </Suspense>
  )
}
