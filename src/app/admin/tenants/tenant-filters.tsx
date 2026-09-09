"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"

const PLANS = [
  { value: "all", label: "All Plans" },
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "enterprise", label: "Enterprise" },
]

const STATUSES = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "pending_deletion", label: "Pending Deletion" },
]

export function TenantFilters({
  currentPlan,
  currentStatus,
}: {
  currentPlan?: string
  currentStatus?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    router.push(`/admin/tenants?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground font-medium">Plan:</span>
        <div className="flex gap-1">
          {PLANS.map((p) => (
            <button
              key={p.value}
              onClick={() => updateFilter("plan", p.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                (currentPlan || "all") === p.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground font-medium">Status:</span>
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => updateFilter("status", s.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                (currentStatus || "all") === s.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
