"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Columns3, Folder, FolderOpen } from "lucide-react"
import { boardTabRows, type TabDivision } from "@/lib/tasks/board-tabs"

/**
 * Folders and projects as tabs above a board, so moving between projects is
 * one click (owner, 2026-11-06). Since 2026-11-08 the sidebar lists the same
 * folders; while it does, these tabs are hidden (globals.css) and serve the
 * phone and the folded sidebar. Rows and their
 * order: src/lib/tasks/board-tabs.ts. Without `divisions` it reads the board
 * list itself (the department view has none of its own).
 *
 * Styled here rather than with the CRM's filter and tab chrome: those were
 * pale enough that the owner had to look for them («если не присмотреться, не
 * видны» — 2026-11-07). The open folder is a bold orange-framed tile, the open
 * project carries an orange bar; inline styles because crm-workspace.css
 * outranks Tailwind utilities inside the workspace.
 */
const ORANGE = "hsl(var(--primary))"
const ORANGE_TINT = "hsl(var(--primary) / 0.1)"
const TEXT = "hsl(var(--foreground))"
const SUB = "hsl(var(--muted-foreground))"
const CARD = "hsl(var(--card))"
const LINE = "hsl(var(--muted-foreground) / 0.35)"

export function BoardProjectTabs({ currentId, divisions, loading = false }: {
  currentId: string
  divisions?: readonly TabDivision[]
  /** The caller is still reading `divisions`: hold the tabs' place. */
  loading?: boolean
}) {
  const t = useTranslations("board")
  const [fetched, setFetched] = useState<TabDivision[] | null>(null)

  useEffect(() => {
    if (divisions) return
    let alive = true
    fetch("/api/v1/divisions")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (alive) setFetched(Array.isArray(json?.data?.divisions) ? json.data.divisions : []) })
      .catch(() => { if (alive) setFetched([]) })
    return () => { alive = false }
  }, [divisions])

  const list = divisions ?? fetched
  const rows = useMemo(() => (list ? boardTabRows(list, currentId) : null), [list, currentId])
  // Until the board list is read, a grey stand-in of the same height holds the
  // tabs' place. Without it the tabs arrived after the table had been drawn and
  // pushed the whole board 112 px down (measured on prod 2026-11-07: CLS 0.136
  // of the page's 0.137, at 3.4 s, when the page waited for all tasks first).
  if (loading || (!divisions && fetched === null)) return <BoardProjectTabsPlaceholder />
  // One board and nowhere else to go: nothing to switch between.
  if (!rows || (rows.places.length < 2 && !rows.projects)) return null

  return (
    <div className="flex flex-col gap-3 px-5 pb-3" data-testid="board-project-tabs" data-board-tabs="">
      <nav aria-label={t("placeTabs")} className="flex flex-wrap items-center gap-2">
        {rows.places.map((place) => {
          const Icon = place.isDepartment ? (place.active ? FolderOpen : Folder) : Columns3
          return (
            <Link
              key={place.id}
              href={`/boards/${place.id}`}
              aria-current={place.active ? "page" : undefined}
              data-active={place.active ? "true" : "false"}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-semibold transition-colors hover:opacity-90"
              style={place.active
                ? { background: ORANGE_TINT, color: ORANGE, border: `2px solid ${ORANGE}` }
                : { background: CARD, color: TEXT, border: `1px solid ${LINE}`, boxShadow: "0 1px 2px rgb(0 0 0 / 0.06)" }}
            >
              <Icon className="h-4 w-4 flex-shrink-0" style={{ color: place.active ? ORANGE : SUB }} aria-hidden="true" />
              {place.name}
            </Link>
          )
        })}
      </nav>
      {rows.projects && (
        <nav
          aria-label={t("projectTabs")}
          className="flex flex-wrap items-end gap-1 rounded-lg px-2"
          style={{ background: CARD, borderBottom: `2px solid ${LINE}` }}
        >
          <ProjectLink href={`/boards/${rows.projects.departmentId}`} active={rows.projects.allActive} label={t("allProjects")} count={null} />
          {rows.projects.items.map((project) => (
            <ProjectLink key={project.id} href={`/boards/${project.id}`} active={project.active} label={project.name} count={project.count} />
          ))}
        </nav>
      )}
    </div>
  )
}

/** Same box as the two rows of tabs (43 px tiles, 46 px project row), in grey. */
function BoardProjectTabsPlaceholder() {
  return (
    <div className="flex flex-col gap-3 px-5 pb-3" data-testid="board-project-tabs-placeholder" data-board-tabs="" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2 animate-pulse motion-reduce:animate-none">
        {[160, 190, 150].map((width) => (
          <div key={width} className="h-[43px] rounded-lg bg-muted" style={{ width }} />
        ))}
      </div>
      <div className="h-[46px] rounded-lg animate-pulse bg-muted/60 motion-reduce:animate-none" />
    </div>
  )
}

function ProjectLink({ href, active, label, count }: { href: string; active: boolean; label: string; count: number | null }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active ? "true" : "false"}
      className="-mb-[2px] inline-flex items-center gap-2 px-3 py-2.5 text-[15px] font-semibold transition-colors"
      style={{ color: active ? ORANGE : TEXT, borderBottom: `3px solid ${active ? ORANGE : "transparent"}` }}
    >
      {label}
      {count !== null && (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={active ? { background: ORANGE, color: "#fff" } : { background: "hsl(var(--muted))", color: SUB }}
        >
          {count}
        </span>
      )}
    </Link>
  )
}
