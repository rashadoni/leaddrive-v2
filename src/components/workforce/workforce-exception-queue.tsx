"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type QueueItem = { displayReference: string; employeeDisplayName: string; type: string; triageSeverity: string; ageSeconds: number; stage: string; evidenceState: string; employeeResponse: string; nextAction: string }

export function WorkforceExceptionQueue() {
  const { data: session } = useSession()
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const role = session?.user?.role
  const isAdmin = role === "admin" || role === "superadmin"
  const organizationId = session?.user?.organizationId ? String(session.user.organizationId) : ""
  useEffect(() => {
    if (!isAdmin) return
    const controller = new AbortController()
    fetch("/api/v1/workforce/exceptions", { headers: organizationId ? { "x-organization-id": organizationId } : {}, signal: controller.signal })
      .then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`); setItems(body.data.cases) })
      .catch((cause: unknown) => { if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [isAdmin, organizationId, retry])
  if (!isAdmin) return <section><PageDescription title="Workforce exceptions" description="A signed-in tenant administrator is required." /></section>
  return <section className="space-y-6"><PageDescription title="Workforce exception queue" description="Review uncertain attendance without exposing raw location, QR, device proof or employee reasons." />
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><ShieldAlert className="mr-2 inline size-4" aria-hidden="true" />Human review only — this screen cannot change attendance or apply discipline.</div>
    <div className="flex justify-end"><Button variant="outline" onClick={() => { setLoading(true); setError(null); setRetry((v) => v + 1) }} disabled={loading}>{loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}Refresh</Button></div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div> : null}
    {loading ? <div className="flex gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading exception queue</div> : null}
    {items && !loading ? <div className="overflow-x-auto rounded-lg border"><table className="min-w-[800px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-3">Case</th><th>Employee</th><th>Type</th><th>Stage</th><th>Evidence</th><th>Next action</th></tr></thead><tbody>{items.map((item) => <tr key={item.displayReference} className="border-b last:border-0"><td className="p-3 font-mono text-xs">{item.displayReference}</td><td>{item.employeeDisplayName}</td><td><Badge variant="outline">{item.type}</Badge></td><td>{item.stage}</td><td>{item.evidenceState}</td><td>{item.nextAction}</td></tr>)}{items.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No exception cases require review.</td></tr> : null}</tbody></table></div> : null}
  </section>
}
