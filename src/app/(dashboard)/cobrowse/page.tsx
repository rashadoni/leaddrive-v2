"use client"

/**
 * T8 Cobrowse — agent dashboard list page.
 *
 * `/cobrowse` — lists the org's active + recent cobrowse sessions
 * + "Start new session" dialog. Per-row link to the session viewer
 * at `/cobrowse/[id]`.
 *
 * Slice-3b agent UI surface. No new HTTP routes — reuses slice-2a
 * `GET /api/v1/cobrowse/sessions` (via the per-id GET; list endpoint
 * not yet built, so this page seeds from the agent's locally-created
 * sessions and falls back to per-id polling).
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, ExternalLink, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { CobrowseStatus } from "@/lib/cobrowse/types"
import { HelpButton } from "@/components/help/help-button"

interface SessionRow {
  id: string
  contactId: string | null
  status: CobrowseStatus
  startedAt: string
  /** joinToken intentionally NOT on list rows — slice-3c server
   *  endpoint excludes it from the projection so tokens don't leak
   *  into dashboard JSON visible in devtools. The per-id viewer
   *  page fetches the token separately when the agent opens it. */
  joinToken?: string
}

const STATUS_VARIANT: Record<CobrowseStatus, "secondary" | "success" | "warning" | "destructive"> = {
  pending: "secondary",
  awaiting_consent: "secondary",
  active: "success",
  paused: "warning",
  ended: "destructive",
}

export default function CobrowseListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  // Slice-3c: real server endpoint replaces the localStorage cache.
  // GET /api/v1/cobrowse/sessions defaults to `mine=true` so the
  // agent sees their own sessions without manager-noise; switching
  // to org-wide is a slice-3d UI toggle.
  useEffect(() => {
    const ac = new AbortController()
    fetch("/api/v1/cobrowse/sessions?limit=50", { signal: ac.signal })
      .then((r) => r.json())
      .then((body: { sessions?: SessionRow[] }) => {
        if (body.sessions) setRows(body.sessions)
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") {
          console.error("[cobrowse] list fetch failed:", e)
        }
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [])

  const recordSession = (s: SessionRow) => {
    // Optimistic prepend so the newly created session appears
    // immediately. Slice-3c omits the local cache — next page load
    // will re-fetch from the server (which now has the row).
    const next = [s, ...rows.filter((r) => r.id !== s.id)].slice(0, 50)
    setRows(next)
    try {
      // Kept the localStorage write only as a session-restore
      // safety net for the active session id; full list is now
      // server-sourced.
      localStorage.setItem("cobrowse:recent", JSON.stringify(next.slice(0, 5)))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">Cobrowse <HelpButton slug="cobrowse" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">
            Watch a customer&apos;s screen during support — they pick what to share, you only see what they show.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Start new session
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading sessions…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-12 text-center">
          <Users className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4">No recent sessions yet.</p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Start your first cobrowse session
          </Button>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Session</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/cobrowse/${r.id}`} className="font-mono text-xs hover:underline">
                      {r.id.slice(0, 8)}…
                    </Link>
                    {r.contactId ? (
                      <p className="text-xs text-muted-foreground">contact {r.contactId.slice(0, 8)}…</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">anonymous</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatRelative(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/cobrowse/${r.id}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? (
        <CreateSessionDialog
          onClose={() => setShowCreate(false)}
          onCreated={(newRow) => {
            recordSession(newRow)
            setShowCreate(false)
            router.push(`/cobrowse/${newRow.id}`)
          }}
        />
      ) : null}
    </div>
  )
}

function CreateSessionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (s: SessionRow) => void }) {
  const [contactId, setContactId] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {}
      if (contactId.trim()) body.contactId = contactId.trim()
      const res = await fetch("/api/v1/cobrowse/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json: { session?: SessionRow; error?: string } = await res.json()
      if (!res.ok || !json.session) {
        setError(json.error || `HTTP ${res.status}`)
        return
      }
      onCreated(json.session)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card text-card-foreground rounded-lg shadow-lg w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Start cobrowse session</h2>
        <p className="text-sm text-muted-foreground">
          A join URL will be generated for the customer. Send it via chat / email — when they open it they&apos;ll be asked to share a screen, tab, or window.
        </p>
        <div className="space-y-2">
          <label className="block text-sm font-medium">Contact ID (optional)</label>
          <Input
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            placeholder="cln… (leave empty for anonymous)"
          />
          <p className="text-xs text-muted-foreground">
            Optional — tie the session to a Contact record so the timeline gets a "cobrowse" activity.
          </p>
        </div>
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? "Creating…" : "Create session"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso)
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (diffSec < 60) return "just now"
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  } catch {
    return ""
  }
}
