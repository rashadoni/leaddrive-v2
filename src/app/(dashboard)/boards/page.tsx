"use client"

/**
 * Boards index — /boards. Entry point from the sidebar (nav-items "boards").
 * Lists this org's Kanban boards (divisions) and lets admins/managers create,
 * edit, and archive them + manage per-board access. Each card links to
 * /boards/[divisionId]. App theme (semantic Tailwind) — the Atlassian palette
 * is reserved for the board surface itself.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Columns3, Plus, ArrowRight, X, Loader2, Pencil, Search, Trash2, ChevronDown, ChevronRight, FolderTree } from "lucide-react"
import { BoardColumnsEditor, COLUMN_STAGES, type EditCol } from "@/components/boards/board-columns-editor"
import { HelpButton } from "@/components/help/help-button"

interface BoardColumnDTO { key: string; label: string; sortOrder: number; mapsToStatus: string; color: string | null }

interface Division {
  id: string
  key: string
  name: string
  color: string | null
  isDepartment?: boolean
  parentDivisionId?: string | null
  boardColumns?: BoardColumnDTO[]
  head?: { id: string; name: string; avatar: string | null } | null
  _count?: { tasks: number }
}

// EditCol + COLUMN_STAGES + DEFAULT_STAGE_ACCENT now live in BoardColumnsEditor
// (imported above) — the single column editor shared with the Configuration page.

interface OrgUser { id: string; name: string; email?: string; avatar?: string | null }

// A board "member" gets full access on that board: view + create + edit + all
// column moves + comment.
const MEMBER_FLAGS = {
  canView: true, canEdit: true, canCreateTask: true, canComment: true,
  canMoveToTodo: true, canMoveToInProgress: true, canMoveToTesting: true,
  canMoveToReview: true, canMoveBack: true,
}

const SWATCHES = ["#EA580C", "#00875A", "#6554C0", "#00B8D9", "#FF8B00", "#DE350B", "#172B4D"]

// ── Reusable member picker: search box + scrollable checkbox list ────────────
// `state` is the users-fetch lifecycle. Before it existed, a failed fetch
// (403 module gate / 500 / network) left `users` empty forever and the picker
// showed an endless "loading" row with no hint anything went wrong.
type PickerState = "loading" | "error" | "ready"
function MemberPicker({ users, state, selected, onToggle }: { users: OrgUser[]; state: PickerState; selected: Set<string>; onToggle: (id: string) => void }) {
  const t = useTranslations("board")
  const [q, setQ] = useState("")
  const filtered = useMemo(() => {
    // Tokenised match: every whitespace-separated word must appear somewhere in
    // name+email. A whole-phrase includes() made "madina agh" miss
    // "Mədinə Ağayeva <madina.aghayeva@…>" (dot between the email words, and the
    // display name spells it with Azerbaijani letters).
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return users
    return users.filter((u) => {
      const hay = `${u.name} ${u.email ?? ""}`.toLowerCase()
      return tokens.every((tok) => hay.includes(tok))
    })
  }, [users, q])
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 rounded-md border bg-background px-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchUsers")}
          className="w-full bg-transparent py-1.5 text-sm outline-none"
        />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-md border">
        {state === "loading" ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</p>
        ) : state === "error" ? (
          <p className="px-3 py-2 text-sm text-destructive">{t("loadUsersFailed")}</p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">—</p>
        ) : (
          filtered.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => onToggle(u.id)} />
              <span className="truncate">{u.name}</span>
              {u.email && <span className="ml-auto truncate text-xs text-muted-foreground">{u.email}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

// ── Inherited-access panel: shown when editing a SECTION under a department ───
// Members granted on the parent department inherit access to every section
// (Phase 2 cascade). This makes that inheritance VISIBLE and lets an admin
// override it per-section: "Deny here" materialises an explicit canView=false row
// (a section row overrides the inherited department grant); "Restore" removes it.
function InheritedAccessPanel({ division }: { division: Division }) {
  const t = useTranslations("board")
  const parentId = division.parentDivisionId
  const [deptMembers, setDeptMembers] = useState<{ id: string; name: string }[]>([])
  const [deniedHere, setDeniedHere] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!parentId) return
    setLoading(true)
    try {
      const [dept, sect] = await Promise.all([
        fetch(`/api/v1/board-permissions?divisionId=${encodeURIComponent(parentId)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`/api/v1/board-permissions?divisionId=${encodeURIComponent(division.id)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      const dms = ((dept?.data?.permissions ?? []) as { userId: string; canView: boolean; user?: { name: string } }[])
        .filter((p) => p.canView)
        .map((p) => ({ id: p.userId, name: p.user?.name ?? p.userId }))
      setDeptMembers(dms)
      // section rows with canView=false are explicit denies overriding the cascade
      setDeniedHere(new Set(((sect?.data?.permissions ?? []) as { userId: string; canView: boolean }[]).filter((p) => !p.canView).map((p) => p.userId)))
    } finally {
      setLoading(false)
    }
  }, [parentId, division.id])
  useEffect(() => { load() }, [load])

  const setDeny = async (userId: string, deny: boolean) => {
    setBusy(userId)
    try {
      if (deny) {
        await fetch("/api/v1/board-permissions", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          // Force every flag false: canView=false is the hard deny, but we also
          // zero the action flags so the stored row is unambiguous even if the
          // user previously had an explicit section grant (no leftover edit/move).
          body: JSON.stringify({
            userId, divisionId: division.id,
            canView: false, canEdit: false, canCreateTask: false, canComment: false,
            canMoveToTodo: false, canMoveToInProgress: false, canMoveToTesting: false,
            canMoveToReview: false, canMoveBack: false,
          }),
        })
      } else {
        await fetch(`/api/v1/board-permissions?userId=${encodeURIComponent(userId)}&divisionId=${encodeURIComponent(division.id)}`, { method: "DELETE", credentials: "include" })
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (!parentId) return null
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-medium">{t("inheritedAccessTitle")}</label>
      <p className="mb-2 text-xs text-muted-foreground">{t("inheritedAccessHint")}</p>
      <div className="max-h-40 overflow-y-auto rounded-md border">
        {loading ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</p>
        ) : deptMembers.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{t("noInheritedAccess")}</p>
        ) : (
          deptMembers.map((u) => {
            const denied = deniedHere.has(u.id)
            return (
              <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className={`truncate ${denied ? "text-muted-foreground line-through" : ""}`}>{u.name}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {denied ? t("deniedHere") : t("inheritedBadge")}
                </span>
                <button
                  onClick={() => setDeny(u.id, !denied)}
                  disabled={busy === u.id}
                  className="ml-auto rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {busy === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : denied ? t("restoreAccess") : t("denyHere")}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── Board card (shared by standalone boards + sections under a department) ────
function BoardCard({ d, canManage, onEdit }: { d: Division; canManage: boolean; onEdit: (d: Division) => void }) {
  const t = useTranslations("board")
  return (
    <div className="group relative rounded-lg border bg-card p-4 transition-shadow hover:shadow-md">
      <Link href={`/boards/${d.id}`} className="block">
        <div className="flex items-center justify-between">
          <span
            className="rounded px-2 py-0.5 text-xs font-bold tracking-wide text-white"
            style={{ background: d.color || "#EA580C" }}
          >
            {d.key}
          </span>
          {canManage ? (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(d) }}
              title={t("editBoard")}
              aria-label={t("editBoard")}
              className="-mr-1 -mt-1 rounded-md border bg-background p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : (
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
        <h2 className="mt-3 font-semibold leading-tight">{d.name}</h2>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("taskCount", { count: d._count?.tasks ?? 0 })}</span>
          {d.head && <span title={d.head.name}>{d.head.name}</span>}
        </div>
      </Link>
    </div>
  )
}

// ── Department group: collapsible header + its child section cards ────────────
function DepartmentGroup({ dept, sections, canManage, onEdit }: { dept: Division; sections: Division[]; canManage: boolean; onEdit: (d: Division) => void }) {
  const t = useTranslations("board")
  const [open, setOpen] = useState(true)
  const rollup = sections.reduce((sum, c) => sum + (c._count?.tasks ?? 0), 0)
  return (
    <div className="rounded-lg border bg-card/40">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? t("collapse") : t("expand")}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <FolderTree className="h-4 w-4 text-primary" />
        <Link href={`/boards/${dept.id}`} className="flex items-center gap-2 font-semibold hover:underline">
          <span
            className="rounded px-2 py-0.5 text-xs font-bold tracking-wide text-white"
            style={{ background: dept.color || "#6554C0" }}
          >
            {dept.key}
          </span>
          {dept.name}
        </Link>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("departmentBadge")}</span>
        <span className="text-xs text-muted-foreground">
          {t("sectionCount", { count: sections.length })} · {t("taskCount", { count: rollup })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/boards/${dept.id}`}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            {t("openDepartment")} <ArrowRight className="h-3 w-3" />
          </Link>
          {canManage && (
            <button
              onClick={() => onEdit(dept)}
              title={t("editBoard")}
              aria-label={t("editBoard")}
              className="rounded-md border bg-background p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t px-4 py-4">
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("departmentEmpty")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((s) => (
                <BoardCard key={s.id} d={s} canManage={canManage} onEdit={onEdit} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function BoardsIndexPage() {
  const t = useTranslations("board")
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer"
  const canManage = role === "admin" || role === "superadmin" || role === "manager"

  const [divisions, setDivisions] = useState<Division[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Division | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/divisions", { credentials: "include" })
      if (res.ok) {
        const j = await res.json()
        setDivisions(j?.data?.divisions ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Group for the index: departments (with their child sections nested) +
  // standalone boards (no parent, not a department) shown flat as before. A
  // section whose parent isn't in the visible set falls back to standalone so it
  // never disappears.
  const departments = useMemo(() => divisions.filter((d) => d.isDepartment), [divisions])
  const sectionsByParent = useMemo(() => {
    const m = new Map<string, Division[]>()
    for (const d of divisions) {
      if (d.parentDivisionId) {
        const arr = m.get(d.parentDivisionId) ?? []
        arr.push(d)
        m.set(d.parentDivisionId, arr)
      }
    }
    return m
  }, [divisions])
  const deptIds = useMemo(() => new Set(departments.map((d) => d.id)), [departments])
  const standalone = useMemo(
    () => divisions.filter((d) => !d.isDepartment && (!d.parentDivisionId || !deptIds.has(d.parentDivisionId))),
    [divisions, deptIds],
  )

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Columns3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold flex items-center gap-2">{t("boardsTitle")} <HelpButton slug="boards" variant="label" /></h1>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("createBoard")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : divisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <Columns3 className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">{t("noBoards")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("noBoardsHint")}</p>
          {canManage && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {t("createBoard")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Departments: each groups its child sections. */}
          {departments.map((dept) => (
            <DepartmentGroup
              key={dept.id}
              dept={dept}
              sections={sectionsByParent.get(dept.id) ?? []}
              canManage={canManage}
              onEdit={setEditTarget}
            />
          ))}
          {/* Standalone boards (no department) — flat grid, as before. */}
          {standalone.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {standalone.map((d) => (
                <BoardCard key={d.id} d={d} canManage={canManage} onEdit={setEditTarget} />
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateBoardDialog
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}
      {editTarget && (
        <EditBoardDialog
          division={editTarget}
          departments={departments}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load() }}
        />
      )}
    </div>
  )
}

// ── Type toggle (section/department) + parent-department selector ─────────────
function TypeParentFields({
  isDepartment, setIsDepartment, parentId, setParentId, departments, excludeId,
}: {
  isDepartment: boolean
  setIsDepartment: (b: boolean) => void
  parentId: string
  setParentId: (s: string) => void
  departments: Division[]
  excludeId?: string
}) {
  const t = useTranslations("board")
  const parentOptions = departments.filter((d) => d.id !== excludeId)
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium">{t("boardType")}</label>
      <div className="mb-1 inline-flex rounded-md border p-0.5">
        <button type="button" onClick={() => setIsDepartment(false)} className={`rounded px-3 py-1 text-sm ${!isDepartment ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t("typeSection")}</button>
        <button type="button" onClick={() => setIsDepartment(true)} className={`rounded px-3 py-1 text-sm ${isDepartment ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{t("typeDepartment")}</button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{isDepartment ? t("typeDepartmentHint") : t("typeSectionHint")}</p>
      {!isDepartment && (
        <>
          <label className="mb-1 block text-sm font-medium">{t("parentDepartment")}</label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">{t("parentNone")}</option>
            {parentOptions.map((d) => (
              <option key={d.id} value={d.id}>{d.name} ({d.key})</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

function CreateBoardDialog({ departments, onClose, onCreated }: { departments: Division[]; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("board")
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [color, setColor] = useState(SWATCHES[0])
  const [isDepartment, setIsDepartment] = useState(false)
  const [parentId, setParentId] = useState("")
  const [users, setUsers] = useState<OrgUser[]>([])
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [usersState, setUsersState] = useState<PickerState>("loading")

  useEffect(() => {
    let alive = true
    fetch("/api/v1/users/assignable", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return
        if (j) { setUsers(j.data ?? []); setUsersState("ready") } else setUsersState("error")
      })
      .catch(() => { if (alive) setUsersState("error") })
    return () => { alive = false }
  }, [])

  const toggleMember = (id: string) =>
    setMembers((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const valid = /^[A-Za-z0-9]{1,16}$/.test(key.trim()) && name.trim().length >= 1

  async function submit() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/divisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          key: key.trim().toUpperCase(),
          name: name.trim(),
          color,
          isDepartment,
          parentDivisionId: isDepartment ? null : (parentId || null),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || t("changeFailed"))
        return
      }
      const created = await res.json().catch(() => ({}))
      const divisionId = created?.data?.id
      if (divisionId && members.size > 0) {
        await Promise.all([...members].map((userId) =>
          fetch("/api/v1/board-permissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ userId, divisionId, ...MEMBER_FLAGS }),
          }).catch(() => {})
        ))
      }
      onCreated()
    } catch {
      setError(t("networkError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 pb-3 pt-6">
          <h2 className="text-lg font-bold">{t("createBoard")}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
        <label className="mb-1 block text-sm font-medium">{t("boardKey")}</label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          maxLength={16}
          placeholder="KHS"
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-primary/40"
        />

        <TypeParentFields
          isDepartment={isDepartment}
          setIsDepartment={setIsDepartment}
          parentId={parentId}
          setParentId={setParentId}
          departments={departments}
        />

        <label className="mb-1 block text-sm font-medium">{t("boardName")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />

        <div className="mb-4 flex items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={c}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{ background: c, borderColor: color === c ? "#172B4D" : "transparent" }}
            />
          ))}
        </div>

        <label className="mb-1 block text-sm font-medium">{t("members")}</label>
        <MemberPicker users={users} state={usersState} selected={members} onToggle={toggleMember} />
        <p className="mb-4 mt-1 text-xs text-muted-foreground">{t("membersHint")}</p>

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t px-6 py-4">
          <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">{t("cancel")}</button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("creating") : t("create")}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditBoardDialog({ division, departments, onClose, onSaved }: { division: Division; departments: Division[]; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("board")
  const [name, setName] = useState(division.name)
  const [color, setColor] = useState(division.color || SWATCHES[0])
  const [isDepartment, setIsDepartment] = useState(!!division.isDepartment)
  const [parentId, setParentId] = useState(division.parentDivisionId ?? "")
  const [users, setUsers] = useState<OrgUser[]>([])
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [original, setOriginal] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Board columns (custom-columns editor): seeded from board_columns (ordered),
  // or all six stages for a board that has none yet.
  const [cols, setCols] = useState<EditCol[]>(() =>
    division.boardColumns?.length
      ? [...division.boardColumns]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({ key: c.key, label: c.label, mapsToStatus: c.mapsToStatus, color: c.color }))
      : COLUMN_STAGES.map((s) => ({ label: s.label, mapsToStatus: s.key, color: null })),
  )

  const [usersState, setUsersState] = useState<PickerState>("loading")

  // Load org users (for the picker) + the board's current members in parallel.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch("/api/v1/users/assignable", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/v1/board-permissions?divisionId=${encodeURIComponent(division.id)}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([uj, pj]) => {
      if (!alive) return
      if (uj) { setUsers(uj.data ?? []); setUsersState("ready") } else setUsersState("error")
      if (pj) {
        const ids = new Set<string>(((pj.data?.permissions ?? []) as { userId: string; canView: boolean }[]).filter((p) => p.canView).map((p) => p.userId))
        setMembers(ids)
        setOriginal(ids)
      }
    })
    return () => { alive = false }
  }, [division.id])

  const toggleMember = (id: string) =>
    setMembers((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })


  // Name required; a board also needs ≥1 named column. A department has no columns.
  const valid = name.trim().length >= 1 && (isDepartment || (cols.length >= 1 && cols.every((c) => c.label.trim().length >= 1)))

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      // 1. Columns (the structural change) via the declarative columns route.
      //    Departments have no Kanban columns, so skip this for them.
      if (!isDepartment) {
        const colRes = await fetch(`/api/v1/divisions/${division.id}/columns`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            columns: cols.map((c) => ({ key: c.key, label: c.label.trim(), mapsToStatus: c.mapsToStatus, color: c.color })),
          }),
        })
        if (!colRes.ok) {
          const j = await colRes.json().catch(() => ({}))
          setError(j?.error || t("changeFailed"))
          return
        }
      }
      // 2. Name + accent color + hierarchy (type / parent department).
      const res = await fetch(`/api/v1/divisions/${division.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          color,
          isDepartment,
          parentDivisionId: isDepartment ? null : (parentId || null),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || t("changeFailed"))
        return
      }
      // Diff membership: grant the newly-checked, revoke the unchecked.
      const toAdd = [...members].filter((id) => !original.has(id))
      const toRemove = [...original].filter((id) => !members.has(id))
      const results = await Promise.allSettled([
        ...toAdd.map((userId) =>
          fetch("/api/v1/board-permissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ userId, divisionId: division.id, ...MEMBER_FLAGS }),
          }).then((r) => { if (!r.ok) throw new Error("grant failed") })),
        ...toRemove.map((userId) =>
          fetch(`/api/v1/board-permissions?userId=${encodeURIComponent(userId)}&divisionId=${encodeURIComponent(division.id)}`, {
            method: "DELETE",
            credentials: "include",
          }).then((r) => { if (!r.ok) throw new Error("revoke failed") })),
      ])
      // Surface partial access-change failures instead of silently "saving" — a
      // revoke that didn't apply means a removed user still has access. POST
      // (upsert) + DELETE (deleteMany) are idempotent, so retry is safe.
      if (results.some((r) => r.status === "rejected")) {
        setError(t("changeFailed"))
        return
      }
      onSaved()
    } catch {
      setError(t("networkError"))
    } finally {
      setSaving(false)
    }
  }

  async function importTasks() {
    if (importing) return
    if (typeof window !== "undefined" && !window.confirm(t("importConfirm"))) return
    setImporting(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/divisions/${division.id}/import-tasks`, { method: "POST", credentials: "include" })
      if (!res.ok) {
        setError(t("changeFailed"))
        return
      }
      const j = await res.json().catch(() => ({}))
      if (typeof window !== "undefined") window.alert(t("importDone", { count: j?.data?.moved ?? 0 }))
      onSaved()
    } catch {
      setError(t("networkError"))
    } finally {
      setImporting(false)
    }
  }

  async function archive() {
    if (archiving) return
    if (typeof window !== "undefined" && !window.confirm(t("archiveConfirm"))) return
    setArchiving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/divisions/${division.id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        setError(t("changeFailed"))
        return
      }
      onSaved()
    } catch {
      setError(t("networkError"))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-6 pb-3 pt-6">
          <h2 className="text-lg font-bold">{t("editBoard")} · {division.key}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
        <label className="mb-1 block text-sm font-medium">{t("boardName")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />

        <div className="mb-4 flex items-center gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={c}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{ background: c, borderColor: color === c ? "#172B4D" : "transparent" }}
            />
          ))}
        </div>

        <label className="mb-1 block text-sm font-medium">{t("members")}</label>
        <MemberPicker users={users} state={usersState} selected={members} onToggle={toggleMember} />
        <p className="mb-4 mt-1 text-xs text-muted-foreground">{t("membersHint")}</p>

        <InheritedAccessPanel division={division} />

        <TypeParentFields
          isDepartment={isDepartment}
          setIsDepartment={setIsDepartment}
          parentId={parentId}
          setParentId={setParentId}
          departments={departments}
          excludeId={division.id}
        />

        {!isDepartment && (
          <>
            <label className="mb-1 block text-sm font-medium">{t("columns")}</label>
            <BoardColumnsEditor value={cols} onChange={setCols} />
            <p className="mb-4 mt-1 text-xs text-muted-foreground">{t("columnsHint")}</p>

            <button
              onClick={importTasks}
              disabled={importing}
              className="mb-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("importTasks")}
            </button>
          </>
        )}

        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t px-6 py-4">
          <button
            onClick={archive}
            disabled={archiving}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
          >
            {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("archive")}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">{t("cancel")}</button>
            <button
              onClick={save}
              disabled={!valid || saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
