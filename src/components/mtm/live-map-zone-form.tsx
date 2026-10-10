"use client"

import { useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { MTM_AGENT_MAP_COLOR_KEYS, MTM_AGENT_MAP_COLORS, type MtmAgentMapColorKey } from "@/lib/mtm/agent-tags"
import {
  LIVE_MAP_ZONE_DEFAULT_HEX,
  LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS,
  LIVE_MAP_ZONE_LIMIT,
  LIVE_MAP_ZONE_MAX_RADIUS_METERS,
  LIVE_MAP_ZONE_MIN_RADIUS_METERS,
  LIVE_MAP_ZONE_NAME_MAX_LENGTH,
  parseLiveMapZoneRadius,
  type LiveMapZone,
  type LiveMapZoneChange,
  type LiveMapZoneWriteProblem,
} from "@/lib/mtm/live-map-zones"

/**
 * What the form is for. A new zone has no shape of its own here: the outline
 * is the ruler's, the centre is the point picked on the map — the form asks
 * only for what cannot be pressed on a map.
 */
export type LiveMapZoneFormTask =
  | { kind: "outline" }
  | { kind: "circle" }
  | { kind: "rename"; zone: LiveMapZone }
  | { kind: "color"; zone: LiveMapZone }
  | { kind: "delete"; zone: LiveMapZone }

export interface LiveMapZoneFormValues {
  /** Trimmed; never empty for a task that asks for a name. */
  name: string
  color: MtmAgentMapColorKey | null
  /** Whole metres inside the allowed range; read only by «circle». */
  radiusMeters: number
}

/** What a filled-in form asks for, of a zone that is already on the map. */
export function liveMapZoneFormChange(kind: LiveMapZoneChange["kind"], values: LiveMapZoneFormValues): LiveMapZoneChange {
  if (kind === "rename") return { kind, name: values.name }
  if (kind === "color") return { kind, color: values.color }
  return { kind }
}

type Notice = "nameRequired" | "radius" | LiveMapZoneWriteProblem

/**
 * Why the form cannot be sent right now, though nothing in it is wrong: what
 * it would keep — the ruler's outline — has stopped being something a zone
 * can be. In words, and with the one press that mends it when there is one.
 */
export interface LiveMapZoneFormBlock {
  text: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * The one small form of «Свои зоны»: name a new zone, rename one, give it a
 * colour, or confirm that it goes. It is drawn where the thing it is about
 * was pressed — beside the ruler, beside the picked point, in the zone's row
 * of the list.
 *
 * Nothing here draws a zone. The form hands over what was typed and waits:
 * the server either keeps it (and whoever opened the form takes the form
 * away) or says why not, and that is said here in words.
 */
export function LiveMapZoneForm({ task, onSubmit, onCancel, className, blocked = null }: {
  task: LiveMapZoneFormTask
  /** Resolves to why the server refused, or to null when it kept the change. */
  onSubmit: (values: LiveMapZoneFormValues) => Promise<LiveMapZoneWriteProblem | null>
  onCancel: () => void
  className?: string
  /**
   * Set while the form has nothing it could keep (see LiveMapZoneFormBlock).
   * The form stays as it is, with everything typed in it, says why, and its
   * «Сохранить» waits. It used to be taken away instead: one stray press on
   * the map made the ruler's line cross itself, and the name typed so far
   * went with the form, without a word.
   */
  blocked?: LiveMapZoneFormBlock | null
}) {
  const tMap = useTranslations("mtmMap")
  const tf = useTranslations("mtmForms")
  const locale = useLocale()
  const zone = task.kind === "rename" || task.kind === "color" || task.kind === "delete" ? task.zone : null
  const [name, setName] = useState(zone?.name ?? "")
  const [color, setColor] = useState<MtmAgentMapColorKey | null>(zone?.color ?? null)
  const [radius, setRadius] = useState(String(LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const asksName = task.kind === "outline" || task.kind === "circle" || task.kind === "rename"
  const asksRadius = task.kind === "circle"
  const asksColor = task.kind === "outline" || task.kind === "circle" || task.kind === "color"
  const removes = task.kind === "delete"
  const count = (value: number) => new Intl.NumberFormat(locale).format(value)
  const limits = {
    min: count(LIVE_MAP_ZONE_MIN_RADIUS_METERS),
    max: count(LIVE_MAP_ZONE_MAX_RADIUS_METERS),
    limit: count(LIVE_MAP_ZONE_LIMIT),
  }

  const title = tMap(`areas.form.${task.kind}Title`, { name: zone?.name ?? "" })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // Enter in the name field submits too, whatever the button looks like.
    if (busy || blocked) return
    const trimmed = name.trim()
    if (asksName && !trimmed) {
      setNotice("nameRequired")
      return
    }
    const radiusMeters = asksRadius ? parseLiveMapZoneRadius(radius) : LIVE_MAP_ZONE_DEFAULT_RADIUS_METERS
    if (radiusMeters == null) {
      setNotice("radius")
      return
    }
    setBusy(true)
    setNotice(null)
    const refused = await onSubmit({ name: trimmed, color, radiusMeters })
    setBusy(false)
    setNotice(refused)
  }

  return (
    <form
      onSubmit={submit}
      // The words under the fields are ours; the browser's own bubble would say «значение должно быть не меньше 25».
      noValidate
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) onCancel() }}
      aria-label={title}
      data-testid="live-map-zone-form"
      data-task={task.kind}
      className={cn("flex flex-col gap-2 rounded-lg border border-zinc-300 bg-card p-2 text-sm dark:border-zinc-600", className)}
    >
      <div className="text-xs font-semibold" data-testid="live-map-zone-form-title">{title}</div>
      {removes ? <p className="text-xs text-muted-foreground">{tMap("areas.form.deleteHint")}</p> : null}
      {asksName ? (
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={LIVE_MAP_ZONE_NAME_MAX_LENGTH}
          placeholder={tMap("areas.form.namePlaceholder")}
          aria-label={tMap("areas.form.name")}
          autoFocus
          autoComplete="off"
          data-testid="live-map-zone-name"
          className="h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60 dark:border-zinc-700"
        />
      ) : null}
      {asksRadius ? (
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-medium">{tMap("areas.form.radius")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={LIVE_MAP_ZONE_MIN_RADIUS_METERS}
            max={LIVE_MAP_ZONE_MAX_RADIUS_METERS}
            step={1}
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            data-testid="live-map-zone-radius"
            className="h-10 w-28 rounded-lg border border-zinc-200 bg-background px-2.5 text-sm outline-none focus:border-primary/60 dark:border-zinc-700"
          />
          <span className="text-muted-foreground" data-testid="live-map-zone-radius-range">{tMap("areas.form.radiusRange", limits)}</span>
        </label>
      ) : null}
      {asksColor ? (
        <div role="group" aria-label={tMap("areas.form.color")} className="flex flex-wrap items-center gap-1.5" data-testid="live-map-zone-colors">
          {MTM_AGENT_MAP_COLOR_KEYS.map((key) => {
            const chosen = color === key
            // The swatch takes its hex from the palette in the code, by key;
            // its name is on the button for a pointer and for a reader.
            return (
              <button
                key={key}
                type="button"
                onClick={() => setColor(key)}
                aria-pressed={chosen}
                aria-label={tf(`mapColors.${key}`)}
                title={tf(`mapColors.${key}`)}
                data-testid={`live-map-zone-color-${key}`}
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10",
                  chosen ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-background dark:ring-zinc-100" : "ring-1 ring-zinc-400/60",
                )}
                style={{ backgroundColor: MTM_AGENT_MAP_COLORS[key] }}
              >
                {chosen ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setColor(null)}
            aria-pressed={color === null}
            data-testid="live-map-zone-color-none"
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs [@media(pointer:coarse)]:h-10",
              color === null ? "border-zinc-900 font-semibold dark:border-zinc-100" : "border-zinc-300 text-muted-foreground hover:bg-muted dark:border-zinc-600",
            )}
          >
            {/* What «no colour» looks like on the map, so the choice is not a blank. */}
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: LIVE_MAP_ZONE_DEFAULT_HEX }} aria-hidden="true" />
            {tMap("areas.form.noColor")}
          </button>
          {/* The choice in words as well: a swatch alone does not name itself. */}
          {color ? <span className="text-xs font-medium" aria-hidden="true" data-testid="live-map-zone-color-name">{tf(`mapColors.${color}`)}</span> : null}
        </div>
      ) : null}
      {blocked ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-amber-800 dark:text-amber-300" data-testid="live-map-zone-blocked">
          <span>{blocked.text}</span>
          {blocked.actionLabel && blocked.onAction ? (
            <button
              type="button"
              onClick={blocked.onAction}
              disabled={busy}
              data-testid="live-map-zone-blocked-action"
              className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2 disabled:opacity-70 [@media(pointer:coarse)]:min-h-11"
            >
              {blocked.actionLabel}
            </button>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-400" data-testid="live-map-zone-notice">
          {tMap(`areas.errors.${notice}`, limits)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || blocked != null}
          data-testid="live-map-zone-save"
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-70 [@media(pointer:coarse)]:min-h-11",
            removes ? "bg-red-600 text-white hover:bg-red-700" : "bg-primary text-primary-foreground",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {tMap(removes ? (busy ? "areas.form.deleting" : "areas.form.delete") : (busy ? "areas.form.saving" : "areas.form.save"))}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          data-testid="live-map-zone-cancel"
          className="inline-flex min-h-9 items-center rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:bg-muted disabled:opacity-70 dark:border-zinc-600 [@media(pointer:coarse)]:min-h-11"
        >
          {tMap("areas.form.cancel")}
        </button>
      </div>
    </form>
  )
}

/**
 * What stands where a zone's form stood when the zone turned out to be gone:
 * a colleague removed it while its new name or colour was being chosen. The
 * zone has left the map and the list, and the form went with it — so this
 * says why, in the same place, until it is closed.
 *
 * Where the form stood, and not in a toast. For a form opened from a zone's
 * balloon that is on the map: the map's frame is what goes full screen, and
 * the page's toasts are drawn outside it, where the browser then shows
 * nothing. For a form opened from a zone's row it is the zones' card on the
 * page, above the rows that are left.
 */
export function LiveMapZoneGone({ onClose, className }: { onClose: () => void; className?: string }) {
  const tMap = useTranslations("mtmMap")
  return (
    <div
      role="status"
      data-testid="live-map-zone-gone"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200", className)}
    >
      <span>{tMap("areas.errors.gone")}</span>
      <button
        type="button"
        onClick={onClose}
        data-testid="live-map-zone-gone-close"
        className="inline-flex min-h-8 items-center font-semibold underline underline-offset-2 [@media(pointer:coarse)]:min-h-11"
      >
        {tMap("areas.form.close")}
      </button>
    </div>
  )
}
