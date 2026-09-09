"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { SkillPicker } from "@/components/skill-picker"
import { Button } from "@/components/ui/button"
import { Loader2, Check, BadgeCheck, AlertCircle } from "lucide-react"

interface Agent {
  id: string
  name: string
  role: string
  skills: string[]
  isAvailable: boolean
}

const ROLE_ROUTABLE = ["admin", "manager", "agent"]

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

/**
 * Manage which skills each agent handles, in one place (instead of editing each user deep in
 * Settings). Options come from the org's queue skills — agents pick, they don't type — and each
 * change auto-saves via PUT /api/v1/users/:id { skills } (the schema accepts a partial update).
 */
export function AgentSkillsManager() {
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const t = useTranslations("skillRouting")
  const [agents, setAgents] = useState<Agent[]>([])
  const [available, setAvailable] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  const fetchData = useCallback(async () => {
    if (!orgId) return
    const headers = { "x-organization-id": String(orgId) }
    setLoadError(false)
    try {
      const [uRes, qRes] = await Promise.all([
        fetch("/api/v1/users", { headers }),
        fetch("/api/v1/ticket-queues", { headers }),
      ])
      // A failed agent fetch must NOT silently look like "no agents" — surface it honestly.
      if (uRes.ok) {
        const j = await uRes.json()
        setAgents((j.data || []).filter((u: Agent) => ROLE_ROUTABLE.includes(u.role)))
      } else {
        setLoadError(true)
      }
      if (qRes.ok) {
        const j = await qRes.json().catch(() => ({}))
        setAvailable(Array.from(new Set((j.data || []).flatMap((q: { skills?: string[] }) => q.skills || []))) as string[])
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const saveSkills = async (id: string, skills: string[]) => {
    const prevSkills = agents.find((a) => a.id === id)?.skills ?? [] // for revert-on-failure
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, skills } : a))) // optimistic
    setSavingId(id)
    setSavedId(null)
    setErrorId(null)
    const fail = () => {
      // revert the optimistic change so the UI never shows an unsaved value
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, skills: prevSkills } : a)))
      setSavedId((s) => (s === id ? null : s)) // never show Check + error together
      setErrorId(id)
    }
    try {
      const res = await fetch(`/api/v1/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify({ skills }),
      })
      if (res.ok) {
        setSavedId(id)
        setTimeout(() => setSavedId((s) => (s === id ? null : s)), 1500)
      } else {
        fail()
      }
    } catch {
      fail()
    } finally {
      setSavingId((s) => (s === id ? null : s))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck className="h-4 w-4 text-primary" /> {t("agentSkills")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("agentSkillsHint")}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> …
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="flex items-center gap-1.5 text-sm text-red-500">
              <AlertCircle className="h-4 w-4" /> {t("loadFailed")}
            </p>
            <Button variant="outline" size="sm" onClick={() => fetchData()}>{t("retry")}</Button>
          </div>
        ) : agents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("noAgents")}</p>
        ) : (
          <div className="divide-y">
            {agents.map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {initials(a.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-sm font-medium">{a.name}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.role}</span>
                    {savingId === a.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    {savedId === a.id && <Check className="h-3 w-3 text-green-600" />}
                    {errorId === a.id && <AlertCircle className="h-3 w-3 text-red-500" aria-label={t("saveFailed")} />}
                  </div>
                  <SkillPicker
                    value={a.skills}
                    onChange={(skills) => saveSkills(a.id, skills)}
                    options={available}
                    emptyHint={t("noSkillsHint")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
