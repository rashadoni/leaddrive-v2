"use client"
import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Plan = {
  id: string
  key: string
  name: string
  description?: string | null
  features: string[]
  addons: string[]
  maxUsers: number
  maxContacts: number
  isActive: boolean
  sortOrder: number
}
type Opt = { id: string; name: string }

export default function PlansClient({
  initialPlans,
  featureOptions,
  addonOptions,
}: {
  initialPlans: Plan[]
  featureOptions: Opt[]
  addonOptions: Opt[]
}) {
  const [plans, setPlans] = useState<Plan[]>(initialPlans)
  const [editing, setEditing] = useState<Partial<Plan> | null>(null)
  const [busy, setBusy] = useState(false)
  const isNew = !!editing && !editing.id

  async function save() {
    if (!editing) return
    setBusy(true)
    try {
      const url = isNew ? "/api/v1/admin/plans" : `/api/v1/admin/plans/${editing.id}`
      const method = isNew ? "POST" : "PATCH"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error || "Save failed")
        return
      }
      setPlans((prev) => (isNew ? [...prev, json.data] : prev.map((p) => (p.id === json.data.id ? json.data : p))))
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"?`)) return
    const res = await fetch(`/api/v1/admin/plans/${p.id}`, { method: "DELETE" })
    const json = await res.json()
    if (!res.ok) {
      alert(json.error) // 409 in-use → suggests deactivate instead
      return
    }
    setPlans((prev) => prev.filter((x) => x.id !== p.id))
  }

  function toggle(field: "features" | "addons", id: string) {
    setEditing((e) => {
      if (!e) return e
      const set = new Set(e[field] ?? [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...e, [field]: Array.from(set) }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Plans</h1>
        <Button
          onClick={() =>
            setEditing({ key: "", name: "", description: "", features: [], addons: [], maxUsers: 3, maxContacts: 500, isActive: true, sortOrder: plans.length })
          }
        >
          Add plan
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Editing a plan changes the defaults applied to <strong>newly-provisioned</strong> tenants only. Existing tenants keep their current features and limits.
      </p>

      <div className="grid gap-3">
        {plans.map((p) => (
          <Card key={p.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">
                {p.name} <span className="text-xs text-muted-foreground">({p.key})</span>{" "}
                {!p.isActive && <span className="text-xs text-amber-600">inactive</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.features.length} features · {p.addons.length} add-ons · users {p.maxUsers === -1 ? "∞" : p.maxUsers} · contacts {p.maxContacts === -1 ? "∞" : p.maxContacts}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => remove(p)}>
                Delete
              </Button>
            </div>
          </Card>
        ))}
        {plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
      </div>

      {editing && (
        <Card className="p-4 space-y-3">
          <h2 className="font-medium">{isNew ? "New plan" : `Edit ${editing.name}`}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Key {isNew ? "" : "(immutable)"}</Label>
              <Input value={editing.key ?? ""} disabled={!isNew} onChange={(e) => setEditing({ ...editing, key: e.target.value })} />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <Label>Max users (-1 = ∞)</Label>
              <Input type="number" value={editing.maxUsers ?? 3} onChange={(e) => setEditing({ ...editing, maxUsers: parseInt(e.target.value, 10) })} />
            </div>
            <div>
              <Label>Max contacts (-1 = ∞)</Label>
              <Input type="number" value={editing.maxContacts ?? 500} onChange={(e) => setEditing({ ...editing, maxContacts: parseInt(e.target.value, 10) })} />
            </div>
          </div>
          <div>
            <Label>Features</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {featureOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={(editing.features ?? []).includes(o.id)} onChange={() => toggle("features", o.id)} />
                  {o.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>Add-ons</Label>
            <div className="grid grid-cols-3 gap-1 mt-1">
              {addonOptions.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={(editing.addons ?? []).includes(o.id)} onChange={() => toggle("addons", o.id)} />
                  {o.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.isActive ?? true} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
            Active
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
