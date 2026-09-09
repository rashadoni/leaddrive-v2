"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Loader2, Power, PowerOff, Trash2, Download, CalendarX, Undo2, Eraser } from "lucide-react"

export function TenantActions({
  tenantId,
  isActive,
  tenantName,
  tenantSlug,
  deletionScheduledAt,
}: {
  tenantId: string
  isActive: boolean
  tenantName: string
  tenantSlug: string
  deletionScheduledAt: string | null
}) {
  const router = useRouter()
  const [showDeactivate, setShowDeactivate] = useState(false)
  const [showScheduleDelete, setShowScheduleDelete] = useState(false)
  const [showForceDelete, setShowForceDelete] = useState(false)
  const [showClearDemo, setShowClearDemo] = useState(false)
  const [slugConfirm, setSlugConfirm] = useState("")
  const [clearConfirm, setClearConfirm] = useState("")
  const [clearResult, setClearResult] = useState("")
  const [loading, setLoading] = useState("")
  const [error, setError] = useState("")

  const isPendingDeletion = !!deletionScheduledAt

  async function handleDeactivateToggle() {
    setLoading("deactivate")
    try {
      if (isActive) {
        await fetch(`/api/v1/admin/tenants/${tenantId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: false }),
        })
      } else {
        await fetch(`/api/v1/admin/tenants/${tenantId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        })
      }
      router.refresh()
    } catch (err) {
      console.error("Toggle failed:", err)
    } finally {
      setLoading("")
      setShowDeactivate(false)
    }
  }

  async function handleScheduleDelete() {
    setLoading("schedule")
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading("")
      setShowScheduleDelete(false)
    }
  }

  async function handleCancelDeletion() {
    setLoading("cancel")
    try {
      await fetch(`/api/v1/admin/tenants/${tenantId}/cancel-deletion`, { method: "POST" })
      router.refresh()
    } catch (err) {
      console.error("Cancel failed:", err)
    } finally {
      setLoading("")
    }
  }

  async function handleForceDelete() {
    if (slugConfirm !== tenantSlug) {
      setError("Slug does not match")
      return
    }
    setLoading("force")
    setError("")
    try {
      const res = await fetch(
        `/api/v1/admin/tenants/${tenantId}?force=true&confirm=${encodeURIComponent(slugConfirm)}`,
        { method: "DELETE" }
      )
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      router.push("/admin/tenants")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading("")
    }
  }

  async function handleClearDemo() {
    if (clearConfirm !== tenantSlug) {
      setError("Slug does not match")
      return
    }
    setLoading("clear")
    setError("")
    setClearResult("")
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/clear-demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: clearConfirm }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setClearResult(data.message || "Demo data cleared")
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading("")
    }
  }

  async function handleExport() {
    setLoading("export")
    try {
      const res = await fetch(`/api/v1/admin/tenants/${tenantId}/export`)
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `leaddrive-export-${tenantSlug}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error("Export failed:", err)
    } finally {
      setLoading("")
    }
  }

  return (
    <>
      {/* Deletion scheduled banner */}
      {isPendingDeletion && (
        <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
          <CalendarX className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            Deletion scheduled for {new Date(deletionScheduledAt!).toLocaleDateString()}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-2 h-7 text-xs"
            onClick={handleCancelDeletion}
            disabled={loading === "cancel"}
          >
            {loading === "cancel" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3 mr-1" />}
            Cancel Deletion
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={!!loading}
        >
          {loading === "export" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
          Export
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="text-amber-600 border-amber-300 hover:bg-amber-50"
          onClick={() => { setShowClearDemo(true); setClearConfirm(""); setError(""); setClearResult("") }}
          disabled={!!loading}
        >
          <Eraser className="w-4 h-4 mr-1" />
          Clear Demo Data
        </Button>

        {!isPendingDeletion && (
          <Button
            variant={isActive ? "destructive" : "default"}
            size="sm"
            onClick={() => setShowDeactivate(true)}
            disabled={!!loading}
          >
            {isActive ? <PowerOff className="w-4 h-4 mr-1" /> : <Power className="w-4 h-4 mr-1" />}
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        )}

        {!isPendingDeletion && (
          <Button
            variant="outline"
            size="sm"
            className="text-amber-600 border-amber-300 hover:bg-amber-50"
            onClick={() => setShowScheduleDelete(true)}
            disabled={!!loading}
          >
            <CalendarX className="w-4 h-4 mr-1" />
            Schedule Delete
          </Button>
        )}

        <Button
          variant="destructive"
          size="sm"
          onClick={() => { setShowForceDelete(true); setSlugConfirm(""); setError("") }}
          disabled={!!loading}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Force Delete
        </Button>
      </div>

      {/* Deactivate dialog */}
      <Dialog open={showDeactivate} onOpenChange={setShowDeactivate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isActive ? "Deactivate" : "Activate"} {tenantName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {isActive
              ? "Users will not be able to log in. Data is preserved."
              : "This will re-enable login for all users."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeactivate(false)}>Cancel</Button>
            <Button variant={isActive ? "destructive" : "default"} onClick={handleDeactivateToggle} disabled={!!loading}>
              {loading === "deactivate" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {isActive ? "Deactivate" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule delete dialog */}
      <Dialog open={showScheduleDelete} onOpenChange={setShowScheduleDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule deletion of {tenantName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The tenant will be deactivated immediately and permanently deleted after <strong>30 days</strong>.
            You can cancel the deletion at any time during the grace period. A JSON export will be created automatically before deletion.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleScheduleDelete} disabled={!!loading}>
              {loading === "schedule" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Schedule Deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force delete dialog */}
      <Dialog open={showForceDelete} onOpenChange={setShowForceDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Permanently delete {tenantName}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This will <strong>immediately and permanently</strong> delete all data for this tenant.
              This action cannot be undone. A JSON export will be attempted before deletion.
            </p>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Type <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{tenantSlug}</code> to confirm:
              </p>
              <Input
                value={slugConfirm}
                onChange={(e) => { setSlugConfirm(e.target.value); setError("") }}
                placeholder={tenantSlug}
                className="font-mono"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleForceDelete}
              disabled={slugConfirm !== tenantSlug || !!loading}
            >
              {loading === "force" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear demo data dialog */}
      <Dialog open={showClearDemo} onOpenChange={setShowClearDemo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-amber-600">Clear demo data for {tenantName}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Wipes <strong>all business data</strong> (companies, contacts, deals, invoices,
              tickets, every section) <strong>and resets tenant configuration</strong> (pipelines,
              custom fields, templates, workflows). Demo and real records are indistinguishable once
              mixed, so this clears both. Re-run Quick Start to restore demo config.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Preserved:</strong> login/users, branding, enabled modules, billing &amp;
              subscriptions, integrations (API keys, webhooks, messaging channels) and the audit
              trail. A JSON export is taken first as a safety net. Cannot be undone from the UI.
            </p>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">
                Type <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{tenantSlug}</code> to confirm:
              </p>
              <Input
                value={clearConfirm}
                onChange={(e) => { setClearConfirm(e.target.value); setError("") }}
                placeholder={tenantSlug}
                className="font-mono"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {clearResult && <p className="text-sm text-emerald-600">{clearResult}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearDemo(false)}>
              {clearResult ? "Close" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearDemo}
              disabled={clearConfirm !== tenantSlug || !!loading}
            >
              {loading === "clear" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Clear Demo Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
