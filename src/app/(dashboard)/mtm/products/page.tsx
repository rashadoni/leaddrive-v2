"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, FileUp, FolderPlus, PackageOpen, RefreshCw, Users } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

type Agent = { id: string; name: string; role: string; status: string }
type GroupMember = { id: string; agentId: string; role: "MANAGER" | "AGENT"; agent: Agent }
type ProductGroup = {
  id: string
  parentId: string | null
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  canManage: boolean
  members: GroupMember[]
  products: Array<{ id: string; name: string; isActive: boolean; documentId: string | null }>
}
type Product = {
  id: string
  groupId: string
  name: string
  description: string | null
  presentationVersion: string | null
  isActive: boolean
  document: { id: string; fileName: string; sizeBytes: number; deletedAt: string | null } | null
  _count: { presentationSessions: number }
}

export default function MtmProductCatalogPage() {
  const t = useTranslations("mtmProductCatalog")
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [assignedAgentIds, setAssignedAgentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [groupForm, setGroupForm] = useState({ name: "", parentId: "" })
  const [productForm, setProductForm] = useState({ name: "", version: "" })
  const [presentationFile, setPresentationFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [groupsResponse, productsResponse, agentsResponse] = await Promise.all([
        fetch("/api/v1/mtm/product-groups"),
        fetch("/api/v1/mtm/products"),
        fetch("/api/v1/mtm/agents?status=ACTIVE&limit=200"),
      ])
      const [groupsBody, productsBody, agentsBody] = await Promise.all([
        groupsResponse.json().catch(() => null),
        productsResponse.json().catch(() => null),
        agentsResponse.json().catch(() => null),
      ])
      if (!groupsResponse.ok || !productsResponse.ok || !agentsResponse.ok) throw new Error()
      const nextGroups = (groupsBody?.data?.groups ?? []) as ProductGroup[]
      setGroups(nextGroups)
      setProducts((productsBody?.data?.products ?? []) as Product[])
      setAgents(((agentsBody?.data?.agents ?? []) as Agent[]).filter((agent) => agent.status === "ACTIVE"))
      setSelectedGroupId((current) => current && nextGroups.some((group) => group.id === current)
        ? current
        : nextGroups.find((group) => group.canManage)?.id ?? nextGroups[0]?.id ?? "")
    } catch {
      setError(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null
  useEffect(() => {
    setAssignedAgentIds(new Set(
      selectedGroup?.members.filter((member) => member.role === "AGENT").map((member) => member.agentId) ?? [],
    ))
  }, [selectedGroupId, selectedGroup])

  const groupProducts = useMemo(
    () => products.filter((product) => product.groupId === selectedGroupId),
    [products, selectedGroupId],
  )
  const fieldAgents = agents.filter((agent) => agent.role === "AGENT")

  const createGroup = async () => {
    if (!groupForm.name.trim()) {
      setError(t("groupNameRequired"))
      return
    }
    setBusy("group")
    setError("")
    try {
      const response = await fetch("/api/v1/mtm/product-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupForm.name.trim(),
          parentId: groupForm.parentId || null,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || t("saveFailed"))
      }
      setGroupForm({ name: "", parentId: "" })
      setNotice(t("groupCreated"))
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"))
    } finally {
      setBusy("")
    }
  }

  const saveMembers = async () => {
    if (!selectedGroup?.canManage) return
    setBusy("members")
    setError("")
    try {
      const managers = selectedGroup.members
        .filter((member) => member.role === "MANAGER")
        .map((member) => ({ agentId: member.agentId, role: "MANAGER" as const }))
      const response = await fetch(`/api/v1/mtm/product-groups/${selectedGroup.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: [
            ...managers,
            ...[...assignedAgentIds].map((agentId) => ({ agentId, role: "AGENT" as const })),
          ],
        }),
      })
      if (!response.ok) throw new Error()
      setNotice(t("membersSaved"))
      await load()
    } catch {
      setError(t("saveFailed"))
    } finally {
      setBusy("")
    }
  }

  const createProduct = async () => {
    if (!selectedGroup?.canManage) return
    if (!productForm.name.trim() || !presentationFile) {
      setError(t("productFieldsRequired"))
      return
    }
    setBusy("product")
    setError("")
    try {
      const clientDocumentId = crypto.randomUUID()
      const uploadBody = new FormData()
      uploadBody.set("file", presentationFile)
      uploadBody.set("title", productForm.name.trim())
      uploadBody.set("clientDocumentId", clientDocumentId)
      const uploadResponse = await fetch("/api/v1/mtm/products/upload", { method: "POST", body: uploadBody })
      const uploadJson = await uploadResponse.json().catch(() => null)
      if (!uploadResponse.ok || !uploadJson?.data?.document?.id) throw new Error(uploadJson?.error || t("saveFailed"))

      const productResponse = await fetch("/api/v1/mtm/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroup.id,
          name: productForm.name.trim(),
          presentationVersion: productForm.version.trim() || null,
          documentId: uploadJson.data.document.id,
        }),
      })
      if (!productResponse.ok) {
        const body = await productResponse.json().catch(() => null)
        throw new Error(body?.error || t("saveFailed"))
      }
      setProductForm({ name: "", version: "" })
      setPresentationFile(null)
      const fileInput = document.getElementById("mtm-product-presentation") as HTMLInputElement | null
      if (fileInput) fileInput.value = ""
      setNotice(t("productCreated"))
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveFailed"))
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="space-y-5">
      <PageDescription icon={PackageOpen} title={t("title")} description={t("subtitle")} />

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div> : null}
      {notice ? <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><Check className="h-4 w-4" />{notice}</div> : null}

      <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-800 md:grid-cols-[minmax(0,1fr)_minmax(180px,280px)_auto] md:items-end">
        <label className="space-y-1 text-sm font-medium">
          <span>{t("newGroup")}</span>
          <Input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} placeholder={t("groupName")} maxLength={160} className="min-h-11" />
        </label>
        <Select label={t("parentGroup")} value={groupForm.parentId} onChange={(event) => setGroupForm({ ...groupForm, parentId: event.target.value })} className="min-h-11">
          <option value="">{t("rootGroup")}</option>
          {groups.filter((group) => group.canManage).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </Select>
        <Button className="min-h-11" disabled={busy === "group"} onClick={() => void createGroup()}>
          <FolderPlus className="mr-2 h-4 w-4" />{t("createGroup")}
        </Button>
      </section>

      {loading ? (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-zinc-200 bg-card dark:border-zinc-800">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("loading")} />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-muted-foreground dark:border-zinc-700">{t("emptyGroups")}</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <nav className="space-y-2" aria-label={t("groups")}>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSelectedGroupId(group.id)}
                className={`min-h-14 w-full rounded-xl border px-4 py-3 text-left transition-colors ${selectedGroupId === group.id ? "border-primary bg-primary/5" : "border-zinc-200 bg-card hover:bg-muted/50 dark:border-zinc-800"}`}
              >
                <span className="block font-medium text-foreground">{group.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t("groupSummary", { agents: group.members.filter((member) => member.role === "AGENT").length, products: group.products.length })}</span>
              </button>
            ))}
          </nav>

          {selectedGroup ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedGroup.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t("assignedAgentsHint")}</p>
                  </div>
                  <Button className="min-h-11" disabled={!selectedGroup.canManage || busy === "members"} onClick={() => void saveMembers()}>
                    <Users className="mr-2 h-4 w-4" />{t("saveAgents")}
                  </Button>
                </div>
                {selectedGroup.members.some((member) => member.role === "MANAGER") ? (
                  <p className="mt-3 text-xs text-muted-foreground">{t("managers")}: {selectedGroup.members.filter((member) => member.role === "MANAGER").map((member) => member.agent.name).join(", ")}</p>
                ) : null}
                <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {fieldAgents.map((agent) => (
                    <label key={agent.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={assignedAgentIds.has(agent.id)}
                        disabled={!selectedGroup.canManage}
                        onChange={(event) => setAssignedAgentIds((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(agent.id)
                          else next.delete(agent.id)
                          return next
                        })}
                      />
                      <span className="truncate">{agent.name}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-800">
                <h2 className="font-semibold">{t("addProduct")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("addProductHint")}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <Input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} placeholder={t("productName")} maxLength={200} className="min-h-11" />
                  <Input value={productForm.version} onChange={(event) => setProductForm({ ...productForm, version: event.target.value })} placeholder={t("version")} maxLength={80} className="min-h-11" />
                  <label className="md:col-span-2">
                    <span className="sr-only">{t("presentationFile")}</span>
                    <input id="mtm-product-presentation" type="file" accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="block min-h-11 w-full rounded-lg border border-zinc-200 bg-background p-2 text-sm dark:border-zinc-800" onChange={(event) => setPresentationFile(event.target.files?.[0] ?? null)} />
                  </label>
                </div>
                <Button className="mt-3 min-h-11 w-full sm:w-auto" disabled={!selectedGroup.canManage || busy === "product"} onClick={() => void createProduct()}>
                  <FileUp className="mr-2 h-4 w-4" />{t("uploadAndCreate")}
                </Button>
              </section>

              <section className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-800">
                <h2 className="font-semibold">{t("products")}</h2>
                {groupProducts.length ? (
                  <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {groupProducts.map((product) => (
                      <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{product.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {product.document?.fileName || t("fileMissing")}
                            {product.presentationVersion ? ` · v${product.presentationVersion}` : ""}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">{t("openedCount", { count: product._count.presentationSessions })}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-muted-foreground">{t("emptyProducts")}</p>}
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
