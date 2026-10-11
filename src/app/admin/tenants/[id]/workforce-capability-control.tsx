"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { CapabilityRow } from "./tenant-capabilities-panel"

interface Props {
  tenantId: string
  label: string
  pages: string
  refreshRevision: number
  disabled?: boolean
  onBusyChange: (busy: boolean) => void
}

export function WorkforceCapabilityControl(props: Props) {
  return <WorkforceCapabilityState key={props.tenantId} {...props} />
}

function WorkforceCapabilityState({ tenantId, label, pages, refreshRevision, disabled, onBusyChange }: Props) {
  const t = useTranslations("admin.tenants")
  const [capability, setCapability] = useState<CapabilityRow | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(false)
    setSaved(false)
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/capabilities`, { signal })
      const body = await res.json()
      if (!mounted.current || signal?.aborted) return
      const row = Array.isArray(body.data?.capabilities)
        ? body.data.capabilities.find((item: CapabilityRow) => item.id === "workforce-hrm")
        : undefined
      if (!res.ok || !row || typeof row.enabled !== "boolean") throw new Error("Capability state unavailable")
      setCapability(row)
    } catch {
      if (mounted.current && !signal?.aborted) { setCapability(null); setError(true) }
    } finally {
      if (!signal?.aborted) {
        inFlight.current = false
        if (mounted.current) setBusy(false)
      }
    }
  }, [tenantId])

  useEffect(() => {
    mounted.current = true
    const ac = new AbortController()
    load(ac.signal)
    return () => { mounted.current = false; inFlight.current = false; ac.abort() }
  }, [load, refreshRevision])

  async function change(enabled: boolean) {
    if (inFlight.current || disabled || !capability) return
    inFlight.current = true
    setBusy(true)
    setError(false)
    setSaved(false)
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/capabilities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: "workforce-hrm", action: enabled ? "approve" : "disable" }),
      })
      const body = await res.json()
      if (!mounted.current) return
      const row = Array.isArray(body.data?.capabilities)
        ? body.data.capabilities.find((item: CapabilityRow) => item.id === "workforce-hrm")
        : undefined
      if (!res.ok || !row || typeof row.enabled !== "boolean") throw new Error("Capability change failed")
      setCapability(row)
      setSaved(true)
    } catch {
      // A dropped response may follow a committed PATCH. Read the canonical
      // state before allowing another write; never invent an optimistic grant.
      if (mounted.current) { setCapability(null); setError(true) }
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div data-tenant-capability="workforce-hrm" className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{pages}</p>
        <p className="text-xs text-muted-foreground">{t("workforceControlHint")}</p>
        <p className="text-xs" role="status" aria-live="polite">
          {busy ? t("workforceLoading") : error ? null : capability ? t(capability.enabled ? "workforceEnabled" : "workforceDisabled") : null}
          {saved ? ` · ${t("saved")}` : null}
        </p>
        {error ? (
          <div role="alert" className="space-y-1 text-xs text-destructive">
            <p>{t("workforceControlError")}</p>
            <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => load()}>{t("workforceRetry")}</Button>
          </div>
        ) : null}
      </div>
      <Switch
        aria-label={label}
        checked={capability?.enabled ?? false}
        disabled={busy || disabled || !capability}
        onCheckedChange={change}
      />
    </div>
  )
}
