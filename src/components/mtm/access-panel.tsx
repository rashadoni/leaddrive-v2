"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { KeyRound } from "lucide-react"
import { Select } from "@/components/ui/select"
import {
  ACCESS_NONE,
  accessChoiceOf,
  accessWrites,
  buildAccessRoster,
  type AccessCard,
  type AccessChoice,
  type AccessRow,
  type AccessUser,
  type AccessWrite,
} from "@/lib/mtm/access-roster"
import { ASSIGNABLE_FIELD_CARD_ROLES } from "@/lib/user-access-summary"
import { MtmAgentPermissionMatrix } from "@/components/mtm/agent-permission-matrix"

/**
 * Route & Field → "Access & permissions": the one place inside the module
 * where an administrator sees who works in it and gives, changes or takes away
 * their field scope (owner, 2026-10-03: "the module needs a section where the
 * admin grants permissions").
 *
 * Each row is a CRM login; what it sees in the field is the employee card
 * linked to it. The select writes straight through the existing admin-only
 * agent endpoints and the row re-reads the cards afterwards, so what is shown
 * is what the server now holds rather than what the form hoped for.
 */
export function MtmAccessPanel() {
  const { data: session } = useSession()
  const t = useTranslations("mtmAccess")
  const ts = useTranslations("settings")
  const role = session?.user?.role
  const isAdmin = role === "admin" || role === "superadmin"
  const [users, setUsers] = useState<AccessUser[] | null>(null)
  const [cards, setCards] = useState<AccessCard[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadCards = useCallback(async () => {
    const response = await fetch("/api/v1/mtm/agents?limit=200", { headers: { Accept: "application/json" } })
    const body = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(body?.data?.agents)) throw new Error("cards")
    setCards(body.data.agents as AccessCard[])
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    Promise.all([
      fetch("/api/v1/users", { headers: { Accept: "application/json" } }).then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok || !Array.isArray(body?.data)) throw new Error("users")
        return body.data as AccessUser[]
      }),
      loadCards(),
    ])
      .then(([loaded]) => { if (!cancelled) setUsers(loaded) })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [isAdmin, loadCards])

  const apply = async (userId: string, writes: AccessWrite[]) => {
    if (writes.length === 0) return
    setBusy(userId)
    setErrors((current) => ({ ...current, [userId]: "" }))
    try {
      for (const write of writes) {
        const response = await fetch(write.url, {
          method: write.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(write.body),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(typeof body?.error === "string" ? body.error : String(response.status))
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setErrors((current) => ({ ...current, [userId]: t("saveFailed", { reason }) }))
    }
    // Re-read either way: after a refusal the select must show what is true.
    await loadCards().catch(() => undefined)
    setBusy(null)
  }

  if (!isAdmin) return <p className="text-sm text-muted-foreground">{t("adminOnly")}</p>

  const roleLabel = (crmRole: string) => (ts.has(`role_${crmRole}`) ? ts(`role_${crmRole}` as never) : crmRole)
  const roster = users ? buildAccessRoster(users, cards) : null

  return (
    <div className="space-y-5" data-testid="mtm-access-panel">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <h2 className="text-lg font-semibold">{t("rosterTitle")}</h2>
      {loadFailed ? (
        <p className="text-sm text-red-500">{t("loadFailed")}</p>
      ) : !roster ? (
        <div className="flex min-h-[20vh] items-center justify-center" aria-busy="true">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      ) : roster.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="hidden gap-4 border-b border-zinc-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground dark:border-zinc-700 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
            <span>{t("colPerson")}</span>
            <span>{t("colCrmRole")}</span>
            <span>{t("colAccess")}</span>
            <span>{t("colRoutes")}</span>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {roster.rows.map((row) => (
              <AccessRowView
                key={row.user.id}
                row={row}
                crmRole={roleLabel(row.user.role)}
                busy={busy === row.user.id}
                error={errors[row.user.id] ?? ""}
                onAccess={(choice) => apply(row.user.id, accessWrites(row, choice))}
                onCardFlag={(cardId, flag, value) => apply(row.user.id, [
                  { url: `/api/v1/mtm/agents/${cardId}`, method: "PUT", body: { [flag]: value } },
                ])}
              />
            ))}
          </ul>
        </div>
      )}

      {roster && roster.mobileOnly > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("mobileOnly", { count: roster.mobileOnly })}{" "}
          <Link href="/mtm/agents" className="underline">{t("openAgents")}</Link>
        </p>
      )}

      {/* What every agent may do — the organization's switches and the system's rules. */}
      <MtmAgentPermissionMatrix cards={cards} onCardsChanged={loadCards} />
    </div>
  )
}

function AccessRowView({
  row, crmRole, busy, error, onAccess, onCardFlag,
}: {
  row: AccessRow
  crmRole: string
  busy: boolean
  error: string
  onAccess: (choice: AccessChoice) => void
  onCardFlag: (cardId: string, flag: "canPlanOwnRoutes" | "canSelfPublishRoutes", value: boolean) => void
}) {
  const t = useTranslations("mtmAccess")
  const choice = accessChoiceOf(row)
  const selectId = `access-${row.user.id}`

  return (
    <li
      className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,1.5fr)_minmax(0,1fr)] md:items-start md:gap-4"
      data-testid={`mtm-access-row-${row.user.id}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.user.name}</p>
        <p className="truncate text-xs text-muted-foreground">{row.user.email}</p>
      </div>
      <p className="text-sm">{crmRole}</p>
      <div className="min-w-0">
        {row.kind === "organization" ? (
          <p className="text-sm">{t("adminRow")}</p>
        ) : row.kind === "hidden" ? (
          <p className="text-sm text-muted-foreground">
            {t("hiddenRow")}{" "}
            <Link href="/settings/users" className="underline">{t("openUsers")}</Link>
          </p>
        ) : (
          <>
            <label htmlFor={selectId} className="sr-only">{t("colAccess")}</label>
            <Select
              id={selectId}
              value={choice ?? ACCESS_NONE}
              disabled={busy}
              onChange={(event) => onAccess(event.target.value as AccessChoice)}
            >
              <option value={ACCESS_NONE}>{t("accessNone")}</option>
              {ASSIGNABLE_FIELD_CARD_ROLES.map((fieldRole) => (
                <option key={fieldRole} value={fieldRole}>{t(`role_${fieldRole}` as never)}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.kind === "none" ? t("noAccessHint") : (
                <>
                  {t("card", { name: row.card.name })}
                  {(row.role === "MANAGER" || row.role === "SUPERVISOR") && (
                    <> · {t("teamHint")} <Link href="/mtm/agents" className="underline">{t("openAgents")}</Link></>
                  )}
                </>
              )}
            </p>
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </>
        )}
      </div>
      <div className="grid gap-2 text-sm">
        {row.kind === "card" && row.role === "AGENT" && (
          <>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700"
                checked={row.card.canPlanOwnRoutes !== false}
                disabled={busy}
                onChange={(event) => onCardFlag(row.card.id, "canPlanOwnRoutes", event.target.checked)}
              />
              {t("canPlan")}
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700"
                checked={row.card.canSelfPublishRoutes === true}
                disabled={busy}
                onChange={(event) => onCardFlag(row.card.id, "canSelfPublishRoutes", event.target.checked)}
              />
              {t("canPublish")}
            </label>
          </>
        )}
      </div>
    </li>
  )
}
