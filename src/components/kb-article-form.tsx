"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { useTranslations } from "next-intl"
import { CircleAlert, RotateCcw } from "lucide-react"

interface KbCategory {
  id: string
  name: string
  _count?: { articles: number }
}

interface KbArticleFormData {
  title: string
  content: string
  categoryId: string
  status: string
  tags: string
}

interface KbArticleFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  initialData?: Partial<KbArticleFormData> & { id?: string }
  orgId?: string
}

export function KbArticleForm({ open, onOpenChange, onSaved, initialData, orgId }: KbArticleFormProps) {
  const tf = useTranslations("forms")
  const tc = useTranslations("common")
  const tk = useTranslations("kb")
  const isEdit = !!initialData?.id
  const [form, setForm] = useState<KbArticleFormData>({
    title: initialData?.title || "",
    content: initialData?.content || "",
    categoryId: initialData?.categoryId || "",
    status: initialData?.status || "draft",
    tags: initialData?.tags || "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [categories, setCategories] = useState<KbCategory[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState("")

  const fetchCategories = useCallback(async () => {
    setCategoriesLoading(true)
    setCategoriesError("")
    try {
      const res = await fetch("/api/v1/kb-categories", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || tk("categoriesLoadFailed"))
      setCategories(json?.data || [])
    } catch (fetchError) {
      setCategoriesError(fetchError instanceof Error ? fetchError.message : tk("categoriesLoadFailed"))
    } finally {
      setCategoriesLoading(false)
    }
  }, [orgId, tk])

  useEffect(() => {
    if (open) {
      setForm({
        title: initialData?.title || "",
        content: initialData?.content || "",
        categoryId: initialData?.categoryId || "",
        status: initialData?.status || "draft",
        tags: initialData?.tags || "",
      })
      setError("")
      void fetchCategories()
    }
  }, [
    fetchCategories,
    initialData?.categoryId,
    initialData?.content,
    initialData?.id,
    initialData?.status,
    initialData?.tags,
    initialData?.title,
    open,
  ])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")

    try {
      const url = isEdit ? `/api/v1/kb/${initialData!.id}` : "/api/v1/kb"
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
        },
        body: JSON.stringify({
          ...form,
          categoryId: form.categoryId || (isEdit ? null : undefined),
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || tk("saveFailed"))
      onSaved()
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : tk("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const update = (key: keyof KbArticleFormData, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>{isEdit ? tf("editArticle") : tf("addArticle")}</DialogTitle>
      </DialogHeader>
      <form data-testid="knowledge-article-form" onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div data-testid="knowledge-article-save-error" role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="title">{tc("title")} *</Label>
              <Input id="title" className="min-h-11" value={form.title} onChange={(e) => update("title", e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="content">{tc("content")} *</Label>
              <Textarea id="content" value={form.content} onChange={(e) => update("content", e.target.value)} rows={8} required />
            </div>
            {categoriesError && (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm">
                <span>{categoriesError}</span>
                <Button data-testid="knowledge-article-categories-retry" type="button" variant="outline" className="min-h-11" onClick={() => void fetchCategories()}>
                  <RotateCcw />{tk("retry")}
                </Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="categoryId">{tc("category")}</Label>
                <Select value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)} disabled={categoriesLoading} className="min-h-11">
                  <option value="">{tk("noCategory")}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={(e) => update("status", e.target.value)} className="min-h-11">
                  <option value="draft">{tc("draft")}</option>
                  <option value="published">{tc("published")}</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="tags">{tc("tags")}</Label>
              <Input id="tags" className="min-h-11" value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder={tk("tagsPlaceholder")} />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>{tc("cancel")}</Button>
          <Button data-testid="knowledge-article-submit" type="submit" className="min-h-11" disabled={saving}>{saving ? tc("saving") : isEdit ? tc("update") : tc("create")}</Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
