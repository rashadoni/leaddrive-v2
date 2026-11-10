"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ChevronRight, Columns3, Folder, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { boardIdFromPath, boardNavTree, type BoardNavLeaf, type TabDivision } from "@/lib/tasks/board-tabs"
import { rememberBoardNames } from "@/lib/tasks/board-names-cache"

/**
 * The folders and their boards inside the sidebar's «Boards» section (owner,
 * 2026-11-08: «каждый созданный каталог будет там как подраздел», so moving
 * between boards of one department needs no trip back). A folder folds and
 * unfolds and opens nothing, as in Bordio; the folder of the open board
 * unfolds by itself. Only what the person may open is listed — GET /api/v1/divisions filters by board access.
 *
 * While it is on screen it marks <html data-board-tree="on">, and the tabs
 * above a board step aside (globals.css): the same switch shown twice would
 * only take room. On a phone, or with the sidebar folded to icons, the tree is
 * not drawn and the tabs come back.
 */
const OPEN_KEY = "board-nav-open-folders"
const REREAD_MS = 30_000

export function SidebarBoardTree({ pathname, visible }: { pathname: string; visible: boolean }) {
  const t = useTranslations("nav.boardTree")
  const [divisions, setDivisions] = useState<TabDivision[] | null>(null)
  const readAt = useRef(0)
  const onBoards = pathname === "/boards" || pathname.startsWith("/boards/")

  // Read once, and again on coming back to the boards (a board added or
  // renamed meanwhile) — not more often than every 30 s.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (readAt.current && (!onBoards || Date.now() - readAt.current < REREAD_MS)) return
    readAt.current = Date.now()
    fetch("/api/v1/divisions")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!Array.isArray(json?.data?.divisions)) return
        rememberBoardNames(json.data.divisions)
        if (mounted.current) setDivisions(json.data.divisions)
      })
      .catch(() => { readAt.current = 0 })
  }, [pathname, onBoards])

  const tree = useMemo(() => (divisions ? boardNavTree(divisions) : []), [divisions])
  const currentId = boardIdFromPath(pathname)
  const currentFolder = useMemo(
    () => tree.find((node) => node.id === currentId || node.children.some((child) => child.id === currentId))?.id ?? null,
    [tree, currentId],
  )

  const [open, setOpen] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]") as unknown
      if (Array.isArray(stored)) setOpen(new Set(stored.filter((id): id is string => typeof id === "string")))
    } catch { /* a private window: start folded */ }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])) } catch { /* not kept, still works */ }
  }, [open, hydrated])
  // The folder of the open board is always unfolded.
  useEffect(() => {
    if (currentFolder) setOpen((previous) => (previous.has(currentFolder) ? previous : new Set(previous).add(currentFolder)))
  }, [currentFolder])

  const shown = visible && tree.length > 0
  useEffect(() => {
    if (!shown) return
    document.documentElement.dataset.boardTree = "on"
    return () => { delete document.documentElement.dataset.boardTree }
  }, [shown])

  if (!shown) return null

  const toggle = (id: string) => setOpen((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <nav aria-label={t("title")} data-testid="sidebar-board-tree" className="mb-1 ml-5 space-y-0.5 border-l border-white/[0.08] pl-1.5">
      {tree.map((node) => {
        if (!node.isDepartment) return <BoardLink key={node.id} board={node} active={node.id === currentId} icon />
        const isOpen = open.has(node.id)
        const FolderIcon = isOpen ? FolderOpen : Folder
        return (
          <div key={node.id} data-testid="sidebar-board-folder" data-folder={node.id}>
            {/* A folder only folds and unfolds, as in Bordio (owner, 2026-11-08:
                «в бордио также открываются?» — there a folder is not a page). */}
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-expanded={isOpen}
              aria-label={t(isOpen ? "collapse" : "expand", { name: node.name })}
              data-testid="sidebar-board-folder-toggle"
              className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-left text-[13px] font-medium text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none"
            >
              <ChevronRight className={cn("h-3 w-3 shrink-0 text-white/40 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} aria-hidden="true" />
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden="true" />
              <span className="truncate">{node.name}</span>
            </button>
            {isOpen && node.children.length > 0 && (
              <div className="ml-6 space-y-0.5">
                {node.children.map((child) => <BoardLink key={child.id} board={child} active={child.id === currentId} />)}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function BoardLink({ board, active, icon = false }: { board: BoardNavLeaf; active: boolean; icon?: boolean }) {
  return (
    <Link
      href={`/boards/${board.id}`}
      prefetch={false}
      data-testid="sidebar-board-link"
      data-nav-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors motion-reduce:transition-none",
        active
          ? "bg-white/[0.12] font-medium text-white before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-[#FF4D00]"
          : "text-white/60 hover:bg-white/[0.06] hover:text-white/90",
      )}
    >
      {icon && <Columns3 className="h-3.5 w-3.5 shrink-0 text-white/50" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{board.name}</span>
      {board.count !== null && <span className="shrink-0 text-[11px] tabular-nums text-white/40">{board.count}</span>}
    </Link>
  )
}
