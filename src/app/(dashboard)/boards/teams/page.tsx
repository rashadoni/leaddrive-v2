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
 * (password, modules, 2FA) stays there. The section is the admin's alone.
 *
 * The look (owner, 2026-11-13, on the first cut: «как будто 2008-й год»): the
 * team list is a plain list of equal rows, not `data-crm-filter` pills — that
 * attribute makes the workspace stylesheet draw a bordered chip of the text's
 * own width. Lines are quiet, a choice in a cell reads as text until touched.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, Info, Loader2, Lock, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { PasswordActions, PasswordInput, PasswordRules, generateTemporaryPassword, passwordIsAcceptable } from "@/components/settings/password-field"
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
  const active = people.filter((p) => p.isActive !== false)
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
  // The section is the admin's: nobody else manages people, and a colleague's e-mail is not theirs to browse.
  if (!canManage && error !== "load") {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center px-6 pt-24 text-center" data-testid="teams-admin-only">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Lock className="h-5 w-5" aria-hidden="true" /></span>
        <h1 className="text-lg font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{t("adminOnlyPage")}</p>
      </div>
    )
  }
  const selectedTeam = teams.find((team) => team.id === selected) ?? null
  const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  // One row shape for «everyone» and for each team: the same width, the name whole, the head-count on the right.
  const teamRow = (on: boolean) => cn(
    "group/team relative flex h-10 items-center rounded-lg text-sm transition-colors duration-150",
    on ? "bg-muted text-foreground" : "text-foreground/75 hover:bg-muted/60 hover:text-foreground",
  )
  const teamButton = cn("flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left", ring)
  const count = "shrink-0 text-xs tabular-nums text-muted-foreground"
  // A cell's choice reads as text until the row is touched: no boxes down the column, the arrow in one line.
  const choice = cn(
    "peer h-8 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent pl-2.5 pr-8 text-sm transition-colors duration-150",
    "hover:border-input hover:bg-background focus-visible:border-input focus-visible:bg-background disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent",
    ring,
  )
  const arrow = "pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60 transition-colors peer-hover:text-foreground peer-focus-visible:text-foreground"
  const line = "border-border/60"

  return (
    <div className="mx-auto max-w-6xl pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-7">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <button type="button" data-crm-button="default" data-testid="teams-add-user" onClick={() => setAdding(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> {t("addUser")}
        </button>
      </header>
      {error && <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">{t(error === "load" ? "loadFailed" : error === "name" ? "nameTaken" : "saveFailed")}</p>}

      <div className="grid items-start gap-x-10 gap-y-8 md:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label={t("teams")} data-testid="teams-list" className="md:sticky md:top-4">
          <h2 className="mb-2 px-3 text-sm font-semibold">{t("teams")}</h2>
          <div className={teamRow(selected === "")}>
            <button type="button" aria-current={selected === "" ? "true" : undefined} onClick={() => setSelected("")} className={teamButton}>
              <span className={cn("min-w-0 flex-1 truncate", selected === "" && "font-medium")}>{t("allTeams")}</span>
              <span className={count}>{active.length}</span>
            </button>
          </div>
          {teams.map((team) => {
            const on = selected === team.id
            return (
              <div key={team.id} className={cn(teamRow(on), "mt-0.5")} data-testid="teams-team" data-team={team.id}>
                {renaming?.id === team.id ? (
                  <input
                    autoFocus
                    aria-label={`${t("rename")}: ${team.name}`}
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: team.id, name: e.target.value })}
                    onBlur={() => void renameTeam()}
                    onKeyDown={(e) => { if (e.key === "Enter") void renameTeam(); if (e.key === "Escape") setRenaming(null) }}
                    className={cn("h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm", ring)}
                  />
                ) : removing === team.id ? (
                  <>
                    <span className="min-w-0 flex-1 truncate px-3" title={team.name}>{team.name}</span>
                    <span className="mr-1.5 flex shrink-0 items-center gap-1">
                      <button type="button" data-testid="teams-team-remove-yes" onClick={() => void removeTeam(team.id)} className={cn("h-7 rounded-md bg-destructive/10 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/15", ring)}>{t("removeYes")}</button>
                      <button type="button" onClick={() => setRemoving(null)} className={cn("h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground", ring)}>{t("no")}</button>
                    </span>
                  </>
                ) : (
                  <>
                    <button type="button" aria-current={on ? "true" : undefined} onClick={() => setSelected(team.id)} className={teamButton}>
                      <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")} title={team.name}>{team.name}</span>
                      <span className={cn(count, "transition-opacity group-hover/team:opacity-0")}>{team.members.length}</span>
                    </button>
                    {/* The row's own actions take the head-count's place when the row is touched: the row never changes width. */}
                    <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/team:opacity-100">
                      <button type="button" title={t("rename")} aria-label={`${t("rename")}: ${team.name}`} onClick={() => setRenaming({ id: team.id, name: team.name })} className={cn("flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground", ring)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" title={t("removeTeam")} aria-label={`${t("removeTeam")}: ${team.name}`} data-testid="teams-team-remove" onClick={() => setRemoving(team.id)} className={cn("flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive", ring)}><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </>
                )}
              </div>
            )
          })}
          {removing && <p className="mt-2 px-3 text-xs leading-5 text-muted-foreground">{t("removeTeamHint")}</p>}
          <div className={cn("mt-2 border-t pt-2", line)}>
            {newTeam === null ? (
              <button type="button" data-testid="teams-create" onClick={() => setNewTeam("")} className={cn("flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground", ring)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> {t("createTeam")}
              </button>
            ) : (
              <input
                autoFocus
                data-testid="teams-create-name"
                aria-label={t("teamName")}
                value={newTeam}
                placeholder={t("teamName")}
                onChange={(e) => setNewTeam(e.target.value)}
                onBlur={() => void createTeam()}
                onKeyDown={(e) => { if (e.key === "Enter") void createTeam(); if (e.key === "Escape") setNewTeam(null) }}
                className={cn("h-10 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground", ring)}
              />
            )}
          </div>
        </nav>

        <section className="min-w-0" data-testid="teams-people" aria-labelledby="teams-people-title">
          <div className="mb-3 flex items-baseline gap-2 px-1">
            <h2 id="teams-people-title" className="truncate text-sm font-semibold">{selectedTeam?.name ?? t("allPeople")}</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{shown.length}</span>
          </div>
          <div className={cn("overflow-hidden rounded-xl border bg-card", line)}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className={cn("h-10 border-b text-left text-xs text-muted-foreground", line)}>
                    <th className="px-4 font-medium">{t("colName")}</th>
                    <th className="w-[17.5rem] px-4 font-medium">{t("colTeam")}</th>
                    <th className="w-[9rem] px-4 font-medium">{t("colTeamRole")}</th>
                    <th className="w-[9.5rem] px-4 font-medium">
                      <span className="inline-flex items-center gap-1.5" title={t("reportsHint")}>{t("colReports")} <Info className="h-3.5 w-3.5 opacity-70" aria-hidden="true" /></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((person) => {
                    const at = membership.get(person.id)
                    const admin = person.role === "admin" || person.role === "superadmin"
                    const reportsOpen = admin || !person.boardReportsHidden
                    return (
                      <tr key={person.id} className={cn("h-14 border-b transition-colors duration-150 last:border-0 hover:bg-muted/40", line)} data-testid="teams-person" data-user={person.id}>
                        <td className="px-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-medium tracking-tight text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100" aria-hidden="true">{initials(person.name)}</span>
                            <span className="min-w-0">
                              <span className="block truncate leading-5">{person.name}</span>
                              {person.email && <span className="block truncate text-xs leading-4 text-muted-foreground">{person.email}</span>}
                            </span>
                          </div>
                        </td>
                        <td className="px-4">
                          <span className="relative -ml-2.5 block">
                            <select data-testid="teams-person-team" aria-label={`${t("colTeam")}: ${person.name}`} value={at?.teamId ?? ""} onChange={(e) => void setTeam(person.id, e.target.value)} className={cn(choice, !at && "text-muted-foreground")}>
                              <option value="">{t("noTeam")}</option>
                              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                            </select>
                            <ChevronDown className={arrow} aria-hidden="true" />
                          </span>
                        </td>
                        <td className="px-4">
                          {at ? (
                            <span className="relative -ml-2.5 block">
                              <select data-testid="teams-person-role" aria-label={`${t("colTeamRole")}: ${person.name}`} value={at.role} onChange={(e) => void setRole(person.id, e.target.value as TeamRole)} className={cn(choice, at.role === "leader" && "font-medium")}>
                                <option value="member">{t("roleMember")}</option>
                                <option value="leader">{t("roleLeader")}</option>
                              </select>
                              <ChevronDown className={arrow} aria-hidden="true" />
                            </span>
                          ) : <span className="text-muted-foreground/70" aria-hidden="true">—</span>}
                        </td>
                        <td className="px-4">
                          {admin ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={t("reportsAlways")}><Check className="h-3.5 w-3.5" aria-hidden="true" /> {t("reportsAdmin")}</span>
                          ) : (
                            <button
                              type="button"
                              data-crm-color-role="toggle"
                              data-testid="teams-person-reports"
                              aria-pressed={reportsOpen}
                              aria-label={`${t("colReports")}: ${person.name}`}
                              title={t("reportsHint")}
                              onClick={() => void setReports(person, !reportsOpen)}
                              className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200", ring, reportsOpen ? "bg-emerald-600" : "bg-muted-foreground/35")}
                            >
                              <span className={cn("pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out", reportsOpen && "translate-x-4")} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">{t("nobody")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className={cn("border-t bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground", line)}>
              {t("fullCardHint")} <Link href="/settings/users" className={cn("rounded font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground", ring)}>{t("fullCardLink")}</Link>
            </p>
          </div>
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
  const [showPassword, setShowPassword] = useState(false)
  const [teamId, setTeamId] = useState(defaultTeam)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = name.trim().length > 0 && /.+@.+\..+/u.test(email.trim()) && passwordIsAcceptable(password)

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
  const field = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  const label = "mb-1.5 block text-sm font-medium"

  return (
    // A window taller than a laptop's screen (the password's rules) scrolls as a whole instead of losing its top and its buttons.
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-black/50 p-4" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
      <div data-crm-dialog="" role="dialog" aria-modal="true" aria-labelledby="team-user-title" className="m-auto w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="team-user-title" className="text-lg font-semibold tracking-tight">{t("addUser")}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("addUserHint")}</p>
          </div>
          <button type="button" aria-label={t("close")} onClick={onClose} className="-mr-1.5 -mt-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="team-user-name">{t("colName")}</label>
            <input id="team-user-name" data-testid="teams-new-user-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="team-user-email">{t("email")}</label>
            <input id="team-user-email" data-testid="teams-new-user-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ad.soyad@company.az" className={field} />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="block text-sm font-medium" htmlFor="team-user-password">{t("password")}</label>
              <PasswordActions
                className="mt-0"
                value={password}
                onGenerate={() => {
                  setPassword(generateTemporaryPassword())
                  // A password made up here has to be read to be handed over.
                  setShowPassword(true)
                }}
              />
            </div>
            {/* The same box as «Ayarlar → İstifadəçilər» (owner, 2026-11-14: «Да, добавь» — «и показать пароль»): the
                server's rules while typing, the eye, «make one up» and «copy» — the admin hands the password over. */}
            <PasswordInput
              id="team-user-password"
              name="new-user-password"
              testId="teams-new-user-password"
              value={password}
              onChange={setPassword}
              visible={showPassword}
              onToggleVisible={() => setShowPassword((shown) => !shown)}
              describedBy="team-user-password-rules"
              invalid={password !== "" && !passwordIsAcceptable(password)}
              className="bg-background focus-visible:border-input focus-visible:ring-ring/50"
            />
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t("passwordHint")}</p>
            <PasswordRules id="team-user-password-rules" password={password} />
          </div>
          <div>
            <label className={label} htmlFor="team-user-team">{t("colTeam")}</label>
            <select id="team-user-team" data-testid="teams-new-user-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={field}>
              <option value="">{t("noTeam")}</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{t("cancel")}</button>
          <button type="button" data-crm-button="default" data-testid="teams-new-user-save" disabled={!valid || saving} onClick={() => void submit()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("add")}
          </button>
        </div>
      </div>
    </div>
  )
}
