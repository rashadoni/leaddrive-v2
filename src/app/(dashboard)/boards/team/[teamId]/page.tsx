"use client"

/**
 * A team's page — Bordio's team space (owner, 2026-11-13): the open tasks of
 * the team's people from every board the viewer may see, and the team's
 * people. A team has no tasks of its own: a task lives on a board, the team
 * page gathers them. The same table as a board's «Siyahı», each row naming its
 * board; what a person may change is decided per task, as everywhere
 * (lib/tasks/task-ownership.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { TaskPanel } from "@/components/tasks/task-panel/task-panel"
import { InlineTasksTable, type InlineTask, type InlineUser } from "@/components/tasks/inline-tasks-table"
import { BOARD_TASKS_PAGE } from "@/lib/tasks/fetch-board-tasks"
import type { TeamDTO } from "@/lib/tasks/board-teams"

interface TeamTask {
  id: string
  title: string
  status: string
  boardColumnKey: string | null
  priority?: string | null
  type?: string | null
  eventType?: string | null
  category?: string | null
  dueDate?: string | null
  division?: { id: string; name: string; key: string; color: string | null } | null
  assignee?: { id: string; name: string; avatar?: string | null } | null
  collaborators?: { user: { id: string; name: string } }[]
  _count?: { comments?: number; checklist?: number }
}
type View = "tasks" | "members"
const initials = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")
const OPEN_GROUP = [{ key: "open", label: "" }]

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>()
  const t = useTranslations("boardTeams")
  const tTask = useTranslations("tasks")
  const tc = useTranslations("common")
  const [team, setTeam] = useState<TeamDTO | null | undefined>(undefined) // undefined = reading, null = no such team
  const [canManage, setCanManage] = useState(false)
  const [tasks, setTasks] = useState<TeamTask[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>("tasks")
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [users, setUsers] = useState<InlineUser[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState("")

  useEffect(() => {
    let alive = true
    fetch("/api/v1/tasks/teams", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!alive) return
        setTeam(((json?.data?.teams ?? []) as TeamDTO[]).find((x) => x.id === teamId) ?? null)
        setCanManage(json?.data?.canManage === true)
      })
      .catch(() => { if (alive) setTeam(null) })
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setUsers(((j?.data ?? []) as { id: string; name: string }[]).map((u) => ({ id: u.id, name: u.name }))) })
      .catch(() => {})
    return () => { alive = false }
  }, [teamId])

  // Only the newest read is applied: an older answer must not undo an edit made after it began.
  const reads = useRef(0)
  const loadTasks = useCallback(async (quiet = false) => {
    const read = ++reads.current
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/v1/tasks?teamId=${encodeURIComponent(teamId)}&open=1&limit=${BOARD_TASKS_PAGE}`, { credentials: "include" })
      const json = res.ok ? await res.json() : null
      if (read === reads.current) setTasks((json?.data?.tasks ?? []) as TeamTask[])
    } catch { /* the empty list says it */ } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [teamId])
  useEffect(() => { void loadTasks() }, [loadTasks])

  const statusLabels: Record<string, string> = {
    backlog: tTask("statusBacklog"), pending: tTask("statusTodo"), todo: tTask("statusTodo"),
    in_progress: tTask("statusInProgress"), testing: tTask("statusTesting"), review: tTask("statusReview"),
    done: tTask("statusCompleted"), completed: tTask("statusCompleted"), cancelled: tTask("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    urgent: tTask("priorityUrgent"), high: tTask("priorityHigh"), medium: tTask("priorityMedium"), low: tTask("priorityLow"),
  }
  const groups = useMemo(() => [{ ...OPEN_GROUP[0], label: t("openTasks") }], [t])
  const groupKeyOf = useCallback(() => "open", [])
  const rows: InlineTask[] = useMemo(() => tasks.map((x) => ({
    id: x.id, title: x.title, status: x.status, boardColumnKey: x.boardColumnKey ?? null, priority: x.priority ?? "medium",
    type: x.type ?? null, eventType: x.eventType ?? null, dueDate: x.dueDate ?? null,
    assignedTo: x.assignee?.id ?? null, assignee: x.assignee ?? null,
    collaborators: x.collaborators?.map((c) => c.user),
    relatedType: x.category ?? null, relatedName: null,
    _count: x._count,
    board: x.division ? { key: x.division.key, name: x.division.name, color: x.division.color } : null,
  })), [tasks])
  const update = useCallback(async (taskId: string, patch: Record<string, unknown>) => {
    // The task's own board decides its lane: the status moves it there.
    if (typeof patch.status === "string") patch = { ...patch, boardColumnKey: null }
    reads.current++
    try {
      await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(patch),
      })
    } finally {
      void loadTasks(true)
    }
  }, [loadTasks])
  const remove = useCallback(async (taskId: string) => {
    reads.current++
    try { await fetch(`/api/v1/tasks/${taskId}`, { method: "DELETE", credentials: "include" }) } finally { void loadTasks(true) }
  }, [loadTasks])
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleAll = () => setSelected((p) => (p.size === rows.length ? new Set<string>() : new Set(rows.map((x) => x.id))))

  if (team === undefined) {
    return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("loading")}</p>
  }
  if (team === null) {
    return <p className="p-6 text-sm text-muted-foreground" data-testid="team-missing">{t("noSuchTeam")}</p>
  }

  return (
    <div className="space-y-3 px-5 pb-8 pt-3" data-testid="team-page">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{team.name}</h1>
        <span className="text-sm text-muted-foreground">{t("peopleCount", { count: team.members.length })}</span>
        {canManage && <Link href="/boards/teams" className="ml-auto text-sm text-muted-foreground underline hover:text-foreground">{t("manage")}</Link>}
      </div>
      <div data-crm-tabs="" className="flex items-center gap-1">
        {(["tasks", "members"] as const).map((v) => (
          <button key={v} type="button" data-crm-tab="" data-state={view === v ? "active" : "inactive"} data-testid={`team-tab-${v}`} onClick={() => setView(v)} className="rounded-t px-3 py-1.5 text-sm font-medium">
            {v === "tasks" ? t("tabTasks") : t("tabMembers")}
          </button>
        ))}
      </div>

      {view === "tasks" && (
        team.members.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">{t("noMembers")}</p>
        ) : (
          <InlineTasksTable
            tasks={rows}
            loading={loading}
            customGroups={groups}
            groupKeyOf={groupKeyOf}
            selectedIds={selected}
            onToggleSelect={toggle}
            onToggleSelectAll={toggleAll}
            onUpdate={update}
            onDelete={remove}
            onEdit={(task) => setOpenTaskId(task.id)}
            onOpenDetail={(id) => setOpenTaskId(id)}
            statusLabels={statusLabels}
            priorityLabels={priorityLabels}
            customFieldDefs={[]}
            users={users}
            categoryColumnLabel={tc("quarter")}
            sortBy={sort}
            onSortChange={setSort}
            look="bordio"
          />
        )
      )}

      {view === "members" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="team-members">
          <table className="w-full text-sm">
            <thead>
              <tr className="h-11 border-b border-border text-left text-muted-foreground">
                <th className="px-3.5 font-normal">{t("colName")}</th>
                <th className="px-3.5 font-normal">{t("colTeamRole")}</th>
              </tr>
            </thead>
            <tbody>
              {team.members.map((member) => (
                <tr key={member.userId} className="h-[49px] border-b border-border last:border-0">
                  <td className="px-3.5">
                    <span className="flex items-center gap-2.5">
                      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground" aria-hidden="true">{initials(member.name)}</span>
                      {member.name}
                    </span>
                  </td>
                  <td className="border-l border-border px-3.5">{member.role === "leader" ? t("roleLeader") : t("roleMember")}</td>
                </tr>
              ))}
              {team.members.length === 0 && <tr><td colSpan={2} className="px-3.5 py-8 text-center text-muted-foreground">{t("noMembers")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {openTaskId && (
        <TaskPanel
          taskId={openTaskId}
          canEdit
          onClose={() => { setOpenTaskId(null); void loadTasks(true) }}
          onMutated={() => { void loadTasks(true) }}
        />
      )}
    </div>
  )
}
