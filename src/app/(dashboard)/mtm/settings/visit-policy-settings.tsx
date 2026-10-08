"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, ChevronDown, Eye, Info, Lock, Plus, RefreshCw, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  SPECIAL_RULE_PRIORITY,
  companyVisitRule,
  listedSpecialVisitRules,
  teamsWithoutSpecialVisitRule,
  visitRuleActions,
  type VisitSwitchAction,
  type VisitSwitchRule,
} from "@/lib/mtm/visit-action-switches"
import { VisitActionSwitches } from "./visit-action-switches"
import { explainMtmApiErrorOr, useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import {
  canCreateVisitPolicy,
  parseVisitPolicyUiAccess,
  visitPolicyDisabledNoticeKeys,
  visitPolicyFeatureDisabled,
  visitPolicyReadOnlyReason,
  visitPolicyTeamChoices,
  type VisitPolicyUiAccess,
} from "@/lib/mtm/visit-policy-ui-access"

interface Policy extends VisitSwitchRule {
  id?: string
  name: string
  team?: { id: string; name: string } | null
}

interface NamedEntity { id: string; name: string }

interface PreviewResult {
  sourcePolicyName: string | null
  requirements: (VisitSwitchAction & { mode: "REQUIRED" | "OPTIONAL" | "HIDDEN" })[]
}

function dateInput(value: string | Date | null | undefined) {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

function normalizePolicy(policy: Policy): Policy {
  return { ...policy, effectiveFrom: dateInput(policy.effectiveFrom), effectiveTo: dateInput(policy.effectiveTo) || null }
}

const fieldClass = "h-9 rounded-md border border-zinc-200 bg-background px-2.5 text-sm dark:border-zinc-700"

/**
 * Route & Field → Settings → what an agent does on a visit.
 *
 * One table of switches for the whole company, and — only where an
 * organization has groups of agents — the same table for a group whose rules
 * differ. Until 2026-10-08 the second part was «visit action policies»: a
 * rule list, three large mode buttons per action, a visit type, dates, a
 * priority, a minimum for every action and «a reason may replace it». The
 * owner, shown it under the new switches: «эту часть ты оставил без
 * изменений». Nobody had ever saved a rule in it. Of its fields the app or the
 * server acts on three — the minimum number of photos and the two «only at
 * institutions of…» conditions — and those are now one press away on every
 * row of the table. A visit type cannot be chosen in the app, and nothing in
 * it can give «a reason instead»; rules written through the API with dates,
 * a visit type or another priority are listed with those named, and resolve
 * exactly as before.
 */
export function VisitPolicySettings({ legacyPhotoRequired = false, aside }: {
  /**
   * The old «photo required on every visit» setting. It applies only while no
   * rule matches, and its own switch is gone from the page — the switches
   * below show it and carry it into the rule their first press creates.
   */
  legacyPhotoRequired?: boolean
  /**
   * The settings cards that stand beside the switches as the second, equal
   * column of the row (owner, 2026-10-08: «симметрично делай… половинчатые
   * блоки»). They do not depend on the rules, so they are drawn either way.
   */
  aside?: ReactNode
}) {
  const t = useTranslations("mtmVisitPolicies")
  const explainError = useMtmApiError()
  const [access, setAccess] = useState<VisitPolicyUiAccess | null>(null)
  const [loadError, setLoadError] = useState("")
  const [featureDisabled, setFeatureDisabled] = useState(false)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [teams, setTeams] = useState<NamedEntity[]>([])
  const [agents, setAgents] = useState<NamedEntity[]>([])
  const [customers, setCustomers] = useState<NamedEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  // Group rules are one click below the company table, closed until asked for.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [openRuleId, setOpenRuleId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [addTeamId, setAddTeamId] = useState("")
  const [previewAgentId, setPreviewAgentId] = useState("")
  const [previewCustomerId, setPreviewCustomerId] = useState("")
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [policyRes, teamRes, agentRes, customerRes] = await Promise.all([
        fetch("/api/v1/mtm/visit-policies"),
        fetch("/api/v1/mtm/teams"),
        fetch("/api/v1/mtm/agents?status=ACTIVE&limit=200"),
        fetch("/api/v1/mtm/customers?status=ACTIVE&limit=200"),
      ])
      const [policyBody, teamBody, agentBody, customerBody] = await Promise.all([
        policyRes.json(), teamRes.json(), agentRes.json(), customerRes.json(),
      ])
      if (!policyRes.ok) {
        setFeatureDisabled(false)
        setLoadError(explainError(policyBody, policyRes.status))
        return
      }
      setLoadError("")
      setAccess(parseVisitPolicyUiAccess(policyBody.data?.access))
      setFeatureDisabled(visitPolicyFeatureDisabled(policyBody.data))
      setPolicies((policyBody.data?.policies ?? []).map(normalizePolicy))
      setTeams(teamBody.data?.teams ?? [])
      setAgents(agentBody.data?.agents ?? [])
      setCustomers(customerBody.data?.customers ?? [])
    } catch {
      setFeatureDisabled(false)
      setLoadError(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [explainError, t])

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Every write of this section that is not a switch: one place explains a
  // refusal in the reader's language instead of printing the server's English.
  const send = async (url: string, method: "POST" | "DELETE", payload: unknown, fallback: string): Promise<Policy | PreviewResult | null> => {
    try {
      const response = await fetch(url, {
        method,
        ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(explainMtmApiErrorOr(explainError, body, response.status, fallback))
      return body?.data ?? null
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : fallback)
      return null
    }
  }

  const company = companyVisitRule(policies)
  const special = listedSpecialVisitRules(policies)
  const canCreate = canCreateVisitPolicy(access)
  const teamChoices = visitPolicyTeamChoices(access, teams)
  const addableTeams = teamsWithoutSpecialVisitRule(teamChoices.teams, policies)
  // Without groups of agents there is nobody a special rule could be for:
  // the section is not offered at all rather than shown empty.
  const groupRulesOffered = teams.length > 0 || special.length > 0
  const companyReadOnly = access ? !access.canWriteOrganizationWide : false

  const addRule = async () => {
    const team = addableTeams.find((candidate) => candidate.id === addTeamId)
    if (!team || working) return
    setWorking(true)
    // A group's rule starts as a copy of what the company table says, so the
    // only thing to do next is to change what differs for this group.
    const created = await send("/api/v1/mtm/visit-policies", "POST", {
      name: team.name,
      teamId: team.id,
      visitType: "DEFAULT",
      priority: SPECIAL_RULE_PRIORITY,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveTo: null,
      isActive: true,
      actions: visitRuleActions(company, { legacyPhotoRequired }),
    }, t("saveFailed")) as Policy | null
    if (created) {
      setAddTeamId("")
      await load()
      setOpenRuleId(created.id ?? null)
      toast.success(t("ruleAdded"))
    }
    setWorking(false)
  }

  const removeRule = async (rule: Policy) => {
    if (!rule.id || working) return
    setWorking(true)
    const removed = await send(`/api/v1/mtm/visit-policies/${rule.id}`, "DELETE", undefined, t("deactivateFailed"))
    if (removed) {
      setConfirmDeleteId(null)
      setOpenRuleId(null)
      await load()
      toast.success(t("ruleDeleted"))
    }
    setWorking(false)
  }

  const runPreview = async () => {
    if (!previewAgentId || !previewCustomerId) return
    setPreviewing(true)
    const result = await send("/api/v1/mtm/visit-policies/preview", "POST", {
      agentId: previewAgentId, customerId: previewCustomerId, visitType: "DEFAULT",
    }, t("previewFailed")) as PreviewResult | null
    if (result) setPreview(result)
    setPreviewing(false)
  }

  const disabledNotice = visitPolicyDisabledNoticeKeys(access)
  const readOnlyText = (reason: ReturnType<typeof visitPolicyReadOnlyReason>) => reason === "supervisor"
    ? t("readOnlySupervisor")
    : reason === "adminOnly"
      ? t("readOnlyAdminOnly")
      : reason === "otherTeam"
        ? t("readOnlyOtherTeam")
        : reason === "noTeam" ? t("managerNoTeamHint") : ""

  // Whom a rule is for, and anything about it that the page itself never sets.
  const ruleScope = (rule: Policy) => {
    const today = new Date().toISOString().slice(0, 10)
    return [
      rule.teamId ? t("ruleForTeam", { team: rule.team?.name ?? teams.find((team) => team.id === rule.teamId)?.name ?? t("teamUnknown") }) : t("companyRuleName"),
      rule.visitType.toUpperCase() !== "DEFAULT" ? t("ruleVisitType", { type: rule.visitType }) : null,
      rule.effectiveFrom > today ? t("ruleFrom", { date: rule.effectiveFrom }) : null,
      rule.effectiveTo ? t("ruleUntil", { date: rule.effectiveTo }) : null,
      rule.priority !== SPECIAL_RULE_PRIORITY ? t("rulePriority", { value: rule.priority }) : null,
    ].filter(Boolean).join(" · ")
  }
  const ruleSummary = (rule: Policy) => {
    const actions = visitRuleActions(rule)
    return t("ruleSummary", {
      required: actions.filter((action) => action.mode === "REQUIRED").length,
      hidden: actions.filter((action) => action.mode === "HIDDEN").length,
    })
  }

  const editorHidden = !advancedOpen && !featureDisabled && !loadError
  const switchesShown = !featureDisabled && !loadError

  return (
    <section>
      {/* What an agent is shown in a visit, and what he must do: two switches
          per action. Not drawn while the rules are switched off or unread —
          the notice below says why instead. */}
      {!switchesShown ? (
        aside ? <div className="mb-3 grid gap-3 lg:grid-cols-2">{aside}</div> : null
      ) : (
        <>
          <div className={aside ? "grid gap-3 lg:grid-cols-2" : undefined} data-testid="visit-switches-row">
            <VisitActionSwitches
              rule={company}
              companyWide
              readOnly={companyReadOnly}
              loading={loading}
              onSaved={load}
              legacyPhotoRequired={legacyPhotoRequired}
              title={t("simpleTitle")}
              scope={t("simpleScope")}
            />
            {aside ? <div className="flex flex-col gap-3">{aside}</div> : null}
          </div>
          {groupRulesOffered ? (
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls="visit-policy-advanced"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
              data-testid="visit-policy-advanced-toggle"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} aria-hidden="true" />
              {t("advancedToggle")}
              {special.length > 0 ? (
                <span className="text-xs font-normal text-muted-foreground">· {t("advancedCount", { count: special.length })}</span>
              ) : null}
            </button>
          ) : null}
        </>
      )}

      <div id="visit-policy-advanced" hidden={editorHidden} className={editorHidden ? undefined : "mt-1"}>
      {loadError ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{loadError}</span>
        </div>
      ) : featureDisabled ? (
        // Switch off: rules are neither listed nor applied, and every write
        // would be refused with 409 — so no table, no group rules, no preview.
        <div role="status" className="flex items-start gap-2 rounded-md border border-zinc-200 bg-muted/40 px-3 py-3 text-sm dark:border-zinc-800" data-testid="visit-policy-feature-disabled">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            <span className="block font-medium">{t(disabledNotice.text)}</span>
            {disabledNotice.hint ? <span className="mt-1 block text-muted-foreground">{t(disabledNotice.hint)}</span> : null}
          </span>
        </div>
      ) : null}

      {/* Neither the "switched off" notice nor a load error sits next to the rules. */}
      {featureDisabled || loadError ? null : (
      <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-700" data-testid="visit-special-rules">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("specialTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("specialHint")}</p>
          </div>
          {canCreate && !featureDisabled ? (
            addableTeams.length > 0 ? (
              <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0" data-testid="visit-special-rule-add">
                <select
                  value={addTeamId}
                  onChange={(event) => setAddTeamId(event.target.value)}
                  aria-label={t("specialChooseTeam")}
                  className={`${fieldClass} min-h-11 min-w-0 flex-1 sm:w-48 sm:flex-none`}
                >
                  <option value="">{t("specialChooseTeam")}</option>
                  {addableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
                <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={addRule} disabled={!addTeamId || working}>
                  <Plus className="h-4 w-4" />{t("specialAdd")}
                </Button>
              </div>
            ) : <p className="shrink-0 text-xs text-muted-foreground">{t("specialAllTeamsHaveRules")}</p>
          ) : null}
        </div>

        {access && !canCreate && access.kind !== "supervisor" ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground" data-testid="visit-policy-no-team-hint">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("managerNoTeamHint")}
          </p>
        ) : null}

        {special.length === 0 ? (
          <p className="mt-3 border-t border-zinc-200 pt-3 text-sm text-muted-foreground dark:border-zinc-700" data-testid="visit-special-rules-empty">{t("empty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
            {special.map((rule) => {
              const id = rule.id as string
              const open = openRuleId === id
              const readOnlyReason = visitPolicyReadOnlyReason(access, { isNew: false, savedTeamId: rule.teamId })
              const readOnly = readOnlyReason !== null
              return (
                <li key={id} data-testid={`visit-special-rule-${id}`}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => { setConfirmDeleteId(null); setOpenRuleId(open ? null : id) }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{rule.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{ruleScope(rule)}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{ruleSummary(rule)}</span>
                    {readOnly ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
                  </button>
                  {open ? (
                    <div className="px-2 pb-3">
                      <VisitActionSwitches
                        rule={rule}
                        readOnly={readOnly}
                        readOnlyNote={readOnlyText(readOnlyReason)}
                        loading={loading}
                        onSaved={load}
                        title={t("ruleActionsTitle")}
                        testId={`visit-rule-switches-${id}`}
                        embedded
                      />
                      {readOnly ? null : (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                          {confirmDeleteId === id ? (
                            <>
                              <span className="mr-auto text-sm">{t("ruleDeleteConfirm", { name: rule.name })}</span>
                              <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={() => setConfirmDeleteId(null)} disabled={working}>{t("ruleDeleteNo")}</Button>
                              <Button type="button" variant="destructive" size="sm" className="min-h-9" onClick={() => { void removeRule(rule) }} disabled={working}>{t("ruleDeleteYes")}</Button>
                            </>
                          ) : (
                            <Button type="button" variant="ghost" size="sm" className="min-h-9 text-destructive" onClick={() => setConfirmDeleteId(id)}>
                              <Trash2 className="mr-1 h-4 w-4" />{t("ruleDelete")}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {/* Which rule one agent really gets at one institution: the answer of
            the same resolver the visit uses, not a guess from the list above. */}
        <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-700" data-testid="visit-rule-check">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("previewTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("previewHint")}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <select value={previewAgentId} onChange={(event) => setPreviewAgentId(event.target.value)} className={`${fieldClass} w-full`} aria-label={t("previewAgent")}>
              <option value="">{t("previewAgent")}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <select value={previewCustomerId} onChange={(event) => setPreviewCustomerId(event.target.value)} className={`${fieldClass} w-full`} aria-label={t("previewCustomer")}>
              <option value="">{t("previewCustomer")}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={runPreview} disabled={previewing || !previewAgentId || !previewCustomerId}>
              {previewing ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Eye className="mr-1 h-4 w-4" />}
              {t("preview")}
            </Button>
          </div>
          {preview ? (
            <div className="mt-3" data-testid="visit-rule-check-result">
              <p className="text-xs text-muted-foreground">{preview.sourcePolicyName ? t("previewSource", { name: preview.sourcePolicyName }) : t("previewDefault")}</p>
              <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {preview.requirements.filter((item) => item.actionKey !== "CHECKLIST" && item.actionKey !== "NEXT_ACTION").map((item) => (
                  <li key={item.actionKey} className="flex items-baseline justify-between gap-2 border-b border-zinc-100 py-1 text-sm dark:border-zinc-800">
                    <span className={cn("min-w-0 truncate", item.mode === "HIDDEN" && "text-muted-foreground")}>{t(`actions.${item.actionKey}`)}</span>
                    <span className={cn("shrink-0 text-xs", item.mode === "REQUIRED" ? "font-semibold text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>
                      {t(`modes.${item.mode}`)}{item.mode === "REQUIRED" && item.minCount > 1 ? ` ×${item.minCount}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      )}
      </div>
    </section>
  )
}
