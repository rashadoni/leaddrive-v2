"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  CalendarDays, Users, Globe, MapPin, DollarSign, X, Plus,
  Presentation, Video, Wrench, Coffee, Building2, HelpCircle,
} from "lucide-react"
import { getCurrencySymbol } from "@/lib/constants"

const TYPE_OPTIONS = [
  { value: "conference", icon: Presentation, color: "bg-blue-100 text-blue-600 border-blue-300" },
  { value: "webinar", icon: Video, color: "bg-violet-100 text-violet-600 border-violet-300" },
  { value: "workshop", icon: Wrench, color: "bg-amber-100 text-amber-600 border-amber-300" },
  { value: "meetup", icon: Coffee, color: "bg-green-100 text-green-600 border-green-300" },
  { value: "exhibition", icon: Building2, color: "bg-pink-100 text-pink-600 border-pink-300" },
  { value: "other", icon: HelpCircle, color: "bg-muted text-muted-foreground border-zinc-200 dark:border-zinc-700" },
]

interface EventFormProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
  orgId?: string
  initialData?: any
}

export function EventForm({ open, onOpenChange, onSaved, orgId, initialData }: EventFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const t = useTranslations("events")
  const isEdit = !!initialData?.id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [step, setStep] = useState(1) // 1=basic, 2=location, 3=financial
  const [tagInput, setTagInput] = useState("")
  const [form, setForm] = useState({
    name: "", description: "", type: "conference", status: "planned",
    startDate: "", endDate: "", location: "", isOnline: false,
    meetingUrl: "", budget: 0, expectedRevenue: 0, maxParticipants: 0,
    tags: [] as string[],
  })

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name || "",
        description: initialData.description || "",
        type: initialData.type || "conference",
        status: initialData.status || "planned",
        startDate: initialData.startDate ? new Date(initialData.startDate).toISOString().slice(0, 16) : "",
        endDate: initialData.endDate ? new Date(initialData.endDate).toISOString().slice(0, 16) : "",
        location: initialData.location || "",
        isOnline: initialData.isOnline || false,
        meetingUrl: initialData.meetingUrl || "",
        budget: initialData.budget || 0,
        expectedRevenue: initialData.expectedRevenue || 0,
        maxParticipants: initialData.maxParticipants || 0,
        tags: initialData.tags || [],
      })
      setStep(1)
    } else {
      setForm({
        name: "", description: "", type: "conference", status: "planned",
        startDate: "", endDate: "", location: "", isOnline: false,
        meetingUrl: "", budget: 0, expectedRevenue: 0, maxParticipants: 0, tags: [],
      })
      setStep(1)
    }
    setError("")
  }, [initialData, open])

  const handleSubmit = async () => {
    if (!form.name.trim()) return setError(tc("required"))
    if (!form.startDate) return setError(tc("required"))
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/events/${initialData.id}` : "/api/v1/events"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) },
        body: JSON.stringify({
          ...form,
          budget: Number(form.budget) || 0,
          expectedRevenue: Number(form.expectedRevenue) || 0,
          maxParticipants: Number(form.maxParticipants) || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed")
      onOpenChange(false)
      onSaved()
    } catch (e: any) {
      setError(e.message)
    } finally { setSaving(false) }
  }

  const set = (key: string, value: any) => setForm(f => ({ ...f, [key]: value }))

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags.includes(tag)) {
      set("tags", [...form.tags, tag])
    }
    setTagInput("")
  }

  const removeTag = (tag: string) => set("tags", form.tags.filter(t => t !== tag))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {isEdit ? tf("editEvent") : tf("newEvent")}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-1 mb-2">
          {[
            { n: 1, label: t("stepBasicInfo") },
            { n: 2, label: t("stepLocationTime") },
            { n: 3, label: t("stepBudgetTags") },
          ].map(s => (
            <button
              key={s.n}
              onClick={() => setStep(s.n)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                step === s.n ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {/* Step 1: Basic Info */}
          {step === 1 && (
            <>
              <div>
                <Label>{t("eventName")} *</Label>
                <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. IT Outsourcing Summit 2026" className="mt-1" />
              </div>

              <div>
                <Label>{tc("description")}</Label>
                <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder={t("descriptionPlaceholder")} className="mt-1" />
              </div>

              <div>
                <Label className="mb-2 block">{tc("type")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {TYPE_OPTIONS.map(opt => {
                    const Icon = opt.icon
                    const active = form.type === opt.value
                    const labelKey = `type${opt.value.charAt(0).toUpperCase() + opt.value.slice(1)}` as any
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set("type", opt.value)}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border-2 transition-all text-sm font-medium ${
                          active ? `${opt.color} border-current shadow-sm` : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        {t(labelKey)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label>{tc("status")}</Label>
                <select className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded-md px-3 text-sm mt-1" value={form.status} onChange={e => set("status", e.target.value)}>
                  <option value="planned">{t("statusPlanned")}</option>
                  <option value="registration_open">{t("statusRegistrationOpen")}</option>
                  <option value="in_progress">{t("statusInProgress")}</option>
                  <option value="completed">{t("statusCompleted")}</option>
                  <option value="cancelled">{t("statusCancelled")}</option>
                </select>
              </div>
            </>
          )}

          {/* Step 2: Location & Time */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{tc("startDate")} *</Label>
                  <Input type="datetime-local" value={form.startDate} onChange={e => set("startDate", e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>{tc("endDate")}</Label>
                  <Input type="datetime-local" value={form.endDate} onChange={e => set("endDate", e.target.value)} className="mt-1" />
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="checkbox" checked={form.isOnline} onChange={e => set("isOnline", e.target.checked)} className="rounded" />
                  <Globe className="h-4 w-4 text-blue-500" />
                  {t("onlineEvent")}
                </label>
              </div>

              {form.isOnline && (
                <div>
                  <Label>{t("meetingUrl")}</Label>
                  <Input value={form.meetingUrl} onChange={e => set("meetingUrl", e.target.value)} placeholder="https://zoom.us/j/..." className="mt-1" />
                </div>
              )}

              <div>
                <Label className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {t("location")}</Label>
                <Input value={form.location} onChange={e => set("location", e.target.value)} placeholder={t("locationPlaceholder")} className="mt-1" />
              </div>

              <div>
                <Label className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {t("maxParticipants")}</Label>
                <Input type="number" value={form.maxParticipants} onChange={e => set("maxParticipants", e.target.value)} placeholder="0 = unlimited" className="mt-1" />
              </div>
            </>
          )}

          {/* Step 3: Budget & Tags */}
          {step === 3 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> {t("budget")} ({getCurrencySymbol()})</Label>
                  <Input type="number" value={form.budget} onChange={e => set("budget", e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>{t("expectedRevenue")} ({getCurrencySymbol()})</Label>
                  <Input type="number" value={form.expectedRevenue} onChange={e => set("expectedRevenue", e.target.value)} className="mt-1" />
                </div>
              </div>

              <div>
                <Label>{tc("tags")}</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    placeholder={t("addTag")}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={addTag}><Plus className="h-4 w-4" /></Button>
                </div>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {form.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-red-500"><X className="h-3 w-3" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview summary */}
              <div className="p-3 rounded-lg bg-muted/50 space-y-1 text-sm">
                <p className="font-medium text-xs text-muted-foreground uppercase">{t("summary")}</p>
                <p><strong>{form.name || t("untitled")}</strong> — {TYPE_OPTIONS.find(opt => opt.value === form.type) && t(`type${form.type.charAt(0).toUpperCase() + form.type.slice(1)}` as any)}</p>
                {form.startDate && <p className="text-muted-foreground">{new Date(form.startDate).toLocaleString(undefined)}</p>}
                {form.location && <p className="text-muted-foreground"><MapPin className="h-3 w-3 inline mr-1" />{form.location}</p>}
                {form.isOnline && <p className="text-muted-foreground"><Globe className="h-3 w-3 inline mr-1" />{t("online")}</p>}
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-between">
            <div>
              {step > 1 && <Button variant="outline" onClick={() => setStep(s => s - 1)}>{tc("back")}</Button>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
              {step < 3 ? (
                <Button onClick={() => setStep(s => s + 1)}>{tc("next")}</Button>
              ) : (
                <Button onClick={handleSubmit} disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tf("newEvent")}</Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
