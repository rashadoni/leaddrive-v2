"use client"

/**
 * Inbox bulk-selection actions — Whelp-style compact card between the
 * conversation-list filters and the scroll list. The list column is ~380px
 * wide, so the shared EntityBulkBar chrome (flex-wrap + fixed-width selects)
 * collapses here into an accidental tower of misaligned controls. This
 * card lays the same four actions out deliberately instead:
 *   count + clear · Close (primary, full width) · Assign | Folder · Tags.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Tag, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Input } from "@/components/ui/input"

interface Props {
  selectedCount: number
  busy: boolean
  agents: { id: string; name: string | null }[]
  folders: { id: string; name: string }[]
  onClearSelection: () => void
  onOpenClose: () => void
  onAssign: (userId: string | null) => void
  onFolder: (folderId: string | null) => void
  onTags: (tags: string[]) => void
}

export function InboxBulkBar({ selectedCount, busy, agents, folders, onClearSelection, onOpenClose, onAssign, onFolder, onTags }: Props) {
  const t = useTranslations("inboxV2")
  const tc = useTranslations("common")
  const [tagsDraft, setTagsDraft] = useState("")

  if (selectedCount === 0) return null

  return (
    <div
      role="region"
      aria-label={tc("selected", { count: selectedCount })}
      className="mx-3 my-2 space-y-2 rounded-xl border border-primary/25 bg-card p-2.5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{selectedCount}</span>
          {tc("selected", { count: selectedCount })}
        </span>
        <button
          type="button"
          onClick={onClearSelection}
          aria-label={tc("deselect")}
          title={tc("deselect")}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Button size="sm" className="h-8 w-full gap-1.5 text-xs" disabled={busy} onClick={onOpenClose}>
        <Check className="h-3.5 w-3.5" />
        {t("bulkClose")}
      </Button>
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          aria-label={t("bulkAssign")}
          className="h-8 text-xs"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "") return
            onAssign(e.target.value === "__unassign__" ? null : e.target.value)
          }}
        >
          <option value="">{t("bulkAssignPlaceholder")}</option>
          <option value="__unassign__">{t("bulkUnassign")}</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
          ))}
        </Select>
        <Select
          aria-label={t("bulkMoveToFolder")}
          className="h-8 text-xs"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "") return
            onFolder(e.target.value === "__unfile__" ? null : e.target.value)
          }}
        >
          <option value="">{t("bulkMoveToFolder")}</option>
          <option value="__unfile__">{t("bulkNoFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>{folder.name}</option>
          ))}
        </Select>
      </div>
      <div className="relative">
        <Tag className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t("bulkAddTags")}
          placeholder={t("bulkAddTags")}
          className="h-8 pl-8 text-xs"
          value={tagsDraft}
          disabled={busy}
          onChange={(e) => setTagsDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            const tags = tagsDraft.split(",").map((tag) => tag.trim()).filter(Boolean)
            if (tags.length === 0) return
            onTags(tags)
            setTagsDraft("")
          }}
        />
      </div>
    </div>
  )
}
