"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowLeft, ChevronLeft, ChevronRight, GripVertical, Loader2, Search, Send, Sparkles, X } from "lucide-react"
import { Hint, HintValue } from "@/components/hint"
import { HomePill } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format-date"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import { routeBuilderStopPlannedTimeForSave } from "@/lib/mtm/route-builder-stop-time"
import {
  routePlannerDayMinutes,
  routePlannerLengthKm,
  routePlannerNextSlot,
  routePlannerPlaces,
  routePlannerStopKey,
  suggestRoutePlannerStops,
  type RoutePlannerCandidate,
} from "@/lib/mtm/route-planner"
import { coerceMtmRouteTargetTypes } from "@/lib/mtm/route-target-types"
import { MTM_ROUTE_TIME_SLOTS } from "@/lib/mtm/route-time-slots"
import { cn } from "@/lib/utils"

const RoutePlannerMap = dynamic(() => import("@/components/mtm/route-planner-map"), { ssr: false })

/**
 * The route planner on a map — /mtm/routes/plan.
 *
 * Owner, 2026-10-15, from the UX audit of the route module: the builder was a
 * small window where the date could not be changed («закройте окно и выберите
 * день в календаре»), the clients were a list inside it, eight at a time, and
 * there was no map. He chose this page from a picture («Да, делай»): the
 * employee and the day on top, both changed here; a map of the clients the
 * employee may visit, orange where nobody has been this month; the day's route
 * beside it — reordered by dragging, each stop on a half-hour slot — and
 * «Предложить маршрут».
 *
 * It creates routes, and saves and publishes them through the same endpoints
 * as the builder, so every rule of the server holds as before. A route that
 * already exists is still opened in the builder: it carries what this page
 * does not show (a name, notes, participants), which a save from here would
 * clear, and a published route has locked stops.
 */

type Agent = { id: string; name: string; role?: string; status?: string }
type Capabilities = { canCreateRoute: boolean; canPublish: boolean; canReview: boolean; actorAgentId: string | null }
type Stop = {
  key: string
  customerId: string
  contactId: string | null
  name: string
  placeName: string
  address: string | null
  latitude: number | null
  longitude: number | null
  plannedTime: string
}
type ApiCandidate = {
  customerId: string
  contactId: string | null
  name: string
  category?: string | null
  specialtyName?: string | null
  lastVisitAt?: string | null
  monthlyVisitCount?: number
  customer?: { name?: string | null; address?: string | null; latitude?: number | null; longitude?: number | null } | null
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function toCandidate(row: ApiCandidate): RoutePlannerCandidate {
  return {
    key: routePlannerStopKey(row),
    customerId: row.customerId,
    contactId: row.contactId ?? null,
    name: row.name,
    placeName: row.customer?.name || row.name,
    address: row.customer?.address ?? null,
    specialtyName: row.specialtyName ?? null,
    category: row.category ?? null,
    latitude: typeof row.customer?.latitude === "number" ? row.customer.latitude : null,
    longitude: typeof row.customer?.longitude === "number" ? row.customer.longitude : null,
    lastVisitAt: row.lastVisitAt ?? null,
    monthlyVisitCount: typeof row.monthlyVisitCount === "number" ? row.monthlyVisitCount : 0,
  }
}

function stopFrom(candidate: RoutePlannerCandidate, plannedTime: string): Stop {
  return {
    key: candidate.key,
    customerId: candidate.customerId,
    contactId: candidate.contactId,
    name: candidate.contactId ? candidate.name : candidate.placeName,
    placeName: candidate.placeName,
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    plannedTime,
  }
}

/** Times stay with the positions: a moved stop takes the slot of the place it lands on. */
function retime(order: Stop[], times: string[]): Stop[] {
  const slots = [...times].sort()
  return order.map((stop, index) => ({ ...stop, plannedTime: slots[index] ?? routePlannerNextSlot(slots[slots.length - 1]) }))
}

export function MtmRoutePlanner() {
  const t = useTranslations("mtmRoutePlanner")
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers = useMemo(() => {
    const value: Record<string, string> = {}
    if (orgId) value["x-organization-id"] = String(orgId)
    return value
  }, [orgId])

  const [timezone, setTimezone] = useState("Asia/Baku")
  const [doctorsEnabled, setDoctorsEnabled] = useState(false)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentId, setAgentId] = useState(searchParams.get("agentId")?.trim() || "")
  const [date, setDate] = useState(() => {
    const requested = searchParams.get("date") || ""
    return DATE_KEY.test(requested) ? requested : ""
  })
  const [route, setRoute] = useState<{ id: string; version: number } | null>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [candidates, setCandidates] = useState<RoutePlannerCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesFailed, setCandidatesFailed] = useState(false)
  const [onlyDue, setOnlyDue] = useState(true)
  const [category, setCategory] = useState("")
  const [query, setQuery] = useState("")
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [focusPlaceId, setFocusPlaceId] = useState<string | null>(null)
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null)
  const [error, setError] = useState("")
  const [duplicate, setDuplicate] = useState<{ id: string } | null>(null)
  const dragIndex = useRef<number | null>(null)
  // «В маршрут» from a list row: that client goes onto the route as soon as
  // the employee's clients are read — or waits, named as missing, until an
  // employee who may visit them is chosen.
  const requestedCustomerId = searchParams.get("customerId")?.trim() || ""
  const prefill = useRef<{ customerId: string; contactId: string | null } | null>(
    requestedCustomerId ? { customerId: requestedCustomerId, contactId: searchParams.get("contactId")?.trim() || null } : null,
  )
  const [prefillPending, setPrefillPending] = useState(Boolean(requestedCustomerId))
  const [candidatesFor, setCandidatesFor] = useState("")

  // Settings, capabilities and the agents the user may plan for.
  useEffect(() => {
    if (!orgId) return
    const controller = new AbortController()
    const json = (path: string) => fetch(path, { headers, signal: controller.signal }).then((response) => response.json()).catch(() => null)
    void Promise.all([json("/api/v1/mtm/settings"), json("/api/v1/mtm/routes?limit=1"), json("/api/v1/mtm/agents?limit=200")]).then(([settings, routes, agentList]) => {
      if (controller.signal.aborted) return
      const zone = typeof settings?.data?.timezone === "string" ? settings.data.timezone : "Asia/Baku"
      setTimezone(zone)
      setDoctorsEnabled(coerceMtmRouteTargetTypes(settings?.data?.routeTargetTypes).some((target) => target.enabled && target.direction === "DOCTOR"))
      const caps = (routes?.data?.capabilities ?? null) as Capabilities | null
      setCapabilities(caps ?? { canCreateRoute: false, canPublish: false, canReview: false, actorAgentId: null })
      const list = ((agentList?.data?.agents ?? []) as Agent[]).filter((agent) => agent.status === undefined || agent.status === "ACTIVE")
      const fieldAgents = caps?.canReview
        ? list.filter((agent) => agent.role === undefined || agent.role === "AGENT")
        : list.filter((agent) => agent.id === caps?.actorAgentId)
      setAgents(fieldAgents)
      setAgentId((current) => current && fieldAgents.some((agent) => agent.id === current) ? current : caps?.canReview ? (fieldAgents[0]?.id ?? "") : (caps?.actorAgentId ?? ""))
      setDate((current) => current || addDateKeyDays(currentDateKey(new Date(), zone), 1))
    })
    return () => controller.abort()
  }, [headers, orgId])

  // The employee and the day live in the address: a reload keeps them.
  useEffect(() => {
    if (!agentId || !date) return
    const next = new URLSearchParams(searchParams.toString())
    next.set("agentId", agentId)
    next.set("date", date)
    // Once the client is on the route, a reload must not put them there twice.
    if (!prefillPending) {
      next.delete("customerId")
      next.delete("contactId")
    }
    if (next.toString() !== searchParams.toString()) router.replace(`/mtm/routes/plan?${next.toString()}`, { scroll: false })
  }, [agentId, date, prefillPending, router, searchParams])

  const addCandidates = useCallback((added: RoutePlannerCandidate[]) => {
    setStops((current) => {
      const next = [...current]
      for (const candidate of added) {
        if (next.some((stop) => stop.key === candidate.key)) continue
        next.push(stopFrom(candidate, routePlannerNextSlot(next[next.length - 1]?.plannedTime)))
      }
      return next
    })
    setError("")
  }, [])

  // The clients this employee may visit on this day: the builder's own list —
  // read once the settings say whether doctors are planned too.
  const settingsLoaded = capabilities !== null
  useEffect(() => {
    if (!orgId || !agentId || !date || !settingsLoaded) return
    const controller = new AbortController()
    setCandidatesLoading(true)
    setCandidatesFailed(false)
    const read = (direction: "ORGANIZATION" | "DOCTOR") => {
      const params = new URLSearchParams({ agentId, startDate: date, direction, period: "MONTH" })
      if (route?.id) params.set("excludeRouteId", route.id)
      return fetch(`/api/v1/mtm/routes/candidates?${params}`, { headers, signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => null)
          if (!response.ok || !Array.isArray(body?.data?.candidates)) throw new Error("MTM_ROUTE_PLANNER_CANDIDATES_FAILED")
          return (body.data.candidates as ApiCandidate[]).map(toCandidate)
        })
    }
    Promise.all([read("ORGANIZATION"), doctorsEnabled ? read("DOCTOR") : Promise.resolve([])])
      .then(([organizations, doctors]) => {
        if (controller.signal.aborted) return
        const list = [...organizations, ...doctors]
        setCandidates(list)
        setCandidatesFor(`${agentId}:${date}`)
        const wanted = prefill.current
        const candidate = wanted ? list.find((item) => item.key === routePlannerStopKey(wanted)) : undefined
        if (candidate) {
          prefill.current = null
          setPrefillPending(false)
          addCandidates([candidate])
          setSelectedPlaceId(candidate.customerId)
          setFocusPlaceId(candidate.customerId)
        }
      })
      .catch(() => { if (!controller.signal.aborted) setCandidatesFailed(true) })
      .finally(() => { if (!controller.signal.aborted) setCandidatesLoading(false) })
    return () => controller.abort()
  }, [addCandidates, agentId, date, doctorsEnabled, headers, orgId, route?.id, settingsLoaded])
  const prefillMissing = prefillPending && !candidatesLoading && !candidatesFailed && candidatesFor === `${agentId}:${date}`

  const monthLabel = date ? formatDate(`${date}T12:00:00.000Z`, locale, { month: "long", timeZone: "UTC" }) : ""
  const dayLabel = date ? formatDate(`${date}T12:00:00.000Z`, locale, { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" }) : ""
  const routeDayLabel = date ? formatDate(`${date}T12:00:00.000Z`, locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }) : ""
  const allPlaces = useMemo(() => routePlannerPlaces(candidates), [candidates])
  const categories = useMemo(() => [...new Set(candidates.map((candidate) => candidate.category).filter((value): value is string => Boolean(value)))].sort(), [candidates])
  const places = useMemo(() => allPlaces.filter((place) => (!onlyDue || place.dueThisMonth)
    && (!category || place.candidates.some((candidate) => candidate.category === category))), [allPlaces, category, onlyDue])
  const duePlaces = allPlaces.filter((place) => place.dueThisMonth).length
  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale)
    if (needle.length < 2) return []
    return allPlaces.filter((place) => [place.name, place.address ?? "", ...place.candidates.map((candidate) => candidate.name)]
      .some((text) => text.toLocaleLowerCase(locale).includes(needle))).slice(0, 8)
  }, [allPlaces, locale, query])

  const lengthKm = routePlannerLengthKm(stops)
  const dayMinutes = routePlannerDayMinutes(stops.map((stop) => stop.plannedTime))
  const canPublish = capabilities?.canPublish === true

  const removeStop = (key: string) => setStops((current) => retime(current.filter((stop) => stop.key !== key), current.filter((stop) => stop.key !== key).map((stop) => stop.plannedTime)))
  const moveStop = (from: number, to: number) => setStops((current) => {
    if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) return current
    const order = [...current]
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    return retime(order, current.map((stop) => stop.plannedTime))
  })
  const setStopTime = (key: string, plannedTime: string) => setStops((current) => current.map((stop) => (stop.key === key ? { ...stop, plannedTime } : stop)))

  const suggest = () => {
    const picked = suggestRoutePlannerStops({ candidates, route: stops })
    if (picked.length === 0) {
      toast.info(t("suggestNothing", { month: monthLabel }))
      return
    }
    addCandidates(picked)
    toast.success(t("suggestAdded", { count: picked.length }))
  }

  const shiftDate = (days: number) => setDate((current) => (current ? addDateKeyDays(current, days) : current))

  async function save(action: "draft" | "publish") {
    if (!agentId || !date) {
      setError(t("needAgentAndDate"))
      return
    }
    if (stops.length === 0) {
      setError(t("needStops"))
      return
    }
    setSaving(action)
    setError("")
    setDuplicate(null)
    try {
      const payload = {
        name: null,
        date,
        notes: null,
        ...(route ? { expectedVersion: route.version } : { status: "DRAFT" as const }),
        agentId,
        assignments: [{ agentId, role: "PRIMARY" }],
        points: stops.map((stop) => ({
          customerId: stop.customerId,
          contactId: stop.contactId,
          plannedTime: routeBuilderStopPlannedTimeForSave(stop, { date, timezone, publishedEdit: false }),
        })),
      }
      const response = await fetch(route ? `/api/v1/mtm/routes/${route.id}` : "/api/v1/mtm/routes", {
        method: route ? "PUT" : "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        if (result?.code === "ROUTE_DUPLICATE" && result?.duplicate?.id) setDuplicate({ id: result.duplicate.id })
        throw new Error(result?.code === "ROUTE_DUPLICATE" ? t("duplicate")
          : result?.code === "ROUTE_POINT_TIME_CONFLICT" ? t("timeConflict")
            : result?.code === "ROUTE_VERSION_CONFLICT" ? t("versionConflict")
              : result?.error || t("saveFailed"))
      }
      const routeId = route?.id ?? result?.data?.id
      const version = result?.data?.version
      if (typeof routeId !== "string" || typeof version !== "number") throw new Error(t("saveFailed"))
      setRoute({ id: routeId, version })
      if (action === "publish") {
        const publishResponse = await fetch(`/api/v1/mtm/routes/${routeId}/publish`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ expectedVersion: version }),
        })
        const published = await publishResponse.json().catch(() => null)
        if (!publishResponse.ok) {
          throw new Error(published?.code === "ROUTE_CONFLICT" ? t("publishConflict")
            : published?.code === "ROUTE_POINT_TIME_CONFLICT" ? t("timeConflict")
              : published?.error || t("publishFailed"))
        }
      }
      toast.success(action === "publish" ? t("published") : t("saved"))
      router.push(`/mtm/routes?routeId=${encodeURIComponent(routeId)}`)
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : t("saveFailed"))
    } finally {
      setSaving(null)
    }
  }

  const onDragStart = (index: number) => () => { dragIndex.current = index }
  const onDrop = (index: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault()
    if (dragIndex.current !== null) moveStop(dragIndex.current, index)
    dragIndex.current = null
  }
  const onStopKey = (index: number) => (event: KeyboardEvent<HTMLLIElement>) => {
    if (!event.altKey) return
    if (event.key === "ArrowUp") { event.preventDefault(); moveStop(index, index - 1) }
    if (event.key === "ArrowDown") { event.preventDefault(); moveStop(index, index + 1) }
  }

  if (capabilities && !capabilities.canCreateRoute) {
    return (
      <div className="space-y-3">
        <Link href="/mtm/routes" className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-sm font-medium"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("back")}</Link>
        <p role="alert" className="rounded-xl border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-4 text-sm">{t("cannotPlan")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="mtm-route-planner">
      <header className="flex flex-wrap items-center gap-2">
        <Hint text={t("hint.back")}>
          <Link href="/mtm/routes" className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-card px-3 text-sm font-medium hover:bg-muted/60"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("back")}</Link>
        </Hint>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <HomePill tone="amber">{t("draftBadge")}</HomePill>
        <Hint text={t("hint.agent")}>
          <label className="inline-flex h-9 items-center rounded-full border border-border bg-card pl-3 pr-1 text-sm">
            <span className="sr-only">{t("agent")}</span>
            <select data-testid="mtm-route-planner-agent" value={agentId} disabled={!capabilities?.canReview} onChange={(event) => setAgentId(event.target.value)} className="h-8 max-w-[220px] bg-transparent pr-1 font-semibold outline-none">
              {agents.length === 0 ? <option value="">{t("noAgents")}</option> : null}
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
        </Hint>
        <div className="inline-flex h-9 items-center gap-0.5 rounded-full border border-border bg-card px-1 text-sm">
          <Hint text={t("hint.prevDay")}><button type="button" aria-label={t("prevDay")} data-testid="mtm-route-planner-prev-day" onClick={() => shiftDate(-1)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button></Hint>
          <Hint text={t("hint.date")}>
            <label className="relative inline-flex items-center px-1">
              <span className="font-semibold first-letter:uppercase" data-testid="mtm-route-planner-day">{dayLabel}</span>
              <input type="date" aria-label={t("date")} value={date} onChange={(event) => { if (DATE_KEY.test(event.target.value)) setDate(event.target.value) }} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </Hint>
          <Hint text={t("hint.nextDay")}><button type="button" aria-label={t("nextDay")} data-testid="mtm-route-planner-next-day" onClick={() => shiftDate(1)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></Hint>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Hint text={t("hint.save")}>
            <Button variant="outline" disabled={saving !== null} onClick={() => void save("draft")} data-testid="mtm-route-planner-save">
              {saving === "draft" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}{t("save")}
            </Button>
          </Hint>
          {canPublish ? (
            <Hint text={t("hint.publish")}>
              <Button disabled={saving !== null} onClick={() => void save("publish")} data-testid="mtm-route-planner-publish">
                {saving === "publish" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}{t("publish")}
              </Button>
            </Hint>
          ) : null}
        </div>
      </header>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-3 text-sm">
          {error}
          {duplicate ? <Link className="font-semibold underline" href={`/mtm/routes?routeId=${encodeURIComponent(duplicate.id)}`}>{t("openDuplicate")}</Link> : null}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[560px] overflow-hidden rounded-2xl border border-border bg-card">
          {date && agentId ? (
            <RoutePlannerMap
              places={places}
              stops={stops}
              selectedPlaceId={selectedPlaceId}
              focusPlaceId={focusPlaceId}
              onSelectPlace={setSelectedPlaceId}
              onAdd={(candidate) => addCandidates([candidate])}
              words={{
                label: t("mapLabel"),
                dueThisMonth: t("legendDue", { month: monthLabel }),
                visitedThisMonth: t("legendVisited"),
                inRoute: t("inRoute"),
                placeVisit: t("placeVisit"),
                add: () => t("addStop", { position: stops.length + 1 }),
                candidateLine: (candidate) => [
                  candidate.specialtyName,
                  candidate.monthlyVisitCount === 0
                    ? t("notVisitedThisMonth", { month: monthLabel })
                    : t("visitedThisMonth", { count: candidate.monthlyVisitCount }),
                ].filter(Boolean).join(" · "),
              }}
            />
          ) : null}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start gap-2">
            <div className="pointer-events-auto relative">
              <label className="flex h-10 w-[300px] max-w-full items-center gap-2 rounded-full border border-border bg-white px-4 text-sm shadow-sm dark:bg-zinc-900">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">{t("search")}</span>
                <input data-testid="mtm-route-planner-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} className="min-w-0 flex-1 bg-transparent outline-none" />
              </label>
              {searchResults.length > 0 ? (
                <ul className="absolute left-0 right-0 top-11 max-h-none rounded-xl border border-border bg-white p-1 shadow-lg dark:bg-zinc-900" data-testid="mtm-route-planner-search-results">
                  {searchResults.map((place) => (
                    <li key={place.customerId}>
                      <button type="button" className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { setFocusPlaceId(place.customerId); setSelectedPlaceId(place.customerId); setQuery("") }}>
                        <span className="block truncate font-medium">{place.name}</span>
                        {place.address ? <span className="block truncate text-xs text-muted-foreground">{place.address}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Hint text={t("hint.onlyDue", { month: monthLabel })}>
              <button type="button" data-testid="mtm-route-planner-only-due" aria-pressed={onlyDue} onClick={() => setOnlyDue(true)} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-semibold shadow-sm", onlyDue ? "border crm-choice-selected" : "border border-border bg-white text-foreground dark:bg-zinc-900")}>
                {t("onlyDue", { month: monthLabel, count: duePlaces })}
              </button>
            </Hint>
            <button type="button" data-testid="mtm-route-planner-all" aria-pressed={!onlyDue} onClick={() => setOnlyDue(false)} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-semibold shadow-sm", !onlyDue ? "border crm-choice-selected" : "border border-border bg-white text-foreground dark:bg-zinc-900")}>
              {t("all", { count: allPlaces.length })}
            </button>
            {categories.map((value) => (
              <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory((current) => (current === value ? "" : value))} className={cn("pointer-events-auto h-9 rounded-full px-3 text-sm font-medium shadow-sm", category === value ? "border crm-choice-selected" : "border border-border bg-white text-foreground dark:bg-zinc-900")}>
                {t("category", { category: value })}
              </button>
            ))}
          </div>
          <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap items-center gap-3 rounded-full bg-white/95 px-3 py-1.5 text-xs shadow-sm dark:bg-zinc-900/95">
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500" />{t("legendDue", { month: monthLabel })}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-400" />{t("legendVisited")}</span>
            <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-zinc-900" />{t("inRoute")}</span>
          </div>
          {candidatesLoading ? (
            <div className="absolute inset-0 z-[400] flex items-center justify-center bg-white/40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("loading")} /></div>
          ) : candidatesFailed ? (
            <p role="alert" className="border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 absolute inset-x-3 bottom-14 z-[500] rounded-xl p-3 text-sm">{t("candidatesFailed")}</p>
          ) : allPlaces.length === 0 && agentId && date ? (
            <p className="absolute inset-x-3 bottom-14 z-[500] rounded-xl bg-white/95 p-3 text-sm text-muted-foreground shadow-sm">{t("noClients")}</p>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col rounded-2xl border border-border bg-card" data-testid="mtm-route-planner-route">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[15px] font-semibold first-letter:uppercase">{t("routeOf", { day: routeDayLabel })}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid="mtm-route-planner-summary">
              <HomePill tone={stops.length > 0 ? "green" : "zinc"}>{t("stops", { count: stops.length })}</HomePill>
              {stops.length > 1 ? <HintValue text={t("hint.length")}><HomePill tone="zinc">{t("km", { km: lengthKm.toLocaleString(locale, { maximumFractionDigits: 1 }) })}</HomePill></HintValue> : null}
              {dayMinutes !== null ? <HintValue text={t("hint.duration")}><HomePill tone="zinc">{dayMinutes % 60 === 0
                ? t("durationHours", { hours: dayMinutes / 60 })
                : t("duration", { hours: Math.floor(dayMinutes / 60), minutes: dayMinutes % 60 })}</HomePill></HintValue> : null}
            </div>
          </div>
          {prefillMissing ? (
            <p role="status" data-testid="mtm-route-planner-prefill-missing" className="mx-3 mt-3 rounded-xl border border-l-4 border-border border-l-amber-500 bg-card text-foreground dark:border-l-amber-500 p-3 text-sm">
              {t("prefillMissing")}
            </p>
          ) : null}
          {stops.length === 0 ? (
            <p className="flex-1 px-4 py-6 text-sm text-muted-foreground">{t("emptyRoute")}</p>
          ) : (
            <ol className="flex-1 space-y-1.5 p-3">
              {stops.map((stop, index) => (
                <li
                  key={stop.key}
                  data-testid={`mtm-route-planner-stop-${index + 1}`}
                  draggable
                  tabIndex={0}
                  onDragStart={onDragStart(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={onDrop(index)}
                  onKeyDown={onStopKey(index)}
                  aria-label={t("stopAria", { position: index + 1, name: stop.name })}
                  className="flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Hint text={t("hint.drag")}><span className="cursor-grab text-muted-foreground"><GripVertical className="h-4 w-4" aria-hidden="true" /></span></Hint>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[12px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{stop.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{stop.contactId ? stop.placeName : stop.address}</span>
                  </span>
                  <Hint text={t("hint.time")}>
                    <select aria-label={t("time")} value={stop.plannedTime} onChange={(event) => setStopTime(stop.key, event.target.value)} className="h-7 rounded-full bg-muted px-2 text-[11px] font-semibold tabular-nums outline-none" data-testid={`mtm-route-planner-time-${index + 1}`}>
                      {MTM_ROUTE_TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                    </select>
                  </Hint>
                  <Hint text={t("hint.remove")}><button type="button" aria-label={t("remove")} onClick={() => removeStop(stop.key)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X className="h-4 w-4" aria-hidden="true" /></button></Hint>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2 border-t border-border p-3">
            <Hint text={t("hint.suggest", { month: monthLabel })}>
              <Button variant="outline" className="w-full border-primary/50 font-semibold text-primary" onClick={suggest} disabled={candidatesLoading || candidates.length === 0} data-testid="mtm-route-planner-suggest">
                <Sparkles aria-hidden="true" />{t("suggest")}
              </Button>
            </Hint>
            <p className="text-center text-[11px] leading-4 text-muted-foreground">{t("suggestNote", { month: monthLabel })}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
