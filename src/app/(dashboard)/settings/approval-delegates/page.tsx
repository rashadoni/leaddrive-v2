"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { ArrowLeft, Plus, Trash2, UserCheck, Calendar, Loader2 } from "lucide-react"
import Link from "next/link"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

type Delegate = {
  id: string
  toUserId: string
  startDate: string
  endDate: string
  reason: string | null
  isActive: boolean
  createdAt: string
  toUser: {
    id: string
    name: string
    email: string
    avatar: string | null
  }
}

type OrgUser = {
  id: string
  name: string
  email: string
}

export default function ApprovalDelegatesPage() {
  const { data: session } = useSession()
  const t = useTranslations("approvalDelegates")
  const tc = useTranslations("common")
  useAutoTour("approvalDelegates")
  const orgId = session?.user?.organizationId

  const [delegates, setDelegates] = useState<Delegate[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  const [form, setForm] = useState({
    toUserId: "",
    startDate: "",
    endDate: "",
    reason: "",
  })

  const headers: Record<string, string> = orgId
    ? { "x-organization-id": String(orgId) }
    : {}

  const fetchDelegates = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const res = await fetch("/api/v1/users/me/approval-delegates", { headers })
      const json = await res.json()
      if (json.success) setDelegates(json.data)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const fetchOrgUsers = useCallback(async () => {
    if (!orgId) return
    setUsersLoading(true)
    try {
      const res = await fetch("/api/v1/users?isActive=true", { headers })
      const json = await res.json()
      if (json.success) setOrgUsers(json.data ?? [])
    } finally {
      setUsersLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (orgId) void fetchDelegates()
  }, [orgId, fetchDelegates])

  function openCreate() {
    setForm({ toUserId: "", startDate: "", endDate: "", reason: "" })
    setCreateError(null)
    setCreateOpen(true)
    void fetchOrgUsers()
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch("/api/v1/users/me/approval-delegates", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId: form.toUserId,
          startDate: new Date(form.startDate).toISOString(),
          endDate: new Date(form.endDate).toISOString(),
          reason: form.reason || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error ?? "Failed to create delegation")
        return
      }
      setCreateOpen(false)
      await fetchDelegates()
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await fetch(`/api/v1/users/me/approval-delegates/${id}`, {
        method: "DELETE",
        headers,
      })
      await fetchDelegates()
    } finally {
      setDeletingId(null)
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  function isActive(d: Delegate) {
    const now = Date.now()
    return d.isActive && new Date(d.startDate).getTime() <= now && new Date(d.endDate).getTime() >= now
  }

  function isUpcoming(d: Delegate) {
    return d.isActive && new Date(d.startDate).getTime() > Date.now()
  }

  const currentUserId = (session?.user as { id?: string })?.id

  return (
    <div className="space-y-6">
      <div data-tour-id="approval-delegates-header" className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UserCheck className="h-6 w-6 text-primary" />
            {t("title")}
            <TourReplayButton tourId="approvalDelegates" />
            <HelpButton slug="approval-delegates" variant="label" />
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
          <PageDescription text={t("pageDescription")} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button data-tour-id="approval-delegates-new" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addDelegation")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : delegates.length === 0 ? (
        <Card data-tour-id="approval-delegates-list">
          <CardContent className="py-12 text-center text-muted-foreground">
            <UserCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{t("empty")}</p>
            <p className="text-sm mt-1">{t("emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div data-tour-id="approval-delegates-list" className="grid gap-3">
          {delegates.map((d) => (
            <Card key={d.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 flex-shrink-0">
                      <UserCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {t("delegateTo")}: <span className="text-primary">{d.toUser.name}</span>
                      </p>
                      <p className="text-sm text-muted-foreground truncate">{d.toUser.email}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {formatDate(d.startDate)} → {formatDate(d.endDate)}
                        </div>
                        {d.reason && (
                          <Badge variant="outline" className="text-xs">
                            {d.reason}
                          </Badge>
                        )}
                        {isActive(d) && (
                          <Badge variant="default" className="text-xs bg-green-600">
                            {t("active")}
                          </Badge>
                        )}
                        {isUpcoming(d) && (
                          <Badge variant="secondary" className="text-xs">
                            {t("upcoming")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(d.id)}
                    disabled={deletingId === d.id}
                    className="flex-shrink-0 text-destructive hover:text-destructive"
                  >
                    {deletingId === d.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>{t("delegateTo")}</Label>
              {usersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tc("loading")}
                </div>
              ) : (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={form.toUserId}
                  onChange={(e) => setForm((f) => ({ ...f, toUserId: e.target.value }))}
                  required
                >
                  <option value="">{t("selectUser")}</option>
                  {orgUsers
                    .filter((u) => u.id !== currentUserId)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("startDate")}</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("endDate")}</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                {t("reason")} <span className="text-muted-foreground text-xs">({tc("optional")})</span>
              </Label>
              <Input
                placeholder={t("reasonPlaceholder")}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                maxLength={100}
              />
            </div>

            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
