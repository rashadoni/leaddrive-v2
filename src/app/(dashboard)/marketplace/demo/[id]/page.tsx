import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getTenantCapabilityDemo } from "@/lib/tenant-capability-demos"
import { TENANT_CAPABILITY_CATALOG } from "@/lib/tenant-capabilities"

export default async function MarketplaceCapabilityDemoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const definition = TENANT_CAPABILITY_CATALOG.find((capability) => capability.id === id)
  const demo = getTenantCapabilityDemo(id)
  if (!definition || !demo) notFound()

  return (
    <div className="max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/marketplace">
              <ArrowLeft className="h-4 w-4" />
              Marketplace
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="brand">{definition.kind.replace("_", " ")}</Badge>
            <Badge variant="outline">{definition.billing.replace("_", " ")}</Badge>
            {definition.ownerModule ? <Badge variant="outline">requires {definition.ownerModule}</Badge> : null}
          </div>
          <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight">{definition.label}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">{demo.headline}</p>
        </div>
        <Card className="p-4 md:w-[300px]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Preview only</p>
              <p className="mt-1 text-sm text-muted-foreground">Opening this page does not install apps, start jobs, or change tenant data.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Operating promise</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{demo.promise}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {demo.workflow.map((step, index) => (
              <div key={step} className="rounded-lg border bg-background p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
                  <p className="text-sm font-medium">Step {index + 1}</p>
                </div>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h2 className="text-base font-semibold">Signals users will see</h2>
          </div>
          <div className="mt-4 space-y-2">
            {demo.sampleSignals.map((signal) => (
              <div key={signal} className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                <span className="text-sm">{signal}</span>
                <Badge variant="outline">demo</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Activation guardrails</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {demo.guardrails.map((guardrail) => (
            <div key={guardrail} className="rounded-lg border bg-background p-4 text-sm leading-5 text-muted-foreground">
              {guardrail}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
