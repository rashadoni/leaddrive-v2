"use client"

import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Bot, Loader2, Check, History, UserRoundCheck, Workflow, Download, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The Inbox AI agent card as it looks: props in, callbacks out, no session and
 * no network. `InboxAgentEditor` (./inbox-agent-editor.tsx) loads and saves
 * it for a tenant; the guided demo renders the same card with LeadDrive's own
 * agent in it (owner, 2026-10-17: demo screens are the product's own).
 */

export const INBOX_AGENT_MODELS = [
  { value: "claude-haiku-4-5-20251001", labelKey: "modelHaiku" },
  { value: "claude-sonnet-4-6", labelKey: "modelSonnet" },
  { value: "claude-opus-4-8", labelKey: "modelOpus" },
]

export interface InboxAgent {
  id?: string
  systemPrompt: string
  knowledgeBase: string
  replyLanguage: string
  model: string
  temperature: number
  escalationEnabled: boolean
  greeting: string
  autoLeadEnabled: boolean
  autoAssignSales: boolean
  autonomousBacklogEnabled: boolean
  autonomousLookbackDays: number
  autonomousBatchSize: number
}

/** The parts of the card a caller may wrap — the demo marks them for its guide. */
export type InboxAgentEditorField =
  | "master"
  | "prompt"
  | "knowledge"
  /** Model, reply language and temperature: the row under the knowledge base. */
  | "settings"
  | "greeting"
  | "escalation"
  | "autonomy"
  | "actions"

export interface InboxAgentEditorViewProps {
  agent: InboxAgent
  onAgentChange: (patch: Partial<InboxAgent>) => void
  aiOn: boolean
  onAiOnChange: (on: boolean) => void
  boards: ReadonlyArray<{ id: string; name: string }>
  qualificationBoardId: string
  onQualificationBoardChange: (id: string) => void
  saving: boolean
  savedTick: boolean
  error: string | null
  onSave: () => void
  importing: boolean
  onExport: () => void
  onImport: () => void
  /** The container's hidden file input, rendered right after the Import button. */
  importSlot?: ReactNode
  /** Text fields shown, not edited. */
  readOnly?: boolean
  /** Text areas as tall as their text: no box scrolling inside the page. */
  fitContent?: boolean
  decorate?: (field: InboxAgentEditorField, node: ReactNode) => ReactNode
}

const asIs = (_field: InboxAgentEditorField, node: ReactNode) => node

/** Grows a text area to its content; jsdom measures nothing, and then nothing changes. */
function useFitHeight(ref: RefObject<HTMLTextAreaElement | null>, value: string, enabled: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const fit = () => {
      el.style.height = "auto"
      if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
    }
    fit()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, value, enabled])
}

export function InboxAgentEditorView({
  agent,
  onAgentChange,
  aiOn,
  onAiOnChange,
  boards,
  qualificationBoardId,
  onQualificationBoardChange,
  saving,
  savedTick,
  error,
  onSave,
  importing,
  onExport,
  onImport,
  importSlot,
  readOnly,
  fitContent = false,
  decorate = asIs,
}: InboxAgentEditorViewProps) {
  const t = useTranslations("settings")
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const knowledgeRef = useRef<HTMLTextAreaElement>(null)
  useFitHeight(promptRef, agent.systemPrompt, fitContent)
  useFitHeight(knowledgeRef, agent.knowledgeBase, fitContent)
  const fitClass = fitContent ? "overflow-hidden resize-none" : undefined

  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-5">
      <div className="flex items-start gap-2">
        <Bot className="h-5 w-5 text-violet-500 mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold">{t("personaTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("personaDesc")}</p>
        </div>
      </div>

      {/* Master switch — the org-level aiAutoReply flag the engine self-gates on. */}
      {decorate("master",
        <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-muted/30">
          <div className="pr-3">
            <Label className="font-medium">{t("aiMasterToggle")}</Label>
            <p className="text-xs text-muted-foreground">{t("aiMasterHint")}</p>
          </div>
          <Switch checked={aiOn} onCheckedChange={onAiOnChange} />
        </div>,
      )}

      <div className="space-y-4">
        {decorate("prompt",
          <div>
            <Label>{t("fieldPrompt")}</Label>
            <Textarea
              ref={promptRef}
              value={agent.systemPrompt}
              onChange={(e) => onAgentChange({ systemPrompt: e.target.value })}
              rows={6}
              readOnly={readOnly}
              placeholder={t("fieldPromptHint")}
              className={cn("mt-1", fitClass)}
            />
          </div>,
        )}

        {/* Facts live apart from behaviour, as they do for the voice agent:
            a price list changes often, the rules almost never, and mixing them
            means every content edit risks disturbing how the agent behaves. */}
        {decorate("knowledge",
          <div>
            <Label>{t("fieldKnowledge")}</Label>
            <Textarea
              ref={knowledgeRef}
              value={agent.knowledgeBase}
              onChange={(e) => onAgentChange({ knowledgeBase: e.target.value })}
              rows={8}
              readOnly={readOnly}
              placeholder={t("fieldKnowledgeHint")}
              className={cn("mt-1", fitClass)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("fieldKnowledgeHelp")}</p>
          </div>,
        )}

        {decorate("settings",
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>{t("fieldModel")}</Label>
              <Select value={agent.model} onChange={(e) => onAgentChange({ model: e.target.value })} className="mt-1 w-full">
                {INBOX_AGENT_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
                ))}
              </Select>
            </div>
            <div>
              {/* A brand that answers in one language has to be able to say so.
                  The default — follow the customer — is right for a mixed
                  audience and wrong for a single-language brand, and until now
                  there was no way to tell the two apart. */}
              <Label>{t("fieldReplyLanguage")}</Label>
              <Select
                value={agent.replyLanguage}
                onChange={(e) => onAgentChange({ replyLanguage: e.target.value })}
                className="mt-1 w-full"
              >
                <option value="">{t("replyLanguageAuto")}</option>
                <option value="az">{t("replyLanguageAz")}</option>
                <option value="ru">{t("replyLanguageRu")}</option>
                <option value="en">{t("replyLanguageEn")}</option>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{t("fieldReplyLanguageHelp")}</p>
            </div>
            <div>
              <Label>{t("fieldTemperature")} — {agent.temperature.toFixed(1)}</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={agent.temperature}
                onChange={(e) => onAgentChange({ temperature: parseFloat(e.target.value) })}
                className="mt-3 w-full accent-violet-500"
              />
            </div>
          </div>,
        )}

        {decorate("greeting",
          <div>
            <Label>{t("fieldGreeting")}</Label>
            <Input
              value={agent.greeting}
              onChange={(e) => onAgentChange({ greeting: e.target.value })}
              readOnly={readOnly}
              placeholder={t("fieldGreetingHint")}
              className="mt-1"
            />
          </div>,
        )}

        {decorate("escalation",
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="pr-3">
              <Label className="font-medium">{t("fieldEscalation")}</Label>
              <p className="text-xs text-muted-foreground">{t("fieldEscalationHint")}</p>
            </div>
            <Switch checked={agent.escalationEnabled} onCheckedChange={(v) => onAgentChange({ escalationEnabled: v })} />
          </div>,
        )}

        {decorate("autonomy",
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/60 dark:bg-orange-950/20">
            <div className="flex items-start gap-2">
              <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div>
                <h3 className="font-semibold">{t("autonomyTitle")}</h3>
                <p className="text-sm text-muted-foreground">{t("autonomyDesc")}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                <div className="pr-3">
                  <Label className="flex items-center gap-1.5 font-medium">
                    <UserRoundCheck className="h-4 w-4 text-orange-600" />
                    {t("autoLeadTitle")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">{t("autoLeadHint")}</p>
                </div>
                <Switch
                  checked={agent.autoLeadEnabled}
                  onCheckedChange={(value) => onAgentChange({ autoLeadEnabled: value })}
                />
              </div>

              {agent.autoLeadEnabled && (
                <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("autonomyBoardLabel")}</Label>
                    <Select
                      value={qualificationBoardId}
                      onChange={(event) => onQualificationBoardChange(event.target.value)}
                      className="mt-1 w-full"
                    >
                      <option value="">{t("autonomyBoardPlaceholder")}</option>
                      {boards.map((board) => (
                        <option key={board.id} value={board.id}>{board.name}</option>
                      ))}
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">{t("autonomyBoardHint")}</p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                    <div className="pr-3">
                      <Label className="font-medium">{t("autoAssignTitle")}</Label>
                      <p className="text-xs leading-5 text-muted-foreground">{t("autoAssignHint")}</p>
                    </div>
                    <Switch
                      checked={agent.autoAssignSales}
                      onCheckedChange={(value) => onAgentChange({ autoAssignSales: value })}
                    />
                  </div>
                </div>
              )}

              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="pr-3">
                    <Label className="flex items-center gap-1.5 font-medium">
                      <History className="h-4 w-4 text-violet-500" />
                      {t("backlogTitle")}
                    </Label>
                    <p className="text-xs leading-5 text-muted-foreground">{t("backlogHint")}</p>
                  </div>
                  <Switch
                    checked={agent.autonomousBacklogEnabled}
                    onCheckedChange={(value) => onAgentChange({ autonomousBacklogEnabled: value })}
                  />
                </div>
                {agent.autonomousBacklogEnabled && (
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
                    <div>
                      <Label>{t("backlogDaysLabel")}</Label>
                      <Select
                        value={String(agent.autonomousLookbackDays)}
                        onChange={(event) => onAgentChange({ autonomousLookbackDays: Number(event.target.value) })}
                        className="mt-1 w-full"
                      >
                        <option value="1">1</option>
                        <option value="3">3</option>
                        <option value="7">7</option>
                        <option value="14">14</option>
                        <option value="30">30</option>
                      </Select>
                    </div>
                    <div>
                      <Label>{t("backlogBatchLabel")}</Label>
                      <Select
                        value={String(agent.autonomousBatchSize)}
                        onChange={(event) => onAgentChange({ autonomousBatchSize: Number(event.target.value) })}
                        className="mt-1 w-full"
                      >
                        <option value="5">5</option>
                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{t("saveError")}: {error}</p>}

      {decorate("actions",
        // Wraps on a phone: Save and the two transfer buttons do not fit one 302px line.
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSave} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("saveBtn")}
          </Button>
          {savedTick && !saving && (
            <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
              <Check className="h-4 w-4" /> {t("saved")}
            </span>
          )}

          {/* Moving this agent to another tenant. Copying the two text boxes by
              hand looks equivalent and is not: the switches below them change
              what the engine appends to the prompt, so the same words produce a
              different assistant. The whole card travels as one file, with a
              checksum, so a partial transfer fails instead of passing quietly. */}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onExport} className="gap-1.5">
              <Download className="h-4 w-4" /> {t("exportBtn")}
            </Button>
            <Button type="button" variant="outline" onClick={onImport} disabled={importing} className="gap-1.5">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("importBtn")}
            </Button>
            {importSlot}
          </div>
        </div>,
      )}
    </div>
  )
}
