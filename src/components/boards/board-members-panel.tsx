"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { MEMBER_FLAGS, MemberPicker, type OrgUser, type PickerState } from "@/components/boards/member-picker"

interface PermissionRow { userId: string; canView: boolean; user?: { id: string; name: string } | null }

async function readPermissions(divisionId: string): Promise<PermissionRow[] | null> {
  const res = await fetch(`/api/v1/board-permissions?divisionId=${encodeURIComponent(divisionId)}`, { credentials: "include" }).catch(() => null)
  if (!res?.ok) return null
  const json = await res.json().catch(() => null)
  return (json?.data?.permissions ?? []) as PermissionRow[]
}

/**
 * «Üzvlər» — who works on this board (Bordio's Members tool). The same grants
 * the board's edit dialog writes (`BoardPermission`, full access): tick people
 * and press «Yadda saxla». People who come with the department are listed
 * apart — they are given or taken on the department, not here. Admins see every
 * board and are not listed. Only for the roles that may manage a board (the
 * permissions API refuses everyone else).
 */
export function BoardMembersPanel({ divisionId, parentDivisionId, parentName }: {
  divisionId: string
  parentDivisionId?: string | null
  parentName?: string | null
}) {
  const t = useTranslations("board")
  const [users, setUsers] = useState<OrgUser[]>([])
  const [usersState, setUsersState] = useState<PickerState>("loading")
  const [original, setOriginal] = useState<Set<string>>(new Set())
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [inherited, setInherited] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch("/api/v1/users/assignable", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      readPermissions(divisionId),
      parentDivisionId ? readPermissions(parentDivisionId) : Promise.resolve([] as PermissionRow[]),
    ]).then(([usersRes, own, parent]) => {
      if (!alive) return
      if (usersRes) { setUsers(usersRes.data ?? []); setUsersState("ready") } else setUsersState("error")
      const direct = new Set((own ?? []).filter((row) => row.canView).map((row) => row.userId))
      const deniedHere = new Set((own ?? []).filter((row) => !row.canView).map((row) => row.userId))
      setOriginal(direct)
      setMembers(new Set(direct))
      setInherited((parent ?? [])
        .filter((row) => row.canView && !deniedHere.has(row.userId))
        .map((row) => ({ id: row.userId, name: row.user?.name ?? row.userId })))
    })
    return () => { alive = false }
  }, [divisionId, parentDivisionId, reloadKey])

  const changed = useMemo(
    () => members.size !== original.size || [...members].some((id) => !original.has(id)),
    [members, original],
  )

  async function save() {
    if (!changed || saving) return
    setSaving(true)
    setMessage(null)
    const toAdd = [...members].filter((id) => !original.has(id))
    const toRemove = [...original].filter((id) => !members.has(id))
    const results = await Promise.allSettled([
      ...toAdd.map((userId) => fetch("/api/v1/board-permissions", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ userId, divisionId, ...MEMBER_FLAGS }),
      }).then((r) => { if (!r.ok) throw new Error("grant") })),
      ...toRemove.map((userId) => fetch(`/api/v1/board-permissions?userId=${encodeURIComponent(userId)}&divisionId=${encodeURIComponent(divisionId)}`, {
        method: "DELETE", credentials: "include",
      }).then((r) => { if (!r.ok) throw new Error("revoke") })),
    ])
    const failed = results.some((result) => result.status === "rejected")
    setMessage({ ok: !failed, text: failed ? t("changeFailed") : t("membersSaved") })
    setReloadKey((key) => key + 1)
    setSaving(false)
  }

  return (
    <div className="max-w-2xl px-5 pb-8 pt-3" data-testid="board-members">
      <p className="mb-3 text-sm text-muted-foreground">{t("membersAdminsNote")}</p>

      <h2 className="mb-1 text-sm font-semibold">{t("membersDirect")}</h2>
      <MemberPicker
        users={users}
        state={usersState}
        selected={members}
        onToggle={(id) => setMembers((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })}
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          data-crm-button="default"
          onClick={save}
          disabled={!changed || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("membersSave")}
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>{message.text}</span>}
      </div>

      {parentDivisionId && (
        <div className="mt-6">
          <h2 className="mb-1 text-sm font-semibold">{t("membersFromDepartment", { name: parentName ?? "" })}</h2>
          {inherited.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInheritedAccess")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {inherited.map((person) => (
                <li key={person.id} className="rounded-full border px-2.5 py-0.5 text-sm">{person.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
