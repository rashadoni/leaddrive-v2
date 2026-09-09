"use client"

/**
 * Card ⋯ quick-actions menu (board). Lets a user change a task's status (move to
 * a board column), priority, type, or assignee straight from the card without
 * opening the detail view. Data + the PATCH handler come from BoardActionsCtx
 * (provided by the board) so the menu stays a leaf with no prop-threading through
 * the draggable wrapper. All pointer/click events are stopped so the trigger
 * never starts a dnd drag or opens the detail modal.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react"
import { MoreHorizontal, Check, Loader2 } from "lucide-react"
import type { TaskTypeDTO } from "@/components/tasks/use-task-types"

export interface QuickCol { key: string; label: string; mapsToStatus: string; accent: string }
export interface QuickUser { id: string; name: string }

export interface BoardActions {
  columns: QuickCol[]
  types: TaskTypeDTO[]
  eventTypes: TaskTypeDTO[]
  moveToColumn: (taskId: string, col: QuickCol) => void
  patchTask: (taskId: string, patch: Record<string, unknown>) => void | Promise<void>
  fetchAssignables: () => Promise<QuickUser[]>
}

export const BoardActionsCtx = createContext<BoardActions | null>(null)

const PRIORITIES = ["critical", "high", "medium", "low"] as const
const PRIORITY_DOT: Record<string, string> = {
  critical: "#DE350B", high: "#DE350B", medium: "#FF8B00", low: "#6B778C",
}

export function CardQuickMenu({
  taskId, currentStatus, currentType, currentEventType, currentPriority, currentAssigneeId,
}: {
  taskId: string
  currentStatus: string
  currentType: string | null
  currentEventType?: string | null
  currentPriority: string
  currentAssigneeId?: string | null
}) {
  const actions = useContext(BoardActionsCtx)
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<QuickUser[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onEsc)
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc) }
  }, [open])

  if (!actions) return null

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setOpen((v) => !v)
    if (!users) actions.fetchAssignables().then(setUsers).catch(() => setUsers([]))
  }

  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    fn()
    setOpen(false)
  }

  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : "")

  return (
    // stopPropagation on pointer-down keeps the dnd PointerSensor + the card's
    // onClick (open detail) from firing when interacting with the menu.
    <div ref={ref} className="relative" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Quick actions"
        className="rounded p-1 text-[#6B778C] hover:bg-black/5"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-7 z-30 max-h-80 w-56 overflow-y-auto rounded-md border border-[#DFE1E6] bg-white py-1 text-[#172B4D] shadow-lg"
        >
          <Section label="Status" />
          {actions.columns.map((c) => (
            <Item key={c.key} active={c.mapsToStatus === currentStatus} onClick={pick(() => actions.moveToColumn(taskId, c))}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.accent }} />
              {c.label}
            </Item>
          ))}

          <Section label="Priority" />
          {PRIORITIES.map((p) => (
            <Item key={p} active={p === currentPriority} onClick={pick(() => actions.patchTask(taskId, { priority: p }))}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PRIORITY_DOT[p] }} />
              {cap(p)}
            </Item>
          ))}

          {actions.types.length > 0 && (
            <>
              <Section label="Type" />
              {actions.types.map((tt) => (
                <Item key={tt.id} active={tt.name === currentType} onClick={pick(() => actions.patchTask(taskId, { type: tt.name }))}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: tt.color }} />
                  {tt.displayName}
                </Item>
              ))}
            </>
          )}

          {actions.eventTypes.length > 0 && (
            <>
              <Section label="Event type" />
              {actions.eventTypes.map((et) => (
                <Item key={et.id} active={et.name === currentEventType} onClick={pick(() => actions.patchTask(taskId, { eventType: et.name }))}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: et.color }} />
                  {et.displayName}
                </Item>
              ))}
            </>
          )}

          <Section label="Assignee" />
          <Item active={!currentAssigneeId} onClick={pick(() => actions.patchTask(taskId, { assignedTo: null }))}>
            <span className="h-2.5 w-2.5 rounded-full border border-[#DFE1E6]" />
            Unassigned
          </Item>
          {users === null ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[#6B778C]"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
          ) : (
            users.map((u) => (
              <Item key={u.id} active={u.id === currentAssigneeId} onClick={pick(() => actions.patchTask(taskId, { assignedTo: u.id }))}>
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#EA580C] text-[8px] font-semibold text-white">
                  {u.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                </span>
                {u.name}
              </Item>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#6B778C]">{label}</div>
}

function Item({ active, onClick, children }: { active?: boolean; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[#F4F5F7]"
    >
      {children}
      {active && <Check className="ml-auto h-3.5 w-3.5 text-[#00875A]" />}
    </button>
  )
}
