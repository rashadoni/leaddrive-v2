import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { WhatsAppSignupWindow } from "@/components/channels/whatsapp-signup-window"
import { whatsappPlatformApp } from "@/lib/whatsapp-embedded-signup"
import { isSignupReturnOrigin } from "@/lib/whatsapp-signup-window"

// Reads the Embedded Signup configuration from the environment on every request.
export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("whatsappSignupWindow")
  return { title: t("title"), robots: { index: false, follow: false } }
}

/**
 * WhatsApp Embedded Signup window on the app host, opened by a tenant's channel catalog
 * (lib/whatsapp-signup-window). Public: it holds no session and calls no API — only Meta's dialog —
 * and hands the result back to the opening tab's origin, which must be the app host or a tenant subdomain.
 */
export default async function WhatsAppSignupWindowPage({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string | string[] }>
}) {
  const [t, params] = await Promise.all([getTranslations("whatsappSignupWindow"), searchParams])
  const origin = typeof params.origin === "string" ? params.origin : null
  const app = whatsappPlatformApp()

  return (
    <WhatsAppSignupWindow
      config={app ? { appId: app.appId, configId: app.configId } : null}
      returnOrigin={isSignupReturnOrigin(origin) ? origin : null}
      labels={{
        title: t("title"),
        description: t("description"),
        button: t("button"),
        working: t("working"),
        done: t("done"),
        cancelled: t("cancelled"),
        failed: t("failed"),
        notFromCatalog: t("notFromCatalog"),
        notConfigured: t("notConfigured"),
      }}
    />
  )
}
