"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"

const LocationPickerMap = dynamic(() => import("@/components/mtm/location-picker-map"), { ssr: false })

interface CustomerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: any
  orgId?: string
  apiBasePath?: "/api/v1/mtm/customers" | "/api/v1/mtm/organizations"
}

export function MtmCustomerForm({
  open,
  onOpenChange,
  onSaved,
  initialData,
  orgId,
  apiBasePath = "/api/v1/mtm/customers",
}: CustomerFormProps) {
  const tc = useTranslations("common")
  const tf = useTranslations("mtmForms")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState({
    code: "", name: "", category: "B", status: "ACTIVE",
    address: "", city: "", district: "",
    latitude: "", longitude: "",
    phone: "", contactPerson: "", notes: "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm({
        code: initialData?.code || "", name: initialData?.name || "",
        category: initialData?.category || "B", status: initialData?.status || "ACTIVE",
        address: initialData?.address || "", city: initialData?.city || "", district: initialData?.district || "",
        latitude: initialData?.latitude?.toString() || "", longitude: initialData?.longitude?.toString() || "",
        phone: initialData?.phone || "", contactPerson: initialData?.contactPerson || "", notes: initialData?.notes || "",
      })
      setError("")
    }
  }, [open, initialData])

  const update = (key: string, value: string) => setForm(f => ({ ...f, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const url = isEdit ? `${apiBasePath}/${initialData!.id}` : apiBasePath
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>) },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || tc("failedToSave"))
      onSaved()
      onOpenChange(false)
    } catch (err: any) { setError(err.message) } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editCustomer") : tf("addCustomer")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="code">{tf("code")}</Label><Input id="code" value={form.code} onChange={e => update("code", e.target.value)} placeholder={tf("placeholderCode")} /></div>
              <div><Label htmlFor="name">{`${tc("name")} *`}</Label><Input id="name" value={form.name} onChange={e => update("name", e.target.value)} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="category">{tc("category")}</Label>
                <Select value={form.category} onChange={e => update("category", e.target.value)}>
                  <option value="A">{tf("catA")}</option>
                  <option value="B">{tf("catB")}</option>
                  <option value="C">{tf("catC")}</option>
                  <option value="D">{tf("catD")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={e => update("status", e.target.value)}>
                  <option value="ACTIVE">{tc("active")}</option>
                  <option value="INACTIVE">{tc("inactive")}</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="contactPerson">{tf("contactPerson")}</Label><Input id="contactPerson" value={form.contactPerson} onChange={e => update("contactPerson", e.target.value)} /></div>
              <div><Label htmlFor="phone">{tc("phone")}</Label><Input id="phone" value={form.phone} onChange={e => update("phone", e.target.value)} /></div>
            </div>
            <div><Label htmlFor="address">{tc("address")}</Label><Input id="address" value={form.address} onChange={e => update("address", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="city">{tc("city")}</Label><Input id="city" value={form.city} onChange={e => update("city", e.target.value)} /></div>
              <div><Label htmlFor="district">{tf("district")}</Label><Input id="district" value={form.district} onChange={e => update("district", e.target.value)} /></div>
            </div>
            <div>
              <Label className="mb-2 block">{tf("location") || "Location"}</Label>
              <LocationPickerMap
                latitude={form.latitude ? parseFloat(form.latitude) : null}
                longitude={form.longitude ? parseFloat(form.longitude) : null}
                onChange={(lat, lng) => { update("latitude", lat.toString()); update("longitude", lng.toString()) }}
              />
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div><Input id="latitude" type="number" step="any" placeholder={tf("placeholderLatitude")} value={form.latitude} onChange={e => update("latitude", e.target.value)} className="text-xs" /></div>
                <div><Input id="longitude" type="number" step="any" placeholder={tf("placeholderLongitude")} value={form.longitude} onChange={e => update("longitude", e.target.value)} className="text-xs" /></div>
              </div>
            </div>
            <div><Label htmlFor="notes">{tc("notes")}</Label><Textarea id="notes" value={form.notes} onChange={e => update("notes", e.target.value)} rows={2} /></div>
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
