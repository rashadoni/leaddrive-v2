"use client"

import { Hint, HintValue } from "@/components/hint"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import {
  ACCESS_NONE,
  accessChoiceOf,
  accessTeamOf,
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
import { MTM_TAB_ROW, mtmTabClass } from "@/components/mtm/calm-classes"
import { MtmPageHeader } from "@/components/mtm/page-header"

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
  const [tab, setTab] = useState<"people" | "agent">("people")
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
      <MtmPageHeader title={t("title")} description={t("description")} />

      {/* Two tabs instead of one 6.6-screen page (owner 2026-10-31, from a
          before/after picture): who works in the section, and what an agent
          may do. */}
      <div role="tablist" aria-label={t("title")} className={MTM_TAB_ROW} data-testid="mtm-access-tabs">
        {(["people", "agent"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`mtm-access-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`mtm-access-panel-${name}`}
            data-testid={`mtm-access-tab-${name}`}
            onClick={() => setTab(name)}
            className={`text-sm font-medium transition-colors ${mtmTabClass(tab === name)}`}
          >
            {t(name === "people" ? "rosterTitle" : "matrixTitle")}
          </button>
        ))}
      </div>

      {tab === "people" ? (
      <div role="tabpanel" id="mtm-access-panel-people" aria-labelledby="mtm-access-tab-people" className="space-y-5">
      {loadFailed ? (
        <p className="text-sm text-red-500">{t("loadFailed")}</p>
      ) : !roster ? (
        <div className="flex min-h-[20vh] items-center justify-center" aria-busy="true">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      ) : roster.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
        {/* The three levels in words, before the list that uses them (owner,
            2026-11-01: «не понятно что, для чего и как работает»). */}
        <div className="grid gap-3 sm:grid-cols-3" data-testid="mtm-access-levels">
          {(["All", "Team", "Own"] as const).map((level) => (
            <div key={level} className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-sm font-semibold">{t(`level${level}Title`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(`level${level}Text`)}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card">
          <div className={`hidden gap-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground md:grid ${ACCESS_GRID}`}>
            <span>{t("colPerson")}</span>
            <span><HintValue text={t("hint.colWhere")}>{t("colWhere")}</HintValue></span>
            <span><HintValue text={t("hint.colSees")}>{t("colSees")}</HintValue></span>
            <span><HintValue text={t("hint.colTeam")}>{t("colTeam")}</HintValue></span>
          </div>
          <ul className="divide-y divide-border">
            {roster.rows.map((row) => (
              <AccessRowView
                key={row.user.id}
                row={row}
                crmRole={roleLabel(row.user.role)}
                team={row.kind === "card" ? accessTeamOf(row.card.id, cards) : []}
                busy={busy === row.user.id}
                error={errors[row.user.id] ?? ""}
                onAccess={(choice) => apply(row.user.id, accessWrites(row, choice))}
                onCardFlag={(cardId, flag, value) => apply(row.user.id, [
                  { url: `/api/v1/mtm/agents/${cardId}`, method: "PUT", body: { [flag]: value } },
                ])}
              />
            ))}
            {roster.mobileCards.map((card) => (
              <MobileCardRow
                key={card.id}
                card={card}
                team={accessTeamOf(card.id, cards)}
                busy={busy === card.id}
                error={errors[card.id] ?? ""}
                onCardFlag={(flag, value) => apply(card.id, [
                  { url: `/api/v1/mtm/agents/${card.id}`, method: "PUT", body: { [flag]: value } },
                ])}
              />
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">{t("matrixNote")}</p>
        </>
      )}
      </div>
      ) : (
        <div role="tabpanel" id="mtm-access-panel-agent" aria-labelledby="mtm-access-tab-agent">
          {/* What every agent may do — the organization's switches and the system's rules. */}
          <MtmAgentPermissionMatrix cards={cards} onCardsChanged={loadCards} />
        </div>
      )}
    </div>
  )
}

/** Person · where · what they see · team and extra rights. */
const ACCESS_GRID = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.45fr)_minmax(0,1.3fr)_minmax(0,1.15fr)]"

function AccessRowView({
  row, crmRole, team, busy, error, onAccess, onCardFlag,
}: {
  row: AccessRow
  crmRole: string
  team: string[]
  busy: boolean
  error: string
  onAccess: (choice: AccessChoice) => void
  onCardFlag: (cardId: string, flag: "canPlanOwnRoutes" | "canSelfPublishRoutes", value: boolean) => void
}) {
  const t = useTranslations("mtmAccess")
  const choice = accessChoiceOf(row)
  const selectId = `access-${row.user.id}`

  return (
    <li className={`grid gap-3 px-4 py-3 md:items-center md:gap-4 ${ACCESS_GRID}`} data-testid={`mtm-access-row-${row.user.id}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.user.name}</p>
        <p className="truncate text-xs text-muted-foreground" title={row.user.email}>{t("crmRoleLine", { role: crmRole })} · {row.user.email}</p>
      </div>
      <p className="text-sm">{t("whereSite")}</p>
      <div className="min-w-0">
        {row.kind === "organization" ? (
          <p className="text-sm">{t("adminRow")}</p>
        ) : row.kind === "hidden" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm text-muted-foreground">{t("noAccess")}</span>
            <Hint text={t("hint.giveAccess")}>
              <Button asChild variant="outline" size="sm" className="min-h-9">
                <Link href="/settings/users" data-testid={`mtm-access-give-${row.user.id}`}>{t("giveAccess")}</Link>
              </Button>
            </Hint>
          </div>
        ) : (
          <>
            <label htmlFor={selectId} className="sr-only">{t("colSees")}</label>
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
            {row.kind === "none" ? <p className="mt-1 text-xs text-muted-foreground">{t("noAccessHint")}</p> : null}
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </>
        )}
      </div>
      <div className="min-w-0 text-sm">
        {row.kind === "card" && row.role === "AGENT" ? (
          <RouteFlags card={row.card} busy={busy} onFlag={(flag, value) => onCardFlag(row.card.id, flag, value)} />
        ) : row.kind === "card" && (row.role === "MANAGER" || row.role === "SUPERVISOR") ? (
          <TeamLine team={team} />
        ) : <span className="text-muted-foreground">—</span>}
      </div>
    </li>
  )
}

/** Someone who works only in the phone app: what their card lets them see, and an agent's route rights. */
function MobileCardRow({ card, team, busy, error, onCardFlag }: {
  card: AccessCard
  team: string[]
  busy: boolean
  error: string
  onCardFlag: (flag: "canPlanOwnRoutes" | "canSelfPublishRoutes", value: boolean) => void
}) {
  const t = useTranslations("mtmAccess")
  const known = (ASSIGNABLE_FIELD_CARD_ROLES as readonly string[]).includes(card.role)
  return (
    <li className={`grid gap-3 px-4 py-3 md:items-center md:gap-4 ${ACCESS_GRID}`} data-testid={`mtm-access-card-${card.id}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{card.name}</p>
        <p className="truncate text-xs text-muted-foreground">{t("mobileOnlyLine")}</p>
      </div>
      <p className="text-sm">{t("wherePhone")}</p>
      <div className="min-w-0">
        <p className="text-sm">{known ? t(`role_${card.role}` as never) : card.role}</p>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
      <div className="min-w-0 text-sm">
        {card.role === "AGENT" ? <RouteFlags card={card} busy={busy} onFlag={onCardFlag} />
          : card.role === "MANAGER" || card.role === "SUPERVISOR" ? <TeamLine team={team} />
          : <span className="text-muted-foreground">—</span>}
      </div>
    </li>
  )
}

function TeamLine({ team }: { team: string[] }) {
  const t = useTranslations("mtmAccess")
  return team.length > 0 ? (
    <p className="truncate" title={team.join(", ")} data-testid="mtm-access-team">{t("teamOf", { names: team.join(", ") })}</p>
  ) : (
    <p className="text-muted-foreground" data-testid="mtm-access-team">
      {t("teamEmpty")} · <Link href="/mtm/agents" className="underline">{t("openAgents")}</Link>
    </p>
  )
}

function RouteFlags({ card, busy, onFlag }: {
  card: AccessCard
  busy: boolean
  onFlag: (flag: "canPlanOwnRoutes" | "canSelfPublishRoutes", value: boolean) => void
}) {
  const t = useTranslations("mtmAccess")
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <Hint text={t("hint.canPlan")}>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={card.canPlanOwnRoutes !== false}
            disabled={busy}
            onChange={(event) => onFlag("canPlanOwnRoutes", event.target.checked)}
          />
          {t("canPlan")}
        </label>
      </Hint>
      <Hint text={t("hint.canPublish")}>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={card.canSelfPublishRoutes === true}
            disabled={busy}
            onChange={(event) => onFlag("canSelfPublishRoutes", event.target.checked)}
          />
          {t("canPublish")}
        </label>
      </Hint>
    </div>
  )
}
