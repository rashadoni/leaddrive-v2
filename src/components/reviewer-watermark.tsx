"use client"

import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { REVIEWER_ROLE } from "@/lib/reviewer-access"

/**
 * An outside reviewer sees their own name, e-mail and today's date across
 * every screen, so a screenshot of what they were shown names who took it.
 * Purely visual and non-interactive; nobody else gets it.
 */
export function ReviewerWatermark() {
  const { data: session } = useSession()
  const t = useTranslations("reviewerAccess")
  const locale = useLocale()
  const user = session?.user
  if (user?.role !== REVIEWER_ROLE) return null

  const label = t("watermark", {
    name: user.name ?? "",
    email: user.email ?? "",
    date: new Date().toLocaleDateString(locale),
  })
  return (
    <div
      aria-hidden="true"
      data-testid="reviewer-watermark"
      className="pointer-events-none fixed inset-0 z-[70] select-none overflow-hidden"
    >
      <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-20 opacity-[0.07]">
        {Array.from({ length: 120 }, (_, index) => (
          <span key={index} className="whitespace-nowrap text-sm font-semibold text-foreground">{label}</span>
        ))}
      </div>
    </div>
  )
}
