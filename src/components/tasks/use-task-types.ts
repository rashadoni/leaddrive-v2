"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

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

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/${endpoint}${activeOnly ? "?activeOnly=true" : ""}`, {
        credentials: "include",
      })
      if (res.ok) {
        const j = await res.json()
        setTypes(j?.data ?? [])
      }
    } catch {
      /* keep last-good list; consumers fall back gracefully */
    } finally {
      setLoading(false)
    }
  }, [endpoint, activeOnly])

  useEffect(() => { refetch() }, [refetch])

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
