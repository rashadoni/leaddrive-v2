"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

export function TaskMeetingNotice({ taskId, orgId: targetOrgId, blocked = false, onNavigate }: {
  taskId: string; orgId?: string; blocked?: boolean; onNavigate?: () => void
}) {
  const t = useTranslations("booking")
  const { data: session } = useSession()
  const orgId = targetOrgId ?? session?.user?.organizationId
  const userId = session?.user?.id
  const key = `${orgId ?? ""}:${userId ?? ""}:${taskId}`
  const [reference, setReference] = useState<{ key: string; data: { bookingId: string | null } | null; failed: boolean } | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!orgId || !userId || !taskId) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/v1/bookings/task-link?taskId=${encodeURIComponent(taskId)}`, {
          headers: { "x-organization-id": orgId }, cache: "no-store", signal: controller.signal,
        })
        const body = await response.json()
        if (!controller.signal.aborted) setReference({ key, data: response.ok && body.success ? body.data : null, failed: !response.ok && response.status !== 403 && response.status !== 404 })
      } catch {
        if (!controller.signal.aborted) setReference({ key, data: null, failed: true })
      }
    })()
    return () => controller.abort()
  }, [orgId, userId, taskId, key, revision, blocked])

  const current = reference?.key === key ? reference : null
  if (!current?.data && !blocked) return null
  const id = current?.data?.bookingId
  return <div role="status" className="mb-3 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
    <p>{t("taskManagedNotice")}</p>
    {current?.data ? <Button asChild variant="outline" className="min-h-11">
      <Link href={id ? `/meetings?booking=${encodeURIComponent(id)}` : "/meetings"} onClick={onNavigate}>
        {t(id ? "taskOpenMeeting" : "taskOpenMeetings")}
      </Link>
    </Button> : <p className="text-muted-foreground">{t("taskManagedAccessHint")}</p>}
    {blocked && current?.failed ? <Button type="button" variant="outline" className="min-h-11" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button> : null}
  </div>
}
