"use client"

/**
 * «Экран в зале»: the links that open a read-only timetable on a monitor
 * (src/app/board/[token]).
 *
 * Two things the first version got wrong, both reported by the owner on
 * 2026-11-11 («ui опять на коленках», «нет редактирования»):
 *
 *   1. It drew the whole staff — twenty-seven names as chips — exactly the
 *      wall the WhatsApp rules had already learned not to draw. The picker is
 *      shared with them now (booking-picked.tsx), so a salon sees «everyone ·
 *      27» until it narrows the list itself.
 *   2. A screen could only be created and put out. Changing who is on it, or
 *      its name, meant making a second link and walking to the monitor to
 *      retype the address. Now every screen edits in place, and its address
 *      never changes.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { BOARD_COLUMNS } from "@/lib/booking/board-view"
import { Picked } from "./booking-picked"

interface BoardLink {
  id: string
  title: string
  url: string
  hostIds: string[]
  columns: number
}

type Draft = { title: string; hostIds: string[] | null; columns: number }

const draftOf = (link: BoardLink): Draft => ({
  title: link.title,
  hostIds: link.hostIds.length ? link.hostIds : null,
  columns: link.columns,
})

export function BookingBoardPanel({ hosts }: { hosts: { id: string; name: string }[] }) {
  const t = useTranslations("booking")
  const [links, setLinks] = useState<BoardLink[] | null>(null)
  /** The screen being edited, or "new" while a screen is being added. */
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>({ title: "", hostIds: null, columns: 2 })
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

  const open = (id: string | null, from?: BoardLink) => {
    setError("")
    setEditing(id)
    setDraft(from ? draftOf(from) : { title: "", hostIds: null, columns: 2 })
  }

  async function save() {
    if (!draft.title.trim()) return
    setBusy(true); setError("")
    const payload = { title: draft.title.trim(), hostIds: draft.hostIds ?? [], columns: draft.columns }
    const isNew = editing === "new"
    const response = await fetch("/api/v1/booking-pages/board", {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isNew ? payload : { id: editing, ...payload }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t("errSave")); return }
    const saved: BoardLink = body.data.link
    setLinks((current) => isNew
      ? [...(current ?? []), saved]
      : (current ?? []).map((link) => link.id === saved.id ? saved : link))
    setEditing(null)
  }

  async function revoke(id: string) {
    setBusy(true); setError("")
    const response = await fetch(`/api/v1/booking-pages/board?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)
    setBusy(false)
    if (!response?.ok) { setError(t("errSave")); return }
    setLinks((current) => (current ?? []).filter((link) => link.id !== id))
    if (editing === id) setEditing(null)
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

  /** The same fields whether a screen is being made or changed. */
  const form = <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-56 space-y-1">
        <Label htmlFor="board-title">{t("boardName")}</Label>
        <Input
          id="board-title"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder={t("boardNamePlaceholder")}
          className="min-h-11"
        />
      </div>
      <div className="space-y-1">
        <Label>{t("boardColumns")}</Label>
        <div className="flex overflow-hidden rounded-lg border border-input" role="group" aria-label={t("boardColumns")}>
          {BOARD_COLUMNS.map((count) => <button
            key={count}
            type="button"
            aria-pressed={draft.columns === count}
            onClick={() => setDraft({ ...draft, columns: count })}
            className={cn("min-h-11 min-w-11 px-4 text-sm font-medium transition-colors",
              draft.columns === count ? "bg-primary/10 text-primary" : "hover:bg-muted")}
          >{count}</button>)}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button disabled={busy || !draft.title.trim()} onClick={() => void save()}>{t("save")}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-full shrink-0 text-sm font-medium sm:w-32">{t("boardWho")}</span>
      <Picked
        items={hosts}
        chosen={draft.hostIds}
        allLabel={t("waRulesAllOf", { count: hosts.length })}
        addLabel={t("waRulesAddMore", { count: hosts.length - (draft.hostIds?.length ?? 0) })}
        searchLabel={t("hostsSearch")}
        emptyLabel={t("hostsNone")}
        pickLabel={t("waRulesPick")}
        resetLabel={t("waRulesReset")}
        onToggle={(id) => {
          const chosen = draft.hostIds ?? []
          const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]
          setDraft({ ...draft, hostIds: next.length ? next : [] })
        }}
        onReset={() => setDraft({ ...draft, hostIds: null })}
      />
    </div>
    <p className="text-xs text-muted-foreground">{t("boardWhoHint")}</p>
  </div>

  return <section className="rounded-xl border border-border bg-card p-5 text-card-foreground">
    <header className="mb-1 flex items-center gap-2">
      <Monitor className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <h2 className="font-medium">{t("boardTitle")}</h2>
    </header>
    <p className="mb-4 text-sm text-muted-foreground">{t("boardHint")}</p>

    <ul className="space-y-2">
      {(links ?? []).map((link) => <li key={link.id} className="rounded-lg border border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{link.title}</span>
          <span className="text-xs text-muted-foreground">
            {t("boardColumnsOf", { count: link.columns })} · {link.hostIds.length ? t("hostsCount", { count: link.hostIds.length }) : t("waRulesSumHostsAll")}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => open(editing === link.id ? null : link.id, link)}>{t("edit")}</Button>
            <Button variant="ghost" size="sm" onClick={() => void copy(link.url)}>
              {copied === link.url ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied === link.url ? t("linkCopied") : t("copyLink")}
            </Button>
            <Button variant="ghost" size="sm" asChild><a href={link.url} target="_blank" rel="noopener noreferrer">{t("openPage")}</a></Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(link.id)}>{t("boardRevoke")}</Button>
          </div>
        </div>
        {/* The address never changes while the screen is edited — that is the
            whole point of editing it rather than making a second one. */}
        <p className="mt-1 break-all text-xs text-muted-foreground">{link.url.replace(/^https?:\/\//, "")}</p>
        {editing === link.id ? form : null}
      </li>)}
    </ul>

    {editing === "new"
      ? form
      : <Button className="mt-3" variant="outline" disabled={busy} onClick={() => open("new")}>{t("boardCreate")}</Button>}
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </section>
}
