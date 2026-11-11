"use client"

/**
 * «Экран в зале»: the links that open a read-only timetable on a monitor
 * (src/app/board/[token]). Set up once — what it shows and how many columns —
 * and the screen looks after itself.
 *
 * The address is the whole permission, so this screen treats it as one: it is
 * shown to copy, it is never editable, and «Söndür» puts it out rather than
 * hiding the row.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BOARD_COLUMNS } from "@/lib/booking/board-view"

interface BoardLink {
  id: string
  title: string
  url: string
  hostIds: string[]
  columns: number
}

export function BookingBoardPanel({ hosts }: { hosts: { id: string; name: string }[] }) {
  const t = useTranslations("booking")
  const [links, setLinks] = useState<BoardLink[] | null>(null)
  const [title, setTitle] = useState("")
  const [chosen, setChosen] = useState<string[]>([])
  const [columns, setColumns] = useState<number>(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/booking-pages/board", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok || !body.success) throw new Error("load")
        if (!controller.signal.aborted) setLinks(body.data.links)
      })
      .catch(() => { if (!controller.signal.aborted) setError(t("errLoad")) })
    return () => controller.abort()
  }, [t])

  async function create() {
    if (!title.trim()) return
    setBusy(true); setError("")
    const response = await fetch("/api/v1/booking-pages/board", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), hostIds: chosen, columns }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t("errSave")); return }
    setLinks([...(links ?? []), body.data.link])
    setTitle(""); setChosen([])
  }

  async function revoke(id: string) {
    setBusy(true); setError("")
    const response = await fetch(`/api/v1/booking-pages/board?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
    setBusy(false)
    if (!response?.ok) { setError(t("errSave")); return }
    setLinks((current) => (current ?? []).filter((link) => link.id !== id))
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      window.prompt(t("copyLink"), url)
    }
  }

  return <section className="rounded-xl border border-border bg-card p-5 text-card-foreground">
    <header className="mb-1 flex items-center gap-2">
      <Monitor className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{t("boardTitle")}</h2>
    </header>
    <p className="mb-4 text-sm text-muted-foreground">{t("boardHint")}</p>

    {links?.length ? <ul className="mb-4 space-y-2">
      {links.map((link) => <li key={link.id} className="rounded-lg border border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{link.title}</span>
          <span className="text-xs text-muted-foreground">{t("boardColumnsOf", { count: link.columns })}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy(link.url)}>
              {copied === link.url ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied === link.url ? t("linkCopied") : t("copyLink")}
            </Button>
            <Button variant="ghost" size="sm" asChild><a href={link.url} target="_blank" rel="noopener noreferrer">{t("openPage")}</a></Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(link.id)}>{t("boardRevoke")}</Button>
          </div>
        </div>
        <p className="mt-1 break-all text-xs text-muted-foreground">{link.url.replace(/^https?:\/\//, "")}</p>
      </li>)}
    </ul> : null}

    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <div className="space-y-1">
        <Label htmlFor="board-title">{t("boardName")}</Label>
        <Input id="board-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("boardNamePlaceholder")} className="min-h-11" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="board-columns">{t("boardColumns")}</Label>
        <select
          id="board-columns"
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm"
          value={columns}
          onChange={(event) => setColumns(Number(event.target.value))}
        >{BOARD_COLUMNS.map((count) => <option key={count} value={count}>{count}</option>)}</select>
      </div>
    </div>

    <fieldset className="mt-3">
      <legend className="mb-2 text-sm text-muted-foreground">{t("boardWho")}</legend>
      <div className="flex flex-wrap gap-2">
        {hosts.map((host) => {
          const on = chosen.includes(host.id)
          return <button
            key={host.id}
            type="button"
            aria-pressed={on}
            onClick={() => setChosen(on ? chosen.filter((id) => id !== host.id) : [...chosen, host.id])}
            className={`min-h-11 rounded-full border px-3 text-sm ${on ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
          >{host.name}</button>
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("boardWhoHint")}</p>
    </fieldset>

    <Button className="mt-4" disabled={busy || !title.trim()} onClick={() => void create()}>{t("boardCreate")}</Button>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </section>
}
