"use client"

/**
 * Versions of a commercial offer (docs/sales-procurement/README.md, task 5.1):
 * «New version» copies this one into a fresh draft; the list shows every
 * version of the number; two picked versions are compared line by line —
 * added, removed, quantity or price changed.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { CopyPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

interface Line { productName: string; quantity: string; unitPrice: string; lineTotal: string }
interface Version { id: string; version: number; status: string; currency: string; totalAmount: string; createdAt: string; lineItems: Line[] }

const num = (value: string) => Number(value)
const money = (value: string | number, currency: string) => `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

export function QuoteVersions({ quoteId, canWrite }: { quoteId: string; canWrite: boolean }) {
  const t = useTranslations("quotesDetail.versions")
  const router = useRouter()
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState<string>("")
  const [right, setRight] = useState<string>("")

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/quotes/${quoteId}/versions`)
      const body = await res.json().catch(() => null)
      const list: Version[] = res.ok ? body?.data ?? [] : []
      setVersions(list)
      setRight((current) => current || quoteId)
      setLeft((current) => current || list.find((v) => v.id !== quoteId)?.id || "")
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => { void load() }, [load])

  const createVersion = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/quotes/${quoteId}/versions`, { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(t("failed")); return }
      toast.success(t("created", { n: body.data.version }))
      router.push(`/quotes/${body.data.id}`)
    } finally {
      setBusy(false)
    }
  }

  const diff = useMemo(() => {
    const a = versions.find((v) => v.id === left)
    const b = versions.find((v) => v.id === right)
    if (!a || !b) return null
    const before = new Map(a.lineItems.map((line) => [line.productName, line]))
    const after = new Map(b.lineItems.map((line) => [line.productName, line]))
    const rows: { name: string; kind: "added" | "removed" | "changed" | "same"; was?: Line; now?: Line }[] = []
    for (const [name, now] of after) {
      const was = before.get(name)
      if (!was) rows.push({ name, kind: "added", now })
      else if (num(was.quantity) !== num(now.quantity) || num(was.unitPrice) !== num(now.unitPrice)) rows.push({ name, kind: "changed", was, now })
      else rows.push({ name, kind: "same", was, now })
    }
    for (const [name, was] of before) if (!after.has(name)) rows.push({ name, kind: "removed", was })
    return { a, b, rows }
  }, [versions, left, right])

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        {canWrite && <Button size="sm" variant="outline" disabled={busy} onClick={createVersion}><CopyPlus className="mr-1 h-4 w-4" />{t("new")}</Button>}
      </div>
      <ul className="space-y-1 text-sm">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className={`hover:underline ${v.id === quoteId ? "font-semibold" : "text-primary"}`} onClick={() => router.push(`/quotes/${v.id}`)}>v{v.version}</button>
            <span className="text-muted-foreground">{t(`status.${v.status}` as never)} · {new Date(v.createdAt).toLocaleDateString()}</span>
            <span className="tabular-nums">{money(v.totalAmount, v.currency)}</span>
          </li>
        ))}
      </ul>
      {versions.length > 1 && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("compare")}</span>
            <select aria-label={t("compare")} className="h-8 rounded-md border bg-background px-2" value={left} onChange={(e) => setLeft(e.target.value)}>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
            </select>
            <span>→</span>
            <select aria-label={t("compare")} className="h-8 rounded-md border bg-background px-2" value={right} onChange={(e) => setRight(e.target.value)}>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version}</option>)}
            </select>
          </div>
          {diff && (
            <table className="w-full text-sm">
              <tbody>
                {diff.rows.filter((row) => row.kind !== "same").map((row) => (
                  <tr key={row.name} className="border-t">
                    <td className="py-1 pr-2">{row.name}</td>
                    <td className="py-1 pr-2 text-xs text-muted-foreground">{t(`change.${row.kind}` as never)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {row.was && <span className={row.kind === "removed" ? "line-through text-muted-foreground" : "text-muted-foreground"}>{num(row.was.quantity)} × {money(row.was.unitPrice, diff.a.currency)}</span>}
                      {row.was && row.now && " → "}
                      {row.now && <span>{num(row.now.quantity)} × {money(row.now.unitPrice, diff.b.currency)}</span>}
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td className="py-1" colSpan={2}>{t("total")}</td>
                  <td className="py-1 text-right tabular-nums">{money(diff.a.totalAmount, diff.a.currency)} → {money(diff.b.totalAmount, diff.b.currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {diff && diff.rows.every((row) => row.kind === "same") && <p className="text-xs text-muted-foreground">{t("noChanges")}</p>}
        </div>
      )}
    </div>
  )
}
