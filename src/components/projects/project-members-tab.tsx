"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Plus, Trash2, Users, X } from "lucide-react"
import { getCurrencySymbol } from "@/lib/constants"
import { type ProjectMember, formatDate } from "./project-types"

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
]

const ROLE_DOTS: Record<string, string> = {
  manager: "bg-blue-500",
  member: "bg-green-500",
  viewer: "bg-gray-400",
}

interface ProjectMembersTabProps {
  projectId: string
  members: ProjectMember[]
  users: { id: string; name: string }[]
  currency: string
  headers: Record<string, string>
  onRefresh: () => void
  getUserName: (id?: string) => string
}

export function ProjectMembersTab({ projectId, members, users, currency, headers, onRefresh, getUserName }: ProjectMembersTabProps) {
  const t = useTranslations("projects")
  const locale = useLocale()
  const sym = getCurrencySymbol(currency)

  const [showForm, setShowForm] = useState(false)
  const [memberUserId, setMemberUserId] = useState("")
  const [memberRole, setMemberRole] = useState("member")

  const roleLabels: Record<string, string> = {
    manager: t("roleManager"), member: t("roleMember"), viewer: t("roleViewer"),
  }

  function getAvatarColor(name: string) {
    const idx = name.charCodeAt(0) % AVATAR_COLORS.length
    return AVATAR_COLORS[idx]
  }

  async function handleAddMember() {
    if (!memberUserId) return
    await fetch(`/api/v1/projects/${projectId}/members`, {
      method: "POST", headers, body: JSON.stringify({ userId: memberUserId, role: memberRole }),
    })
    setShowForm(false); setMemberUserId(""); setMemberRole("member"); onRefresh()
  }

  async function removeMember(memberId: string) {
    await fetch(`/api/v1/projects/${projectId}/members?memberId=${memberId}`, { method: "DELETE", headers })
    onRefresh()
  }

  async function updateMemberRole(memberId: string, role: string) {
    await fetch(`/api/v1/projects/${projectId}/members`, {
      method: "PUT", headers, body: JSON.stringify({ memberId, role }),
    })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t("addMember")}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("addMember")}</h3>
            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-muted rounded transition-colors"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={memberUserId} onChange={e => setMemberUserId(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">— {t("selectManager")} —</option>
              {users.filter(u => !members.some(m => m.userId === u.id)).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select value={memberRole} onChange={e => setMemberRole(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>{t("cancel")}</Button>
            <Button size="sm" onClick={handleAddMember} disabled={!memberUserId}>{t("create")}</Button>
          </div>
        </div>
      )}

      {members.length > 0 ? (
        <div className="rounded-xl border border-zinc-200/60 dark:border-zinc-700/60 bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200/40 dark:border-zinc-700/40 bg-primary/[0.03]">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("members")}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("role")}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("estimatedHours")}</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{t("joined")}</th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const userName = getUserName(m.userId)
                return (
                  <tr key={m.id} className="border-b border-zinc-200 dark:border-zinc-700/20 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${getAvatarColor(userName)}`}>
                          {userName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{userName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${ROLE_DOTS[m.role] || "bg-gray-400"}`} />
                        <select value={m.role} onChange={e => updateMemberRole(m.id, e.target.value)}
                          className="text-xs px-2 py-1 rounded-lg border border-input bg-background font-medium cursor-pointer">
                          {Object.entries(roleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {m.hoursLogged}h{m.hourlyRate ? ` · ${sym}${m.hourlyRate}/h` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{formatDate(m.joinedAt, locale)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => removeMember(m.id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">{t("noMembers")}</p>
        </div>
      )}
    </div>
  )
}
