"use client"

import { useState, useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { X, Eye, Building2, LinkIcon, UserCircle, Tag, Calendar, Type, Mail, Phone, Zap, Archive, Loader2, Users, Check, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { SegmentConditionBuilder } from "@/components/segment-condition-builder"

interface SegmentConditions {
  company: string
  source: string
  brand: string
  category: string
  role: string
  tag: string
  createdAfter: string
  createdBefore: string
  name: string
  hasEmail: boolean
  hasPhone: boolean
  // SMS attribution (TT §3.3)
  hasSmsAttribution: boolean
  smsSinceDays: string
  // Behavioral conditions
  engagementScoreMin: string
  engagementScoreMax: string
  engagementTier: string
  lastActivityAfter: string
  lastActivityBefore: string
  inactiveDays: string
  hasEventType: string
}

const emptyConditions: SegmentConditions = {
  company: "",
  source: "",
  brand: "",
  category: "",
  role: "",
  tag: "",
  createdAfter: "",
  createdBefore: "",
  name: "",
  hasEmail: false,
  hasPhone: false,
  hasSmsAttribution: false,
  smsSinceDays: "",
  engagementScoreMin: "",
  engagementScoreMax: "",
  engagementTier: "",
  lastActivityAfter: "",
  lastActivityBefore: "",
  inactiveDays: "",
  hasEventType: "",
}

interface SegmentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: any
  orgId?: string
}

export function SegmentForm({ open, onOpenChange, onSaved, initialData, orgId }: SegmentFormProps) {
  const t = useTranslations("segments")
  const tc = useTranslations("common")
  const tb = useTranslations("behavioralFilters")
  const isEdit = !!initialData?.id

  const sourceOptions = [
    { value: "", label: t("sourceAny") },
    { value: "website", label: t("sourceWebsite") },
    { value: "referral", label: t("sourceReferral") },
    { value: "cold_call", label: t("sourceColdCall") },
    { value: "email", label: t("sourceEmail") },
    { value: "sms", label: "SMS" },
    { value: "social", label: t("sourceSocial") },
    { value: "event", label: t("sourceEvent") },
    { value: "other", label: t("sourceOther") },
  ]

  const categoryOptions = [
    { value: "", label: t("sourceAny") },
    { value: "vip", label: "VIP" },
    { value: "regular", label: "Regular" },
    { value: "partner", label: "Partner" },
    { value: "prospect", label: "Prospect" },
    { value: "inactive", label: "Inactive" },
  ]

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isDynamic, setIsDynamic] = useState(true)
  const [conditions, setConditions] = useState<SegmentConditions>(emptyConditions)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [advancedMode, setAdvancedMode] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialData?.name || "")
      setDescription(initialData?.description || "")
      setIsDynamic(initialData?.isDynamic !== false)
      setPreviewCount(null)
      setError("")

      if (initialData?.conditions && typeof initialData.conditions === "object") {
        const c = initialData.conditions as any
        setConditions({
          company: c.company || "",
          source: c.source || "",
          brand: c.brand || "",
          category: c.category || "",
          role: c.role || "",
          tag: c.tag || "",
          createdAfter: c.createdAfter || c.created_after || "",
          createdBefore: c.createdBefore || c.created_before || "",
          name: c.name || "",
          hasEmail: !!c.hasEmail || !!c.has_email,
          hasPhone: !!c.hasPhone || !!c.has_phone,
          hasSmsAttribution: !!c.hasSmsAttribution || !!c.receivedSms,
          smsSinceDays: c.smsSinceDays || "",
          engagementScoreMin: c.engagementScoreMin || "",
          engagementScoreMax: c.engagementScoreMax || "",
          engagementTier: c.engagementTier || "",
          lastActivityAfter: c.lastActivityAfter || "",
          lastActivityBefore: c.lastActivityBefore || "",
          inactiveDays: c.inactiveDays || "",
          hasEventType: c.hasEventType || "",
        })
      } else {
        setConditions(emptyConditions)
      }
    }
  }, [open, initialData])

  const updateCond = (key: keyof SegmentConditions, value: any) => {
    setConditions(c => ({ ...c, [key]: value }))
    setPreviewCount(null)
  }

  const activeConditionsCount = useMemo(() => {
    let count = 0
    if (conditions.company.trim()) count++
    if (conditions.source) count++
    if (conditions.brand.trim()) count++
    if (conditions.category) count++
    if (conditions.role.trim()) count++
    if (conditions.tag.trim()) count++
    if (conditions.createdAfter) count++
    if (conditions.createdBefore) count++
    if (conditions.name.trim()) count++
    if (conditions.hasEmail) count++
    if (conditions.hasPhone) count++
    if (conditions.hasSmsAttribution) count++
    if (conditions.smsSinceDays) count++
    if (conditions.engagementScoreMin) count++
    if (conditions.engagementScoreMax) count++
    if (conditions.engagementTier) count++
    if (conditions.lastActivityAfter) count++
    if (conditions.lastActivityBefore) count++
    if (conditions.inactiveDays) count++
    if (conditions.hasEventType) count++
    return count
  }, [conditions])

  const getCleanConditions = () => {
    const clean: any = {}
    if (conditions.company.trim()) clean.company = conditions.company.trim()
    if (conditions.source) clean.source = conditions.source
    if (conditions.brand.trim()) clean.brand = conditions.brand.trim()
    if (conditions.category) clean.category = conditions.category
    if (conditions.role.trim()) clean.role = conditions.role.trim()
    if (conditions.tag.trim()) clean.tag = conditions.tag.trim()
    if (conditions.createdAfter) clean.createdAfter = conditions.createdAfter
    if (conditions.createdBefore) clean.createdBefore = conditions.createdBefore
    if (conditions.name.trim()) clean.name = conditions.name.trim()
    if (conditions.hasEmail) clean.hasEmail = true
    if (conditions.hasPhone) clean.hasPhone = true
    if (conditions.hasSmsAttribution) clean.hasSmsAttribution = true
    if (conditions.smsSinceDays) clean.smsSinceDays = conditions.smsSinceDays
    // Behavioral conditions
    if (conditions.engagementScoreMin) clean.engagementScoreMin = conditions.engagementScoreMin
    if (conditions.engagementScoreMax) clean.engagementScoreMax = conditions.engagementScoreMax
    if (conditions.engagementTier) clean.engagementTier = conditions.engagementTier
    if (conditions.lastActivityAfter) clean.lastActivityAfter = conditions.lastActivityAfter
    if (conditions.lastActivityBefore) clean.lastActivityBefore = conditions.lastActivityBefore
    if (conditions.inactiveDays) clean.inactiveDays = conditions.inactiveDays
    if (conditions.hasEventType) clean.hasEventType = conditions.hasEventType
    return clean
  }

  const handlePreview = async () => {
    setPreviewing(true)
    try {
      const res = await fetch("/api/v1/segments/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ conditions: getCleanConditions() }),
      })
      const json = await res.json()
      if (json.success) setPreviewCount(json.data.count)
    } catch (err) { console.error(err) } finally { setPreviewing(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t("nameRequired"))
      return
    }
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/segments/${initialData!.id}` : "/api/v1/segments"
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        isDynamic,
        conditions: getCleanConditions(),
        contactCount: previewCount ?? initialData?.contactCount ?? 0,
      }
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("saveFailed"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const clearCondition = (key: keyof SegmentConditions) => {
    if (typeof conditions[key] === "boolean") {
      updateCond(key, false)
    } else {
      updateCond(key, "")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <DialogTitle>{isEdit ? t("titleEdit") : t("titleNew")}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{t("subtitle2")}</p>
            </div>
          </div>
        </div>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg mb-4">{error}</div>}

          <div className="space-y-5">
            {/* Basic info */}
            <div className="space-y-3">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`${t("namePlaceholder")} *`}
                className="text-base font-medium h-11"
                required
              />
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t("descPlaceholder")}
                rows={2}
                className="resize-none"
              />
            </div>

            {/* Type toggle — styled as pill switcher */}
            <div className="flex items-center gap-2 p-1 bg-muted rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setIsDynamic(true)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  isDynamic
                    ? "bg-background shadow-sm text-green-700 dark:text-green-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Zap className="h-3.5 w-3.5" />
                {t("dynamicType")}
              </button>
              <button
                type="button"
                onClick={() => setIsDynamic(false)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  !isDynamic
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Archive className="h-3.5 w-3.5" />
                {t("staticType")}
              </button>
            </div>

            {/* Conditions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  {t("filters")}
                  {activeConditionsCount > 0 && (
                    <Badge variant="default" className="h-5 min-w-[20px] justify-center text-[11px] px-1.5">
                      {activeConditionsCount}
                    </Badge>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAdvancedMode(!advancedMode)}
                    className={cn("flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 transition-colors",
                      advancedMode ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:text-foreground border-muted"
                    )}
                  >
                    <GitBranch className="h-3 w-3" /> {advancedMode ? "Advanced" : "Advanced"}
                  </button>
                  {activeConditionsCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setConditions(emptyConditions)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("resetAll")}
                    </button>
                  )}
                </div>
              </div>

              {/* Active conditions chips */}
              {activeConditionsCount > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {conditions.company.trim() && (
                    <ConditionChip label={`${t("condCompany")}: ${conditions.company}`} onRemove={() => clearCondition("company")} />
                  )}
                  {conditions.source && (
                    <ConditionChip label={`${t("condSource")}: ${sourceOptions.find(o => o.value === conditions.source)?.label}`} onRemove={() => clearCondition("source")} />
                  )}
                  {conditions.role.trim() && (
                    <ConditionChip label={`${t("condRole")}: ${conditions.role}`} onRemove={() => clearCondition("role")} />
                  )}
                  {conditions.tag.trim() && (
                    <ConditionChip label={`${t("condTag")}: ${conditions.tag}`} onRemove={() => clearCondition("tag")} />
                  )}
                  {conditions.name.trim() && (
                    <ConditionChip label={`${t("condName")}: ${conditions.name}`} onRemove={() => clearCondition("name")} />
                  )}
                  {conditions.createdAfter && (
                    <ConditionChip label={`${t("condAfter")}: ${conditions.createdAfter}`} onRemove={() => clearCondition("createdAfter")} />
                  )}
                  {conditions.createdBefore && (
                    <ConditionChip label={`${t("condBefore")}: ${conditions.createdBefore}`} onRemove={() => clearCondition("createdBefore")} />
                  )}
                  {conditions.hasEmail && (
                    <ConditionChip label={t("condHasEmail")} onRemove={() => clearCondition("hasEmail")} />
                  )}
                  {conditions.hasPhone && (
                    <ConditionChip label={t("condHasPhone")} onRemove={() => clearCondition("hasPhone")} />
                  )}
                </div>
              )}

              {/* Advanced Condition Builder */}
              {advancedMode && (
                <SegmentConditionBuilder
                  initialConditions={Object.entries(getCleanConditions()).map(([key, value]) => ({ field: key, operator: "contains", value: String(value) }))}
                  onSave={(groups) => {
                    // Convert advanced groups back to simple conditions for now
                    const firstGroup = groups[0]
                    if (firstGroup) {
                      const newConds = { ...emptyConditions }
                      firstGroup.conditions.forEach(c => {
                        if (c.field in newConds) {
                          if (typeof (newConds as any)[c.field] === "boolean") {
                            (newConds as any)[c.field] = c.operator === "is_true"
                          } else {
                            (newConds as any)[c.field] = c.value
                          }
                        }
                      })
                      setConditions(newConds)
                    }
                    setAdvancedMode(false)
                  }}
                />
              )}

              {/* Filter grid */}
              {!advancedMode && <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 p-4 space-y-4">
                {/* Row 1: Company + Source */}
                <div className="grid grid-cols-2 gap-3">
                  <FilterField icon={Building2} label={t("condCompany")}>
                    <Input
                      value={conditions.company}
                      onChange={e => updateCond("company", e.target.value)}
                      placeholder={t("contains")}
                      className="h-9"
                    />
                  </FilterField>
                  <FilterField icon={LinkIcon} label={t("condSource")}>
                    <Select
                      value={conditions.source}
                      onChange={e => updateCond("source", e.target.value)}
                      className="h-9"
                    >
                      {sourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </FilterField>
                </div>

                {/* Row 1b: Brand + Category (TT §3.3) */}
                <div className="grid grid-cols-2 gap-3">
                  <FilterField icon={Tag} label={t("condBrand")}>
                    <Input
                      value={conditions.brand}
                      onChange={e => updateCond("brand", e.target.value)}
                      placeholder={t("contains")}
                      className="h-9"
                    />
                  </FilterField>
                  <FilterField icon={Archive} label={t("condCategory")}>
                    <Select
                      value={conditions.category}
                      onChange={e => updateCond("category", e.target.value)}
                      className="h-9"
                    >
                      {categoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </FilterField>
                </div>

                {/* Row 1c: SMS attribution (TT §3.3) */}
                <div className="grid grid-cols-2 gap-3 items-end">
                  <ToggleCheck
                    checked={conditions.hasSmsAttribution}
                    onChange={v => updateCond("hasSmsAttribution", v)}
                    icon={Phone}
                    label={t("condReceivedSms")}
                  />
                  <FilterField icon={Calendar} label={t("condSmsWithinDays")}>
                    <Input
                      type="number"
                      min={1}
                      value={conditions.smsSinceDays}
                      onChange={e => updateCond("smsSinceDays", e.target.value)}
                      placeholder="30"
                      className="h-9"
                    />
                  </FilterField>
                </div>

                {/* Row 2: Role + Tag */}
                <div className="grid grid-cols-2 gap-3">
                  <FilterField icon={UserCircle} label={t("condRole")}>
                    <Input
                      value={conditions.role}
                      onChange={e => updateCond("role", e.target.value)}
                      placeholder={t("placeholderCeo")}
                      className="h-9"
                    />
                  </FilterField>
                  <FilterField icon={Tag} label={t("condTag")}>
                    <Input
                      value={conditions.tag}
                      onChange={e => updateCond("tag", e.target.value)}
                      placeholder={t("placeholderTag")}
                      className="h-9"
                    />
                  </FilterField>
                </div>

                {/* Row 3: Name */}
                <FilterField icon={Type} label={t("condName")}>
                  <Input
                    value={conditions.name}
                    onChange={e => updateCond("name", e.target.value)}
                    placeholder={t("contains")}
                    className="h-9"
                  />
                </FilterField>

                {/* Row 4: Dates */}
                <div className="grid grid-cols-2 gap-3">
                  <FilterField icon={Calendar} label={t("condAfter")}>
                    <Input
                      type="date"
                      value={conditions.createdAfter}
                      onChange={e => updateCond("createdAfter", e.target.value)}
                      className="h-9"
                    />
                  </FilterField>
                  <FilterField icon={Calendar} label={t("condBefore")}>
                    <Input
                      type="date"
                      value={conditions.createdBefore}
                      onChange={e => updateCond("createdBefore", e.target.value)}
                      className="h-9"
                    />
                  </FilterField>
                </div>

                {/* Row 5: Checkboxes */}
                <div className="flex items-center gap-6 pt-1">
                  <ToggleCheck
                    checked={conditions.hasEmail}
                    onChange={v => updateCond("hasEmail", v)}
                    icon={Mail}
                    label={t("condHasEmail")}
                  />
                  <ToggleCheck
                    checked={conditions.hasPhone}
                    onChange={v => updateCond("hasPhone", v)}
                    icon={Phone}
                    label={t("condHasPhone")}
                  />
                </div>
              </div>}
            </div>

            {/* Behavioral Conditions */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/10">
              <h4 className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-3 uppercase">{tb("title")}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("engagementScoreMin")}</Label>
                  <Input type="number" min={0} max={100} value={conditions.engagementScoreMin} onChange={e => setConditions({ ...conditions, engagementScoreMin: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("engagementScoreMax")}</Label>
                  <Input type="number" min={0} max={100} value={conditions.engagementScoreMax} onChange={e => setConditions({ ...conditions, engagementScoreMax: e.target.value })} placeholder="100" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("engagementTier")}</Label>
                  <Select value={conditions.engagementTier} onChange={e => setConditions({ ...conditions, engagementTier: e.target.value })}>
                    <option value="">{tb("any")}</option>
                    <option value="hot">{tb("hot")}</option>
                    <option value="warm">{tb("warm")}</option>
                    <option value="cold">{tb("cold")}</option>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("inactiveDays")}</Label>
                  <Input type="number" min={1} value={conditions.inactiveDays} onChange={e => setConditions({ ...conditions, inactiveDays: e.target.value })} placeholder="30" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("lastActivityAfter")}</Label>
                  <Input type="date" value={conditions.lastActivityAfter} onChange={e => setConditions({ ...conditions, lastActivityAfter: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{tb("hasEventType")}</Label>
                  <Select value={conditions.hasEventType} onChange={e => setConditions({ ...conditions, hasEventType: e.target.value })}>
                    <option value="">{tb("any")}</option>
                    <option value="email_opened">{tb("emailOpened")}</option>
                    <option value="email_clicked">{tb("emailClicked")}</option>
                    <option value="deal_created">{tb("dealCreated")}</option>
                    <option value="ticket_created">{tb("ticketCreated")}</option>
                    <option value="meeting_scheduled">{tb("meetingScheduled")}</option>
                    <option value="call_logged">{tb("callLogged")}</option>
                  </Select>
                </div>
              </div>
            </div>

            {/* Preview result */}
            {previewCount !== null && (
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/40">
                  <Users className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">{previewCount.toLocaleString()}</p>
                  <p className="text-xs text-green-600 dark:text-green-400">{t("contactsMatch")}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={previewing}
            className="gap-1.5 mr-auto"
          >
            {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {previewing ? t("previewing") : t("preview")}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button type="submit" disabled={saving} className="min-w-[120px] gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {saving ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

function FilterField({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5 font-normal">
        <Icon className="h-3 w-3" /> {label}
      </Label>
      {children}
    </div>
  )
}

function ConditionChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 rounded-full pl-2.5 pr-1 py-0.5">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="p-0.5 rounded-full hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function ToggleCheck({ checked, onChange, icon: Icon, label }: {
  checked: boolean
  onChange: (v: boolean) => void
  icon: React.ElementType
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm transition-all",
        checked
          ? "bg-primary/10 border-primary/30 text-primary font-medium"
          : "bg-background border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 text-muted-foreground hover:text-foreground"
      )}
    >
      <div className={cn(
        "h-4 w-4 rounded border border-zinc-200 dark:border-zinc-700 flex items-center justify-center transition-colors",
        checked ? "bg-primary border-primary" : "border-muted-foreground/30"
      )}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
