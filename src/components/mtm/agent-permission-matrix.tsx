"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Check, Lock, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AGENT_PERMISSION_GROUPS,
  AGENT_PERMISSION_ROWS,
  AGENT_SWITCH_ROWS,
  agentCardFlagCount,
  type AgentPermissionRow,
  type AgentPermissionSettingKey,
  type AgentPermissionSettings,
} from "@/lib/mtm/agent-permissions"
import type { AccessCard } from "@/lib/mtm/access-roster"

/**
 * "What an agent may do": every function of a field agent in one list (owner,
 * 2026-10-04: "a role matrix — what the agent can do and what not, for all
 * functions").
 *
 * A switch is a tenant MTM setting the API already checks where it refuses the
 * agent, so flipping it here changes what the server does — and the row
 * re-reads the settings afterwards, so it shows what the server now holds, not
 * what the click hoped for. A row without a switch states a rule of the system
 * in words; nothing can be stored for it.
 */
export function MtmAgentPermissionMatrix({ cards }: { cards: readonly AccessCard[] }) {
  const t = useTranslations("mtmAccess")
  const [settings, setSettings] = useState<Partial<AgentPermissionSettings> | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<AgentPermissionSettingKey | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/mtm/settings", { headers: { Accept: "application/json" } })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new Error("settings")
    setSettings(body.data as Partial<AgentPermissionSettings>)
  }, [])

  useEffect(() => {
    let cancelled = false
    load().catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [load])

  const toggle = async (setting: AgentPermissionSettingKey, next: boolean) => {
    setBusy(setting)
    setErrors((current) => ({ ...current, [setting]: "" }))
    try {
      const response = await fetch("/api/v1/mtm/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [setting]: next }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(t("saveFailed", { reason: typeof body?.error === "string" ? body.error : String(response.status) }))
      }
      // The API drops an administrator-only key from anyone else and says so.
      if (Array.isArray(body?.data?.ignoredKeys) && body.data.ignoredKeys.includes(setting)) {
        throw new Error(t("matrixNotSaved"))
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [setting]: error instanceof Error ? error.message : String(error) }))
    }
    // Re-read either way: after a refusal the switch must show what is true.
    await load().catch(() => undefined)
    setBusy(null)
  }

  const title = (id: string) => t(`perm_${id}` as never)

  return (
    <section className="space-y-3" aria-labelledby="mtm-agent-matrix-title" data-testid="mtm-agent-permission-matrix">
      <div>
        <h2 id="mtm-agent-matrix-title" className="text-lg font-semibold">{t("matrixTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("matrixDescription")}</p>
      </div>

      {loadFailed ? (
        <p className="text-sm text-red-500">{t("matrixLoadFailed")}</p>
      ) : !settings ? (
        <div className="flex min-h-[12vh] items-center justify-center" aria-busy="true">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        </div>
      ) : (
        <div className="space-y-4">
          {AGENT_PERMISSION_GROUPS.map((group) => (
            <div key={group} className="rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
              <h3 className="border-b border-zinc-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground dark:border-zinc-700">
                {t(`permGroup_${group}` as never)}
              </h3>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {AGENT_PERMISSION_ROWS.filter((row) => row.group === group).map((row) => (
                  <MatrixRow
                    key={row.id}
                    row={row}
                    settings={settings}
                    cards={cards}
                    busy={busy !== null}
                    error={row.kind === "switch" ? errors[row.setting] ?? "" : ""}
                    title={title}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MatrixRow({
  row, settings, cards, busy, error, title, onToggle,
}: {
  row: AgentPermissionRow
  settings: Partial<AgentPermissionSettings>
  cards: readonly AccessCard[]
  busy: boolean
  error: string
  title: (id: string) => string
  onToggle: (setting: AgentPermissionSettingKey, next: boolean) => void
}) {
  const t = useTranslations("mtmAccess")
  const name = title(row.id)
  // A switch that depends on another shows "may not" and cannot be pressed
  // while the other is off; its own stored value comes back with it.
  const requiredRow = row.kind === "switch" && row.requires
    ? AGENT_SWITCH_ROWS.find((candidate) => candidate.setting === row.requires)
    : undefined
  const blocked = row.kind === "switch" && row.requires !== undefined && settings[row.requires] !== true
  const on = row.kind === "switch" && settings[row.setting] === true && !blocked
  const cardFlag = row.kind === "perAgent" || row.kind === "switch" ? row.cardFlag : undefined
  const count = cardFlag ? agentCardFlagCount(cards, cardFlag) : null

  return (
    <li
      className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_14rem] md:items-start md:gap-6"
      data-testid={`mtm-agent-permission-${row.id}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`perm_${row.id}_hint` as never)}</p>
        {row.kind === "switch" && (
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`surface_${row.surfaces.join("_")}` as never)}</p>
        )}
        {row.kind === "switch" && count && count.total > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("alsoPerAgent", count)}{" "}
            <Link href="/mtm/agents" className="underline">{t("openAgents")}</Link>
          </p>
        )}
        {blocked && requiredRow && (
          <p className="mt-0.5 text-xs text-muted-foreground">{t("requiresHint", { name: title(requiredRow.id) })}</p>
        )}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      <div className="min-w-0">
        {row.kind === "switch" ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={name}
            disabled={busy || blocked}
            onClick={() => onToggle(row.setting, !on)}
            className="inline-flex min-h-11 items-center gap-3 rounded-lg text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-muted")}
            >
              <span className={cn("inline-block h-5 w-5 rounded-full bg-white transition-transform", on ? "translate-x-6" : "translate-x-1")} />
            </span>
            <span className={on ? "text-foreground" : "text-muted-foreground"}>{on ? t("stateCan") : t("stateCannot")}</span>
          </button>
        ) : row.kind === "perAgent" ? (
          <>
            <p className="text-sm font-medium">
              {count && count.total > 0 ? t("perAgentCount", count) : t("perAgentNoAgents")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("perAgentWhere")}{" "}
              <Link href="/mtm/agents" className="underline">{t("openAgents")}</Link>
            </p>
          </>
        ) : (
          <>
            <p
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                row.kind === "always"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
              )}
            >
              {row.kind === "always"
                ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
                : <X className="h-3.5 w-3.5" aria-hidden="true" />}
              {t(row.kind === "always" ? "stateAlways" : "stateNever")}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t("fixedRule")}
            </p>
          </>
        )}
      </div>
    </li>
  )
}
