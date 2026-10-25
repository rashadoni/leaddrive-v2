"use client"

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ChevronDown, Search, Send } from "lucide-react"

import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { explainMtmApiErrorOr, useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import { invalidateOperationalWeekSnapshotsAfterTaskMutation } from "@/lib/mtm/operational-week-cache"
import { quickTaskDueDate } from "@/lib/mtm/task-quick-due"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { cn } from "@/lib/utils"

/**
 * A task in one line at the top of «Полевые задачи» (owner, 2026-10-20:
 * «добавить задачу слишком длинный процесс… максимально облегчи»; «в
 * приложении ты облегчил правильно» — the panel gets the app's three fields).
 * Whom, what, which day, «Отправить». The dialog of thirteen fields is gone
 * from this page; a client, a repeat or a start date are set later in the
 * task's own card, where they always were.
 *
 * «Кому» is a search, not a list (owner: «если людей будет больше, то список
 * будет длинный»): two letters narrow it, the keyboard is enough, and next to
 * each name stands what the giver needs to know — on shift or not, and whether
 * the pop-up will reach the phone (agent-task-glance.ts).
 */

export type TaskRecipient = {
  id: string
  name: string
  teamId?: string | null
  team?: { id: string; name: string } | null
  pushReady?: boolean
  onShift?: boolean
  routeToday?: { planned: number; visited: number } | null
}

export type RecipientSection =
  | { kind: "matches"; total: number; agents: TaskRecipient[] }
  | { kind: "recent"; agents: TaskRecipient[] }
  | { kind: "team"; team: string | null; agents: TaskRecipient[] }

type DueChoice = "today" | "tomorrow" | "none" | "date"

const RECENT_KEY = "mtm.taskQuickAdd.recent"
const RECENT_LIMIT = 5

/** Azerbaijani and Russian letters folded one for one, so «memmedov» finds «Məmmədov» and a match still points into the name. */
const FOLD: Record<string, string> = { "ə": "e", "ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "ё": "е" }

export function foldForSearch(value: string): string {
  return value.split("").map((char) => {
    const lower = char.toLocaleLowerCase("az").charAt(0)
    return FOLD[lower] ?? lower
  }).join("")
}

/** Where `query` sits in `name`, by the folded letters; null when it does not. */
export function matchRange(name: string, query: string): [number, number] | null {
  const needle = foldForSearch(query.trim())
  if (!needle) return null
  const start = foldForSearch(name).indexOf(needle)
  return start < 0 ? null : [start, start + needle.length]
}

/**
 * What the «Кому» list shows. Something typed: every person whose name or team
 * holds it. Nothing typed: the people this browser gave tasks to lately, then
 * everyone else by team, the people without a team last.
 */
export function recipientSections(agents: readonly TaskRecipient[], query: string, recentIds: readonly string[]): RecipientSection[] {
  const needle = foldForSearch(query.trim())
  if (needle) {
    const found = agents.filter((agent) => foldForSearch(agent.name).includes(needle) || foldForSearch(agent.team?.name ?? "").includes(needle))
    return [{ kind: "matches", total: agents.length, agents: found }]
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const recent = recentIds.map((id) => byId.get(id)).filter((agent): agent is TaskRecipient => Boolean(agent)).slice(0, RECENT_LIMIT)
  const shown = new Set(recent.map((agent) => agent.id))
  const teams = new Map<string | null, TaskRecipient[]>()
  for (const agent of agents) {
    if (shown.has(agent.id)) continue
    const team = agent.team?.name ?? null
    teams.set(team, [...(teams.get(team) ?? []), agent])
  }
  const teamSections = [...teams.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([team, members]): RecipientSection => ({ kind: "team", team, agents: members }))
  return recent.length ? [{ kind: "recent", agents: recent }, ...teamSections] : teamSections
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase("az")).join("")
}

function readRecent(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function writeRecent(ids: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {
    // A private window keeps no recents; the list still works.
  }
}

function Highlighted({ name, query }: { name: string; query: string }) {
  const range = matchRange(name, query)
  if (!range) return <>{name}</>
  return <>{name.slice(0, range[0])}<mark className="bg-transparent font-extrabold text-primary underline decoration-2 underline-offset-2">{name.slice(range[0], range[1])}</mark>{name.slice(range[1])}</>
}

export function MtmTaskQuickAdd({
  agents,
  timezone,
  orgId,
  defaultAgentId,
  onCreated,
}: {
  agents: readonly TaskRecipient[]
  timezone: string
  orgId?: string
  /** The person the page is filtered to, chosen at once. */
  defaultAgentId?: string
  onCreated: () => void
}) {
  const t = useTranslations("mtmTaskQuickAdd")
  const explainError = useMtmApiError()
  const listId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const [agentId, setAgentId] = useState(defaultAgentId ?? "")
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [due, setDue] = useState<DueChoice>("tomorrow")
  const [dueDay, setDueDay] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => { setRecentIds(readRecent()) }, [])
  useEffect(() => { if (defaultAgentId) setAgentId(defaultAgentId) }, [defaultAgentId])

  const selected = agents.find((agent) => agent.id === agentId) ?? null
  const sections = useMemo(() => recipientSections(agents, query, recentIds), [agents, query, recentIds])
  const flat = useMemo(() => sections.flatMap((section) => section.agents), [sections])
  // Each person stands in the list once (a recent one is not repeated under his team).
  const indexOf = useMemo(() => new Map(flat.map((agent, index) => [agent.id, index])), [flat])
  const today = dateInputValueInTimezone(new Date(), timezone)

  useEffect(() => { setActive(0) }, [query, open])
  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active, listId, open])

  const choose = (agent: TaskRecipient) => {
    setAgentId(agent.id)
    setOpen(false)
    setQuery("")
    setError("")
    window.setTimeout(() => titleRef.current?.focus(), 0)
  }

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(flat.length - 1, 0)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const agent = flat[active]
      if (agent) choose(agent)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) {
      setError(t("chooseWho"))
      setOpen(true)
      return
    }
    if (!title.trim()) {
      setError(t("writeWhat"))
      titleRef.current?.focus()
      return
    }
    if (due === "date" && !dueDay) {
      setError(t("chooseDay"))
      return
    }
    let dueDate: Date | null
    try {
      dueDate = quickTaskDueDate(due === "date" ? dueDay : due, new Date(), timezone)
    } catch {
      setError(t("dueInPast"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/v1/mtm/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
        body: JSON.stringify({ agentId: selected.id, title: title.trim(), dueDate: dueDate?.toISOString() ?? null }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        setError(explainMtmApiErrorOr(explainError, body, response.status, t("failed")))
        return
      }
      invalidateOperationalWeekSnapshotsAfterTaskMutation()
      const nextRecent = [selected.id, ...recentIds.filter((id) => id !== selected.id)].slice(0, RECENT_LIMIT)
      setRecentIds(nextRecent)
      writeRecent(nextRecent)
      toast.success(t("sent", { name: selected.name }))
      setTitle("")
      titleRef.current?.focus()
      onCreated()
    } catch {
      setError(t("failed"))
    } finally {
      setSaving(false)
    }
  }

  const statusOf = (agent: TaskRecipient) => agent.onShift
    ? agent.routeToday ? t("onShiftRoute", { visited: agent.routeToday.visited, planned: agent.routeToday.planned }) : t("onShift")
    : t("offShift")

  return (
    <form onSubmit={submit} aria-label={t("title")} className="space-y-2" data-testid="mtm-task-quick-add">
      <div className="grid gap-2 rounded-xl border-2 border-foreground/80 bg-card p-2 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)_auto_auto]">
        <Popover open={open} onOpenChange={setOpen}>
          <Hint wrap text={t("hint.who")}>
            <PopoverAnchor asChild>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t("who")}
                onClick={() => setOpen(true)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm"
                data-testid="mtm-task-quick-who"
              >
                {selected ? (
                  <>
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-card text-xs font-bold text-foreground dark:border-zinc-600">{initials(selected.name)}</span>
                    <span className="truncate font-medium">{selected.name}</span>
                  </>
                ) : <span className="text-muted-foreground">{t("whoPlaceholder")}</span>}
                <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </PopoverAnchor>
          </Hint>
          <PopoverContent
            align="start"
            className="w-[min(32rem,calc(100vw-2rem))] p-2"
            onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus() }}
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchRef}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
                aria-label={t("search")}
                placeholder={t("search")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
                className="min-h-11 pl-9"
                data-testid="mtm-task-quick-search"
              />
            </div>
            <div id={listId} role="listbox" aria-label={t("who")} className="mt-2 max-h-80 overflow-y-auto">
              {flat.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{t("noMatches")}</p> : sections.map((section) => (
                <div key={section.kind === "team" ? `team:${section.team ?? ""}` : section.kind} role="group" aria-label={section.kind === "matches" ? t("matches", { shown: section.agents.length, total: section.total }) : section.kind === "recent" ? t("recent") : section.team ?? t("noTeam")}>
                  <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.kind === "matches" ? t("matches", { shown: section.agents.length, total: section.total }) : section.kind === "recent" ? t("recent") : section.team ?? t("noTeam")}
                  </div>
                  {section.agents.map((agent) => {
                    const index = indexOf.get(agent.id) ?? 0
                    return (
                      <div
                        key={agent.id}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(agent)}
                        className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2", index === active && "bg-muted")}
                        data-testid={`mtm-task-quick-option-${agent.id}`}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-card text-xs font-bold text-foreground dark:border-zinc-600">{initials(agent.name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold"><Highlighted name={agent.name} query={query} /></span>
                          <span className="block truncate text-xs text-muted-foreground">{[agent.team?.name, statusOf(agent)].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold", agent.pushReady ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
                          <span className={cn("h-2 w-2 rounded-full", agent.pushReady ? "bg-green-600" : "bg-amber-500")} aria-hidden="true" />
                          {agent.pushReady ? t("pushReady") : t("pushOff")}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <p className="mt-1 border-t border-border px-2 pt-2 text-xs text-muted-foreground">{t("keys")}</p>
          </PopoverContent>
        </Popover>

        <Input
          ref={titleRef}
          value={title}
          onChange={(event) => { setTitle(event.target.value); setError("") }}
          maxLength={200}
          placeholder={t("whatPlaceholder")}
          aria-label={t("what")}
          className="min-h-11"
          data-testid="mtm-task-quick-title"
        />

        <div className="flex gap-2">
          <Hint wrap text={t("hint.due")}>
            <Select aria-label={t("due")} value={due} onChange={(event) => { setDue(event.target.value as DueChoice); setError("") }} className="min-h-11 min-w-36" data-testid="mtm-task-quick-due">
              <option value="today">{t("dueToday")}</option>
              <option value="tomorrow">{t("dueTomorrow")}</option>
              <option value="none">{t("dueNone")}</option>
              <option value="date">{t("dueDate")}</option>
            </Select>
          </Hint>
          {due === "date" ? (
            <Input type="date" min={today} value={dueDay} onChange={(event) => { setDueDay(event.target.value); setError("") }} aria-label={t("dueDateLabel")} className="min-h-11 w-40" data-testid="mtm-task-quick-day" />
          ) : null}
        </div>

        <Hint wrap text={saving ? null : t("hint.send")}>
          <Button type="submit" className="min-h-11 w-full lg:w-auto" disabled={saving} data-testid="mtm-task-quick-send">
            <Send className="h-4 w-4" aria-hidden="true" />{saving ? t("sending") : t("send")}
          </Button>
        </Hint>
      </div>
      {error ? (
        <p role="alert" className="px-1 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : selected ? (
        <p className={cn("flex items-center gap-2 px-1 text-sm", selected.pushReady ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")} data-testid="mtm-task-quick-reach">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", selected.pushReady ? "bg-green-600" : "bg-amber-500")} aria-hidden="true" />
          {selected.pushReady ? t("reachYes") : t("reachNo")}
        </p>
      ) : null}
    </form>
  )
}
