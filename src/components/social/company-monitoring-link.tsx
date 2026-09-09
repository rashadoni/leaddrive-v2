"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ExternalLink, Loader2, Radio } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"

type LinkedProfile = { id: string; name: string; status: string }
type PickerProfile = {
  id: string
  subjectId: string | null
  name: string
  status: string
  company: { id: string; name: string } | null
}

/**
 * «Взять на мониторинг» в карточке компании CRM.
 *
 * Блок молча не рендерится, если соцмониторинг тенанту недоступен: у роли
 * может не быть модуля вовсе, и показывать кнопку, ведущую в 403, нечестно.
 */
export function CompanyMonitoringLink({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations("companies.monitoring")
  const [linked, setLinked] = useState<LinkedProfile[] | null>(null)
  // Модуль недоступен (401/403) — блока быть не должно вовсе. Любая другая
  // ошибка временная, и прятать блок навсегда, не дав повторить, нечестно.
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [picking, setPicking] = useState(false)
  const [candidates, setCandidates] = useState<PickerProfile[] | null>(null)
  const [selected, setSelected] = useState<string>("")
  const [saving, setSaving] = useState(false)

  const loadLinked = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/social/monitoring-profiles?companyId=${encodeURIComponent(companyId)}`, {
      cache: "no-store",
      signal,
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      setUnavailable(true)
      return
    }
    if (!response.ok) {
      setLoadError(true)
      return
    }
    setLoadError(false)
    const payload = await response.json()
    setLinked(Array.isArray(payload?.data?.linked) ? payload.data.linked : [])
  }, [companyId])

  useEffect(() => {
    const controller = new AbortController()
    loadLinked(controller.signal).catch(error => {
      if (error instanceof Error && error.name === "AbortError") return
      setLoadError(true)
    })
    return () => controller.abort()
  }, [loadLinked])

  const openPicker = async () => {
    setPicking(true)
    if (candidates) return
    try {
      const response = await fetch("/api/v1/social/monitoring-profiles", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || !payload?.success) throw new Error("load_failed")
      setCandidates(
        (payload.data?.profiles ?? [])
          // Легаси-сценарий без объекта мониторинга привязывать не к чему.
          .filter((profile: PickerProfile) => Boolean(profile.subjectId))
          .map((profile: PickerProfile) => ({
            id: profile.id,
            subjectId: profile.subjectId,
            name: profile.name,
            status: profile.status,
            company: profile.company ?? null,
          })),
      )
    } catch {
      toast.error(t("loadFailed"))
      setPicking(false)
    }
  }

  const link = async (subjectId: string, reassign = false) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/social/monitoring-profiles/${subjectId}/company`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reassign ? { companyId, reassign: true } : { companyId }),
      })
      const payload = await response.json().catch(() => null)
      // Объект уже у другого клиента: подтверждаем передачу явно, иначе у той
      // карточки мониторинг просто исчезнет и никто об этом не узнает.
      if (response.status === 409 && payload?.error === "already_linked_to_other_company") {
        const owner = payload?.data?.company?.name ?? ""
        setSaving(false)
        if (!confirm(t("reassignConfirm", { company: owner }))) return
        await link(subjectId, true)
        return
      }
      if (!response.ok || !payload?.success) throw new Error(payload?.error ?? "link_failed")
      toast.success(t("linked"))
      setPicking(false)
      await loadLinked()
    } catch {
      toast.error(t("linkFailed"))
    } finally {
      setSaving(false)
    }
  }

  const unlink = async (subjectId: string) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/v1/social/monitoring-profiles/${subjectId}/company`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: null }),
      })
      if (!response.ok) throw new Error("unlink_failed")
      toast.success(t("unlinked"))
      await loadLinked()
    } catch {
      toast.error(t("linkFailed"))
    } finally {
      setSaving(false)
    }
  }

  if (unavailable) return null
  if (loadError) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <Radio className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{t("title")}</span>
          <span className="text-xs text-muted-foreground">{t("loadFailed")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 text-xs"
            onClick={() => { setLoadError(false); void loadLinked() }}
          >
            {t("retry")}
          </Button>
        </div>
      </div>
    )
  }
  if (linked === null) return null

  return (
    <div className="rounded-xl border border-zinc-200 bg-card p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold">{t("title")}</span>
        {linked.length > 0 && (
          <Badge
            variant={linked.some(profile => profile.status === "active") ? "success" : "outline"}
            className="text-[10px]"
          >
            {/* Бейдж обязан отражать реальное состояние: приостановленный или
                архивный мониторинг не должен читаться как работающий. */}
            {linked.some(profile => profile.status === "active") ? t("active") : t("inactive")}
          </Badge>
        )}
      </div>

      {linked.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {linked.map(profile => (
            <div key={profile.id} className="flex flex-wrap items-center gap-2">
              <a
                className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                href={`/social-monitoring?monitoringId=${encodeURIComponent(profile.id)}&subjectId=${encodeURIComponent(profile.id)}&subjectName=${encodeURIComponent(profile.name)}`}
              >
                {profile.name}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              {profile.status !== "active" && (
                <Badge variant="outline" className="text-[10px]">{t(`status.${profile.status}`)}</Badge>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 text-xs text-muted-foreground"
                disabled={saving}
                onClick={() => unlink(profile.id)}
              >
                {t("unlink")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {picking ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {candidates === null ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("loading")}
            </span>
          ) : (
            <>
              <Select
                className="h-11 w-full max-w-xs"
                value={selected}
                onChange={event => setSelected(event.target.value)}
                aria-label={t("pickPlaceholder")}
              >
                <option value="">{t("pickPlaceholder")}</option>
                {candidates.map(profile => (
                  <option key={profile.id} value={profile.subjectId ?? profile.id}>
                    {profile.company && profile.company.id !== companyId
                      ? `${profile.name} · ${t("ownedBy", { company: profile.company.name })}`
                      : profile.name}
                  </option>
                ))}
              </Select>
              <Button type="button" size="sm" className="h-11" disabled={!selected || saving} onClick={() => link(selected)}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("linkAction")}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-11" onClick={() => setPicking(false)}>
                {t("cancel")}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {linked.length === 0 && <p className="text-xs text-muted-foreground">{t("hint")}</p>}
          <Button type="button" variant="outline" size="sm" className="h-11 text-xs" onClick={openPicker}>
            {/* Связь намеренно не уникальна: у одной компании может быть
                несколько наблюдаемых брендов, персон и продуктов. */}
            {linked.length > 0 ? t("addAnother") : t("takeUnderMonitoring")}
          </Button>
          <a
            className="inline-flex min-h-11 items-center gap-1.5 text-xs text-primary hover:underline"
            href={`/social-monitoring?view=monitors&newMonitoringName=${encodeURIComponent(companyName)}`}
          >
            {t("createNew")}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      )}
    </div>
  )
}
