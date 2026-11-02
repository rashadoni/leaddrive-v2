"use client"

import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Download, FileText, FolderOpen, FolderPlus, Loader2,
  Presentation, Search, Stethoscope, Trash2, UploadCloud, Users, X,
} from "lucide-react"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { Hint, HintValue } from "@/components/hint"
import { HOME_ICON, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { MtmPageHeader } from "@/components/mtm/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatFileSize } from "@/lib/format-file-size"
import { MAX_MOBILE_DOCUMENT_BYTES } from "@/lib/mtm/mobile-document-limits"
import {
  PRESENTATION_ACCEPT,
  presentationKind,
  productGroupAncestry,
  productGroupReadiness,
  productGroupShowings,
  productGroupTree,
  productGroupViewers,
  productNameFromFileName,
  productPresentationReady,
  productsNobodySees,
  viewerChanges,
  viewerState,
  type ProductGroupReadiness,
  type ViewerState,
} from "@/lib/mtm/product-catalog-view"
import { cn } from "@/lib/utils"

/**
 * «Products and presentations» (/mtm/products): the decks agents open on a
 * visit and show the doctor, sorted into groups, and who sees which one in
 * the app.
 *
 * Owner, 2026-10-15: «этот раздел не очень понятен… нужно подтянуть
 * интуитивность и интерактивность» — so the chosen group reads as three steps.
 * Owner, 2026-10-21, on that screen: «тут нет удаления презентации и ещё нет
 * выбора презентации… я хочу выбрать несколько презентаций и указать, для
 * какого агента будут видны… и нет сохранения». The mockup he approved
 * («давай»): tick presentations → tick in «Who sees it» → «Save»; nothing
 * changes before «Save»; «Delete» on each presentation asks by its name and
 * keeps its showings in the visit history.
 */

type Agent = { id: string; name: string; role: string; status: string }
type GroupMember = { id?: string; agentId: string; role: "MANAGER" | "AGENT"; agent: Agent }
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
  document: { id: string; fileName: string; mimeType?: string; sizeBytes: number; deletedAt: string | null } | null
  viewerAgentIds: string[]
  _count: { presentationSessions: number }
}
type Draft = { file: File; name: string; version: string }
type SaveState = "idle" | "saving" | "saved" | "failed"

const CARD = "rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)]"

const READINESS_TONE: Record<ProductGroupReadiness, HomeTone> = {
  READY: "green",
  PARTLY: "amber",
  NO_PRESENTATIONS: "amber",
  NO_AGENTS: "amber",
}

async function errorText(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  return typeof body?.error === "string" && body.error ? body.error : fallback
}

export function MtmProductCatalog() {
  const t = useTranslations("mtmProductCatalog")
  const locale = useLocale()
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [deletedShowings, setDeletedShowings] = useState<Record<string, number>>({})
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [notice, setNotice] = useState("")

  const [groupForm, setGroupForm] = useState<{ name: string; parentId: string } | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState("")

  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [draftError, setDraftError] = useState("")
  const [dragging, setDragging] = useState(false)
  // A new key gives a fresh, empty file field after an upload or a cancel.
  const [fileFieldKey, setFileFieldKey] = useState(0)

  const [agentQuery, setAgentQuery] = useState("")
  // The presentations ticked on the left, and the ticks in «Who sees it» not saved yet.
  const [chosenIds, setChosenIds] = useState<Set<string>>(() => new Set())
  const [pending, setPending] = useState<Map<string, boolean>>(() => new Map())
  const [viewerSave, setViewerSave] = useState<SaveState>("idle")
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [leavingFor, setLeavingFor] = useState<string | null>(null)

  const load = useCallback(async (select?: string) => {
    setLoadError("")
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
      setProducts(((productsBody?.data?.products ?? []) as Product[]).map((product) => ({
        ...product,
        viewerAgentIds: Array.isArray(product.viewerAgentIds) ? product.viewerAgentIds : [],
      })))
      setDeletedShowings((productsBody?.data?.deletedShowings ?? {}) as Record<string, number>)
      setAgents(((agentsBody?.data?.agents ?? []) as Agent[]).filter((agent) => agent.status === "ACTIVE"))
      setSelectedGroupId((current) => {
        const wanted = select ?? current
        if (wanted && nextGroups.some((group) => group.id === wanted)) return wanted
        return productGroupTree(nextGroups).find(({ group }) => group.canManage)?.group.id ?? nextGroups[0]?.id ?? ""
      })
    } catch {
      setLoadError(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(""), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const tree = useMemo(() => productGroupTree(groups), [groups])
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null
  const fieldAgents = useMemo(() => agents.filter((agent) => agent.role === "AGENT"), [agents])
  const groupProducts = useMemo(() => products.filter((product) => product.groupId === selectedGroupId), [products, selectedGroupId])
  const chosen = useMemo(() => groupProducts.filter((product) => chosenIds.has(product.id)), [groupProducts, chosenIds])
  const changes = useMemo(() => viewerChanges(chosen, pending), [chosen, pending])
  const changeCount = changes.add.length + changes.remove.length
  const canCreateRoot = groups.length === 0 || groups.some((group) => group.canManage)

  // A new group, a file being chosen, a search, a choice — all belong to the group on screen.
  useEffect(() => {
    setDraft(null)
    setDraftError("")
    setAgentQuery("")
    setChosenIds(new Set())
    setPending(new Map())
    setViewerSave("idle")
  }, [selectedGroupId])

  /** Another group, unless ticks not saved would be lost without a word. */
  const openGroup = (groupId: string) => {
    if (groupId === selectedGroupId) return
    if (changeCount > 0) {
      setLeavingFor(groupId)
      return
    }
    setSelectedGroupId(groupId)
  }

  const openGroupForm = (parentId: string) => {
    setGroupError("")
    setGroupForm({ name: "", parentId })
  }

  const createGroup = async () => {
    if (!groupForm) return
    const name = groupForm.name.trim()
    if (!name) {
      setGroupError(t("groupNameRequired"))
      return
    }
    setGroupBusy(true)
    setGroupError("")
    try {
      const response = await fetch("/api/v1/mtm/product-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: groupForm.parentId || null }),
      })
      if (response.status === 409) throw new Error(t("groupNameTaken"))
      if (!response.ok) throw new Error(await errorText(response, t("saveFailed")))
      const body = await response.json().catch(() => null)
      setGroupForm(null)
      setNotice(t("groupCreated", { name }))
      await load(typeof body?.data?.id === "string" ? body.data.id : undefined)
    } catch (error) {
      setGroupError(error instanceof Error && error.message ? error.message : t("saveFailed"))
    } finally {
      setGroupBusy(false)
    }
  }

  const toggleChosen = (productId: string, on: boolean) => {
    setChosenIds((current) => {
      const next = new Set(current)
      if (on) next.add(productId)
      else next.delete(productId)
      return next
    })
  }

  /**
   * A tick in «Who sees it» is held until «Save». Ticking an agent who sees
   * the chosen presentations only partly gives him all of them; unticking takes
   * them all away; a tick that lands back on what is saved is no change.
   */
  const setAgentPending = (agentId: string, on: boolean) => {
    setViewerSave("idle")
    setPending((current) => {
      const next = new Map(current)
      const saved = viewerState(chosen, agentId)
      if ((on && saved === "all") || (!on && saved === "none")) next.delete(agentId)
      else next.set(agentId, on)
      return next
    })
  }

  const setAllAgentsPending = (on: boolean) => {
    setViewerSave("idle")
    setPending(() => {
      const next = new Map<string, boolean>()
      for (const agent of fieldAgents) {
        const saved = viewerState(chosen, agent.id)
        if ((on && saved !== "all") || (!on && saved !== "none")) next.set(agent.id, on)
      }
      return next
    })
  }

  const saveViewers = async () => {
    if (!selectedGroup?.canManage || chosen.length === 0 || changeCount === 0) return
    setViewerSave("saving")
    const response = await fetch("/api/v1/mtm/products/viewers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: chosen.map((product) => product.id), add: changes.add, remove: changes.remove }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    const saved = Array.isArray(body?.data?.products) ? body.data.products as Array<{ id: string; viewerAgentIds: string[] }> : null
    if (!response?.ok || !saved) {
      // The ticks stay as they were set: pressing «Save» again sends them again.
      setViewerSave("failed")
      return
    }
    const byId = new Map(saved.map((product) => [product.id, product.viewerAgentIds]))
    setProducts((current) => current.map((product) => byId.has(product.id) ? { ...product, viewerAgentIds: byId.get(product.id)! } : product))
    setPending(new Map())
    setViewerSave("saved")
    setNotice(t("savedViewers", { names: chosen.map((product) => `«${product.name}»`).join(", ") }))
  }

  const deleteProduct = async (product: Product) => {
    const response = await fetch(`/api/v1/mtm/products/${product.id}`, { method: "DELETE" }).catch(() => null)
    if (!response?.ok) throw new Error(t("deleteFailed"))
    setProducts((current) => current.filter((candidate) => candidate.id !== product.id))
    setDeletedShowings((current) => ({
      ...current,
      [product.groupId]: (current[product.groupId] ?? 0) + product._count.presentationSessions,
    }))
    setChosenIds((current) => {
      const next = new Set(current)
      next.delete(product.id)
      return next
    })
    setNotice(t("deleted", { name: product.name }))
  }

  const chooseFile = (file: File | null | undefined) => {
    setDraftError("")
    if (!file) return
    if (!presentationKind(file)) {
      setDraft(null)
      setDraftError(t("fileWrongType"))
      return
    }
    if (file.size > MAX_MOBILE_DOCUMENT_BYTES) {
      setDraft(null)
      setDraftError(t("fileTooLarge", { size: formatFileSize(MAX_MOBILE_DOCUMENT_BYTES, locale) }))
      return
    }
    setDraft({ file, name: productNameFromFileName(file.name), version: "" })
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!selectedGroup?.canManage) return
    chooseFile(event.dataTransfer.files?.[0])
  }

  const uploadDraft = async () => {
    if (!selectedGroup?.canManage || !draft) return
    const name = draft.name.trim()
    if (!name) {
      setDraftError(t("productNameRequired"))
      return
    }
    setDraftBusy(true)
    setDraftError("")
    try {
      const upload = new FormData()
      upload.set("file", draft.file)
      upload.set("title", name)
      upload.set("clientDocumentId", crypto.randomUUID())
      const uploadResponse = await fetch("/api/v1/mtm/products/upload", { method: "POST", body: upload })
      const uploadJson = await uploadResponse.json().catch(() => null)
      if (!uploadResponse.ok || !uploadJson?.data?.document?.id) throw new Error(uploadJson?.error || t("saveFailed"))
      const productResponse = await fetch("/api/v1/mtm/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroup.id,
          name,
          presentationVersion: draft.version.trim() || null,
          documentId: uploadJson.data.document.id,
        }),
      })
      if (productResponse.status === 409) throw new Error(t("productNameTaken"))
      if (!productResponse.ok) throw new Error(await errorText(productResponse, t("saveFailed")))
      const productJson = await productResponse.json().catch(() => null)
      setDraft(null)
      setFileFieldKey((key) => key + 1)
      setNotice(t("productCreated", { name }))
      await load()
      // The new presentation is the one chosen: «Who sees it» is about it at once.
      if (typeof productJson?.data?.id === "string") {
        setChosenIds(new Set([productJson.data.id]))
        setPending(new Map())
      }
    } catch (error) {
      setDraftError(error instanceof Error && error.message ? error.message : t("saveFailed"))
    } finally {
      setDraftBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-border bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("loading")} />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="mtm-product-catalog">
      <MtmPageHeader title={t("title")} description={t("subtitle")} />

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-l-4 border-border border-l-red-500 bg-card text-foreground dark:border-l-red-500 p-3 text-sm">
          {loadError}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-l-4 border-border border-l-emerald-500 bg-card text-foreground dark:border-l-emerald-500 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{notice}
        </div>
      ) : null}

      {groups.length === 0 && !loadError ? (
        <FirstGroup
          form={groupForm ?? { name: "", parentId: "" }}
          busy={groupBusy}
          error={groupError}
          onChange={(name) => setGroupForm({ name, parentId: "" })}
          onCreate={() => void createGroup()}
          canCreate={canCreateRoot}
        />
      ) : (
        <div className="grid items-stretch gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <section aria-labelledby="mtm-product-groups-title" className={cn(CARD, "min-w-0 self-stretch")}>
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <HintValue text={t("groupsHint")} className="whitespace-nowrap text-[15px] font-semibold"><span id="mtm-product-groups-title">{t("groupsShort")}</span></HintValue>
              <HomePill tone="zinc">{groups.length}</HomePill>
              {canCreateRoot ? (
                <Hint text={t("newGroupHint")}>
                  <Button size="sm" variant="outline" className="ml-auto" data-testid="mtm-product-group-new" onClick={() => openGroupForm("")}>
                    <FolderPlus aria-hidden="true" />{t("newGroupButton")}
                  </Button>
                </Hint>
              ) : null}
            </header>
            {groupForm ? (
              <GroupForm
                tree={tree}
                form={groupForm}
                busy={groupBusy}
                error={groupError}
                onChange={setGroupForm}
                onCancel={() => { setGroupForm(null); setGroupError("") }}
                onCreate={() => void createGroup()}
              />
            ) : null}
            <ul className="p-2" aria-label={t("groups")}>
              {tree.map(({ group, depth }) => {
                const readiness = productGroupReadiness(products, group.id)
                const selected = group.id === selectedGroupId
                const productCount = products.filter((product) => product.groupId === group.id).length
                return (
                  <li key={group.id}>
                    <Hint text={t("hint.group")} side="right">
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      data-testid={`mtm-product-group-${group.id}`}
                      onClick={() => openGroup(group.id)}
                      style={{ paddingLeft: `${12 + depth * 18}px` }}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-xl py-2.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        selected ? "bg-muted/60 font-semibold shadow-[inset_3px_0_0_hsl(var(--primary))]" : "hover:bg-muted/60",
                      )}
                    >
                      <FolderOpen className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{group.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {t("groupSummary", { products: productCount, agents: productGroupViewers(products, group.id).size })}
                        </span>
                        {readiness === "PARTLY" ? (
                          <HomePill tone="amber" className="mt-1 text-xs">{t("readiness.PARTLY", { count: productsNobodySees(products, group.id).length })}</HomePill>
                        ) : null}
                      </span>
                      {readiness !== "PARTLY" ? (
                        <HomePill tone={READINESS_TONE[readiness]} className="text-xs">{t(`readiness.${readiness}`)}</HomePill>
                      ) : null}
                    </button>
                    </Hint>
                  </li>
                )
              })}
            </ul>
          </section>

          {selectedGroup ? (
            <GroupDetail
              key={selectedGroup.id}
              group={selectedGroup}
              groups={groups}
              products={products}
              deletedShowings={deletedShowings}
              groupProducts={groupProducts}
              fieldAgents={fieldAgents}
              agentQuery={agentQuery}
              onAgentQuery={setAgentQuery}
              chosen={chosen}
              chosenIds={chosenIds}
              onChoose={toggleChosen}
              onChooseAll={(on) => setChosenIds(on ? new Set(groupProducts.map((product) => product.id)) : new Set())}
              pending={pending}
              changeCount={changeCount}
              viewerSave={viewerSave}
              onAgent={setAgentPending}
              onAllAgents={setAllAgentsPending}
              onSave={() => void saveViewers()}
              onDiscard={() => { setPending(new Map()); setViewerSave("idle") }}
              onDelete={setDeleting}
              onNewSubgroup={() => openGroupForm(selectedGroup.id)}
              draft={draft}
              draftBusy={draftBusy}
              draftError={draftError}
              dragging={dragging}
              fileFieldKey={fileFieldKey}
              onDragging={setDragging}
              onDrop={onDrop}
              onChooseFile={chooseFile}
              onDraft={setDraft}
              onCancelDraft={() => { setDraft(null); setDraftError(""); setFileFieldKey((key) => key + 1) }}
              onUpload={() => void uploadDraft()}
            />
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={deleting != null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        onConfirm={() => deleting ? deleteProduct(deleting) : Promise.resolve()}
        title={deleting ? t("deleteTitle", { name: deleting.name }) : undefined}
        description={deleting ? t("deleteText", { count: deleting._count.presentationSessions }) : undefined}
        confirmLabel={t("deleteConfirm")}
        loadingLabel={t("deleting")}
        icon={<Trash2 className="h-5 w-5 text-destructive" aria-hidden="true" />}
      />
      <ConfirmDialog
        open={leavingFor != null}
        onOpenChange={(open) => { if (!open) setLeavingFor(null) }}
        onConfirm={async () => { if (leavingFor) setSelectedGroupId(leavingFor) }}
        title={t("leaveTitle")}
        description={t("leaveText")}
        confirmLabel={t("leaveConfirm")}
        confirmVariant="default"
      />
    </div>
  )
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
        done ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 ring-1 ring-inset ring-amber-500 dark:text-amber-300",
      )}
    >
      {done ? <Check className="h-4 w-4" /> : n}
    </span>
  )
}

function StepCard({ testId, n, done, title, titleHint, badge, children, footer, footerClassName }: {
  testId: string
  n: number
  done: boolean
  title: string
  titleHint: string
  badge?: ReactNode
  children: ReactNode
  footer?: ReactNode
  footerClassName?: string
}) {
  return (
    <section data-testid={testId} className={cn(CARD, "flex min-w-0 flex-col")}>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <StepBadge n={n} done={done} />
        <HintValue text={titleHint} className="min-w-0 truncate text-[15px] font-semibold">{title}</HintValue>
        {badge ? <span className="ml-auto flex items-center gap-2">{badge}</span> : null}
      </header>
      <div className="flex flex-1 flex-col gap-3 p-4">{children}</div>
      {footer ? <div className={cn("rounded-b-2xl border-t border-border px-4 py-2.5 text-xs", footerClassName)}>{footer}</div> : null}
    </section>
  )
}

/** The names of these agents, in the order of the agents list; cards no longer active are left out. */
function agentNames(agentIds: string[], fieldAgents: Agent[]): string[] {
  const ids = new Set(agentIds)
  return fieldAgents.filter((agent) => ids.has(agent.id)).map((agent) => agent.name)
}

function GroupDetail(props: {
  group: ProductGroup
  groups: ProductGroup[]
  products: Product[]
  deletedShowings: Record<string, number>
  groupProducts: Product[]
  fieldAgents: Agent[]
  agentQuery: string
  onAgentQuery: (query: string) => void
  chosen: Product[]
  chosenIds: Set<string>
  onChoose: (productId: string, on: boolean) => void
  onChooseAll: (on: boolean) => void
  pending: Map<string, boolean>
  changeCount: number
  viewerSave: SaveState
  onAgent: (agentId: string, on: boolean) => void
  onAllAgents: (on: boolean) => void
  onSave: () => void
  onDiscard: () => void
  onDelete: (product: Product) => void
  onNewSubgroup: () => void
  draft: Draft | null
  draftBusy: boolean
  draftError: string
  dragging: boolean
  fileFieldKey: number
  onDragging: (dragging: boolean) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onChooseFile: (file: File | null | undefined) => void
  onDraft: (draft: Draft) => void
  onCancelDraft: () => void
  onUpload: () => void
}) {
  const t = useTranslations("mtmProductCatalog")
  const locale = useLocale()
  const { group, groups, products, groupProducts, fieldAgents, draft, chosen, pending } = props
  const readiness = productGroupReadiness(products, group.id)
  const parents = productGroupAncestry(groups, group.id).slice(1).reverse()
  const managers = group.members.filter((member) => member.role === "MANAGER")
  const viewers = productGroupViewers(products, group.id)
  const readyProducts = groupProducts.filter(productPresentationReady)
  const showings = productGroupShowings(products, group.id, props.deletedShowings)
  const query = props.agentQuery.trim().toLocaleLowerCase(locale)
  const shownAgents = query ? fieldAgents.filter((agent) => agent.name.toLocaleLowerCase(locale).includes(query)) : fieldAgents
  const editing = group.canManage && chosen.length > 0
  const allChosen = groupProducts.length > 0 && chosen.length === groupProducts.length

  return (
    <div className="min-w-0 space-y-4" data-testid="mtm-product-group-detail">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {parents.length ? (
            <p className="truncate text-xs text-muted-foreground">{parents.map((parent) => parent.name).join(" › ")} ›</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold">{group.name}</h2>
            <Hint text={t(`readinessHint.${readiness}`)}>
              <span tabIndex={0} data-testid="mtm-product-group-readiness" className="outline-none">
                <HomePill tone={READINESS_TONE[readiness]}>
                  {readiness === "READY" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {t(`readiness.${readiness}`, { count: productsNobodySees(products, group.id).length })}
                </HomePill>
              </span>
            </Hint>
          </div>
          {managers.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <HintValue text={t("hint.managers")}>{t("managers")}</HintValue>: {managers.map((member) => member.agent.name).join(", ")}
            </p>
          ) : null}
        </div>
        {group.canManage ? (
          <Hint text={t("newSubgroupHint", { name: group.name })}>
            <Button variant="outline" onClick={props.onNewSubgroup} data-testid="mtm-product-subgroup-new">
              <FolderPlus aria-hidden="true" />{t("newSubgroup")}
            </Button>
          </Hint>
        ) : null}
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <StepCard
          testId="mtm-product-step-presentations"
          n={1}
          done={readyProducts.length > 0}
          title={t("stepPresentations")}
          titleHint={t("stepPresentationsHint")}
          badge={(
            <>
              <HomePill tone="zinc">{groupProducts.length}</HomePill>
              {group.canManage && groupProducts.length > 1 ? (
                allChosen
                  ? <Button size="sm" variant="ghost" onClick={() => props.onChooseAll(false)} data-testid="mtm-product-choose-none">{t("chooseNone")}</Button>
                  : <Button size="sm" variant="outline" onClick={() => props.onChooseAll(true)} data-testid="mtm-product-choose-all">{t("chooseAll")}</Button>
              ) : null}
            </>
          )}
        >
          {groupProducts.length ? (
            <ul className="space-y-2">
              {groupProducts.map((product) => {
                const kind = product.document ? presentationKind(product.document) : null
                const ready = productPresentationReady(product)
                const isChosen = props.chosenIds.has(product.id)
                const seenBy = agentNames(product.viewerAgentIds, fieldAgents)
                return (
                  <li
                    key={product.id}
                    data-testid={`mtm-product-${product.id}`}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors",
                      isChosen ? "border-foreground" : "border-border",
                    )}
                  >
                    {group.canManage ? (
                      <Hint text={t("chooseHint")}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                          checked={isChosen}
                          aria-label={product.name}
                          data-testid={`mtm-product-choose-${product.id}`}
                          onChange={(event) => props.onChoose(product.id, event.target.checked)}
                        />
                      </Hint>
                    ) : null}
                    <span className={cn(
                      "flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                      kind === "PPT" ? "text-orange-700 dark:text-orange-300" : "text-rose-700 dark:text-rose-300",
                    )}>{kind ?? <FileText className="h-4 w-4" aria-hidden="true" />}</span>
                    <span className="min-w-[11rem] flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{product.name}</span>
                        {product.presentationVersion ? <HomePill tone="zinc">v{product.presentationVersion.replace(/^v/i, "")}</HomePill> : null}
                      </span>
                      {ready && product.document ? (
                        <span className="mt-0.5 flex min-w-0 gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{product.document.fileName}</span>
                          <span className="shrink-0">· {formatFileSize(product.document.sizeBytes, locale)}</span>
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">{t("fileMissing")}</span>
                      )}
                      <HintValue text={t("hint.openedCount")} className="mt-1 inline-block text-xs font-medium text-foreground">
                        {t("showings", { count: product._count.presentationSessions })}
                      </HintValue>
                      <span data-testid={`mtm-product-seen-${product.id}`} className={cn("mt-1 block text-xs", seenBy.length ? "text-foreground" : "font-medium text-amber-700 dark:text-amber-300")}>
                        {seenBy.length ? t("seenBy", { names: seenBy.join(", ") }) : t("seenByNobody")}
                      </span>
                    </span>
                    <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                      {ready ? (
                        <Hint text={t("downloadHint")}>
                          <a
                            href={`/api/v1/mtm/products/${product.id}/presentation`}
                            download={product.document?.fileName}
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />{t("download")}
                          </a>
                        </Hint>
                      ) : null}
                      {group.canManage ? (
                        <Hint text={t("deleteHint")}>
                          <button
                            type="button"
                            data-testid={`mtm-product-delete-${product.id}`}
                            onClick={() => props.onDelete(product)}
                            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-red-200 px-3 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("delete")}
                          </button>
                        </Hint>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyProducts")}</p>
          )}

          {group.canManage ? (
            draft ? (
              <div data-testid="mtm-product-draft" className="space-y-3 rounded-xl border border-l-4 border-border border-l-primary bg-card p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Presentation className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">{draft.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(draft.file.size, locale)}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <label className="space-y-1 text-xs font-medium">
                    <span>{t("productName")}</span>
                    <Input value={draft.name} maxLength={200} onChange={(event) => props.onDraft({ ...draft, name: event.target.value })} data-testid="mtm-product-draft-name" />
                  </label>
                  <label className="space-y-1 text-xs font-medium">
                    <HintValue text={t("versionHint")}>{t("version")}</HintValue>
                    <Input value={draft.version} maxLength={80} placeholder="2026.1" onChange={(event) => props.onDraft({ ...draft, version: event.target.value })} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Hint text={props.draftBusy ? null : t("hint.uploadAndCreate")}>
                    <Button onClick={props.onUpload} disabled={props.draftBusy} data-testid="mtm-product-draft-upload">
                      {props.draftBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
                      {props.draftBusy ? t("uploading") : t("upload")}
                    </Button>
                  </Hint>
                  <Button variant="ghost" onClick={props.onCancelDraft} disabled={props.draftBusy}><X aria-hidden="true" />{t("cancel")}</Button>
                </div>
              </div>
            ) : (
              <label
                data-testid="mtm-product-dropzone"
                onDragOver={(event) => { event.preventDefault(); props.onDragging(true) }}
                onDragLeave={() => props.onDragging(false)}
                onDrop={props.onDrop}
                className={cn(
                  "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors focus-within:ring-2 focus-within:ring-ring/40",
                  props.dragging ? "border-primary" : "border-zinc-300 hover:border-primary/60 hover:bg-muted/40 dark:border-border",
                )}
              >
                <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
                <span className="text-sm font-semibold">{t("dropTitle")}</span>
                <span className="text-xs text-muted-foreground">{t("dropHint", { size: formatFileSize(MAX_MOBILE_DOCUMENT_BYTES, locale) })}</span>
                <input
                  key={props.fileFieldKey}
                  type="file"
                  accept={PRESENTATION_ACCEPT}
                  className="sr-only"
                  data-testid="mtm-product-file"
                  onChange={(event) => props.onChooseFile(event.target.files?.[0])}
                />
              </label>
            )
          ) : (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("readOnlyHint")}</p>
          )}
          {props.draftError ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{props.draftError}</p> : null}
        </StepCard>

        <StepCard
          testId="mtm-product-step-agents"
          n={2}
          done={readiness === "READY"}
          title={t("stepAgents")}
          titleHint={t("stepAgentsHint")}
          badge={<HomePill tone="zinc">{t("agentsOf", { count: viewers.size, total: fieldAgents.length })}</HomePill>}
          footer={group.canManage && chosen.length > 0 ? (
            <SaveBar
              changeCount={props.changeCount}
              state={props.viewerSave}
              onSave={props.onSave}
              onDiscard={props.onDiscard}
            />
          ) : group.canManage ? null : <span className="text-muted-foreground">{t("readOnlyHint")}</span>}
          footerClassName={props.changeCount > 0 ? "border-t-2 border-t-orange-400 dark:border-t-orange-500" : undefined}
        >
          <p className="text-sm" data-testid="mtm-product-chosen">
            {editing
              ? t("chosen", { count: chosen.length, names: chosen.map((product) => product.name).join(", ") })
              : group.canManage && groupProducts.length > 0
                ? <span className="text-muted-foreground">{t("nothingChosen")}</span>
                : null}
          </p>
          {fieldAgents.length > 8 ? (
            <label className="relative block">
              <span className="sr-only">{t("agentSearch")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={props.agentQuery} onChange={(event) => props.onAgentQuery(event.target.value)} placeholder={t("agentSearch")} className="pl-9" />
            </label>
          ) : null}
          {editing && fieldAgents.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => props.onAllAgents(true)} data-testid="mtm-product-agents-all">{t("selectAll")}</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onAllAgents(false)} data-testid="mtm-product-agents-none">{t("selectNone")}</Button>
            </div>
          ) : null}
          {fieldAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noFieldAgents")}{" "}
              <Link href="/mtm/agents" prefetch={false} className="font-medium text-primary hover:underline">{t("openAgents")}</Link>
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              {shownAgents.map((agent) => editing ? (
                <li key={agent.id}>
                  <AgentChoice agent={agent} chosen={chosen} pending={pending.get(agent.id)} onChange={(on) => props.onAgent(agent.id, on)} />
                </li>
              ) : (
                <li key={agent.id}>
                  <AgentSummary agent={agent} groupProducts={groupProducts} />
                </li>
              ))}
            </ul>
          )}
        </StepCard>
      </div>

      <section data-testid="mtm-product-step-visit" className={cn(CARD, "flex flex-wrap items-center gap-4 p-4")}>
        <StepBadge n={3} done={readiness === "READY"} />
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", HOME_ICON.blue)}><Stethoscope className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <HintValue text={t("stepVisitHint")} className="text-[15px] font-semibold">{t("stepVisit")}</HintValue>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {readiness === "READY" ? t("visitReady") : t(`visitBlocked.${readiness}`)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
          <HintValue text={t("hint.openedCount")} className="text-[28px] font-bold leading-none tabular-nums">{showings}</HintValue>
          <span className="text-sm text-muted-foreground">{t("showingsUnit", { count: showings })}</span>
        </div>
      </section>
    </div>
  )
}

/**
 * One agent in «Who sees it» while presentations are chosen: what he sees of
 * them now, and — once ticked or unticked — what he will see after «Save».
 */
function AgentChoice({ agent, chosen, pending, onChange }: {
  agent: Agent
  chosen: Product[]
  pending: boolean | undefined
  onChange: (on: boolean) => void
}) {
  const t = useTranslations("mtmProductCatalog")
  const saved = viewerState(chosen, agent.id)
  const shown: ViewerState = pending === undefined ? saved : pending ? "all" : "none"
  const count = chosen.length
  const now = saved === "all"
    ? t("agentSeesAll", { count })
    : saved === "some"
      ? t("agentSeesSome", { names: chosen.filter((product) => product.viewerAgentIds.includes(agent.id)).map((product) => product.name).join(", ") })
      : t("agentSeesNone", { count })
  const after = pending === undefined ? null : pending ? t("agentWillSee", { count }) : t("agentWillNotSee", { count })
  return (
    <Hint text={t("hint.chooseAgent")}>
      <label
        data-testid={`mtm-product-agent-${agent.id}`}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors hover:border-primary/60",
          shown === "none" ? "border-border" : "border-foreground",
        )}
      >
        <input
          type="checkbox"
          className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={shown === "all"}
          ref={(element) => { if (element) element.indeterminate = shown === "some" }}
          onChange={() => onChange(shown !== "all")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{agent.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{after ? `${now} → ${after}` : now}</span>
        </span>
        {after ? <HomePill tone="amber" className="shrink-0 text-xs">{t("changed")}</HomePill> : null}
      </label>
    </Hint>
  )
}

/** One agent in «Who sees it» while nothing is chosen: which of the group's presentations he sees. */
function AgentSummary({ agent, groupProducts }: { agent: Agent; groupProducts: Product[] }) {
  const t = useTranslations("mtmProductCatalog")
  const seen = groupProducts.filter((product) => product.viewerAgentIds.includes(agent.id)).map((product) => product.name)
  return (
    <div
      data-testid={`mtm-product-agent-${agent.id}`}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm",
        seen.length ? "border-foreground" : "border-border",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{agent.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {seen.length ? t("agentGroupSees", { names: seen.join(", ") }) : t("agentGroupSeesNothing")}
        </span>
      </span>
    </div>
  )
}

/** «Save» and what it will do — nothing changes for an agent before it is pressed. */
function SaveBar({ changeCount, state, onSave, onDiscard }: {
  changeCount: number
  state: SaveState
  onSave: () => void
  onDiscard: () => void
}) {
  const t = useTranslations("mtmProductCatalog")
  const dirty = changeCount > 0
  const saving = state === "saving"
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="mtm-product-save-bar">
      <span className="min-w-0 flex-1 text-[13px]">
        {state === "failed" ? (
          <span role="alert" className="font-medium text-red-700 dark:text-red-300">{t("saveFailedViewers")}</span>
        ) : dirty ? (
          <span className="font-medium text-orange-800 dark:text-orange-200">{t("unsaved", { count: changeCount })}</span>
        ) : (
          <span className="text-muted-foreground">{t("noChanges")}</span>
        )}
      </span>
      {dirty ? (
        <Hint text={t("discardHint")}>
          <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving} data-testid="mtm-product-viewers-discard">{t("discard")}</Button>
        </Hint>
      ) : null}
      <Hint text={dirty ? t("saveHint") : t("saveNothingHint")} wrap={!dirty || saving}>
        <Button onClick={onSave} disabled={!dirty || saving} data-testid="mtm-product-viewers-save">
          {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {saving ? t("savingViewers") : t("save")}
        </Button>
      </Hint>
    </div>
  )
}

function GroupForm({ tree, form, busy, error, onChange, onCancel, onCreate }: {
  tree: Array<{ group: ProductGroup; depth: number }>
  form: { name: string; parentId: string }
  busy: boolean
  error: string
  onChange: (form: { name: string; parentId: string }) => void
  onCancel: () => void
  onCreate: () => void
}) {
  const t = useTranslations("mtmProductCatalog")
  return (
    <form
      data-testid="mtm-product-group-form"
      className="space-y-2 border-b border-border bg-muted/40 p-3"
      onSubmit={(event) => { event.preventDefault(); onCreate() }}
    >
      <label className="block space-y-1 text-xs font-medium">
        <span>{t("groupName")}</span>
        <Input autoFocus value={form.name} maxLength={160} placeholder={t("groupNamePlaceholder")} onChange={(event) => onChange({ ...form, name: event.target.value })} data-testid="mtm-product-group-name" />
      </label>
      <label className="block space-y-1 text-xs font-medium">
        <HintValue text={t("parentGroupHint")}>{t("parentGroup")}</HintValue>
        <select
          value={form.parentId}
          onChange={(event) => onChange({ ...form, parentId: event.target.value })}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("rootGroup")}</option>
          {tree.filter(({ group }) => group.canManage).map(({ group, depth }) => (
            <option key={group.id} value={group.id}>{`${"  ".repeat(depth)}${group.name}`}</option>
          ))}
        </select>
      </label>
      {error ? <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <Hint text={busy ? null : t("hint.createGroup")}>
          <Button type="submit" size="sm" disabled={busy} data-testid="mtm-product-group-create">
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}{t("createGroup")}
          </Button>
        </Hint>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{t("cancel")}</Button>
      </div>
    </form>
  )
}

/** No group yet: what the screen is for, and the one thing to do first. */
function FirstGroup({ form, busy, error, onChange, onCreate, canCreate }: {
  form: { name: string; parentId: string }
  busy: boolean
  error: string
  onChange: (name: string) => void
  onCreate: () => void
  canCreate: boolean
}) {
  const t = useTranslations("mtmProductCatalog")
  const steps = [
    { icon: <FolderOpen className="h-5 w-5" aria-hidden="true" />, tone: "orange" as const, title: t("howGroupTitle"), text: t("howGroupText") },
    { icon: <Presentation className="h-5 w-5" aria-hidden="true" />, tone: "blue" as const, title: t("stepPresentations"), text: t("stepPresentationsHint") },
    { icon: <Users className="h-5 w-5" aria-hidden="true" />, tone: "green" as const, title: t("stepAgents"), text: t("stepAgentsHint") },
    { icon: <Stethoscope className="h-5 w-5" aria-hidden="true" />, tone: "zinc" as const, title: t("stepVisit"), text: t("stepVisitHint") },
  ]
  return (
    <section data-testid="mtm-product-first-group" className={cn(CARD, "space-y-5 p-5")}>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-xl bg-muted/50 p-3">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", HOME_ICON[step.tone])}>{step.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{index + 1}. {step.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {canCreate ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); onCreate() }}>
          <label className="min-w-[220px] flex-1 space-y-1 text-sm font-medium">
            <span>{t("firstGroupLabel")}</span>
            <Input value={form.name} maxLength={160} placeholder={t("groupNamePlaceholder")} onChange={(event) => onChange(event.target.value)} data-testid="mtm-product-group-name" />
          </label>
          <Button type="submit" disabled={busy} data-testid="mtm-product-group-create">
            {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}{t("createGroup")}
          </Button>
          {error ? <p role="alert" className="w-full text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t("emptyGroupsReadOnly")}</p>
      )}
    </section>
  )
}
