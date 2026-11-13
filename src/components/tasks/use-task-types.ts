"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { sharedGetJson } from "@/lib/client/shared-get"

export interface TaskTypeDTO {
  id: string
  name: string
  displayName: string
  color: string
  sortOrder: number
  isActive: boolean
}

export interface TaskTypeInfo {
  displayName: string
  color: string
}

/**
 * Shared core: fetch an org configurable-type axis. `activeOnly` (board dropdowns /
 * card rendering) hides retired entries; the Configuration editor passes false to
 * manage active + inactive. Returns a name→info map for cheap label/color lookup.
 */
export function useConfigTypes(endpoint: "task-types" | "event-types", activeOnly: boolean) {
  const [types, setTypes] = useState<TaskTypeDTO[]>([])
  const [loading, setLoading] = useState(true)

  // `shared`: the read a component makes when it appears joins the same read by another part of
  // the page (lib/client/shared-get). A refetch — after the editor saved something — reads for itself.
  const load = useCallback(async (shared: boolean) => {
    setLoading(true)
    const url = `/api/v1/${endpoint}${activeOnly ? "?activeOnly=true" : ""}`
    try {
      if (shared) {
        const read = await sharedGetJson<{ data?: TaskTypeDTO[] }>(url)
        if (read.ok) setTypes(read.json?.data ?? [])
      } else {
        const res = await fetch(url, { credentials: "include" })
        if (res.ok) {
          const j = await res.json()
          setTypes(j?.data ?? [])
        }
      }
    } catch {
      /* keep last-good list; consumers fall back gracefully */
    } finally {
      setLoading(false)
    }
  }, [endpoint, activeOnly])

  const refetch = useCallback(() => load(false), [load])

  useEffect(() => { void load(true) }, [load])

  const typeMap = useMemo(
    () => new Map<string, TaskTypeInfo>(types.map((t) => [t.name, { displayName: t.displayName, color: t.color }])),
    [types],
  )

  return { types, typeMap, loading, refetch }
}

/** Org task types (Bordio "Task types" axis — the functional category / department). */
export function useTaskTypes(activeOnly = false) {
  return useConfigTypes("task-types", activeOnly)
}

/** Org event types (Bordio "Event types" axis — the channel/source: 914 LINE, SOCIAL MEDIA, …). */
export function useEventTypes(activeOnly = false) {
  return useConfigTypes("event-types", activeOnly)
}
