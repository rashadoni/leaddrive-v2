"use client"

/**
 * «Komandalar və istifadəçilər» — Bordio's «Teams & Users» (owner, 2026-11-13:
 * «нужно добавить раздел teams and users с тем же функционалом»; mockup →
 * «Да, делай»). Teams on the left; on the right the organization's people with
 * their team, their role in it, whether they see the boards' reports, and
 * whether they are active.
 *
 * The people are the organization's users — the same rows «Ayarlar →
 * İstifadəçilər» shows (owner: «пользователь, который создаётся в разделе
 * команда, чтоб был виден и в разделе пользователи») — a person added here is
 * made through the same API and is there at once; the rest of the card
 * (password, modules, 2FA) stays there. Only the admin changes anything.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Loader2, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { orgFromSession } from "@/lib/nav-items"
import { tenantHideableModules } from "@/lib/user-module-access"
import type { TeamDTO, TeamRole } from "@/lib/tasks/board-teams"

interface Person {
  id: string
  name: string
  email?: string
  role: string
  isActive?: boolean
  boardReportsHidden?: boolean
}

const initials = (name: string) => name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")

export default function TeamsAndUsersPage() {
  const t = useTranslations("boardTeams")
  const { data: session } = useSession()
  const [teams, setTeams] = useState<TeamDTO[] | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [people, setPeople] = useState<Person[]>([])
  const [selected, setSelected] = useState<string>("") // "" = everyone
  // What went wrong, by kind — the words are picked when drawn, so reading the
  // page never depends on the translator's identity.
  const [error, setError] = useState<"load" | "save" | "name" | null>(null)
  const [newTeam, setNewTeam] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const [teamsRes, usersRes] = await Promise.all([
      fetch("/api/v1/tasks/teams", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/v1/users", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (!teamsRes) { setError("load"); setTeams([]); return }
    setTeams(teamsRes.data.teams)
    setCanManage(teamsRes.data.canManage === true)
    setPeople(Array.isArray(usersRes?.data) ? usersRes.data : [])
  }, [])
  useEffect(() => { void load() }, [load])

  // Who is where: read off the teams, so one answer decides every column.
  const membership = useMemo(() => {
    const map = new Map<string, { teamId: string; role: TeamRole }>()
    for (const team of teams ?? []) for (const member of team.members) map.set(member.userId, { teamId: team.id, role: member.role })
    return map
  }, [teams])
  // Without the right to read the users (a member looking at the page) the teams' own people are shown.
  const rows: Person[] = useMemo(() => {
    if (people.length > 0) return people
    return (teams ?? []).flatMap((team) => team.members.map((m) => ({ id: m.userId, name: m.name, role: "" })))
  }, [people, teams])
  const active = rows.filter((p) => p.isActive !== false)
  const shown = selected ? active.filter((p) => membership.get(p.id)?.teamId === selected) : active

  const send = async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setError(null)
    const res = await fetch(url, {
      method, credentials: "include",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }).catch(() => null)
    if (!res?.ok) {
      const json = await res?.json().catch(() => null)
      setError(json?.code === "TEAM_NAME_TAKEN" ? "name" : "save")
      return false
    }
    return true
  }
  const createTeam = async () => {
    const name = (newTeam ?? "").trim()
    if (!name) { setNewTeam(null); return }
    if (await send("/api/v1/tasks/teams", "POST", { name })) { setNewTeam(null); await load() }
  }
  const renameTeam = async () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (name && await send(`/api/v1/tasks/teams/${renaming.id}`, "PATCH", { name })) await load()
    setRenaming(null)
  }
  const removeTeam = async (id: string) => {
    if (await send(`/api/v1/tasks/teams/${id}`, "DELETE")) { if (selected === id) setSelected(""); await load() }
    setRemoving(null)
  }
  const setTeam = async (userId: string, teamId: string) => {
    if (await send("/api/v1/tasks/teams/members", "PUT", { userId, teamId: teamId || null })) await load()
  }
  const setRole = async (userId: string, role: TeamRole) => {
    const teamId = membership.get(userId)?.teamId
    if (teamId && await send("/api/v1/tasks/teams/members", "PUT", { userId, teamId, role })) await load()
  }
  const setReports = async (person: Person, open: boolean) => {
    setPeople((list) => list.map((p) => (p.id === person.id ? { ...p, boardReportsHidden: !open } : p)))
    if (!(await send(`/api/v1/users/${person.id}`, "PUT", { boardReportsHidden: !open }))) await load()
  }

  // A person added here works on the boards: the other sections stay closed until the admin opens them on the user card.
  const boardsOnly = useMemo(
    () => tenantHideableModules(orgFromSession(session?.user)).filter((id) => id !== "boards"),
    [session?.user?.id, session?.user?.organizationId], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (teams === null) {
    return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("loading")}</p>
  }
  const select = "h-8 max-w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm hover:border-border focus:border-border disabled:opacity-70"

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-16">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        {canManage && (
          <button type="button" data-crm-button="default" data-testid="teams-add-user" onClick={() => setAdding(true)} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
            <UserPlus className="h-4 w-4" aria-hidden="true" /> {t("addUser")}
          </button>
        )}
      </div>
      {!canManage && <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t("adminOnly")}</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{t(error === "load" ? "loadFailed" : error === "name" ? "nameTaken" : "saveFailed")}</p>}

      <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-3" data-testid="teams-list">
          <h2 className="mb-2 px-2 text-base font-medium">{t("teams")}</h2>
          <button type="button" data-crm-filter="" data-state={selected === "" ? "active" : "inactive"} onClick={() => setSelected("")} className="flex h-9 w-full items-center justify-between px-2 text-sm">
            <span>{t("allTeams")}</span><span className="text-xs text-muted-foreground">{active.length}</span>
          </button>
          {teams.map((team) => (
            <div key={team.id} className="group flex items-center gap-1" data-testid="teams-team" data-team={team.id}>
              {renaming?.id === team.id ? (
                <input
                  autoFocus
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: team.id, name: e.target.value })}
                  onBlur={() => void renameTeam()}
                  onKeyDown={(e) => { if (e.key === "Enter") void renameTeam(); if (e.key === "Escape") setRenaming(null) }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                />
              ) : (
                <button type="button" data-crm-filter="" data-state={selected === team.id ? "active" : "inactive"} onClick={() => setSelected(team.id)} className="flex h-9 min-w-0 flex-1 items-center justify-between gap-2 px-2 text-sm">
                  <span className="truncate">{team.name}</span><span className="shrink-0 text-xs text-muted-foreground">{team.members.length}</span>
                </button>
              )}
              {canManage && renaming?.id !== team.id && (removing === team.id ? (
                <span className="flex shrink-0 items-center gap-1 text-xs">
                  <button type="button" data-testid="teams-team-remove-yes" onClick={() => void removeTeam(team.id)} className="rounded border border-destructive/50 px-1.5 py-0.5 text-destructive">{t("removeYes")}</button>
                  <button type="button" onClick={() => setRemoving(null)} className="rounded border px-1.5 py-0.5">{t("no")}</button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" title={t("rename")} aria-label={`${t("rename")}: ${team.name}`} onClick={() => setRenaming({ id: team.id, name: team.name })} className="rounded p-1 text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" title={t("removeTeam")} aria-label={`${t("removeTeam")}: ${team.name}`} data-testid="teams-team-remove" onClick={() => setRemoving(team.id)} className="rounded p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              ))}
            </div>
          ))}
          {canManage && (newTeam === null ? (
            <button type="button" data-testid="teams-create" onClick={() => setNewTeam("")} className="mt-1 flex h-9 w-full items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="h-4 w-4" aria-hidden="true" /> {t("createTeam")}
            </button>
          ) : (
            <input
              autoFocus
              data-testid="teams-create-name"
              value={newTeam}
              placeholder={t("teamName")}
              onChange={(e) => setNewTeam(e.target.value)}
              onBlur={() => void createTeam()}
              onKeyDown={(e) => { if (e.key === "Enter") void createTeam(); if (e.key === "Escape") setNewTeam(null) }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          ))}
          {removing && <p className="mt-2 px-2 text-xs text-muted-foreground">{t("removeTeamHint")}</p>}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card" data-testid="teams-people">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="h-11 border-b border-border text-left text-muted-foreground">
                  <th className="px-3.5 font-normal">{t("colName")} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">{shown.length}</span></th>
                  <th className="px-3.5 font-normal">{t("colTeam")}</th>
                  <th className="px-3.5 font-normal">{t("colTeamRole")}</th>
                  <th className="px-3.5 font-normal" title={t("reportsHint")}>{t("colReports")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => {
                  const at = membership.get(person.id)
                  const admin = person.role === "admin" || person.role === "superadmin"
                  const reportsOpen = admin || !person.boardReportsHidden
                  return (
                    <tr key={person.id} className="h-[49px] border-b border-border last:border-0 hover:bg-muted/40" data-testid="teams-person" data-user={person.id}>
                      <td className="px-3.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-muted-foreground" aria-hidden="true">{initials(person.name)}</span>
                          <span className="min-w-0">
                            <span className="block truncate">{person.name}</span>
                            {person.email && <span className="block truncate text-xs text-muted-foreground">{person.email}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="border-l border-border px-2">
                        <select data-testid="teams-person-team" aria-label={`${t("colTeam")}: ${person.name}`} disabled={!canManage} value={at?.teamId ?? ""} onChange={(e) => void setTeam(person.id, e.target.value)} className={select}>
                          <option value="">{t("noTeam")}</option>
                          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                      </td>
                      <td className="border-l border-border px-2">
                        {at ? (
                          <select data-testid="teams-person-role" aria-label={`${t("colTeamRole")}: ${person.name}`} disabled={!canManage} value={at.role} onChange={(e) => void setRole(person.id, e.target.value as TeamRole)} className={select}>
                            <option value="member">{t("roleMember")}</option>
                            <option value="leader">{t("roleLeader")}</option>
                          </select>
                        ) : <span className="px-1.5 text-muted-foreground">–</span>}
                      </td>
                      <td className="border-l border-border px-3.5">
                        {people.length === 0 ? <span className="text-muted-foreground">–</span> : admin ? (
                          <span className="text-muted-foreground" title={t("reportsAlways")}>✓ {t("reportsAdmin")}</span>
                        ) : (
                          <button
                            type="button"
                            data-crm-color-role="toggle"
                            data-testid="teams-person-reports"
                            disabled={!canManage}
                            aria-pressed={reportsOpen}
                            aria-label={`${t("colReports")}: ${person.name}`}
                            title={t("reportsHint")}
                            onClick={() => void setReports(person, !reportsOpen)}
                            className={cn("relative inline-flex h-[18px] w-[30px] shrink-0 rounded-full transition-colors disabled:opacity-60", reportsOpen ? "bg-emerald-600" : "bg-muted-foreground/40")}
                          >
                            <span className={cn("pointer-events-none absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all", reportsOpen ? "left-[14px]" : "left-0.5")} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={4} className="px-3.5 py-8 text-center text-muted-foreground">{t("nobody")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {canManage && (
            <p className="border-t border-border px-3.5 py-2.5 text-xs text-muted-foreground">
              {t("fullCardHint")} <Link href="/settings/users" className="underline hover:text-foreground">{t("fullCardLink")}</Link>
            </p>
          )}
        </section>
      </div>

      {adding && (
        <AddUserDialog
          teams={teams}
          defaultTeam={selected}
          hiddenModules={boardsOnly}
          onClose={() => setAdding(false)}
          onAdded={async () => { setAdding(false); await load() }}
        />
      )}
    </div>
  )
}

function AddUserDialog({ teams, defaultTeam, hiddenModules, onClose, onAdded }: {
  teams: readonly TeamDTO[]
  defaultTeam: string
  hiddenModules: readonly string[]
  onClose: () => void
  onAdded: () => void | Promise<void>
}) {
  const t = useTranslations("boardTeams")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [teamId, setTeamId] = useState(defaultTeam)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = name.trim().length > 0 && /.+@.+\..+/u.test(email.trim()) && password.length > 0

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/users", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role: "sales", hiddenModules }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(typeof json?.error === "string" ? json.error : t("saveFailed")); return }
      const userId = json?.data?.id
      if (userId && teamId) {
        await fetch("/api/v1/tasks/teams/members", {
          method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, teamId }),
        }).catch(() => null)
      }
      await onAdded()
    } catch {
      setError(t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }
  const field = "mb-3 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div data-crm-dialog="" role="dialog" aria-modal="true" aria-label={t("addUser")} className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("addUser")}</h2>
          <button type="button" aria-label={t("close")} onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <label className="mb-1 block text-sm font-medium" htmlFor="team-user-name">{t("colName")}</label>
        <input id="team-user-name" data-testid="teams-new-user-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
        <label className="mb-1 block text-sm font-medium" htmlFor="team-user-email">{t("email")}</label>
        <input id="team-user-email" data-testid="teams-new-user-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ad.soyad@company.az" className={field} />
        <label className="mb-1 block text-sm font-medium" htmlFor="team-user-password">{t("password")}</label>
        <input id="team-user-password" data-testid="teams-new-user-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        <label className="mb-1 block text-sm font-medium" htmlFor="team-user-team">{t("colTeam")}</label>
        <select id="team-user-team" data-testid="teams-new-user-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={field}>
          <option value="">{t("noTeam")}</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <p className="mb-3 text-xs text-muted-foreground">{t("addUserHint")}</p>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-3 text-sm">{t("cancel")}</button>
          <button type="button" data-crm-button="default" data-testid="teams-new-user-save" disabled={!valid || saving} onClick={() => void submit()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("add")}
          </button>
        </div>
      </div>
    </div>
  )
}
