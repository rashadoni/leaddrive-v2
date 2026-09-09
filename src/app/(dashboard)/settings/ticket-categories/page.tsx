"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { BarChart3, Check, CornerDownRight, Eye, EyeOff, GitBranch, Pencil, Plus, RotateCcw, Search, Tags, X } from "lucide-react"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"

type CategoryScope = "ticket" | "complaint" | "both"

interface TicketCategory {
  id: string
  name: string
  slug: string
  parentId: string | null
  description: string | null
  scope: CategoryScope
  defaultPriority: string | null
  isPortalVisible: boolean
  isActive: boolean
  sortOrder: number
  children?: TicketCategory[]
  _count?: { children: number; tickets: number }
}

interface CategoryRow extends TicketCategory {
  depth: number
}

interface FormState {
  name: string
  slug: string
  parentId: string
  scope: CategoryScope
  defaultPriority: string
  description: string
  isPortalVisible: boolean
  isActive: boolean
  sortOrder: number
}

const emptyForm: FormState = {
  name: "",
  slug: "",
  parentId: "",
  scope: "ticket",
  defaultPriority: "",
  description: "",
  isPortalVisible: true,
  isActive: true,
  sortOrder: 0,
}

function flattenTree(nodes: TicketCategory[], depth = 0): CategoryRow[] {
  return nodes.flatMap(node => [
    { ...node, depth },
    ...flattenTree(node.children || [], depth + 1),
  ])
}

export default function TicketCategoriesPage() {
  const { data: session } = useSession()
  const t = useTranslations("ticketCategories")
  const orgId = session?.user?.organizationId
  useAutoTour("ticketCategories")

  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [tree, setTree] = useState<TicketCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [scopeFilter, setScopeFilter] = useState<"all" | CategoryScope>("all")
  const [showInactive, setShowInactive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const orgHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {}
    if (orgId) headers["x-organization-id"] = String(orgId)
    return headers
  }, [orgId])

  const fetchCategories = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/v1/ticket-categories?includeInactive=true", { headers: orgHeaders })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("loadFailed"))
      setCategories(json.data?.categories || [])
      setTree(json.data?.tree || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [orgHeaders, t])

  useEffect(() => { fetchCategories() }, [fetchCategories])

  const rows = useMemo(() => {
    const baseRows = flattenTree(tree.length > 0 ? tree : categories)
    const q = search.trim().toLowerCase()
    return baseRows.filter(row => {
      if (!showInactive && !row.isActive) return false
      if (scopeFilter !== "all" && row.scope !== scopeFilter && row.scope !== "both") return false
      if (!q) return true
      return [row.name, row.slug, row.description || ""].some(value => value.toLowerCase().includes(q))
    })
  }, [categories, tree, search, scopeFilter, showInactive])

  const descendantsById = useMemo(() => {
    const childrenByParent = new Map<string, TicketCategory[]>()
    for (const category of categories) {
      if (!category.parentId) continue
      const siblings = childrenByParent.get(category.parentId) || []
      siblings.push(category)
      childrenByParent.set(category.parentId, siblings)
    }

    const collect = (categoryId: string, seen = new Set<string>()): Set<string> => {
      const children = childrenByParent.get(categoryId) || []
      for (const child of children) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        collect(child.id, seen)
      }
      return seen
    }

    return new Map(categories.map(category => [category.id, collect(category.id)]))
  }, [categories])

  const stats = useMemo(() => ({
    total: categories.length,
    roots: categories.filter(category => !category.parentId).length,
    active: categories.filter(category => category.isActive).length,
    portal: categories.filter(category => category.isPortalVisible).length,
    subcategories: categories.filter(category => category.parentId).length,
  }), [categories])

  const startCreate = (parentId = "") => {
    const parent = parentId ? categories.find(category => category.id === parentId) : null
    setEditingId(null)
    setError("")
    setForm({
      ...emptyForm,
      parentId,
      scope: parent?.scope || emptyForm.scope,
      defaultPriority: parent?.defaultPriority || emptyForm.defaultPriority,
    })
  }

  const startEdit = (category: TicketCategory) => {
    setEditingId(category.id)
    setError("")
    setForm({
      name: category.name,
      slug: category.slug,
      parentId: category.parentId || "",
      scope: category.scope,
      defaultPriority: category.defaultPriority || "",
      description: category.description || "",
      isPortalVisible: category.isPortalVisible,
      isActive: category.isActive,
      sortOrder: category.sortOrder || 0,
    })
  }

  const setParentCategory = (parentId: string) => {
    const parent = parentId ? categories.find(category => category.id === parentId) : null
    setForm(current => ({
      ...current,
      parentId,
      scope: !editingId && parent ? parent.scope : current.scope,
      defaultPriority: !editingId && parent?.defaultPriority ? parent.defaultPriority : current.defaultPriority,
    }))
  }

  const saveCategory = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError("")
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        parentId: form.parentId || null,
        scope: form.scope,
        defaultPriority: form.defaultPriority || null,
        description: form.description.trim() || null,
        isPortalVisible: form.isPortalVisible,
        isActive: form.isActive,
        sortOrder: Number(form.sortOrder) || 0,
      }
      const res = await fetch(editingId ? `/api/v1/ticket-categories/${editingId}` : "/api/v1/ticket-categories", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t("saveFailed"))
      setForm(emptyForm)
      setEditingId(null)
      await fetchCategories()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const setCategoryActive = async (category: TicketCategory, isActive: boolean) => {
    setError("")
    const res = await fetch(`/api/v1/ticket-categories/${category.id}`, {
      method: isActive ? "PATCH" : "DELETE",
      headers: isActive ? { "Content-Type": "application/json", ...orgHeaders } : orgHeaders,
      body: isActive ? JSON.stringify({ isActive: true }) : undefined,
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error || t("saveFailed"))
      return
    }
    await fetchCategories()
  }

  const scopeLabel = (scope: CategoryScope) => {
    if (scope === "complaint") return t("complaintScope")
    if (scope === "both") return t("bothScope")
    return t("ticketScope")
  }

  const blockedParentIds = editingId ? descendantsById.get(editingId) || new Set<string>() : new Set<string>()
  const parentOptions = categories.filter(category => category.id !== editingId && !blockedParentIds.has(category.id) && category.isActive)
  const selectedParent = form.parentId ? categories.find(category => category.id === form.parentId) || null : null
  const formModeLabel = selectedParent ? t("subcategory") : t("rootCategory")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Tags className="h-6 w-6" /> {t("title")} <TourReplayButton tourId="ticketCategories" /> <HelpButton slug="tickets" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/tickets?view=reports#ticketing-report">
              <BarChart3 className="h-4 w-4" /> {t("viewServiceDesk")}
            </Link>
          </Button>
          <Button className="gap-2" onClick={() => startCreate()}>
            <Plus className="h-4 w-4" /> {t("newRootCategory")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid overflow-hidden rounded-md border bg-background sm:grid-cols-2 lg:grid-cols-5">
        {[
          [t("statsTotal"), stats.total],
          [t("statsRoots"), stats.roots],
          [t("statsActive"), stats.active],
          [t("statsPortal"), stats.portal],
          [t("statsSubcategories"), stats.subcategories],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-r p-3 lg:border-b-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-base">{t("categoryTree")}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{t("categoryTreeHint")}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")} className="pl-9" />
                </div>
                <Select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as "all" | CategoryScope)} className="sm:w-40">
                  <option value="all">{t("allScopes")}</option>
                  <option value="ticket">{t("ticketScope")}</option>
                  <option value="complaint">{t("complaintScope")}</option>
                  <option value="both">{t("bothScope")}</option>
                </Select>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              {t("showInactive")}
            </label>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">{t("loading")}</p>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center">
                <p className="font-medium">{t("noCategories")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("noCategoriesHint")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">{t("category")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("scopeColumn")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("priorityColumn")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("usageColumn")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("visibilityColumn")}</th>
                      <th className="px-3 py-2 text-right font-medium">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(category => (
                      <tr key={category.id} className={cn("border-t", !category.isActive && "bg-muted/30 text-muted-foreground")}>
                        <td className="px-3 py-2">
                          <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${Math.min(category.depth, 4) * 18}px` }}>
                            {category.depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium">{category.name}</span>
                                <Badge variant="outline" className="shrink-0">{category.depth > 0 ? t("subcategory") : t("rootCategory")}</Badge>
                                {!category.isActive && <Badge variant="secondary">{t("inactiveBadge")}</Badge>}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">{category.slug}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2"><Badge variant="outline">{scopeLabel(category.scope)}</Badge></td>
                        <td className="px-3 py-2 text-xs">{category.defaultPriority || t("noDefaultPriority")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {t("ticketsCount", { count: category._count?.tickets || 0 })} · {t("childrenCount", { count: category._count?.children || 0 })}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={category.isPortalVisible ? "default" : "secondary"} className="gap-1">
                            {category.isPortalVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                            {category.isPortalVisible ? t("portalBadge") : t("internalBadge")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" title={t("addChild")} onClick={() => startCreate(category.id)}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" title={t("edit")} onClick={() => startEdit(category)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {category.isActive ? (
                              <Button variant="ghost" size="sm" title={t("deactivate")} onClick={() => setCategoryActive(category, false)}>
                                <X className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" title={t("restore")} onClick={() => setCategoryActive(category, true)}>
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">{editingId ? t("formTitleEdit") : t("formTitleCreate")}</CardTitle>
              <Badge variant="outline" className="shrink-0">{formModeLabel}</Badge>
            </div>
            {selectedParent && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitBranch className="h-3.5 w-3.5" />
                {t("subcategoryUnder", { parent: selectedParent.name })}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("name")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("namePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("slug")}</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder={t("slugPlaceholder")} />
              <p className="text-xs text-muted-foreground">{t("slugHelp")}</p>
            </div>
            <Select label={t("parent")} value={form.parentId} onChange={(e) => setParentCategory(e.target.value)}>
              <option value="">{t("noParent")}</option>
              {parentOptions.map(category => <option key={category.id} value={category.id}>{category.parentId ? "-- " : ""}{category.name}</option>)}
            </Select>
            <p className="text-xs text-muted-foreground">{selectedParent ? t("parentSelectedHelp") : t("parentRootHelp")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t("scope")} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as CategoryScope })}>
                <option value="ticket">{t("ticketScope")}</option>
                <option value="complaint">{t("complaintScope")}</option>
                <option value="both">{t("bothScope")}</option>
              </Select>
              <Select label={t("defaultPriority")} value={form.defaultPriority} onChange={(e) => setForm({ ...form, defaultPriority: e.target.value })}>
                <option value="">{t("noDefaultPriority")}</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("description")}</Label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("descriptionPlaceholder")}
                className="min-h-24 w-full rounded-lg border border-zinc-200/70 bg-card px-3 py-2 text-sm outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-zinc-700/70"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input type="checkbox" checked={form.isPortalVisible} onChange={(e) => setForm({ ...form, isPortalVisible: e.target.checked })} />
                {t("portalVisible")}
              </label>
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                {t("active")}
              </label>
            </div>
            <div className="space-y-1.5">
              <Label>{t("sortOrder")}</Label>
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={saveCategory} disabled={saving || !form.name.trim()} className="flex-1">
                <Check className="h-4 w-4" /> {editingId ? t("saveCategory") : t("createCategory")}
              </Button>
              {editingId && (
                <Button variant="outline" onClick={() => startCreate()} disabled={saving}>
                  {t("cancelEdit")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
