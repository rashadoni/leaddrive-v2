"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

type ProvisioningStep = {
  id: string
  stepKey: string
  status: string
  attempts: number
  output: unknown
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

type ProvisioningRun = {
  id: string
  version: number
  status: string
  summary: unknown
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  steps: ProvisioningStep[]
}

const STEP_LABELS: Record<string, string> = {
  module_contract: "Plan & modules",
  omnichannel_foundation: "Omni-channel",
  social_safety: "Outbound safety",
  brand_profile: "Brand & AI identity",
  provider_entitlements: "Search providers",
  readiness: "Readiness check",
}

function statusBadge(status: string) {
  if (status === "completed") return <Badge variant="success">Ready</Badge>
  if (status === "running") return <Badge variant="warning">Running</Badge>
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>
  if (status === "partial") return <Badge variant="warning">Needs attention</Badge>
  return <Badge variant="outline">{status.replaceAll("_", " ")}</Badge>
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === "failed") return <AlertCircle className="h-4 w-4 text-red-600" />
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />
}

export function TenantProvisioningPanel({ tenantId }: { tenantId: string }) {
  const [run, setRun] = useState<ProvisioningRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/tenants/${tenantId}/provisioning`, { signal })
      const body = await response.json().catch(() => ({}))
      if (response.status === 404) {
        setRun(null)
        return
      }
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setRun(body.data)
    } catch (loadError) {
      if ((loadError as Error).name !== "AbortError") {
        setError((loadError as Error).message || "Provisioning status failed to load")
      }
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const canRetry = run?.status === "failed" || run?.status === "partial"
  const completed = useMemo(
    () => run?.steps.filter((step) => step.status === "completed").length ?? 0,
    [run],
  )

  async function retry() {
    if (!run) return
    setRetrying(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/tenants/${tenantId}/provisioning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setRun(body.data)
    } catch (retryError) {
      setError((retryError as Error).message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Tenant readiness</h3>
            {run ? statusBadge(run.status) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Modules, brand identity, channels and provider access are initialized independently.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => load()} disabled={loading || retrying}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {canRetry ? (
            <Button type="button" size="sm" onClick={retry} disabled={retrying}>
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Retry failed steps
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      ) : error ? (
        <div className="m-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : !run ? (
        <div className="p-5 text-sm text-muted-foreground">
          This tenant predates Provisioning v2. Existing configuration was not changed.
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {run.steps.map((step) => (
              <div key={step.id} className="rounded-xl border bg-background p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <StepIcon status={step.status} />
                    <p className="truncate text-sm font-medium">{STEP_LABELS[step.stepKey] || step.stepKey}</p>
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground">try {step.attempts}</span>
                </div>
                <p className={`mt-2 text-xs ${step.error ? "text-red-600" : "text-muted-foreground"}`}>
                  {step.error || (step.status === "completed" ? "Initialized safely" : "Waiting to run")}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{completed} of {run.steps.length} steps complete · bootstrap v{run.version}</span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              External credentials are connected after creation; no paid run starts here.
            </span>
          </div>
        </>
      )}
    </Card>
  )
}
