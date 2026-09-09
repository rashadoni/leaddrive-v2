"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { AlertCircle, BrainCircuit, CheckCircle2, Loader2, PackageCheck, ShieldCheck, XCircle } from "lucide-react"

type CapabilityStatus =
  | "included"
  | "enabled"
  | "hidden"
  | "demo"
  | "requested"
  | "requires_plan"
  | "setup_required"
  | "disabled"

interface CapabilityRow {
  id: string
  label: string
  description: string
  kind: string
  billing: string
  appSlug: string | null
  status: CapabilityStatus
  reason: string
  actions: string[]
  enabled: boolean
  visibleInMenu: boolean
  entitlementKeys: string[]
}

interface CapabilitiesResponse {
  data?: {
    capabilities: CapabilityRow[]
  }
  error?: string
}

export function TenantCapabilitiesPanel({ tenantId }: { tenantId: string }) {
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/capabilities`, { signal })
      const body: CapabilitiesResponse = await res.json()
      if (!res.ok) {
        setError(body.error || `Capabilities failed to load (HTTP ${res.status})`)
        return
      }
      setCapabilities(body.data?.capabilities ?? [])
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError("Capabilities failed to load")
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const requested = useMemo(
    () => capabilities.filter((capability) => capability.status === "requested"),
    [capabilities],
  )
  const grantable = useMemo(
    () => capabilities.filter(isCapabilityGrantable),
    [capabilities],
  )
  const active = useMemo(
    () => capabilities.filter((capability) =>
      capability.status === "included" ||
      capability.status === "enabled" ||
      capability.status === "hidden" ||
      capability.status === "setup_required",
    ),
    [capabilities],
  )
  const advisorSuiteActive = useMemo(() => isAdvisorSuiteActive(capabilities), [capabilities])

  async function mutate(capability: CapabilityRow, action: "approve" | "reject_request" | "disable") {
    setBusyId(capability.id)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/capabilities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityId: capability.id, action }),
      })
      const body: CapabilitiesResponse = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Action failed (HTTP ${res.status})`)
        return
      }
      setCapabilities(body.data?.capabilities ?? [])
      setMessage(
        action === "approve"
          ? `${capability.label} approved`
          : action === "disable"
            ? `${capability.label} disabled without deleting tenant data`
            : `${capability.label} request rejected`,
      )
    } finally {
      setBusyId(null)
    }
  }

  async function enableAdvisorSuite() {
    setBusyId("advisor-suite")
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/capabilities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enable_advisor_suite" }),
      })
      const body: CapabilitiesResponse = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || `Advisor Suite activation failed (HTTP ${res.status})`)
        return
      }
      setCapabilities(body.data?.capabilities ?? [])
      setMessage("Advisor Suite enabled for this tenant")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Capability approvals</h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Approve tenant requests without letting customers self-install paid modules.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => load()} disabled={loading || busyId !== null}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          <span>{message}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg border bg-muted/30" />
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border bg-background p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-primary" />
                  <p className="font-medium leading-5">Advisor Suite</p>
                  <Badge variant={advisorSuiteActive ? "success" : "warning"}>
                    {advisorSuiteActive ? "ready" : "needs activation"}
                  </Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Enables live Advisor coverage for CRM, sales, contracts, marketing, ticketing, finance, analytics, routes and MTM with safe execution limits.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["CRM", "Sales", "Contracts", "Marketing", "Support", "Finance", "Analytics", "Routes", "MTM", "AI"].map((label) => (
                    <Badge key={label} variant="outline">{label}</Badge>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={enableAdvisorSuite}
                disabled={advisorSuiteActive || busyId === "advisor-suite"}
                className="shrink-0"
              >
                {busyId === "advisor-suite" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {advisorSuiteActive ? "Enabled" : "Enable Suite"}
              </Button>
            </div>
          </div>
          <CapabilitySection
            title="Requests"
            empty="No pending tenant requests."
            capabilities={requested}
            busyId={busyId}
            onApprove={(capability) => mutate(capability, "approve")}
            onReject={(capability) => mutate(capability, "reject_request")}
          />
          <CapabilitySection
            title="Available to grant"
            empty="No additional grantable capabilities are available."
            capabilities={grantable}
            busyId={busyId}
            onApprove={(capability) => mutate(capability, "approve")}
          />
          <CapabilitySection
            title="Enabled / included"
            empty="No capabilities are enabled."
            capabilities={active}
            busyId={busyId}
            onDisable={(capability) => mutate(capability, "disable")}
          />
        </div>
      )}
    </Card>
  )
}

function CapabilitySection({
  title,
  empty,
  capabilities,
  busyId,
  onApprove,
  onReject,
  onDisable,
}: {
  title: string
  empty: string
  capabilities: CapabilityRow[]
  busyId: string | null
  onApprove?: (capability: CapabilityRow) => void
  onReject?: (capability: CapabilityRow) => void
  onDisable?: (capability: CapabilityRow) => void
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">{capabilities.length}</span>
      </div>
      {capabilities.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {capabilities.map((capability) => {
            const busy = busyId === capability.id
            const hasApprovalPath = capabilityHasApprovalPath(capability)
            const canApprove = Boolean(onApprove) && hasApprovalPath
            const canDisable = Boolean(onDisable) && capability.actions.includes("disable")
            return (
              <div key={capability.id} className="rounded-lg border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium leading-5">{capability.label}</p>
                      <Badge variant={statusVariant(capability.status)}>{capability.status.replace("_", " ")}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{capability.description}</p>
                  </div>
                  <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{capability.billing}</Badge>
                  <Badge variant="outline">{capability.kind.replace("_", " ")}</Badge>
                  {capability.entitlementKeys.length > 0 ? (
                    <Badge variant="secondary">{capability.entitlementKeys.join(", ")}</Badge>
                  ) : capability.appSlug ? (
                    <Badge variant="secondary">marketplace app</Badge>
                  ) : (
                    <Badge variant="warning">not grantable</Badge>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{capability.reason}</p>
                {(onApprove || onReject || canDisable) ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {onApprove ? (
                      <Button size="sm" onClick={() => onApprove(capability)} disabled={busy || !canApprove}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Approve
                      </Button>
                    ) : null}
                    {onReject ? (
                      <Button size="sm" variant="outline" onClick={() => onReject(capability)} disabled={busy}>
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                    ) : null}
                    {canDisable ? (
                      <Button size="sm" variant="outline" onClick={() => onDisable?.(capability)} disabled={busy}>
                        <XCircle className="h-4 w-4" />
                        Disable
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function statusVariant(status: CapabilityStatus) {
  switch (status) {
    case "included":
    case "enabled":
      return "success"
    case "hidden":
    case "setup_required":
      return "warning"
    case "demo":
      return "info"
    case "requested":
      return "brand"
    case "requires_plan":
    case "disabled":
      return "outline"
  }
}

export function capabilityHasApprovalPath(
  capability: Pick<CapabilityRow, "entitlementKeys" | "appSlug">,
): boolean {
  return capability.entitlementKeys.length > 0 || capability.appSlug !== null
}

export function isCapabilityGrantable(
  capability: Pick<CapabilityRow, "status" | "entitlementKeys" | "appSlug">,
): boolean {
  return (
    capability.status !== "included" &&
    capability.status !== "enabled" &&
    capability.status !== "hidden" &&
    capability.status !== "setup_required" &&
    capability.status !== "disabled" &&
    capability.status !== "requested" &&
    capabilityHasApprovalPath(capability)
  )
}

export function isAdvisorSuiteActive(capabilities: Pick<CapabilityRow, "id" | "enabled">[]): boolean {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]))
  const daVinci = byId.get("da-vinci-ai")
  const routeField = byId.get("route-field")
  const requiredCore = ["crm-core", "sales-core", "settings-core"].every((id) => byId.get(id)?.enabled)
  return Boolean(requiredCore && daVinci?.enabled && routeField?.enabled)
}
