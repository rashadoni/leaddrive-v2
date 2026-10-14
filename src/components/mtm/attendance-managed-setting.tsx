"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MtmAttendanceDayKinds } from "@/components/mtm/attendance-day-kinds"
import { MtmAttendanceHrAccess } from "@/components/mtm/attendance-hr-access"
import { MtmAttendanceRequestLimits } from "@/components/mtm/attendance-request-limits"

/**
 * Settings that used to sit under the report and took the report's management
 * right. As tabs they read the same right from the rules endpoint, fresh on
 * every visit, so a demoted administrator never keeps an editable form.
 */
export function MtmAttendanceManagedSetting({ kind }: { kind: "day-kinds" | "access" | "requests" }) {
  const t = useTranslations("mtmAttendance")
  const [canManage, setCanManage] = useState<boolean | null>(null)
  const [denied, setDenied] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/v1/mtm/attendance/rules", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null)
        if (controller.signal.aborted) return
        if (!response.ok || body?.success !== true) { setDenied(true); setCanManage(false); return }
        setCanManage(body.data?.canManageRules === true)
      })
      .catch(() => { if (!controller.signal.aborted) { setDenied(true); setCanManage(false) } })
    return () => controller.abort()
  }, [])
  if (canManage === null) return <p role="status" className="text-sm text-muted-foreground">{t("reportLoading")}</p>
  const props = { canManage, accessUnavailable: denied, onAccessLost: () => { setDenied(true); setCanManage(false) } }
  if (kind === "day-kinds") return <MtmAttendanceDayKinds {...props} onSaved={() => undefined} />
  if (kind === "access") return <MtmAttendanceHrAccess {...props} />
  return <MtmAttendanceRequestLimits {...props} />
}
