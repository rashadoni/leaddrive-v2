"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  ExternalLink,
  KeyRound,
  Layers3,
  Loader2,
  Network,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { MODULE_REGISTRY, type ModuleId, withRequiredModules } from "@/lib/modules"
import { locateFieldError } from "./field-errors"

type PlanOpt = {
  key: string
  name: string
  features: string[]
  maxUsers: number
  maxContacts: number
  isActive: boolean
}

type ProviderKey = "serpapi" | "bright_data" | "apify"
type ProviderMode = "disabled" | "platform" | "byok"

type ProvisioningStep = {
  stepKey: string
  status: string
  attempts: number
  output: unknown
  error: string | null
}

interface ProvisionResult {
  organization: { id: string; name: string; slug: string; plan: string }
  user: { id: string; email: string; name: string }
  tempPassword: string
  url: string
  provisioning: {
    id: string
    status: string
    steps: ProvisioningStep[]
  }
}

const STEPS = [
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "modules", label: "Plan & modules", icon: Layers3 },
  { id: "brand", label: "Brand & AI", icon: Bot },
  { id: "connections", label: "Connections", icon: Network },
  { id: "review", label: "Review", icon: ShieldCheck },
] as const

const CHANNELS = [
  { id: "email", label: "Email", note: "Inbox and outbound mail" },
  { id: "webchat", label: "Web chat", note: "Website conversations" },
  { id: "whatsapp", label: "WhatsApp", note: "Business messaging" },
  { id: "facebook", label: "Facebook", note: "Messenger and comments" },
  { id: "instagram", label: "Instagram", note: "Direct and comments" },
  { id: "tiktok", label: "TikTok", note: "DM, comments, mentions and leads" },
  { id: "telegram", label: "Telegram", note: "Bot and direct messaging" },
] as const

const PROVIDERS: Array<{ id: ProviderKey; label: string; note: string }> = [
  { id: "serpapi", label: "SerpApi", note: "Web discovery" },
  { id: "bright_data", label: "Bright Data", note: "Social and web datasets" },
  { id: "apify", label: "Apify", note: "Adapter-based collection" },
]

const FEATURE_MODULES = (Object.entries(MODULE_REGISTRY) as [ModuleId, { name: string; alwaysOn?: boolean }][])
  .filter(([, definition]) => !definition.alwaysOn)
  .map(([id, definition]) => ({ id, label: definition.name }))

function splitList(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)))
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30)
}

export default function NewTenantPage() {
  const router = useRouter()
  const requestKey = useRef("")
  const [step, setStep] = useState(0)
  const [plans, setPlans] = useState<PlanOpt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [copied, setCopied] = useState("")
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    adminEmail: "",
    adminName: "",
    plan: "",
    features: [] as string[],
    primaryColor: "#F4510B",
    logo: "",
    seedDemoData: false,
    brandName: "",
    legalName: "",
    website: "",
    description: "",
    aliases: "",
    languages: "az, ru, en",
    geographies: "Azerbaijan",
    supportEmail: "",
    voice: "calm, respectful, concise and human",
    customInstructions: "",
    channels: [] as string[],
    providers: {
      serpapi: "disabled",
      bright_data: "disabled",
      apify: "disabled",
    } as Record<ProviderKey, ProviderMode>,
  })

  useEffect(() => {
    fetch("/api/v1/admin/plans")
      .then((response) => response.json())
      .then((body) => {
        const active: PlanOpt[] = (body.data ?? []).filter((plan: PlanOpt) => plan.isActive)
        setPlans(active)
        if (active[0]) {
          setForm((current) => ({
            ...current,
            plan: active[0].key,
            features: withRequiredModules([
              ...active[0].features,
              ...(current.channels.length ? ["omnichannel"] : []),
            ]),
          }))
        }
      })
      .catch(() => setError("Plans could not be loaded. Refresh and try again."))
  }, [])

  const selectedPlan = plans.find((plan) => plan.key === form.plan)
  const activeConnectionCount = form.channels.length
  const enabledProviders = useMemo(
    () => PROVIDERS.filter((provider) => form.providers[provider.id] !== "disabled"),
    [form.providers],
  )

  function updateName(name: string) {
    setForm((current) => ({
      ...current,
      companyName: name,
      brandName: current.brandName && current.brandName !== current.companyName ? current.brandName : name,
      slug: generateSlug(name),
    }))
  }

  function changePlan(plan: string) {
    const next = plans.find((candidate) => candidate.key === plan)
    setForm((current) => ({
      ...current,
      plan,
      features: next
        ? withRequiredModules([
            ...next.features,
            ...(current.channels.length ? ["omnichannel"] : []),
          ])
        : current.features,
    }))
  }

  function toggleFeature(id: string) {
    setForm((current) => {
      const isEnabled = current.features.includes(id)
      if (id === "omnichannel" && isEnabled) {
        return {
          ...current,
          features: current.features.filter((feature) => feature !== id),
          channels: [],
        }
      }

      const requiredByEnabledModule = isEnabled && FEATURE_MODULES.some((module) => (
        current.features.includes(module.id) && module.id !== id && MODULE_REGISTRY[module.id].requires.includes(id as ModuleId)
      ))
      if (requiredByEnabledModule) return current

      return {
        ...current,
        features: isEnabled
          ? current.features.filter((feature) => feature !== id)
          : withRequiredModules([...current.features, id]),
      }
    })
  }

  function toggleChannel(id: string) {
    setForm((current) => {
      const channels = current.channels.includes(id)
        ? current.channels.filter((channel) => channel !== id)
        : [...current.channels, id]
      return {
        ...current,
        channels,
        features: channels.length && !current.features.includes("omnichannel")
          ? withRequiredModules([...current.features, "omnichannel"])
          : !channels.length
            ? current.features.filter((feature) => feature !== "omnichannel")
            : current.features,
      }
    })
  }

  function validateCurrentStep(): string | null {
    if (step === 0) {
      if (!form.companyName.trim() || !form.slug.trim() || !form.adminName.trim() || !form.adminEmail.trim()) {
        return "Complete the workspace and administrator details."
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) return "Enter a valid administrator email."
      if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(form.slug)) return "The URL key must be 3–30 lowercase letters, numbers or hyphens."
    }
    if (step === 1 && !form.plan) return "Choose an active plan."
    if (step === 2 && !form.brandName.trim()) return "Add the primary brand. It anchors AI identity and monitoring."
    return null
  }

  function nextStep() {
    const issue = validateCurrentStep()
    if (issue) {
      setError(issue)
      return
    }
    setError("")
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    setError("")
    try {
      const data = new FormData()
      data.append("file", file)
      const response = await fetch("/api/v1/admin/upload-logo", { method: "POST", body: data })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Logo upload failed")
      setForm((current) => ({ ...current, logo: body.url }))
    } catch (uploadError) {
      setError((uploadError as Error).message)
      setLogoPreview(null)
    } finally {
      setLogoUploading(false)
    }
  }

  async function provision() {
    setError("")
    setLoading(true)
    if (!requestKey.current) requestKey.current = crypto.randomUUID()
    try {
      const response = await fetch("/api/v1/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: requestKey.current,
          companyName: form.companyName.trim(),
          slug: form.slug,
          adminEmail: form.adminEmail.trim(),
          adminName: form.adminName.trim(),
          plan: form.plan,
          branding: { primaryColor: form.primaryColor, logo: form.logo || undefined },
          features: form.features,
          seedDemoData: form.seedDemoData,
          primaryBrand: {
            name: form.brandName.trim(),
            legalName: form.legalName.trim() || undefined,
            website: form.website.trim() || undefined,
            description: form.description.trim() || undefined,
            aliases: splitList(form.aliases),
            languages: splitList(form.languages),
            geographies: splitList(form.geographies),
            supportEmail: form.supportEmail.trim() || undefined,
            voice: form.voice.trim() || undefined,
            customInstructions: form.customInstructions.trim() || undefined,
          },
          channels: form.channels,
          providers: PROVIDERS.map((provider) => {
            const billingMode = form.providers[provider.id]
            return {
              providerKey: provider.id,
              billingMode,
              enabled: billingMode !== "disabled",
              spendPolicy: {
                sourceOfTruth: billingMode === "byok" ? "provider_account" : "tenant_policy",
              },
            }
          }),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        // A rejected field is worth more than a rejected request: name the box
        // in the wizard's own words and open the step that holds it.
        const located = typeof body.error === "string" ? locateFieldError(body.error) : null
        if (located) setStep(located.step)
        throw new Error(
          located
            ? `${STEPS[located.step].label} → ${located.field}: ${located.reason}`
            : body.error || "Tenant provisioning failed",
        )
      }
      setResult(body.data)
    } catch (provisionError) {
      setError((provisionError as Error).message || "Network error")
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(""), 1800)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex items-start gap-3">
        <Link href="/admin/tenants">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Tenants
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create a production-ready tenant</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One guided setup for the workspace, modules, brand identity, Omni-channel and provider access.
          </p>
        </div>
      </div>

      <nav aria-label="Tenant setup progress" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STEPS.map((item, index) => {
          const Icon = item.icon
          const active = index === step
          const done = index < step
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => index <= step && setStep(index)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/5"
                  : done
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-2">
                {done ? <Check className="h-4 w-4 text-emerald-600" /> : <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />}
                <span className="text-xs font-semibold">{index + 1}. {item.label}</span>
              </div>
            </button>
          )
        })}
      </nav>

      <Card className="overflow-hidden">
        <div className="border-b px-5 py-4 sm:px-7">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Step {step + 1} of {STEPS.length}</p>
          <h2 className="mt-1 text-lg font-semibold">{STEPS[step].label}</h2>
        </div>

        <div className="p-5 sm:p-7">
          {step === 0 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Company name" required>
                <Input value={form.companyName} onChange={(event) => updateName(event.target.value)} placeholder="Acme Group" />
              </Field>
              <Field label="Tenant URL" required hint={`https://${form.slug || "company"}.leaddrivecrm.org`}>
                <Input
                  value={form.slug}
                  onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="acme-group"
                  className="font-mono"
                />
              </Field>
              <Field label="Administrator name" required>
                <Input value={form.adminName} onChange={(event) => setForm({ ...form, adminName: event.target.value })} placeholder="Aysel Mammadova" />
              </Field>
              <Field label="Administrator email" required>
                <Input type="email" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} placeholder="admin@company.com" />
              </Field>
              <Field label="Brand color">
                <div className="flex gap-2">
                  <input
                    aria-label="Brand color"
                    type="color"
                    value={form.primaryColor}
                    onChange={(event) => setForm({ ...form, primaryColor: event.target.value })}
                    className="h-10 w-12 cursor-pointer rounded-lg border bg-background p-1"
                  />
                  <Input value={form.primaryColor} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} className="font-mono" />
                </div>
              </Field>
              <Field label="Logo" hint="PNG, JPG, WebP or SVG · max 2 MB">
                {logoPreview || form.logo ? (
                  <div className="flex h-20 items-center gap-3 rounded-xl border p-2">
                    <Image
                      src={logoPreview || form.logo}
                      alt="Tenant logo preview"
                      width={112}
                      height={56}
                      unoptimized
                      className="h-14 w-28 object-contain"
                    />
                    {logoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setLogoPreview(null); setForm({ ...form, logo: "" }) }}>
                      <X className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <label className="flex h-20 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted/30">
                    <Upload className="h-4 w-4" />
                    Upload logo
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" />
                  </label>
                )}
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-6">
              <Field label="Commercial plan" required>
                <Select value={form.plan} onChange={(event) => changePlan(event.target.value)}>
                  {!plans.length ? <option value="">Loading plans…</option> : null}
                  {plans.map((plan) => (
                    <option key={plan.key} value={plan.key}>
                      {plan.name} · {plan.maxUsers === -1 ? "Unlimited" : plan.maxUsers} users · {plan.maxContacts === -1 ? "Unlimited" : plan.maxContacts} contacts
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Enabled modules</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{form.features.length} selected</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {FEATURE_MODULES.map((module) => {
                    const selected = form.features.includes(module.id)
                    const requiredForSupport = module.id === "crm" && form.features.includes("support")
                    return (
                      <button
                        key={module.id}
                        type="button"
                        disabled={requiredForSupport}
                        onClick={() => toggleFeature(module.id)}
                        title={requiredForSupport ? "Support requires the shared companies and clients in Основная." : undefined}
                        className={`flex min-h-14 items-center justify-between rounded-xl border px-3 text-left text-sm font-medium transition-colors ${
                          selected ? "border-primary bg-primary/5 text-foreground" : "text-muted-foreground hover:bg-muted/30"
                        } ${requiredForSupport ? "cursor-not-allowed" : ""}`}
                      >
                        <span className="min-w-0">
                          <span className="block">{module.label}</span>
                          {module.id === "crm" ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Компании и клиенты</span> : null}
                          {requiredForSupport ? <span className="mt-0.5 block text-xs font-normal text-muted-foreground">Нужен для Поддержки</span> : null}
                        </span>
                        <span className={`ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : ""}`}>
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {form.features.includes("support") ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Поддержка использует компании и клиентов из «Основная», поэтому этот модуль добавлен автоматически.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  The selected plan is the contract source of truth. Provisioning writes an explicit enabled/disabled module map.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Turning off Omni-Channel automatically clears its selected connections.
                </p>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Primary brand" required hint="Every AI draft and reply account will be bound to this identity.">
                <Input value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} placeholder="Acme" />
              </Field>
              <Field label="Legal entity">
                <Input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} placeholder="Acme LLC" />
              </Field>
              <Field label="Official website">
                <Input type="url" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://acme.example" />
              </Field>
              <Field label="Support email">
                <Input type="email" value={form.supportEmail} onChange={(event) => setForm({ ...form, supportEmail: event.target.value })} placeholder="support@acme.example" />
              </Field>
              <Field label="Aliases" hint="Comma-separated names, handles or common spellings.">
                <Input value={form.aliases} onChange={(event) => setForm({ ...form, aliases: event.target.value })} placeholder="Acme Store, @acme" />
              </Field>
              <Field label="Languages">
                <Input value={form.languages} onChange={(event) => setForm({ ...form, languages: event.target.value })} placeholder="az, ru, en" />
              </Field>
              <Field label="Markets">
                <Input value={form.geographies} onChange={(event) => setForm({ ...form, geographies: event.target.value })} placeholder="Azerbaijan, Georgia" />
              </Field>
              <Field label="AI voice">
                <Input value={form.voice} onChange={(event) => setForm({ ...form, voice: event.target.value })} />
              </Field>
              <div className="md:col-span-2">
                <Field label="Brand description">
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    placeholder="What the brand does, who it serves and what must be represented accurately."
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Additional AI instructions" hint="These are appended after the mandatory tenant and brand safety rules.">
                  <textarea
                    value={form.customInstructions}
                    onChange={(event) => setForm({ ...form, customInstructions: event.target.value })}
                    className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                    placeholder="Escalation rules, approved terminology, prohibited claims…"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-7">
              <section>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Omni-channel foundation</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Selected channels are created as setup-required. No credential is copied between tenants.</p>
                  </div>
                  <Badge variant="outline">{activeConnectionCount} platforms</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CHANNELS.map((channel) => {
                    const selected = form.channels.includes(channel.id)
                    return (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => toggleChannel(channel.id)}
                        className={`rounded-xl border p-3 text-left transition-colors ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{channel.label}</span>
                          {selected ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <span className="h-4 w-4 rounded-full border" />}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{channel.note}</p>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="border-t pt-6">
                <h3 className="text-sm font-semibold">Discovery providers</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Grant entitlement now; connect credentials later. Provisioning never starts a paid job.
                </p>
                <div className="mt-3 space-y-3">
                  {PROVIDERS.map((provider) => (
                    <div key={provider.id} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_220px] sm:items-center">
                      <div>
                        <p className="text-sm font-medium">{provider.label}</p>
                        <p className="text-xs text-muted-foreground">{provider.note}</p>
                      </div>
                      <Select
                        value={form.providers[provider.id]}
                        onChange={(event) => setForm((current) => ({
                          ...current,
                          providers: { ...current.providers, [provider.id]: event.target.value as ProviderMode },
                        }))}
                      >
                        <option value="disabled">Not included</option>
                        <option value="platform">Platform account</option>
                        <option value="byok">Client account (BYOK)</option>
                      </Select>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ReviewMetric label="Workspace" value={form.companyName} note={`${form.slug}.leaddrivecrm.org`} />
                <ReviewMetric label="Plan" value={selectedPlan?.name || form.plan} note={`${form.features.length} modules`} />
                <ReviewMetric label="Brand identity" value={form.brandName} note={`${splitList(form.languages).length} languages`} />
                <ReviewMetric label="Connections" value={`${activeConnectionCount} channels`} note={`${enabledProviders.length} providers`} />
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-900">Safe first state</p>
                    <p className="mt-1 text-sm text-emerald-800">
                      Login is enabled. Outbound social replies stay emergency-stopped, channel credentials stay missing, and paid discovery stays idle until explicitly connected and authorized.
                    </p>
                  </div>
                </div>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
                <input
                  type="checkbox"
                  checked={form.seedDemoData}
                  onChange={(event) => setForm({ ...form, seedDemoData: event.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium">Add optional demo content</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">Runs after provisioning and does not change integration safety states.</span>
                </span>
              </label>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-4 sm:px-7">
          <Button type="button" variant="ghost" disabled={step === 0 || loading} onClick={() => { setError(""); setStep((current) => current - 1) }}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={nextStep}>
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" onClick={provision} disabled={loading} className="min-w-44">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {loading ? "Building tenant…" : "Create tenant safely"}
            </Button>
          )}
        </div>
      </Card>

      <Dialog open={!!result} onOpenChange={(open) => !open && result && router.push(`/admin/tenants/${result.organization.id}`)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Tenant created · {result?.provisioning.status}
            </DialogTitle>
          </DialogHeader>
          {result ? (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm">
                <CredentialRow label="Workspace" value={result.url} onCopy={() => copy(result.url, "url")} copied={copied === "url"} />
                <CredentialRow label="Admin" value={result.user.email} onCopy={() => copy(result.user.email, "email")} copied={copied === "email"} />
                <CredentialRow label="Temporary password" value={result.tempPassword} onCopy={() => copy(result.tempPassword, "password")} copied={copied === "password"} secret />
              </div>
              <div className="space-y-2">
                {result.provisioning.steps.map((provisioningStep) => (
                  <div key={provisioningStep.stepKey} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span>{STEPS.find((candidate) => provisioningStep.stepKey.includes(candidate.id))?.label || provisioningStep.stepKey.replaceAll("_", " ")}</span>
                    <Badge variant={provisioningStep.status === "completed" ? "success" : "warning"}>
                      {provisioningStep.status}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <KeyRound className="h-4 w-4 shrink-0" />
                Connect tenant-owned channel and provider credentials before enabling live traffic.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" asChild>
                  <Link href={`${result.url}/settings/channels`} target="_blank" rel="noreferrer">
                    Continue channel setup
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
                <Button onClick={() => router.push(`/admin/tenants/${result.organization.id}`)}>
                  Open readiness status
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required ? <span className="text-primary"> *</span> : null}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ReviewMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-xl border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold">{value || "Not set"}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{note}</p>
    </div>
  )
}

function CredentialRow({
  label,
  value,
  onCopy,
  copied,
  secret,
}: {
  label: string
  value: string
  onCopy: () => void
  copied: boolean
  secret?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <button type="button" onClick={onCopy} className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-primary hover:underline">
        <span className="truncate">{secret ? value : value}</span>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
