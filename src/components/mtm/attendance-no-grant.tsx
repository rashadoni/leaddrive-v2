"use client"

import { useTranslations } from "next-intl"

/**
 * Personnel for someone it is not open to: the attendance section is on and the
 * module is theirs, but they have neither the HR grant nor a manager's card
 * (lib/mtm/attendance-access.ts). Said in words — a bare «page not found» got a
 * manager made an administrator instead (Zeytun, 2026-11-20).
 */
export function MtmAttendanceNoGrant() {
  const t = useTranslations("personnel")
  return (
    <div className="mx-auto max-w-xl space-y-2 rounded-xl border bg-card p-6" data-testid="attendance-no-grant">
      <h1 className="text-lg font-semibold">{t("noGrantTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("noGrantBody")}</p>
    </div>
  )
}
