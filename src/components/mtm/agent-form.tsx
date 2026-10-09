"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  MTM_AGENT_MAP_COLORS,
  MTM_AGENT_MAP_COLOR_KEYS,
  MTM_AGENT_TAG_MAX_COUNT,
  MTM_AGENT_TAG_MAX_LENGTH,
  isMtmAgentMapColorKey,
  normalizeMtmAgentTags,
  validateMtmAgentTags,
} from "@/lib/mtm/agent-tags"

interface AgentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: AgentData
  orgId?: string
}

interface AgentData {
  id: string
  name?: string | null
  email?: string | null
  phone?: string | null
  externalCode?: string | null
  role?: string | null
  status?: string | null
  canPlanOwnRoutes?: boolean | null
  canSelfPublishRoutes?: boolean | null
  managerId?: string | null
  tags?: string[] | null
  mapColor?: string | null
}

interface ManagerOption {
  id: string
  name: string
}

/** Why the label just typed was not added: the card would hold too many, the label is too long, or the text cannot be a label. */
type TagProblem = "limit" | "tooLong" | "refused"

/** A typed piece the way it would be stored — for comparing, never for showing. */
function tidyTag(piece: string): string {
  return normalizeMtmAgentTags([piece])[0] ?? ""
}

function isTagTooLong(piece: string): boolean {
  return tidyTag(piece).length > MTM_AGENT_TAG_MAX_LENGTH
}

/**
 * The card's labels once `typed` is added to them. A comma separates labels,
 * so a pasted «резерв, ночная смена» is two. The answer is the server's own
 * rule applied in the browser: a label the API would refuse never becomes a
 * chip, and nothing is cut or dropped behind the manager's back.
 *
 * A label other cards already carry is taken in THEIR spelling: «стажёр»
 * typed where colleagues are «Стажёр» becomes «Стажёр». The map's filter
 * counts the two as different values, so one group spelled two ways is shown
 * in halves — and the list of suggestions alone does not stop a typed word.
 */
function withTypedTags(
  current: string[],
  typed: string,
  known: readonly string[] = [],
): { tags: string[]; problem: TagProblem | null } {
  const pieces = typed.split(",").map((piece) => {
    const key = tidyTag(piece).toLowerCase()
    return (key && known.find((label) => label.toLowerCase() === key)) || piece
  })
  const next = normalizeMtmAgentTags([...current, ...pieces])
  // Nothing new: an empty entry, or a label the card already has.
  if (next.length === current.length) return { tags: current, problem: null }
  const checked = validateMtmAgentTags(next)
  if (checked.ok) return { tags: checked.tags, problem: null }
  // Each reason has its own words: «too long» said as «wrong characters»
  // leaves the manager looking for a character that is not there.
  return {
    tags: current,
    problem: checked.reason === "count" ? "limit" : checked.reason === "length" ? "tooLong" : "refused",
  }
}

export function MtmAgentForm({ open, onOpenChange, onSaved, initialData, orgId }: AgentFormProps) {
  const tc = useTranslations("common")
  const tf = useTranslations("mtmForms")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    externalCode: "",
    password: "",
    role: "AGENT",
    status: "ACTIVE",
    canPlanOwnRoutes: true,
    canSelfPublishRoutes: false,
    managerId: "",
    tags: [] as string[],
    mapColor: "",
  })
  const [managers, setManagers] = useState<ManagerOption[]>([])
  // The label being typed, before Enter or a comma turns it into a chip.
  const [tagDraft, setTagDraft] = useState("")
  const [tagProblem, setTagProblem] = useState<TagProblem | null>(null)
  // Labels other cards already carry, offered while typing — so the same
  // group is not spelled «резерв» on one card and «Резервные» on the next.
  const [knownTags, setKnownTags] = useState<string[]>([])
  // Whether the manager pressed a colour button in this form: only then is
  // the colour his to save (see what is sent in handleSubmit).
  const [mapColorTouched, setMapColorTouched] = useState(false)
  // Shown in clear by default. The manager sets this password for someone else
  // and has to hand it over, so what is saved must be what they can read: on
  // 2026-10-06 a manager set an agent's password twice behind the dots and the
  // phone was refused both times — the card held something else, and nothing on
  // the screen could show it.
  const [passwordHidden, setPasswordHidden] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      const givenColor = initialData?.mapColor
      setForm({
        name: initialData?.name || "",
        email: initialData?.email || "",
        phone: initialData?.phone || "",
        externalCode: initialData?.externalCode || "",
        password: "",
        role: initialData?.role || "AGENT",
        status: initialData?.status || "ACTIVE",
        canPlanOwnRoutes: initialData?.canPlanOwnRoutes ?? true,
        canSelfPublishRoutes: initialData?.canSelfPublishRoutes ?? false,
        managerId: initialData?.managerId || "",
        tags: normalizeMtmAgentTags(initialData?.tags ?? []),
        // A key this build does not know draws no ring on the map, so the
        // form shows «no colour» for it too.
        mapColor: isMtmAgentMapColorKey(givenColor) ? givenColor : "",
      })
      setMapColorTouched(false)
      setTagDraft("")
      setTagProblem(null)
      setError("")
      setPasswordHidden(false)
      fetch("/api/v1/mtm/agents?limit=200", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
        .then(r => r.json())
        .then(json => {
          if (!json.success) return
          const cards: Array<ManagerOption & { tags?: string[] | null }> = json.data.agents || []
          setManagers(cards)
          // «In use» means on somebody else's card. This card's own spelling
          // must stay correctable: counted as known, «Стажёр» retyped as
          // «стажёр» on the only card that carries it would turn back.
          const others = cards.filter(card => card.id !== initialData?.id)
          setKnownTags(normalizeMtmAgentTags(others.flatMap(card => card.tags ?? [])).sort((a, b) => a.localeCompare(b)))
        })
        .catch(() => {})
    }
  }, [open, initialData, orgId])

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  /** Turns what is typed into chips; says why when it cannot. `rest` stays in the field, still being typed. */
  const addTags = (typed: string, rest = "") => {
    const added = withTypedTags(form.tags, typed, knownTags)
    if (added.problem) {
      setTagProblem(added.problem)
      return
    }
    setForm(current => ({ ...current, tags: added.tags }))
    setTagDraft(rest)
    setTagProblem(isTagTooLong(rest) ? "tooLong" : null)
  }
  const changeTagDraft = (value: string) => {
    const comma = value.lastIndexOf(",")
    setTagDraft(value)
    if (comma === -1) {
      // Said while the label is being typed, not only on Enter: the field
      // itself no longer stops at the limit (see the input below).
      setTagProblem(isTagTooLong(value) ? "tooLong" : null)
      return
    }
    // A comma ends a label the way Enter does. What was refused stays in the
    // field as typed, next to the reason, so it can be corrected.
    addTags(value.slice(0, comma), value.slice(comma + 1).trimStart())
  }
  const removeTag = (tag: string) => {
    setForm(current => ({ ...current, tags: current.tags.filter(item => item !== tag) }))
    setTagProblem(null)
  }
  const tagsFull = form.tags.length >= MTM_AGENT_TAG_MAX_COUNT
  // A pasted list can fill the card and leave its tail in the field. That
  // text can never become a label, and a save would stop on it — so the field
  // stays open for it to be deleted, and the limit is said aloud meanwhile.
  const tagDraftLeftOver = tagsFull && tagDraft.trim() !== ""
  const suggestedTags = normalizeMtmAgentTags([...form.tags, ...knownTags]).slice(form.tags.length)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // A label still in the field is on the screen, so it is saved with the
    // rest — or the save stops and says why, rather than losing it quietly.
    const labels = withTypedTags(form.tags, tagDraft, knownTags)
    if (labels.problem) {
      setTagProblem(labels.problem)
      return
    }
    // On an existing card the labels and the colour travel only when THIS
    // form changed them; the server keeps what it is not sent. The form is
    // filled from a row of a list that may be minutes old, or that left the
    // two fields out: sent back unchanged on every save, that row erased what
    // another manager had set meanwhile — while correcting a phone number.
    const openedTags = normalizeMtmAgentTags(initialData?.tags ?? [])
    const tagsChanged = labels.tags.length !== openedTags.length || labels.tags.some((tag, index) => tag !== openedTags[index])
    // Against what the card holds, not what the form drew: a colour key this
    // build does not know is drawn as «no colour», and is left alone until
    // the manager himself presses a colour button.
    const mapColorChanged = mapColorTouched && (form.mapColor || null) !== (initialData?.mapColor ?? null)
    const sendTags = !isEdit || tagsChanged
    const sendMapColor = !isEdit || mapColorChanged
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `/api/v1/mtm/agents/${initialData!.id}` : "/api/v1/mtm/agents"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          ...form,
          managerId: form.managerId || null,
          password: form.password || undefined, // only send if not empty
          tags: sendTags ? labels.tags : undefined,
          mapColor: sendMapColor ? form.mapColor || null : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tc("failedToSave"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editAgent") : tf("addAgent")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="name">{`${tc("name")} *`}</Label>
              <Input id="name" value={form.name} onChange={e => update("name", e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="email">{tc("email")}</Label>
                <Input id="email" type="email" value={form.email} onChange={e => update("email", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="phone">{tc("phone")}</Label>
                <Input id="phone" value={form.phone} onChange={e => update("phone", e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="externalCode">{tf("externalCode")}</Label>
              <Input id="externalCode" value={form.externalCode} onChange={e => update("externalCode", e.target.value)} placeholder={tf("externalCodeHint")} />
            </div>
            <div>
              <Label htmlFor="agent-password">{isEdit ? tf("newPassword") : tf("password")} {!isEdit && "*"}</Label>
              <div className="relative">
                {/* Not `id="password"` beside an email field: that is a sign-in
                    form to a browser, which then offers — or fills in — the
                    manager's own saved password. `new-password` says this is a
                    credential being set; in clear it is an ordinary field the
                    browser must not remember. */}
                <Input
                  id="agent-password"
                  name="agent-new-password"
                  type={passwordHidden ? "password" : "text"}
                  value={form.password}
                  onChange={e => update("password", e.target.value)}
                  placeholder={isEdit ? tf("leaveEmptyToKeep") : tf("minSixChars")}
                  minLength={isEdit ? undefined : 12}
                  maxLength={72}
                  required={!isEdit}
                  autoComplete={passwordHidden ? "new-password" : "off"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="pr-24"
                />
                <button
                  type="button"
                  onClick={() => setPasswordHidden(hidden => !hidden)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                >
                  {passwordHidden ? tf("showPassword") : tf("hidePassword")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{tf("passwordHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="role">{tf("role")}</Label>
                <Select value={form.role} onChange={e => update("role", e.target.value)}>
                  <option value="AGENT">{tf("roleAgent")}</option>
                  <option value="SUPERVISOR">{tf("roleSupervisor")}</option>
                  <option value="MANAGER">{tf("roleManager")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={e => update("status", e.target.value)}>
                  <option value="ACTIVE">{tc("active")}</option>
                  <option value="INACTIVE">{tc("inactive")}</option>
                  <option value="SUSPENDED">{tf("suspended")}</option>
                </Select>
              </div>
            </div>
            {form.role === "AGENT" ? (
              <div className="grid gap-3">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                  <input
                    id="canPlanOwnRoutes"
                    className="mt-0.5 h-5 w-5 accent-primary"
                    type="checkbox"
                    checked={form.canPlanOwnRoutes}
                    onChange={(event) => setForm((current) => ({ ...current, canPlanOwnRoutes: event.target.checked }))}
                  />
                  <span>
                    <span className="block font-medium">{tf("allowSelfRoutePlanning")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{tf("allowSelfRoutePlanningHint")}</span>
                  </span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
                  <input
                    id="canSelfPublishRoutes"
                    className="mt-0.5 h-5 w-5 accent-primary"
                    type="checkbox"
                    checked={form.canSelfPublishRoutes}
                    onChange={(event) => setForm((current) => ({ ...current, canSelfPublishRoutes: event.target.checked }))}
                  />
                  <span>
                    <span className="block font-medium">{tf("allowSelfRoutePublish")}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{tf("allowSelfRoutePublishHint")}</span>
                  </span>
                </label>
              </div>
            ) : null}
            <div>
              <Label htmlFor="agent-tags">{tf("tags")}</Label>
              <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200/70 bg-card px-2 py-1.5 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/20 dark:border-zinc-700/70">
                {form.tags.map(tag => (
                  <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm">
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={tf("removeTag", { tag })}
                      title={tf("removeTag", { tag })}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <input
                  id="agent-tags"
                  list="agent-tags-known"
                  value={tagDraft}
                  onChange={e => changeTagDraft(e.target.value)}
                  onKeyDown={e => {
                    // Enter adds the label; it must not save the whole card
                    // half-way through typing one.
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
                    e.preventDefault()
                    addTags(tagDraft)
                  }}
                  placeholder={tagsFull ? "" : tf("tagsPlaceholder")}
                  // No maxLength here: a browser applies it to the whole
                  // pasted text, so «стажёр, ночная смена, резерв» arrived
                  // cut to «…, ре» and the tail was saved as a label. The
                  // length is checked per label, with its own message.
                  //
                  // Closed at the limit only while empty: text left in the
                  // field has to stay deletable.
                  disabled={tagsFull && tagDraft === ""}
                  autoComplete="off"
                  // A tablet keyboard capitalises the first letter, which
                  // made «Стажёр» out of the laptop's «стажёр».
                  autoCapitalize="none"
                  className="h-7 min-w-[9rem] flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed md:text-sm"
                />
              </div>
              <datalist id="agent-tags-known">
                {suggestedTags.map(tag => <option key={tag} value={tag} />)}
              </datalist>
              {tagProblem === "tooLong" ? (
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{tf("tagTooLong", { max: MTM_AGENT_TAG_MAX_LENGTH })}</p>
              ) : tagProblem === "refused" ? (
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{tf("tagRefused")}</p>
              ) : tagProblem === "limit" || tagDraftLeftOver ? (
                // An alert, and in its own words: the text in the field is
                // what stops the save, and «there are already ten» is untrue
                // of a card with nine labels and two more pasted.
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{tf("tagsOverLimit", { max: MTM_AGENT_TAG_MAX_COUNT })}</p>
              ) : tagsFull ? (
                <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-400">{tf("tagsLimit", { max: MTM_AGENT_TAG_MAX_COUNT })}</p>
              ) : null}
              <p className="text-xs text-muted-foreground mt-1">{tf("tagsHint", { max: MTM_AGENT_TAG_MAX_COUNT })}</p>
            </div>
            <div>
              <Label id="agent-map-color-label">{tf("mapColor")}</Label>
              <div role="group" aria-labelledby="agent-map-color-label" className="mt-1 flex flex-wrap items-center gap-2">
                {MTM_AGENT_MAP_COLOR_KEYS.map(key => {
                  const chosen = form.mapColor === key
                  // The swatch takes its hex from the palette in the code, by
                  // key; the name is on the button for a pointer and a reader.
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setMapColorTouched(true)
                        setForm(current => ({ ...current, mapColor: key }))
                      }}
                      aria-pressed={chosen}
                      aria-label={tf(`mapColors.${key}`)}
                      title={tf(`mapColors.${key}`)}
                      className={cn(
                        "inline-flex h-9 w-9 items-center justify-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2",
                        // The thin outline keeps a dark colour in sight on a
                        // dark theme, as on the map's list: «Чёрный» on the
                        // dark dialog was a gap where the eighth button is.
                        chosen
                          ? "ring-2 ring-zinc-900 ring-offset-2 ring-offset-background dark:ring-zinc-100"
                          : "ring-1 ring-zinc-400/60",
                      )}
                      style={{ backgroundColor: MTM_AGENT_MAP_COLORS[key] }}
                    >
                      {chosen ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => {
                    setMapColorTouched(true)
                    setForm(current => ({ ...current, mapColor: "" }))
                  }}
                  aria-pressed={form.mapColor === ""}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    form.mapColor === ""
                      ? "border-zinc-900 font-medium dark:border-zinc-100"
                      : "border-zinc-200 text-muted-foreground hover:bg-muted dark:border-zinc-700",
                  )}
                >
                  {tf("mapColorNone")}
                </button>
                {/* The choice in words as well: a swatch alone does not name itself. */}
                {isMtmAgentMapColorKey(form.mapColor) ? (
                  <span className="text-sm font-medium" aria-hidden="true">{tf(`mapColors.${form.mapColor}`)}</span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{tf("mapColorHint")}</p>
            </div>
            <div>
              <Label htmlFor="managerId">{tf("manager")}</Label>
              <Select value={form.managerId} onChange={e => update("managerId", e.target.value)}>
                <option value="">{tf("noManager")}</option>
                {managers.filter(m => m.id !== initialData?.id).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
