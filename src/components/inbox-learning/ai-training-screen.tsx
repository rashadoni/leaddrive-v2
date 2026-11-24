"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowRight, Check, GraduationCap, Loader2, Plus, Search, Sparkles, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/hint"
import { HelpButton } from "@/components/help/help-button"
import { ChannelIcon, channelColor } from "@/lib/inbox-channels"
import { cn } from "@/lib/utils"
import {
  KNOWLEDGE_TYPES, READINESS_MIN_QUESTIONS, READINESS_TARGET, TRAIT_TYPES,
  type Readiness,
} from "@/lib/inbox/learning/model"
import type { ChannelDetail, ChannelSummary, DifferenceView, LearnedItemView, LearningProgress } from "@/lib/inbox/learning/service"
import { startVisibleInterval } from "@/lib/client/visible-interval"
import { PriceListDialog } from "@/components/inbox-learning/price-list-dialog"

/**
 * «Обучение ИИ» (owner 2026-11-15, by the approved mock-up — «Давай»). One channel at a time: how
 * ready its AI is, where it would have answered differently, the prices waiting for «Подтвердить»,
 * its character and its knowledge — every row editable, removable, and linked to the conversation it
 * came from. One page scroll; only the thin section bar stays on screen.
 */

type Filter = "all" | "money" | "service" | "qa" | "place" | "rule"
type SourceFilter = "all" | "learned" | "manual"

const FILTER_TYPES: Record<Exclude<Filter, "all">, readonly string[]> = {
  money: ["price", "discount"],
  service: ["service"],
  qa: ["qa", "other"],
  place: ["place", "hours"],
  rule: ["rule"],
}

async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function AiTrainingScreen() {
  const t = useTranslations("aiTraining")
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChannelDetail | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [source, setSource] = useState<SourceFilter>("all")
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [removed, setRemoved] = useState<LearnedItemView[]>([])
  const [flash, setFlash] = useState<string | null>(null)
  const [handover, setHandover] = useState(false)
  const [busy, setBusy] = useState(false)
  const wantedItem = useRef<string | null>(null)

  const loadChannels = useCallback(async () => {
    const json = await call<{ data: { channels: ChannelSummary[] } }>("/api/v1/settings/inbox-learning")
    const list = json?.data.channels ?? []
    setChannels(list)
    return list
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const json = await call<{ data: ChannelDetail }>(`/api/v1/settings/inbox-learning/${encodeURIComponent(id)}`)
    setDetail(json?.data ?? null)
  }, [])

  // First load: the channel and the row a link from a conversation points at, else the first channel in training.
  useEffect(() => {
    void (async () => {
      const list = await loadChannels()
      const params = new URLSearchParams(window.location.search)
      wantedItem.current = params.get("item")
      const wanted = params.get("channel")
      const first = list.find((c) => c.id === wanted) ?? list.find((c) => c.mode === "learning") ?? list[0]
      if (first) setSelected(first.id)
    })()
  }, [loadChannels])

  useEffect(() => {
    if (!selected) return
    let ignore = false
    call<{ data: ChannelDetail }>(`/api/v1/settings/inbox-learning/${encodeURIComponent(selected)}`)
      .then((json) => { if (!ignore) setDetail(json?.data ?? null) })
    return () => { ignore = true }
  }, [selected])

  const pick = (id: string) => {
    setSelected(id)
    setEditing(null)
    setAdding(false)
    setRemoved([])
  }

  // Bring the row a link pointed at into view, once.
  useEffect(() => {
    const id = wantedItem.current
    if (!id || !detail) return
    wantedItem.current = null
    if (!detail.items.some((i) => i.id === id)) return
    setFlash(id)
    requestAnimationFrame(() => document.getElementById(`learned-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }))
    const timer = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(timer)
  }, [detail])

  const channel = channels?.find((c) => c.id === selected) ?? null

  const refresh = useCallback(async () => {
    await loadChannels()
    if (selected) await loadDetail(selected)
  }, [loadChannels, loadDetail, selected])

  // While training is still reading the channel, follow it: once a minute, only while the tab is seen.
  const following = channel?.mode === "learning"
    && detail?.channel.id === channel?.id
    && (detail?.progress.state === "waiting_first_run" || detail?.progress.state === "reading")
  useEffect(() => {
    if (!following) return
    return startVisibleInterval(() => { void refresh() }, 60_000, { firstTickAfterMs: 60_000 })
  }, [following, refresh])

  const setMode = async (mode: "learning" | "agent" | "ai" | "draft") => {
    if (!channel) return
    setBusy(true)
    const ok = await call("/api/v1/settings/channel-reply", {
      method: "PATCH",
      body: JSON.stringify({ configId: channel.id, mode: mode === "draft" ? "ai" : mode, draftMode: mode === "draft" }),
    })
    setBusy(false)
    if (!ok) { toast.error(t("saveFailed")); return }
    toast.success(
      mode === "learning" ? t("toastLearningOn", { name: channel.name })
        : mode === "agent" ? t("toastLearningOff", { name: channel.name })
          : mode === "draft" ? t("toastDraftOn", { name: channel.name }) : t("toastAiOn", { name: channel.name }),
    )
    setHandover(false)
    await refresh()
  }

  const changeItem = async (item: LearnedItemView, body: Record<string, unknown>, done?: string) => {
    const json = await call<{ data: { item: LearnedItemView } }>(
      `/api/v1/settings/inbox-learning/${encodeURIComponent(selected!)}/items/${encodeURIComponent(item.id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    )
    if (!json) { toast.error(t("saveFailed")); return false }
    if (done) toast.success(done)
    setEditing(null)
    await refresh()
    return true
  }

  const removeItem = async (item: LearnedItemView) => {
    const json = await call(`/api/v1/settings/inbox-learning/${encodeURIComponent(selected!)}/items/${encodeURIComponent(item.id)}`, { method: "DELETE" })
    if (!json) { toast.error(t("saveFailed")); return }
    setRemoved((r) => [...r, item])
    await refresh()
  }

  const restoreItem = async (item: LearnedItemView) => {
    const ok = await changeItem(item, { action: "restore" })
    if (ok) setRemoved((r) => r.filter((x) => x.id !== item.id))
  }

  const addItem = async (input: { type: string; title: string; body: string }) => {
    const json = await call(`/api/v1/settings/inbox-learning/${encodeURIComponent(selected!)}/items`, { method: "POST", body: JSON.stringify(input) })
    if (!json) { toast.error(t("saveFailed")); return }
    toast.success(t("toastAdded"))
    setAdding(false)
    await refresh()
  }

  const resolveSample = async (d: DifferenceView, action: "accept" | "teach" | "dismiss") => {
    const json = await call<{ data: { item: LearnedItemView | null } }>(
      `/api/v1/settings/inbox-learning/${encodeURIComponent(selected!)}/samples/${encodeURIComponent(d.id)}`,
      { method: "PATCH", body: JSON.stringify({ action }) },
    )
    if (!json) { toast.error(t("saveFailed")); return }
    toast.success(
      action === "accept" ? t("toastAccepted")
        : action === "dismiss" ? t("toastSkipped")
          : json.data.item?.status === "pending" ? t("toastTaughtPrice") : t("toastTaught"),
    )
    await refresh()
  }

  const items = useMemo(() => detail?.items ?? [], [detail])
  const matches = useCallback((i: LearnedItemView) => {
    const q = query.trim().toLocaleLowerCase()
    if (!q) return true
    return `${i.title} ${i.body} ${i.alternatives.map((a) => a.body).join(" ")}`.toLocaleLowerCase().includes(q)
  }, [query])
  const waiting = items.filter((i) => i.kind === "knowledge" && i.status !== "active")
  const traits = items.filter((i) => i.kind === "trait")
  const knowledge = items.filter((i) => i.kind === "knowledge" && i.status === "active")
  const shownKnowledge = knowledge.filter((i) =>
    matches(i)
    && (filter === "all" || FILTER_TYPES[filter].includes(i.type))
    && (source === "all" || i.source === source),
  )

  // The page scrolls inside the dashboard's <main>, not the window. A section lands just under the
  // sticky bar, whatever its height: one row on a laptop, two rows (tabs, then search) on a phone.
  const bar = useRef<HTMLDivElement>(null)
  const jump = (id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    section.style.scrollMarginTop = `${(bar.current?.offsetHeight ?? 0) + 16}px`
    section.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const jumpTop = () => {
    const main = bar.current?.closest("main")
    if (main) main.scrollTo({ top: 0, behavior: "smooth" })
    else window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <div className="text-xs text-muted-foreground">{t("breadcrumb")}</div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GraduationCap className="h-6 w-6 text-primary" />
          {t("title")}
          <HelpButton slug="inbox-ai-training" variant="label" />
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {channels === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</div>
      ) : channels.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("noChannels")} <Link href="/settings/channels" className="font-medium text-primary hover:underline">{t("noChannelsLink")}</Link>
        </div>
      ) : (
        <ChannelTiles channels={channels} selected={selected} onPick={pick} />
      )}

      {channel && detail && detail.channel.id === channel.id && (
        channel.mode === "human" && detail.readiness.compared === 0 && items.length === 0 ? (
          <StartCard channel={channel} busy={busy} onStart={() => setMode("learning")} />
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <ReadinessCard
                channel={channel}
                readiness={detail.readiness}
                progress={detail.progress}
                busy={busy}
                onHandover={() => setHandover(true)}
                onMode={setMode}
              />
              {channel.mode === "learning" || detail.differences.length > 0 ? (
                <DifferencesCard differences={detail.differences} onResolve={resolveSample} onJumpWaiting={() => jump("learning-waiting")} />
              ) : (
                <TryCard key={channel.id} channelId={channel.id} />
              )}
            </div>

            {/* Sticks to the very top of the scrolling <main>: a negative top equal to main's padding
                (p-3 / sm:p-4 / lg:p-8), or the cards showed through the padding band above it. The
                background is opaque — a translucent blurred one showed the white cards beneath as a
                shifted grey box (owner, 2026-11-24: «исправь ui»). Same width as the cards below. */}
            <div ref={bar} data-testid="learning-section-bar" className="sticky -top-3 z-20 flex flex-wrap items-center gap-2 border-b bg-background py-2 sm:-top-4 lg:-top-8">
              <SectionTab onClick={jumpTop}>{t("tabReadiness")}</SectionTab>
              {waiting.length > 0 && (
                <SectionTab onClick={() => jump("learning-waiting")} count={waiting.length} warn>{t("tabWaiting")}</SectionTab>
              )}
              <SectionTab onClick={() => jump("learning-character")} count={traits.length}>{t("tabCharacter")}</SectionTab>
              <SectionTab onClick={() => jump("learning-knowledge")} count={knowledge.length}>{t("tabKnowledge")}</SectionTab>
              <label className="ml-auto flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 sm:max-w-sm">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  id="learning-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchLabel")}
                  className="w-full min-w-0 bg-transparent text-sm outline-none"
                />
              </label>
            </div>

            {waiting.filter(matches).length > 0 && (
              <section id="learning-waiting" className="scroll-mt-20 space-y-3">
                <SectionHead title={t("waitingTitle")} text={t("waitingText")} />
                <div className="grid gap-3 md:grid-cols-2">
                  {waiting.filter(matches).map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      flash={flash === item.id}
                      editing={editing === item.id}
                      onEdit={() => { setEditing(item.id); setAdding(false) }}
                      onCancel={() => setEditing(null)}
                      onSave={(body) => changeItem(item, { action: "edit", ...body }, t("toastSaved"))}
                      onApprove={() => changeItem(item, { action: "approve" }, t("toastApproved", { title: item.title }))}
                      onChoose={(index) => changeItem(item, { action: "choose", index }, t("toastChosen", { title: item.title }))}
                      onRemove={() => removeItem(item)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section id="learning-character" className="scroll-mt-20 space-y-3">
              <SectionHead
                title={t("characterTitle")}
                text={detail.conversations > 0 ? t("characterText", { name: channel.name, count: detail.conversations }) : t("characterEmpty", { name: channel.name })}
              />
              <TryCard key={`${channel.id}-compact`} channelId={channel.id} compact />
              <div className="grid gap-3 md:grid-cols-2">
                {TRAIT_TYPES.map((type) => traits.find((x) => x.type === type)).filter((x): x is LearnedItemView => Boolean(x)).filter(matches).map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    flash={flash === item.id}
                    editing={editing === item.id}
                    onEdit={() => { setEditing(item.id); setAdding(false) }}
                    onCancel={() => setEditing(null)}
                    onSave={(body) => changeItem(item, { action: "edit", ...body }, t("toastCharacterSaved"))}
                    onRemove={() => removeItem(item)}
                  />
                ))}
                {removed.filter((r) => r.kind === "trait").map((item) => (
                  <RemovedRow key={item.id} item={item} onRestore={() => restoreItem(item)} />
                ))}
              </div>
            </section>

            <section id="learning-knowledge" className="scroll-mt-20 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <SectionHead title={t("knowledgeTitle")} text={t("knowledgeText", { name: channel.name })} />
                <div className="flex flex-wrap gap-2">
                  <Hint text={t("pricePasteHint")}>
                    <Button variant="outline" onClick={() => setPasting(true)} data-testid="price-list-open">{t("pricePaste")}</Button>
                  </Hint>
                  <Button onClick={() => { setAdding(true); setEditing(null) }}><Plus className="mr-1 h-4 w-4" />{t("add")}</Button>
                </div>
              </div>
              {pasting && selected && (
                <PriceListDialog
                  channelId={selected}
                  onClose={() => setPasting(false)}
                  onSaved={() => { setPasting(false); toast.success(t("toastPricesSaved")); void refresh() }}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterType")}>
                  {(["all", "money", "service", "qa", "place", "rule"] as const).map((f) => (
                    <button key={f} type="button" data-crm-filter data-state={filter === f ? "active" : "inactive"} onClick={() => setFilter(f)} className="rounded-full border px-3 py-1 text-xs">
                      {t(`filter_${f}`)}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filterSource")}>
                  {(["all", "learned", "manual"] as const).map((f) => (
                    <button key={f} type="button" data-crm-filter data-state={source === f ? "active" : "inactive"} onClick={() => setSource(f)} className="rounded-full border px-3 py-1 text-xs">
                      {t(`source_${f}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {adding && <NewItemCard onSave={addItem} onCancel={() => setAdding(false)} />}
                {removed.filter((r) => r.kind === "knowledge").map((item) => (
                  <RemovedRow key={item.id} item={item} onRestore={() => restoreItem(item)} />
                ))}
                {shownKnowledge.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    flash={flash === item.id}
                    editing={editing === item.id}
                    onEdit={() => { setEditing(item.id); setAdding(false) }}
                    onCancel={() => setEditing(null)}
                    onSave={(body) => changeItem(item, { action: "edit", ...body }, t("toastSaved"))}
                    onRemove={() => removeItem(item)}
                  />
                ))}
                {shownKnowledge.length === 0 && !adding && (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground md:col-span-2">
                    {knowledge.length === 0 ? t("knowledgeEmpty") : t("nothingFound")}
                    {knowledge.length > 0 && (
                      <Button variant="outline" size="sm" className="ml-3" onClick={() => { setQuery(""); setFilter("all"); setSource("all") }}>{t("clearFilters")}</Button>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )
      )}
      {channel && (!detail || detail.channel.id !== channel.id) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</div>
      )}

      {channel && detail && (
        <HandoverDialog
          key={handover ? "open" : "closed"}
          open={handover}
          channel={channel}
          readiness={detail.readiness}
          waiting={waiting.length}
          busy={busy}
          onClose={() => setHandover(false)}
          onConfirm={(mode) => setMode(mode)}
        />
      )}
    </div>
  )
}

/* ─────────────── channel tiles ─────────────── */

export function ModePill({ mode, days }: { mode: ChannelSummary["mode"]; days?: number | null }) {
  const t = useTranslations("aiTraining")
  if (mode === "learning") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
        <GraduationCap className="h-3 w-3" />{days ? t("modeLearningDays", { days }) : t("modeLearning")}
      </span>
    )
  }
  if (mode === "ai") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><Sparkles className="h-3 w-3" />{t("modeAi")}</span>
  if (mode === "draft") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{t("modeDraft")}</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><User className="h-3 w-3" />{t("modeHuman")}</span>
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function ChannelTiles({ channels, selected, onPick }: { channels: ChannelSummary[]; selected: string | null; onPick: (id: string) => void }) {
  const t = useTranslations("aiTraining")
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("channels")}>
      {channels.map((c) => {
        const r = c.readiness
        let right: ReactNode = null
        if (c.mode === "learning") {
          right = r.percent !== null
            ? <span className="text-xl font-bold tabular-nums">{r.percent}%</span>
            : <span className="text-xs text-muted-foreground">{t("tileCollecting", { count: r.compared, min: READINESS_MIN_QUESTIONS })}</span>
        } else if (c.mode === "human") {
          right = <span className="text-xs font-medium text-violet-700 dark:text-violet-300">{t("tileStart")}</span>
        } else if (r.percent !== null) {
          right = <span className="text-xs text-muted-foreground">{t("tileWasReady", { percent: r.percent })}</span>
        }
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            data-crm-color-role="toggle"
            aria-pressed={selected === c.id}
            className={cn(
              "flex min-w-0 flex-col gap-2 rounded-xl border-2 bg-card p-3 text-left transition",
              selected === c.id ? "border-violet-500 ring-2 ring-violet-100 dark:ring-violet-900/40" : "border-border hover:border-violet-300",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", channelColor(c.channelType === "chatwoot" ? "tiktok" : c.channelType))}>
                <ChannelIcon channel={c.channelType === "chatwoot" ? "tiktok" : c.channelType} className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block text-xs text-muted-foreground">{t(`channel_${c.channelType}` as never)}</span>
              </span>
            </span>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <ModePill mode={c.mode} days={c.mode === "learning" ? daysSince(c.startedAt) : null} />
              {right}
            </span>
            {c.waiting > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">{t("tileWaiting", { count: c.waiting })}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ─────────────── readiness ─────────────── */

function Ring({ percent, shown, label }: { percent: number; shown: string; label: string }) {
  const r = 54
  const len = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * len
  const target = (READINESS_TARGET / 100) * 2 * Math.PI
  const color = shown === "—" ? "hsl(var(--muted-foreground))" : percent >= READINESS_TARGET ? "rgb(22 163 74)" : "rgb(124 58 237)"
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 132 132" className="h-32 w-32 -rotate-90" aria-hidden="true">
        <circle cx="66" cy="66" r={r} stroke="hsl(var(--muted))" strokeWidth="12" fill="none" />
        <circle cx="66" cy="66" r={r} stroke={color} strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={`${dash} ${len}`} />
        <circle cx={66 + Math.cos(target) * r} cy={66 + Math.sin(target) * r} r="4.5" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="2" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-3xl font-extrabold tabular-nums leading-none">{shown}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
        </div>
      </div>
    </div>
  )
}

function Trend({ points }: { points: Readiness["trend"] }) {
  const t = useTranslations("aiTraining")
  if (points.length < 2) return null
  const w = 300, h = 46, pad = 4
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1)
  const y = (v: number) => h - pad - (v / 100) * (h - 2 * pad)
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`).join(" ")
  const area = `${pad},${h - pad} ${line} ${x(points.length - 1).toFixed(1)},${h - pad}`
  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
        <span>{t("trendLabel", { target: READINESS_TARGET })}</span>
        <span>{t("trendRange", { from: points[0].percent, to: points[points.length - 1].percent })}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1 h-12 w-full" aria-label={t("trendAria")}>
        <line x1={pad} x2={w - pad} y1={y(READINESS_TARGET)} y2={y(READINESS_TARGET)} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 4" strokeWidth="1" />
        <polygon points={area} fill="rgb(124 58 237 / 0.12)" />
        <polyline points={line} fill="none" stroke="rgb(124 58 237)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].percent)} r="3.5" fill="rgb(124 58 237)" />
      </svg>
    </div>
  )
}

function ReadinessCard({ channel, readiness: r, progress, busy, onHandover, onMode }: {
  channel: ChannelSummary
  readiness: Readiness
  progress: LearningProgress
  busy: boolean
  onHandover: () => void
  onMode: (mode: "learning" | "agent" | "ai" | "draft") => void
}) {
  const t = useTranslations("aiTraining")
  const ready = r.percent !== null
  const legend = [
    { key: "same", n: r.same, color: "bg-emerald-600" },
    { key: "almost", n: r.almost, color: "bg-emerald-300 dark:bg-emerald-800" },
    { key: "different", n: r.different, color: "bg-amber-500" },
    { key: "handoff", n: r.handoff, color: "bg-slate-400" },
  ] as const

  if (channel.mode !== "learning") {
    return (
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Ring percent={r.percent ?? 0} shown={ready ? `${r.percent}%` : "—"} label={t("ringNow")} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{channel.mode === "human" ? t("stoppedTitle") : channel.mode === "draft" ? t("draftTitle") : t("aiTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{channel.mode === "human" ? t("stoppedText") : t("aiText")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => onMode("learning")}><GraduationCap className="mr-1 h-4 w-4" />{channel.mode === "human" ? t("resumeLearning") : t("backToLearning")}</Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div id="learning-readiness" className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Ring
          percent={ready ? r.percent! : (r.compared / READINESS_MIN_QUESTIONS) * 100}
          shown={ready ? `${r.percent}%` : "—"}
          label={ready ? t("ringAsPerson") : t("ringCollecting", { count: r.compared, min: READINESS_MIN_QUESTIONS })}
        />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {ready ? t("readyHeadline", { same: r.same, total: r.compared }) : t("collectingHeadline", { count: r.compared, min: READINESS_MIN_QUESTIONS })}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{ready ? t("readyText", { total: r.compared }) : t("collectingText", { min: READINESS_MIN_QUESTIONS })}</p>
          {ready && (
            <div className="mt-2">
              {r.percent! >= READINESS_TARGET
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><Check className="h-3 w-3" />{t("verdictReady")}</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{t("verdictTarget", { target: READINESS_TARGET })}</span>}
            </div>
          )}
        </div>
      </div>

      <ProgressBlock progress={progress} />

      {r.compared > 0 && (
        <>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {legend.map((l) => <span key={l.key} className={l.color} style={{ width: `${(l.n / r.compared) * 100}%` }} />)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {legend.map((l) => (
              <div key={l.key} className="flex min-w-0 items-center gap-1.5">
                <i className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", l.color)} />
                <span className="truncate">{t(`legend_${l.key}`)}</span>
                <b className="ml-auto tabular-nums">{l.n}</b>
              </div>
            ))}
          </div>
        </>
      )}

      <Trend points={r.trend} />

      {r.topics.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t("topicsHeadline", { known: r.topicsKnown, total: r.topics.length })}</h3>
            {r.topicPercent !== null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{r.topicPercent}%</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.topics.map((topic) => (
              <span
                key={topic.name}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs",
                  topic.state === "ok" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
                  topic.state === "wait" && "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                  topic.state === "no" && "border border-dashed text-muted-foreground",
                )}
              >
                {topic.state === "ok" && <Check className="h-3 w-3" />}
                {topic.name}{topic.state === "wait" ? ` · ${t("topicWaits")}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <Button disabled={busy} onClick={onHandover}><Sparkles className="mr-1 h-4 w-4" />{t("handover")}</Button>
        <Button variant="outline" disabled={busy} onClick={() => onMode("agent")}>{t("stop")}</Button>
        <span className="text-xs text-muted-foreground">{t("silentNote")}</span>
      </div>
    </div>
  )
}

/* ─────────────── how far training has got ─────────────── */

const clock = (iso: string, plusMinutes = 0) =>
  new Date(new Date(iso).getTime() + plusMinutes * 60_000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

function ProgressBar({ label, value, total, hint }: { label: string; value: number; total: number; hint?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{hint ?? `${value} / ${total}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={total}>
        <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-emerald-500" : "bg-violet-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * «Ход обучения» (owner 2026-11-15: «сделай так, чтоб как-то показывался прогресс обучения»): what the
 * last pass found and read, and when the next one comes — so a fresh channel showing 0 everywhere
 * says whether it is waiting, reading or has nothing to read.
 */
function ProgressBlock({ progress: p }: { progress: LearningProgress }) {
  const t = useTranslations("aiTraining")
  const busy = p.state === "waiting_first_run" || p.state === "reading"
  const stoppedKey = p.stopped && p.stopped !== "run_cap" ? (["budget", "budget_unavailable", "day_cap", "no_api_key"].includes(p.stopped) ? p.stopped : "error") : null
  return (
    <div className="mt-4 space-y-3 rounded-xl border bg-muted/30 p-3" data-testid="learning-progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {busy
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
            : p.state === "listening" ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <GraduationCap className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span>{t(`progress_${p.state}`)}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {p.lastRunAt
            ? t("progressLastRun", { last: clock(p.lastRunAt), next: clock(p.lastRunAt, 5) })
            : t("progressFirstRun")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t(`progress_${p.state}Text`)}</p>
      {stoppedKey && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{t(`progressStopped_${stoppedKey}`)}</p>
      )}
      {p.state !== "waiting_first_run" && p.state !== "nothing_found" && (
        <div className="space-y-2.5">
          <ProgressBar label={t("progressAnswers")} value={p.answersRead} total={p.answersTotal} />
          <ProgressBar label={t("progressConversations")} value={p.conversationsRead} total={p.conversationsTotal} />
          <ProgressBar label={t("progressCompared")} value={Math.min(p.compared, p.minQuestions)} total={p.minQuestions} hint={`${p.compared} / ${p.minQuestions}`} />
        </div>
      )}
    </div>
  )
}

function StartCard({ channel, busy, onStart }: { channel: ChannelSummary; busy: boolean; onStart: () => void }) {
  const t = useTranslations("aiTraining")
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-9 text-center shadow-sm">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><GraduationCap className="h-6 w-6" /></div>
      <h2 className="text-lg font-semibold">{t("startTitle", { name: channel.name })}</h2>
      <p className="max-w-xl text-sm text-muted-foreground">{t("startText")}</p>
      <div className="mt-1 grid w-full max-w-3xl gap-3 text-left text-sm sm:grid-cols-3">
        {(["1", "2", "3"] as const).map((n) => (
          <div key={n} className="rounded-xl border p-3">
            <b className="block">{t(`step${n}Title`)}</b>
            <span className="text-muted-foreground">{t(`step${n}Text`)}</span>
          </div>
        ))}
      </div>
      <Button variant="brand" disabled={busy} onClick={onStart}><GraduationCap className="mr-1 h-4 w-4" />{t("start")}</Button>
      <p className="text-xs text-muted-foreground">{t("startCost")}</p>
    </div>
  )
}

/* ─────────────── where the AI would have answered differently ─────────────── */

function DifferencesCard({ differences, onResolve, onJumpWaiting }: {
  differences: DifferenceView[]
  onResolve: (d: DifferenceView, action: "accept" | "teach" | "dismiss") => void
  onJumpWaiting: () => void
}) {
  const t = useTranslations("aiTraining")
  const open = differences.filter((d) => d.verdict === "different").length
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("diffTitle")}</h2>
        {open > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{t("diffWaiting", { count: open })}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{differences.length ? t("diffText") : t("diffEmpty")}</p>
      <div className="mt-3 space-y-3">
        {differences.map((d) => (
          <div key={d.id} className="space-y-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="font-semibold">«{d.question || d.topic}»</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs", d.verdict === "handoff" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300")}>
                {t(`reason_${d.verdict === "handoff" ? "handoff" : d.reason ?? "other"}` as never)}
              </span>
            </div>
            <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm">
              <span className="pt-0.5 text-xs text-muted-foreground">{t("diffPerson")}</span>
              <span className="whitespace-pre-wrap break-words">{d.personAnswer}</span>
              <span className="pt-0.5 text-xs text-violet-700 dark:text-violet-300">{t("diffAi")}</span>
              <span className="whitespace-pre-wrap break-words text-violet-700 dark:text-violet-300">{d.aiAnswer || "—"}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {d.reason === "pending_price" ? (
                <Button size="sm" onClick={onJumpWaiting}>{t("diffConfirmPrice")}</Button>
              ) : (
                <Button size="sm" onClick={() => onResolve(d, "teach")}><Plus className="mr-1 h-3.5 w-3.5" />{t("diffTeach")}</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onResolve(d, "accept")}>{d.verdict === "handoff" ? t("diffHandoffRight") : t("diffAccept")}</Button>
              <Hint text={t("diffSkipHint")}>
                <Button size="sm" variant="outline" onClick={() => onResolve(d, "dismiss")}>{t("diffSkip")}</Button>
              </Hint>
              <Button size="sm" variant="ghost" asChild>
                <Link href={`/inbox?conversation=${encodeURIComponent(d.conversationId)}&message=${encodeURIComponent(d.answerMessageId)}`}>
                  {t("openConversation")}<ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────── try the AI ─────────────── */

function TryCard({ channelId, compact = false }: { channelId: string; compact?: boolean }) {
  const t = useTranslations("aiTraining")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<{ reply: string; handedOff: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const ask = async () => {
    if (!question.trim()) return
    setLoading(true)
    const json = await call<{ data: { reply: string | null; handedOff: boolean; skipped?: string } }>(
      `/api/v1/settings/inbox-learning/${encodeURIComponent(channelId)}/try`,
      { method: "POST", body: JSON.stringify({ question }) },
    )
    setLoading(false)
    if (!json?.data.reply) { toast.error(json?.data.skipped === "budget" ? t("tryBudget") : t("tryFailed")); return }
    setAnswer({ reply: json.data.reply, handedOff: json.data.handedOff })
  }
  return (
    <div className={cn("rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/20", !compact && "shadow-sm")}>
      <div className="text-sm font-semibold text-violet-700 dark:text-violet-300">{t("tryTitle")}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("tryText")}</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input id={`try-${channelId}-${compact ? "c" : "f"}`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("tryPlaceholder")} onKeyDown={(e) => { if (e.key === "Enter") void ask() }} />
        <Button variant="outline" disabled={loading || !question.trim()} onClick={ask} className="shrink-0">
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}{t("tryButton")}
        </Button>
      </div>
      {answer && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="self-start rounded-2xl rounded-bl-md border bg-card px-3 py-2 text-sm">{question}</div>
          <div className="max-w-[90%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet-600 px-3 py-2 text-sm text-white">{answer.reply}</div>
          {answer.handedOff && <span className="self-end text-xs text-muted-foreground">{t("tryHandedOff")}</span>}
        </div>
      )}
    </div>
  )
}

/* ─────────────── rows ─────────────── */

function SectionHead({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function SectionTab({ children, count, warn, onClick }: { children: ReactNode; count?: number; warn?: boolean; onClick: () => void }) {
  return (
    <button type="button" data-crm-tab onClick={onClick} className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
      {count !== undefined && (
        <span className={cn("ml-1 inline-block min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums", warn ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-muted text-foreground")}>{count}</span>
      )}
    </button>
  )
}

function RemovedRow({ item, onRestore }: { item: LearnedItemView; onRestore: () => void }) {
  const t = useTranslations("aiTraining")
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
      {t("removed", { title: item.title })}
      <Button size="sm" variant="outline" onClick={onRestore}>{t("restore")}</Button>
    </div>
  )
}

function ItemCard({ item, flash, editing, onEdit, onCancel, onSave, onApprove, onChoose, onRemove }: {
  item: LearnedItemView
  flash: boolean
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: (body: { title: string; body: string; type?: string }) => void
  onApprove?: () => void
  onChoose?: (index: number) => void
  onRemove: () => void
}) {
  const t = useTranslations("aiTraining")
  const trait = item.kind === "trait"
  const waiting = item.status === "pending" || item.status === "conflict"

  if (editing) return <ItemEditForm item={item} onSave={onSave} onCancel={onCancel} />

  return (
    <div
      id={`learned-${item.id}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 transition-shadow",
        waiting && "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20",
        flash && "ring-4 ring-violet-400/70",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{trait ? t("traitBadge") : t(`type_${item.type}` as never)}</span>
        {item.status === "pending" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{t("pendingBadge")}</span>}
        {item.status === "conflict" && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">{t("conflictBadge")}</span>}
        {item.status === "active" && item.approvedAt && !trait && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"><Check className="h-3 w-3" />{t("approvedBadge")}</span>
        )}
      </div>
      <div className="font-semibold">{trait ? t(`trait_${item.type}` as never) : item.title}</div>
      {item.status === "conflict" ? (
        <>
          <div className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs text-orange-800 dark:bg-orange-950/30 dark:text-orange-300">{t("conflictText")}</div>
          <div className="flex flex-col gap-1.5">
            {item.alternatives.map((a, i) => (
              <button
                key={`${a.body}-${i}`}
                type="button"
                data-crm-color-role="toggle"
                onClick={() => onChoose?.(i)}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:border-violet-400"
              >
                <b className="min-w-0 break-words">{a.body}</b>
                <span className="shrink-0 text-xs text-muted-foreground">{t("altSeen", { count: a.seen })} · {t("thisIsRight")}</span>
              </button>
            ))}
          </div>
        </>
      ) : item.type === "phrases" ? (
        <div className="flex flex-wrap gap-1.5">
          {item.body.split("\n").map((p) => p.trim()).filter(Boolean).map((p) => (
            <span key={p} className="rounded-lg bg-muted px-2 py-1 text-xs">{p}</span>
          ))}
        </div>
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm">{item.body}</div>
      )}
      {item.status === "pending" && (
        <div className="rounded-lg bg-amber-100/70 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">{t("pendingText")}</div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {item.source === "manual" ? (
          <span>{t("addedByYou")}</span>
        ) : trait ? (
          <span>{item.edited ? t("editedByYou") : t("learnedFromAnswers", { count: item.seenCount })}</span>
        ) : (
          <>
            <span>{t("seen", { count: item.seenCount })}</span>
            {item.from && (
              <Link
                href={`/inbox?conversation=${encodeURIComponent(item.from.conversationId)}${item.from.messageId ? `&message=${encodeURIComponent(item.from.messageId)}` : ""}`}
                className="inline-flex items-center gap-1 font-medium text-violet-700 hover:underline dark:text-violet-300"
              >
                {item.from.name ? t("fromConversation", { name: item.from.name }) : t("fromConversationNoName")}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {item.edited && <span>{t("editedByYou")}</span>}
          </>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {item.status === "pending" && onApprove && (
          <Hint text={t("approveHint")}>
            <Button size="sm" onClick={onApprove}><Check className="mr-1 h-3.5 w-3.5" />{t("approve")}</Button>
          </Hint>
        )}
        {item.status !== "conflict" && <Button size="sm" variant="outline" onClick={onEdit}>{t("edit")}</Button>}
        <Button size="sm" variant="destructive-outline" onClick={onRemove}>{trait ? t("removeTrait") : t("remove")}</Button>
      </div>
    </div>
  )
}

function ItemEditForm({ item, onSave, onCancel }: {
  item: LearnedItemView
  onSave: (body: { title: string; body: string; type?: string }) => void
  onCancel: () => void
}) {
  const t = useTranslations("aiTraining")
  const [title, setTitle] = useState(item.title)
  const [body, setBody] = useState(item.body)
  const [type, setType] = useState(item.type)
  const trait = item.kind === "trait"
  const waiting = item.status === "pending" || item.status === "conflict"
  return (
    <div id={`learned-${item.id}`} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      {!trait && (
        <Select id={`type-${item.id}`} value={type} onChange={(e) => setType(e.target.value)} aria-label={t("fieldType")}>
          {KNOWLEDGE_TYPES.map((k) => <option key={k} value={k}>{t(`type_${k}`)}</option>)}
        </Select>
      )}
      {!trait && <Input id={`title-${item.id}`} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("fieldTitle")} />}
      <Textarea id={`body-${item.id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={trait ? 3 : 4} aria-label={t("fieldBody")} />
      {item.type === "phrases" && <span className="text-xs text-muted-foreground">{t("phrasesHint")}</span>}
      {waiting && <span className="text-xs text-muted-foreground">{t("editConfirms")}</span>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave({ title, body, ...(trait ? {} : { type }) })}>{waiting ? t("saveAndConfirm") : t("save")}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
      </div>
    </div>
  )
}

function NewItemCard({ onSave, onCancel }: { onSave: (input: { type: string; title: string; body: string }) => void; onCancel: () => void }) {
  const t = useTranslations("aiTraining")
  const [type, setType] = useState("qa")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-violet-300 bg-card p-4 dark:border-violet-800">
      <span className="text-xs text-muted-foreground">{t("newHint")}</span>
      <Select id="new-learned-type" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("fieldType")}>
        {KNOWLEDGE_TYPES.map((k) => <option key={k} value={k}>{t(`type_${k}`)}</option>)}
      </Select>
      <Input id="new-learned-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("newTitlePlaceholder")} aria-label={t("fieldTitle")} />
      <Textarea id="new-learned-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("newBodyPlaceholder")} rows={3} aria-label={t("fieldBody")} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!title.trim() || !body.trim()} onClick={() => onSave({ type, title, body })}>{t("addConfirm")}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>{t("cancel")}</Button>
      </div>
    </div>
  )
}

/* ─────────────── hand the channel to the AI ─────────────── */

function HandoverDialog({ open, channel, readiness: r, waiting, busy, onClose, onConfirm }: {
  open: boolean
  channel: ChannelSummary
  readiness: Readiness
  waiting: number
  busy: boolean
  onClose: () => void
  onConfirm: (mode: "draft" | "ai") => void
}) {
  const t = useTranslations("aiTraining")
  const cautious = r.percent === null || r.percent < READINESS_TARGET
  const [choice, setChoice] = useState<"draft" | "ai">(cautious ? "draft" : "ai")
  return (
    // The app's Dialog is the panel itself; header, content and footer are its three sections —
    // nested inside `DialogContent`, the title and the buttons stood on white slabs in the grey.
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogHeader>
        <DialogTitle>{t("handoverTitle", { name: channel.name })}</DialogTitle>
        <DialogDescription>
          {r.percent === null
            ? t("handoverUnknown", { count: r.compared, min: READINESS_MIN_QUESTIONS })
            : cautious
              ? t("handoverLow", { percent: r.percent, target: READINESS_TARGET })
              : t("handoverReady", { percent: r.percent, same: r.same, total: r.compared })}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="flex flex-col gap-2">
          {(["draft", "ai"] as const).map((option) => (
            <label key={option} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3", choice === option ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-border")}>
              <input type="radio" name="handover" checked={choice === option} onChange={() => setChoice(option)} className="mt-1 accent-violet-600" />
              <span>
                <b className="block text-sm">{t(`handover_${option}`)}</b>
                <span className="text-xs text-muted-foreground">{t(`handover_${option}Text`)}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("handoverNote")} {waiting > 0 ? t("handoverWaiting", { count: waiting }) : ""}
        </p>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        <Button disabled={busy} onClick={() => onConfirm(choice)}>{t("handoverConfirm")}</Button>
      </DialogFooter>
    </Dialog>
  )
}
