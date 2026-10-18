"use client"

import { useTranslations } from "next-intl"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"

export type Mode = "agent" | "ai" | "rules" | "off"
export type ModeSource = "explicit" | "default_agent" | "whatsapp_default_ai"

export interface ChannelReplyRow {
  id: string
  channelType: string
  configName: string
  isActive: boolean
  reply: {
    mode: Mode
    modeDefaulted?: boolean
    modeSource?: ModeSource
    draftMode?: boolean
    /** A2 — auto-send confidence threshold; null = send everything. */
    aiThreshold?: number | null
    /** A3 — share of inbound conversations the AI handles; null = everyone. */
    aiRolloutPercent?: number | null
  }
}

/** UI-facing mode: collapses mode+draftMode into one 3-way choice. */
export type UiMode = "agent" | "ai_draft" | "ai"

/**
 * Per-channel "who replies" matrix. Reads/writes the reply policy via
 * /api/v1/settings/channel-reply. Only the channels in ENFORCED actually honor the setting
 * end-to-end today (TikTok↔Chatwoot, Facebook, Instagram, Telegram, VKontakte, WhatsApp);
 * any other channel stores it but its webhook doesn't act on it yet → shown disabled with a
 * "coming soon" badge so the control never reads as live when it isn't. NOTE: WhatsApp's AI
 * (Da Vinci) is default-ON, so the API reads an unset whatsapp channel as "ai" (not "agent").
 * The API lists conversation channels only: Social Monitoring's settings rows, the Slack/Teams
 * hooks and VoIP have screens of their own and never reach this matrix.
 *
 * Presentation (simplified 2026-07): a plain 3-way segmented control (Human / Draft / Auto)
 * per channel; the confidence + rollout knobs move to a muted second line, shown only when
 * the AI is on. Same data model + API as before.
 *
 * This is the matrix as it looks: rows in, choices out. `ChannelReplyMatrix`
 * (./channel-reply-matrix.tsx) loads and saves it for a tenant; the guided
 * demo renders the same matrix with its own rows.
 */
const ENFORCED = new Set(["chatwoot", "facebook", "instagram", "telegram", "vkontakte", "whatsapp"])

const CHANNEL_LABEL: Record<string, string> = {
  chatwoot: "TikTok", tiktok: "TikTok", telegram: "Telegram", whatsapp: "WhatsApp",
  facebook: "Facebook", instagram: "Instagram", vkontakte: "VKontakte",
  email: "Email", sms: "SMS", "web-chat": "Web Chat",
}

const UI_MODES: UiMode[] = ["agent", "ai_draft", "ai"]

export interface ChannelReplyMatrixViewProps {
  rows: readonly ChannelReplyRow[]
  loading: boolean
  savingId: string | null
  onUiModeChange: (row: ChannelReplyRow, ui: UiMode) => void
  onRolloutChange: (row: ChannelReplyRow, raw: string) => void
  onThresholdChange: (row: ChannelReplyRow, raw: string) => void
  /** Extra attributes for one mode button — the demo points its guide at one. */
  targetFor?: (row: ChannelReplyRow, mode: UiMode) => { "data-demo-target"?: string } | undefined
}

export function ChannelReplyMatrixView({
  rows,
  loading,
  savingId,
  onUiModeChange,
  onRolloutChange,
  onThresholdChange,
  targetFor,
}: ChannelReplyMatrixViewProps) {
  const t = useTranslations("settings")
  const modeLabel = (m: UiMode) =>
    m === "agent" ? t("aiModeHuman") : m === "ai_draft" ? t("aiModeDraft") : t("aiModeAuto")

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-start gap-2">
        <Sparkles className="h-5 w-5 text-violet-500 shrink-0 mt-0.5" />
        <div>
          <h2 className="font-semibold">{t("aiRoutingTitle2")}</h2>
          <p className="text-sm text-muted-foreground">{t("aiRoutingDesc2")}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">{t("noChannels")}</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => {
            const enforced = ENFORCED.has(row.channelType)
            const label = CHANNEL_LABEL[row.channelType] ?? row.channelType
            const isWhatsappDefaultAi = row.reply.modeSource === "whatsapp_default_ai"
            const value: UiMode =
              row.reply.mode === "ai" ? (row.reply.draftMode ? "ai_draft" : "ai") : "agent"
            const thresholdValue =
              typeof row.reply.aiThreshold === "number" ? String(row.reply.aiThreshold) : ""
            const rolloutValue =
              typeof row.reply.aiRolloutPercent === "number" ? String(row.reply.aiRolloutPercent) : ""
            const busy = savingId === row.id
            return (
              <div key={row.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{label}</span>
                      {!enforced && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                          {t("aiRoutingComingSoon")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{row.configName}</p>
                  </div>

                  {/* 3-way segmented control: Human / Draft / Auto */}
                  <div className="inline-flex shrink-0 rounded-md border border-zinc-200 dark:border-zinc-700 p-0.5">
                    {UI_MODES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        disabled={!enforced || busy}
                        onClick={() => value !== m && onUiModeChange(row, m)}
                        {...targetFor?.(row, m)}
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                          value === m
                            ? m === "agent"
                              ? "bg-zinc-200 text-foreground dark:bg-zinc-700"
                              : "bg-violet-500 text-white"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {modeLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fine-tune line — muted, only when the AI is on for an enforced channel. */}
                {value !== "agent" && enforced && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 pl-0 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5" title={t("aiRolloutHint")}>
                      {t("aiTuneRollout")}
                      <Select
                        value={rolloutValue}
                        disabled={busy}
                        onChange={(e) => onRolloutChange(row, e.target.value)}
                        className="h-7 w-24 text-xs"
                      >
                        <option value="">{t("aiRolloutAll")}</option>
                        <option value="75">75%</option>
                        <option value="50">50%</option>
                        <option value="25">25%</option>
                        <option value="10">10%</option>
                        <option value="0">0%</option>
                        {rolloutValue !== "" && !["75", "50", "25", "10", "0"].includes(rolloutValue) && (
                          <option value={rolloutValue}>{rolloutValue}%</option>
                        )}
                      </Select>
                    </label>
                    {value === "ai" && (
                      <label className="flex items-center gap-1.5" title={t("aiThresholdHint")}>
                        {t("aiTuneCaution")}
                        <Select
                          value={thresholdValue}
                          disabled={busy}
                          onChange={(e) => onThresholdChange(row, e.target.value)}
                          className="h-7 w-36 text-xs"
                        >
                          <option value="">{t("aiThresholdOff")}</option>
                          <option value="0.85">{t("aiCautionCareful")}</option>
                          <option value="0.7">{t("aiCautionBalanced")}</option>
                          <option value="0.55">{t("aiCautionBold")}</option>
                          {thresholdValue !== "" && !["0.85", "0.7", "0.55"].includes(thresholdValue) && (
                            <option value={thresholdValue}>{thresholdValue}</option>
                          )}
                        </Select>
                      </label>
                    )}
                  </div>
                )}

                {isWhatsappDefaultAi && (
                  <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
                    {t("replyModeWhatsappDefaultHint")}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("aiRoutingAiHint")}</p>
    </div>
  )
}
