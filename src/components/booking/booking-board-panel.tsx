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
 *
 * And a third, on 2026-11-13: he booked a visit, opened the monitor and found
 * it empty («на сегодня же была запись, где она?»). The screen was narrowed to
 * four masters and the visit was with a fifth — exactly what it was told to
 * show, and exactly what looks broken. A wall cannot explain itself to the
 * people in the room, so this panel does: under every screen, how many of
 * today's meetings it holds and whose it leaves out, with one button that
 * stops leaving anybody out. Rooms are columns here like masters are.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, EyeOff, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { BOARD_COLUMNS } from "@/lib/booking/board-view"
import { Picked } from "./booking-picked"
import { BookingChip } from "./booking-chip"

interface BoardLink {
  id: string
  title: string
  url: string
  hostIds: string[]
  columns: number
  /** Today on this screen, and today's meetings it will never show. */
  today?: { shown: number; elsewhere: { name: string; count: number }[] }
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
  /** Rooms, chairs, courts: columns of a screen exactly as masters are. */
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([])
  const chairs = [...hosts, ...rooms]

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/booking-pages/resources", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!body?.success || controller.signal.aborted) return
        setRooms((body.data.resources as { id: string; name: string; isActive: boolean }[]).filter((room) => room.isActive).map(({ id, name }) => ({ id, name })))
      })
      // A salon without rooms, or a hiccup: the picker simply lists masters.
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

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

  /** One press from «why is the screen empty» to a screen that leaves nobody out. */
  async function showEveryone(link: BoardLink) {
    setBusy(true); setError("")
    const response = await fetch("/api/v1/booking-pages/board", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: link.id, title: link.title, hostIds: [], columns: link.columns }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(false)
    if (!response?.ok || !body?.success) { setError(t("errSave")); return }
    const saved: BoardLink = body.data.link
    setLinks((current) => (current ?? []).map((item) => item.id === saved.id ? saved : item))
    if (editing === link.id) setEditing(null)
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

  /** «3 чел. · 2 комнаты»: whom a narrowed screen shows, said in the two kinds it can hold. */
  const whoOf = (link: BoardLink) => {
    const roomIds = new Set(rooms.map((room) => room.id))
    const ofRooms = link.hostIds.filter((id) => roomIds.has(id)).length
    const ofPeople = link.hostIds.length - ofRooms
    return [ofPeople ? t("hostsCount", { count: ofPeople }) : "", ofRooms ? t("boardRoomsCount", { count: ofRooms }) : ""].filter(Boolean).join(" · ")
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
        {/* The choice is a layout, so it is shown as one: three tiles of the
            screen itself rather than the digits 1, 2 and 4. */}
        <div className="flex gap-2" role="group" aria-label={t("boardColumns")}>
          {BOARD_COLUMNS.map((count) => <BookingChip
            key={count}
            active={draft.columns === count}
            label={t("boardColumnsOf", { count })}
            onClick={() => setDraft({ ...draft, columns: count })}
          >
            <span className="flex h-6 gap-0.5" aria-hidden="true">
              {Array.from({ length: count }, (ignored, index) => <span
                key={index}
                className={cn("w-2 rounded-[2px]", draft.columns === count ? "bg-primary/70" : "bg-muted-foreground/40")}
              />)}
            </span>
            <span className="tabular-nums">{count}</span>
          </BookingChip>)}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="w-full shrink-0 text-sm font-medium sm:w-32">{t("boardWho")}</span>
      <Picked
        items={chairs}
        chosen={draft.hostIds}
        allLabel={t("waRulesAllOf", { count: chairs.length })}
        addLabel={t("waRulesAddMore", { count: chairs.length - (draft.hostIds?.length ?? 0) })}
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
    <div className="flex items-center gap-2 border-t pt-3">
      <Button disabled={busy || !draft.title.trim()} onClick={() => void save()}>{t("save")}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</Button>
    </div>
  </div>

  return <section className="rounded-xl border border-border bg-card p-5 text-card-foreground">
    <header className="mb-4 flex flex-wrap items-start gap-3">
      <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="font-medium">{t("boardTitle")}</h2>
        <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{t("boardHint")}</p>
      </div>
      {editing === "new" ? null : <Button className="ml-auto" variant="outline" disabled={busy} onClick={() => open("new")}>{t("boardCreate")}</Button>}
    </header>

    <ul className="space-y-2">
      {(links ?? []).map((link) => <li key={link.id} className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-start gap-3">
          {/* The layout, at a glance: this screen is two columns wide. */}
          <span className="mt-0.5 flex h-8 shrink-0 gap-0.5 rounded-md bg-muted p-1.5" aria-hidden="true">
            {Array.from({ length: link.columns }, (ignored, index) => <span key={index} className="w-1.5 rounded-[2px] bg-muted-foreground/40" />)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{link.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {t("boardColumnsOf", { count: link.columns })} · {link.hostIds.length ? whoOf(link) : t("boardWhoAll")}
              {link.today ? ` · ${link.today.shown ? t("boardTodayShown", { count: link.today.shown }) : t("boardTodayNone")}` : ""}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button variant="outline" size="sm" asChild><a href={link.url} target="_blank" rel="noopener noreferrer">{t("openPage")}</a></Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => open(editing === link.id ? null : link.id, link)}>{t("edit")}</Button>
            {/* Putting a screen out is apart from the rest: it is the one
                action nobody takes back from the monitor's side. */}
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke(link.id)} className="text-muted-foreground hover:text-destructive">{t("boardRevoke")}</Button>
          </div>
        </div>
        {/* The address never changes while the screen is edited — that is the
            whole point of editing it rather than making a second one. */}
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{link.url.replace(/^https?:\/\//, "")}</span>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void copy(link.url)}>
            {copied === link.url ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
            {copied === link.url ? t("linkCopied") : t("copyLink")}
          </Button>
        </div>
        {/* The answer to «where is today's booking»: it is with somebody this
            screen was told not to show. Said here, with the way out beside it. */}
        {link.today?.elsewhere.length ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{t("boardTodayElsewhere", {
            count: link.today.elsewhere.reduce((sum, item) => sum + item.count, 0),
            names: link.today.elsewhere.slice(0, 4).map((item) => item.name).join(", ") + (link.today.elsewhere.length > 4 ? "…" : ""),
          })}</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void showEveryone(link)}>{t("boardShowEveryone")}</Button>
        </div> : null}
        {editing === link.id ? form : null}
      </li>)}
    </ul>

    {editing === "new" ? form : null}
    {links?.length === 0 && editing !== "new"
      ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("boardEmpty")}</p>
      : null}
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
  </section>
}
