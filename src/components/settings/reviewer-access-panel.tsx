"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { Copy, Eye, Loader2, ShieldCheck, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { isCrmCapabilityAvailable } from "@/lib/crm-product-availability"
import { navItems, orgFromSession } from "@/lib/nav-items"
import { tenantHideableModules, USER_HIDEABLE_MODULE_IDS, WORKFORCE_HIDEABLE_ID } from "@/lib/user-module-access"
import { REVIEWER_MAX_DAYS } from "@/lib/reviewer-access"

/**
 * Outside reviewer under NDA (src/lib/reviewer-access.ts): the admin gives
 * read-only access to the ticked sections until a date at most 30 days out,
 * sees how many days are left, closes it at any moment, and reads the journal
 * of everything the reviewer opened. Admins only; the API refuses everyone else.
 */

interface Grant {
  id: string
  name: string
  email: string
  modules: string[]
  reason: string
  expiresAt: string
  createdAt: string
  revokedAt: string | null
  lastLogin: string | null
  open: boolean
  reads: number
}

interface JournalRow {
  id: string
  occurredAt: string
  section: string
  recordId: string | null
  kind: "list" | "record" | "file" | string
  path: string | null
  query: string | null
  ipAddress: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** End of the picked day in the admin's own time zone. */
function endOfPickedDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59)
}

export function ReviewerAccessPanel() {
  const t = useTranslations("reviewerAccess")
  const tn = useTranslations("nav")
  const tc = useTranslations("common")
  const locale = useLocale()
  const { data: session } = useSession()
  const sessionUser = session?.user
  const isAdmin = sessionUser?.role === "admin" || sessionUser?.role === "superadmin"

  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [journalFor, setJournalFor] = useState<string | null>(null)
  const [journal, setJournal] = useState<JournalRow[] | null>(null)
  const [closing, setClosing] = useState<string | null>(null)

  const moduleOptions = (
    sessionUser?.role === "superadmin"
      ? USER_HIDEABLE_MODULE_IDS
      : tenantHideableModules(orgFromSession(sessionUser))
  ).filter(isCrmCapabilityAvailable).map((id) => {
    const group = navItems.find((item) =>
      id === WORKFORCE_HIDEABLE_ID ? item.capability === id : item.module === id,
    )?.group
    return { id, label: group ? tn(`groups.${group}` as never) : id }
  })
  const moduleLabel = (id: string) => moduleOptions.find((option) => option.id === id)?.label ?? id

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/reviewer-access")
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      const rows: unknown[] = Array.isArray(json?.data) ? json.data : []
      setGrants(rows.filter((row): row is Grant =>
        typeof row === "object" && row !== null && Array.isArray((row as Grant).modules) && typeof (row as Grant).id === "string"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  if (!isAdmin) return null

  const formatDay = (value: string) => new Date(value).toLocaleDateString(locale)
  const formatTime = (value: string) => new Date(value).toLocaleString(locale)

  const status = (grant: Grant) => {
    if (grant.revokedAt) return { text: t("statusClosed", { date: formatDay(grant.revokedAt) }), tone: "text-muted-foreground" }
    if (!grant.open) return { text: t("statusExpired", { date: formatDay(grant.expiresAt) }), tone: "text-muted-foreground" }
    const days = Math.max(1, Math.ceil((new Date(grant.expiresAt).getTime() - Date.now()) / DAY_MS))
    return { text: t("statusOpen", { days, date: formatDay(grant.expiresAt) }), tone: "text-emerald-700 dark:text-emerald-400" }
  }

  const closeNow = async (grant: Grant) => {
    setClosing(grant.id)
    try {
      const res = await fetch(`/api/v1/reviewer-access/${grant.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error(t("closeFailed"))
        return
      }
      toast.success(t("closed", { name: grant.name }))
      await load()
    } finally {
      setClosing(null)
    }
  }

  const toggleJournal = async (grant: Grant) => {
    if (journalFor === grant.id) {
      setJournalFor(null)
      setJournal(null)
      return
    }
    setJournalFor(grant.id)
    setJournal(null)
    const res = await fetch(`/api/v1/reviewer-access/${grant.id}/journal`)
    const json = res.ok ? await res.json().catch(() => null) : null
    setJournal(Array.isArray(json?.data) ? json.data : [])
  }

  const kindLabel = (kind: string) => kind === "record" ? t("kindRecord") : kind === "file" ? t("kindFile") : t("kindList")

  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700" data-testid="reviewer-access-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-4 w-4" /> {t("title")}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("hint", { days: REVIEWER_MAX_DAYS })}</p>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="reviewer-access-open">
          {t("grantButton")}
        </Button>
      </div>

      {loading ? (
        <div className="mt-4 h-10 animate-pulse rounded-lg bg-muted" />
      ) : grants.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
          {grants.map((grant) => {
            const state = status(grant)
            return (
              <Fragment key={grant.id}>
                <li className="flex flex-wrap items-center gap-3 px-3 py-3" data-testid="reviewer-access-row">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{grant.name} <span className="font-normal text-muted-foreground">· {grant.email}</span></p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("sections")}: {grant.modules.map(moduleLabel).join(", ")} · {t("reason")}: {grant.reason}
                    </p>
                    <p className={`mt-0.5 text-xs font-medium ${state.tone}`}>
                      {state.text} · {t("reads", { count: grant.reads })}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void toggleJournal(grant)}>
                    <Eye className="mr-1 h-4 w-4" /> {journalFor === grant.id ? t("journalHide") : t("journalShow")}
                  </Button>
                  {grant.open && (
                    <Button variant="outline" size="sm" disabled={closing === grant.id} onClick={() => void closeNow(grant)}>
                      {closing === grant.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <XCircle className="mr-1 h-4 w-4" />}
                      {t("closeNow")}
                    </Button>
                  )}
                </li>
                {journalFor === grant.id && (
                  <li className="bg-muted/30 px-3 py-3" data-testid="reviewer-access-journal">
                    {journal === null ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : journal.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("journalEmpty")}</p>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="py-1 pr-3 font-medium">{t("journalWhen")}</th>
                            <th className="py-1 pr-3 font-medium">{t("journalWhat")}</th>
                            <th className="py-1 pr-3 font-medium">{t("journalFrom")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journal.map((row) => (
                            <tr key={row.id} className="border-t border-zinc-200 dark:border-zinc-700">
                              <td className="py-1 pr-3 whitespace-nowrap">{formatTime(row.occurredAt)}</td>
                              <td className="py-1 pr-3">
                                {t.has(`scopes.${row.section}` as never) ? t(`scopes.${row.section}` as never) : row.section} · {kindLabel(row.kind)}
                                {row.recordId ? <span className="text-muted-foreground"> · {row.recordId}</span> : null}
                                {row.query ? <span className="text-muted-foreground"> · {row.query}</span> : null}
                              </td>
                              <td className="py-1 pr-3 text-muted-foreground">{row.ipAddress ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </li>
                )}
              </Fragment>
            )
          })}
        </ul>
      )}

      <GrantDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        moduleOptions={moduleOptions}
        onCreated={(result) => {
          setShowCreate(false)
          setCreated(result)
          void load()
        }}
      />

      <Dialog open={!!created} onOpenChange={(open) => { if (!open) setCreated(null) }}>
        <div className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createdTitle")}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <p className="text-sm text-muted-foreground">{t("createdHint")}</p>
            {created && (
              <dl className="mt-3 space-y-2 text-sm" data-testid="reviewer-access-credentials">
                <div><dt className="text-xs text-muted-foreground">{t("loginUrl")}</dt><dd className="font-mono">{typeof window !== "undefined" ? `${window.location.origin}/login` : "/login"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("loginEmail")}</dt><dd className="font-mono">{created.email}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t("loginPassword")}</dt><dd className="font-mono break-all">{created.password}</dd></div>
              </dl>
            )}
          </DialogContent>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!created) return
                void navigator.clipboard?.writeText(`${window.location.origin}/login\n${created.email}\n${created.password}`)
                toast.success(t("copied"))
              }}
            >
              <Copy className="mr-1 h-4 w-4" /> {t("copy")}
            </Button>
            <Button onClick={() => setCreated(null)}>{tc("close")}</Button>
          </DialogFooter>
        </div>
      </Dialog>
    </section>
  )
}

function GrantDialog({
  open,
  onOpenChange,
  moduleOptions,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  moduleOptions: { id: string; label: string }[]
  onCreated: (result: { email: string; password: string }) => void
}) {
  const t = useTranslations("reviewerAccess")
  const tc = useTranslations("common")
  const today = new Date()
  const maxDay = dateInputValue(new Date(today.getTime() + REVIEWER_MAX_DAYS * DAY_MS))
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [modules, setModules] = useState<string[]>([])
  const [until, setUntil] = useState(dateInputValue(new Date(today.getTime() + 7 * DAY_MS)))
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName("")
    setEmail("")
    setModules([])
    setUntil(dateInputValue(new Date(Date.now() + 7 * DAY_MS)))
    setReason("")
  }, [open])

  const expiresAt = endOfPickedDay(until)
  const ready = name.trim() && email.trim() && modules.length > 0 && reason.trim().length >= 3 && expiresAt

  const submit = async () => {
    if (!ready || !expiresAt) return
    setSaving(true)
    try {
      const res = await fetch("/api/v1/reviewer-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), modules, expiresAt: expiresAt.toISOString(), reason: reason.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = json?.code as string | undefined
        toast.error(
          code === "REVIEWER_ACCESS_EMAIL_TAKEN" ? t("errorEmailTaken")
            : code === "REVIEWER_ACCESS_EXPIRY_RANGE" ? t("errorExpiry", { days: REVIEWER_MAX_DAYS })
              : code === "REVIEWER_ACCESS_LIMIT" ? t("errorLimit")
                : t("errorGeneric"),
        )
        return
      }
      onCreated({ email: json.data.email, password: json.data.password })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="w-full max-w-lg" data-testid="reviewer-access-dialog">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reviewer-name">{t("fieldName")}</Label>
                <Input id="reviewer-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="reviewer-email">{t("fieldEmail")}</Label>
                <Input id="reviewer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">{t("fieldSections")}</p>
              <p className="text-xs text-muted-foreground">{t("fieldSectionsHint")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {moduleOptions.map((option) => (
                  <label key={option.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modules.includes(option.id)}
                      onChange={(e) => setModules((current) => e.target.checked
                        ? [...current, option.id]
                        : current.filter((id) => id !== option.id))}
                      className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="reviewer-until">{t("fieldUntil")}</Label>
                <Input id="reviewer-until" type="date" min={dateInputValue(today)} max={maxDay} value={until} onChange={(e) => setUntil(e.target.value)} />
                <p className="mt-0.5 text-xs text-muted-foreground">{t("fieldUntilHint", { days: REVIEWER_MAX_DAYS })}</p>
              </div>
              <div>
                <Label htmlFor="reviewer-reason">{t("fieldReason")}</Label>
                <Input id="reviewer-reason" value={reason} placeholder={t("fieldReasonPlaceholder")} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t("rules")}</p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button disabled={!ready || saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {t("submit")}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  )
}
