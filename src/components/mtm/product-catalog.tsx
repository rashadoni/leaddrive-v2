"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import Link from "next/link"
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, Download, FileText, FolderOpen, FolderPlus, Loader2, PackageOpen,
  Presentation, Search, Stethoscope, UploadCloud, Users, X,
} from "lucide-react"
import { Hint, HintValue } from "@/components/hint"
import { HOME_ICON, HomePill, type HomeTone } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatFileSize } from "@/lib/format-file-size"
import { MAX_MOBILE_DOCUMENT_BYTES } from "@/lib/mtm/mobile-document-limits"
import {
  PRESENTATION_ACCEPT,
  agentsWhoSeeProductGroup,
  presentationKind,
  productGroupAncestry,
  productGroupReadiness,
  productGroupShowings,
  productGroupTree,
  productNameFromFileName,
  productPresentationReady,
  type ProductGroupReadiness,
} from "@/lib/mtm/product-catalog-view"
import { cn } from "@/lib/utils"

/**
 * «Products and presentations» (/mtm/products): the decks agents open on a
 * visit and show the doctor, sorted into groups, and who gets which group in
 * the app.
 *
 * Owner, 2026-10-15, looking at it: «этот раздел не очень понятен… нужно
 * подтянуть интуитивность и интерактивность». It opened on a form to create a
 * group, listed the groups flat, and under the chosen one stacked three boxes —
 * agents with a separate save button, a browser file field, the products as
 * grey lines — with nothing saying what a group is for or whether an agent
 * would ever see the file. Now the chosen group reads as the three steps it
 * takes: its presentations, its agents (each tick saved at once), and what
 * happens on a visit. Every group in the list says whether it is ready.
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
  _count: { presentationSessions: number }
}
type Draft = { file: File; name: string; version: string }
type SaveState = "idle" | "saving" | "saved" | "failed"

const CARD = "rounded-2xl border border-zinc-200 bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)] dark:border-zinc-700"

const READINESS_TONE: Record<ProductGroupReadiness, HomeTone> = {
  READY: "green",
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
  const [memberSave, setMemberSave] = useState<SaveState>("idle")
  const saveChain = useRef<Promise<void>>(Promise.resolve())

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
      setProducts((productsBody?.data?.products ?? []) as Product[])
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
  const canCreateRoot = groups.length === 0 || groups.some((group) => group.canManage)

  // A new group, a file being chosen, a search — all belong to the group on screen.
  useEffect(() => {
    setDraft(null)
    setDraftError("")
    setAgentQuery("")
    setMemberSave("idle")
  }, [selectedGroupId])

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

  /**
   * A tick is saved at once. Saves are written one after another, each with
   * the whole list as it stood after its tick, so the last one is what stays.
   */
  const writeAgents = (group: ProductGroup, agentIds: Set<string>) => {
    if (!group.canManage) return
    const members: GroupMember[] = [
      ...group.members.filter((member) => member.role === "MANAGER"),
      ...fieldAgents.filter((agent) => agentIds.has(agent.id)).map((agent) => ({ agentId: agent.id, role: "AGENT" as const, agent })),
    ]
    setGroups((current) => current.map((candidate) => candidate.id === group.id ? { ...candidate, members } : candidate))
    setMemberSave("saving")
    const body = JSON.stringify({ members: members.map((member) => ({ agentId: member.agentId, role: member.role })) })
    saveChain.current = saveChain.current.then(async () => {
      const response = await fetch(`/api/v1/mtm/product-groups/${group.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(() => null)
      if (response?.ok) {
        setMemberSave("saved")
        return
      }
      setMemberSave("failed")
      // What the server holds is what the screen shows.
      await load()
    })
  }

  const agentIdsOf = (group: ProductGroup) =>
    new Set(group.members.filter((member) => member.role === "AGENT").map((member) => member.agentId))

  const toggleAgent = (agent: Agent, on: boolean) => {
    if (!selectedGroup) return
    const agentIds = agentIdsOf(selectedGroup)
    if (on) agentIds.add(agent.id)
    else agentIds.delete(agent.id)
    writeAgents(selectedGroup, agentIds)
  }

  const setAllAgents = (on: boolean) => {
    if (!selectedGroup) return
    writeAgents(selectedGroup, on ? new Set(fieldAgents.map((agent) => agent.id)) : new Set())
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
      if (!productResponse.ok) throw new Error(await errorText(productResponse, t("saveFailed")))
      setDraft(null)
      setFileFieldKey((key) => key + 1)
      setNotice(t("productCreated", { name }))
      await load()
    } catch (error) {
      setDraftError(error instanceof Error && error.message ? error.message : t("saveFailed"))
    } finally {
      setDraftBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-48 place-items-center rounded-2xl border border-zinc-200 bg-card dark:border-zinc-800">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("loading")} />
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="mtm-product-catalog">
      <header className="flex flex-wrap items-start gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", HOME_ICON.orange)}><PackageOpen className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </header>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-l-4 border-zinc-200 border-l-red-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-red-500 p-3 text-sm">
          {loadError}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void load()}>{t("retry")}</Button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-l-4 border-zinc-200 border-l-emerald-500 bg-card text-foreground dark:border-zinc-700 dark:border-l-emerald-500 p-3 text-sm">
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
            <header className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
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
                const readiness = productGroupReadiness(groups, products, group.id)
                const selected = group.id === selectedGroupId
                const productCount = products.filter((product) => product.groupId === group.id).length
                const { own, inherited } = agentsWhoSeeProductGroup(groups, group.id)
                return (
                  <li key={group.id}>
                    <Hint text={t("hint.group")} side="right">
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      data-testid={`mtm-product-group-${group.id}`}
                      onClick={() => setSelectedGroupId(group.id)}
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
                          {t("groupSummary", { products: productCount, agents: own.size + inherited.size })}
                        </span>
                      </span>
                      <HomePill tone={READINESS_TONE[readiness]} className="text-[11px]">{t(`readiness.${readiness}`)}</HomePill>
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
              groupProducts={groupProducts}
              fieldAgents={fieldAgents}
              agentQuery={agentQuery}
              onAgentQuery={setAgentQuery}
              memberSave={memberSave}
              onToggleAgent={toggleAgent}
              onSetAllAgents={setAllAgents}
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

function StepCard({ testId, n, done, title, titleHint, badge, children, footer }: {
  testId: string
  n: number
  done: boolean
  title: string
  titleHint: string
  badge?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section data-testid={testId} className={cn(CARD, "flex min-w-0 flex-col")}>
      <header className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <StepBadge n={n} done={done} />
        <HintValue text={titleHint} className="min-w-0 truncate text-[15px] font-semibold">{title}</HintValue>
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </header>
      <div className="flex flex-1 flex-col gap-3 p-4">{children}</div>
      {footer ? <div className="border-t border-zinc-100 px-4 py-2.5 text-xs dark:border-zinc-800">{footer}</div> : null}
    </section>
  )
}

function GroupDetail(props: {
  group: ProductGroup
  groups: ProductGroup[]
  products: Product[]
  groupProducts: Product[]
  fieldAgents: Agent[]
  agentQuery: string
  onAgentQuery: (query: string) => void
  memberSave: SaveState
  onToggleAgent: (agent: Agent, on: boolean) => void
  onSetAllAgents: (on: boolean) => void
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
  const { group, groups, products, groupProducts, fieldAgents, draft } = props
  const readiness = productGroupReadiness(groups, products, group.id)
  const ancestry = productGroupAncestry(groups, group.id)
  const parents = ancestry.slice(1).reverse()
  const managers = group.members.filter((member) => member.role === "MANAGER")
  const { own, inherited } = agentsWhoSeeProductGroup(groups, group.id)
  const inheritedFrom = (agentId: string) => ancestry.slice(1).find((ancestor) =>
    ancestor.members.some((member) => member.role === "AGENT" && member.agentId === agentId))?.name
  const readyProducts = groupProducts.filter(productPresentationReady)
  const showings = productGroupShowings(products, group.id)
  const query = props.agentQuery.trim().toLocaleLowerCase(locale)
  const shownAgents = query ? fieldAgents.filter((agent) => agent.name.toLocaleLowerCase(locale).includes(query)) : fieldAgents
  const readOnlyHint = group.canManage ? null : t("hint.lockedGroup")

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
                  {t(`readiness.${readiness}`)}
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
          badge={<HomePill tone="zinc">{groupProducts.length}</HomePill>}
        >
          {groupProducts.length ? (
            <ul className="space-y-2">
              {groupProducts.map((product) => {
                const kind = product.document ? presentationKind(product.document) : null
                const ready = productPresentationReady(product)
                return (
                  <li key={product.id} data-testid={`mtm-product-${product.id}`} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                    <span className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold",
                      kind === "PPT" ? "text-orange-700 dark:text-orange-300" : "text-rose-700 dark:text-rose-300",
                    )}>{kind ?? <FileText className="h-4 w-4" aria-hidden="true" />}</span>
                    <span className="min-w-0 flex-1">
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
                    </span>
                    {ready ? (
                      <Hint text={t("downloadHint")}>
                        <a
                          href={`/api/v1/mtm/products/${product.id}/presentation`}
                          download={product.document?.fileName}
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-xs font-medium transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />{t("download")}
                        </a>
                      </Hint>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("emptyProducts")}</p>
          )}

          {group.canManage ? (
            draft ? (
              <div data-testid="mtm-product-draft" className="space-y-3 rounded-xl border border-l-4 border-zinc-200 border-l-primary bg-card dark:border-zinc-700 p-3">
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
                  props.dragging ? "border-primary" : "border-zinc-300 hover:border-primary/60 hover:bg-muted/40 dark:border-zinc-700",
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
          done={own.size + inherited.size > 0}
          title={t("stepAgents")}
          titleHint={t("stepAgentsHint")}
          badge={<HomePill tone="zinc">{t("agentsOf", { count: own.size + inherited.size, total: fieldAgents.length })}</HomePill>}
          footer={<MemberSaveLine state={props.memberSave} canManage={group.canManage} />}
        >
          <p className="text-xs text-muted-foreground">{t("assignedAgentsHint", { name: group.name })}</p>
          {fieldAgents.length > 8 ? (
            <label className="relative block">
              <span className="sr-only">{t("agentSearch")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={props.agentQuery} onChange={(event) => props.onAgentQuery(event.target.value)} placeholder={t("agentSearch")} className="pl-9" />
            </label>
          ) : null}
          {group.canManage && fieldAgents.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => props.onSetAllAgents(true)} data-testid="mtm-product-agents-all">{t("selectAll")}</Button>
              <Button size="sm" variant="ghost" onClick={() => props.onSetAllAgents(false)}>{t("selectNone")}</Button>
            </div>
          ) : null}
          {fieldAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noFieldAgents")}{" "}
              <Link href="/mtm/agents" prefetch={false} className="font-medium text-primary hover:underline">{t("openAgents")}</Link>
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
              {shownAgents.map((agent) => {
                const checked = own.has(agent.id)
                const viaParent = inherited.has(agent.id) ? inheritedFrom(agent.id) : undefined
                const row = (
                  <label
                    data-testid={`mtm-product-agent-${agent.id}`}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors",
                      checked || viaParent ? "border-foreground" : "border-zinc-200 dark:border-zinc-700",
                      group.canManage && !viaParent ? "cursor-pointer hover:border-primary/60" : "cursor-default",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={checked || Boolean(viaParent)}
                      disabled={!group.canManage || Boolean(viaParent)}
                      onChange={(event) => props.onToggleAgent(agent, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{agent.name}</span>
                      {viaParent ? <span className="block truncate text-xs text-muted-foreground">{t("viaParent", { name: viaParent })}</span> : null}
                    </span>
                  </label>
                )
                return (
                  <li key={agent.id}>
                    {viaParent ? <Hint text={t("viaParentHint", { name: viaParent })}>{row}</Hint>
                      : readOnlyHint ? <Hint text={readOnlyHint}>{row}</Hint> : row}
                  </li>
                )
              })}
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

function MemberSaveLine({ state, canManage }: { state: SaveState; canManage: boolean }) {
  const t = useTranslations("mtmProductCatalog")
  if (!canManage) return <span className="text-muted-foreground">{t("readOnlyHint")}</span>
  if (state === "saving") return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("saving")}</span>
  if (state === "saved") return <span role="status" className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300"><Check className="h-3.5 w-3.5" aria-hidden="true" />{t("saved")}</span>
  if (state === "failed") return <span role="alert" className="font-medium text-red-700 dark:text-red-300">{t("saveFailedAgents")}</span>
  return <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden="true" />{t("autosaveHint")}</span>
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
      className="space-y-2 border-b border-zinc-100 bg-muted/40 p-3 dark:border-zinc-800"
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
