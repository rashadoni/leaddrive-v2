"use client"

import { useState, type ComponentType, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Bot, CalendarDays, Check, Loader2, PhoneCall, SquareKanban, StickyNote, Tag, UserPlus, Zap } from "lucide-react"
import { Hint } from "@/components/hint"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { PanelCard } from "./panel-card"

type Icon = ComponentType<{ className?: string }>

/** A disabled tile still says why — the owner does not read icons, and a grey square says nothing. */
type Availability = { enabled: true; hint: string } | { enabled: false; hint: string }

export type QuickActionsProps = {
  call: Availability & { run?: () => void }
  assign: Availability & {
    agents: { id: string; name: string | null }[]
    assignedTo: string | null
    onAssign: (userId: string | null) => void
  }
  tag: Availability & { run?: () => void }
  note: Availability & { run?: () => void }
  meeting: Availability & { run?: () => void }
  deal: Availability & { run?: () => void }
  template: Availability & { replies: { label: string; text: string }[]; onInsert: (text: string) => void }
  ai: Availability & {
    off: boolean
    saving: boolean
    onToggle: () => void
  }
}

const TONES = {
  call: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  assign: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  tag: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  note: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  meeting: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  deal: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  template: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  aiOn: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  aiOff: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
} as const

function TileFace({ icon: IconCmp, tone, label, sub, busy }: { icon: Icon; tone: string; label: string; sub?: string; busy?: boolean }) {
  return (
    <>
      <span className={cn("flex h-[38px] w-[38px] items-center justify-center rounded-xl", tone)}>
        {busy ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <IconCmp className="h-[17px] w-[17px]" />}
      </span>
      <span className="w-full truncate text-[10px] font-semibold leading-tight text-foreground/75">{label}</span>
      {sub ? <span className="-mt-0.5 w-full truncate text-[9px] font-semibold leading-tight text-muted-foreground">{sub}</span> : null}
    </>
  )
}

const TILE = "flex min-w-0 flex-col items-center gap-1 rounded-xl px-0.5 py-1 text-center transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"

function Tile({ testId, availability, onClick, children, pressed }: {
  testId: string
  availability: Availability
  onClick?: () => void
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <Hint text={availability.hint} side="bottom" wrap={!availability.enabled}>
      <button
        type="button"
        data-testid={testId}
        className={TILE}
        disabled={!availability.enabled}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {children}
      </button>
    </Hint>
  )
}

/**
 * «Sürətli əməllər» — the eight tiles of the owner-approved mock-up (2026-11-15). Five of them were
 * already in the inbox, scattered over the header, the composer and the panel; three are new:
 * a meeting, a deal, and the conversation's own AI switch.
 */
export function QuickActions(props: QuickActionsProps) {
  const t = useTranslations("inboxPanel")
  const [assignOpen, setAssignOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const { call, assign, tag, note, meeting, deal, template, ai } = props

  return (
    <PanelCard title={t("quickActions")} testId="inbox-panel-quick-actions">
      <div className="grid grid-cols-4 gap-x-1 gap-y-2">
        <Tile testId="inbox-panel-action-call" availability={call} onClick={call.run}>
          <TileFace icon={PhoneCall} tone={TONES.call} label={t("actCall")} />
        </Tile>

        <Popover open={assignOpen} onOpenChange={setAssignOpen}>
          <Hint text={assign.hint} side="bottom" wrap={!assign.enabled}>
            <PopoverTrigger asChild disabled={!assign.enabled}>
              <button type="button" data-testid="inbox-panel-action-assign" className={TILE} disabled={!assign.enabled}>
                <TileFace icon={UserPlus} tone={TONES.assign} label={t("actAssign")} />
              </button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent align="start" className="w-56 p-1.5">
            <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("assignTitle")}</div>
            <div className="max-h-64 overflow-y-auto">
              {[{ id: null as string | null, name: t("assignNobody") }, ...assign.agents.map((agent) => ({ id: agent.id as string | null, name: agent.name || "—" }))].map((option) => (
                <button
                  key={option.id ?? "nobody"}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => { setAssignOpen(false); assign.onAssign(option.id) }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {assign.assignedTo === option.id ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Tile testId="inbox-panel-action-tag" availability={tag} onClick={tag.run}>
          <TileFace icon={Tag} tone={TONES.tag} label={t("actTag")} />
        </Tile>
        <Tile testId="inbox-panel-action-note" availability={note} onClick={note.run}>
          <TileFace icon={StickyNote} tone={TONES.note} label={t("actNote")} />
        </Tile>
        <Tile testId="inbox-panel-action-meeting" availability={meeting} onClick={meeting.run}>
          <TileFace icon={CalendarDays} tone={TONES.meeting} label={t("actMeeting")} />
        </Tile>
        <Tile testId="inbox-panel-action-deal" availability={deal} onClick={deal.run}>
          <TileFace icon={SquareKanban} tone={TONES.deal} label={t("actDeal")} />
        </Tile>

        <Popover open={templatesOpen} onOpenChange={setTemplatesOpen}>
          <Hint text={template.hint} side="bottom" wrap={!template.enabled}>
            <PopoverTrigger asChild disabled={!template.enabled}>
              <button type="button" data-testid="inbox-panel-action-template" className={TILE} disabled={!template.enabled}>
                <TileFace icon={Zap} tone={TONES.template} label={t("actTemplate")} />
              </button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent align="end" className="w-64 p-1.5">
            <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("templatesTitle")}</div>
            <div className="max-h-72 overflow-y-auto">
              {template.replies.map((reply, index) => (
                <button
                  key={`${reply.label}-${index}`}
                  type="button"
                  className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => { setTemplatesOpen(false); template.onInsert(reply.text) }}
                >
                  <span className="block truncate text-xs font-medium">{reply.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{reply.text}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Tile testId="inbox-panel-action-ai" availability={ai} onClick={ai.onToggle} pressed={!ai.off}>
          <TileFace
            icon={Bot}
            tone={ai.off ? TONES.aiOff : TONES.aiOn}
            label={t("actAi")}
            sub={ai.off ? t("aiStateOff") : t("aiStateOn")}
            busy={ai.saving}
          />
        </Tile>
      </div>
    </PanelCard>
  )
}
