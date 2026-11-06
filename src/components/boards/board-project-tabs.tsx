"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { boardTabRows, type TabDivision } from "@/lib/tasks/board-tabs"

/**
 * Folders and projects as tabs above a board, so moving between projects is
 * one click and the sidebar stays as it is (owner, 2026-11-06). Rows and their
 * order: src/lib/tasks/board-tabs.ts. Without `divisions` it reads the board
 * list itself (the department view has none of its own).
 */
export function BoardProjectTabs({ currentId, divisions }: { currentId: string; divisions?: readonly TabDivision[] }) {
  const t = useTranslations("board")
  const [fetched, setFetched] = useState<TabDivision[] | null>(null)

  useEffect(() => {
    if (divisions) return
    let alive = true
    fetch("/api/v1/divisions")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (alive && json?.data?.divisions) setFetched(json.data.divisions) })
      .catch(() => {})
    return () => { alive = false }
  }, [divisions])

  const list = divisions ?? fetched
  const rows = useMemo(() => (list ? boardTabRows(list, currentId) : null), [list, currentId])
  // One board and nowhere else to go: nothing to switch between.
  if (!rows || (rows.places.length < 2 && !rows.projects)) return null

  return (
    <div className="flex flex-col gap-2 px-5 pb-2" data-testid="board-project-tabs">
      <nav aria-label={t("placeTabs")} className="flex flex-wrap items-center gap-1.5">
        {rows.places.map((place) => (
          <Link
            key={place.id}
            href={`/boards/${place.id}`}
            data-crm-filter=""
            data-state={place.active ? "active" : "inactive"}
            aria-current={place.active ? "page" : undefined}
            className="px-3 py-1 text-sm font-medium"
          >
            {place.name}
          </Link>
        ))}
      </nav>
      {rows.projects && (
        <nav aria-label={t("projectTabs")} data-crm-tabs="" className="flex flex-wrap items-center gap-1">
          <Link
            href={`/boards/${rows.projects.departmentId}`}
            data-crm-tab=""
            data-state={rows.projects.allActive ? "active" : "inactive"}
            aria-current={rows.projects.allActive ? "page" : undefined}
            className="rounded-t px-3 py-1.5 text-sm font-medium"
          >
            {t("allProjects")}
          </Link>
          {rows.projects.items.map((project) => (
            <Link
              key={project.id}
              href={`/boards/${project.id}`}
              data-crm-tab=""
              data-state={project.active ? "active" : "inactive"}
              aria-current={project.active ? "page" : undefined}
              className="rounded-t px-3 py-1.5 text-sm font-medium"
            >
              {project.name}
              {project.count !== null && <span className="ml-1.5 text-xs opacity-60">{project.count}</span>}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
