"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { useTranslations } from "next-intl"

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
      fetchCategories()
    }
  }, [open, initialData])

  const fetchCategories = async () => {
    try {
      const res = await fetch("/api/v1/kb-categories", {
        headers: orgId ? { "x-organization-id": orgId } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setCategories(json.data)
    } catch {}
  }

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
          categoryId: form.categoryId || undefined,
          tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to save")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message)
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
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <DialogContent>
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3">{error}</div>}
          <div className="grid gap-4">
            <div>
              <Label htmlFor="title">{tc("title")} *</Label>
              <Input id="title" value={form.title} onChange={(e) => update("title", e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="content">{tc("content")} *</Label>
              <Textarea id="content" value={form.content} onChange={(e) => update("content", e.target.value)} rows={8} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="categoryId">{tc("category")}</Label>
                <Select value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)}>
                  <option value="">{tk("noCategory")}</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="status">{tc("status")}</Label>
                <Select value={form.status} onChange={(e) => update("status", e.target.value)}>
                  <option value="draft">{tc("draft")}</option>
                  <option value="published">{tc("published")}</option>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="tags">{tc("tags")}</Label>
              <Input id="tags" value={form.tags} onChange={(e) => update("tags", e.target.value)} placeholder="tag1, tag2, tag3" />
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
