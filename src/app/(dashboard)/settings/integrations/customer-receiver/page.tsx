"use client"

import { useSession } from "next-auth/react"
import { useLocale } from "next-intl"
import { ReceiverBuilder } from "@/components/settings/receiver-builder"
import { RECEIVER_COPY } from "@/components/settings/receiver-builder-copy"
import type { BuilderLocale } from "@/lib/integrations/customer-receiver/constructor/catalog"

export default function CustomerReceiverPage() {
  const { data: session, status } = useSession()
  const requestedLocale = useLocale()
  const locale: BuilderLocale = requestedLocale === "az" || requestedLocale === "ru" ? requestedLocale : "en"
  const copy = RECEIVER_COPY[locale]
  if (status === "loading") return <p role="status">{copy.load}</p>
  if (session?.user?.role !== "admin" && session?.user?.role !== "superadmin") return <p>{copy.forbidden}</p>
  return <ReceiverBuilder key={session.user.organizationId} locale={locale} />
}
