"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowRight, CreditCard, FileText, Gauge } from "lucide-react"

export default function BillingPage() {
  const ts = useTranslations("settings")
  const tb = useTranslations("billing")
  useAutoTour("billing")

  return (
    <div className="space-y-6">
      <div>
        <h1 data-tour-id="billing-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{ts("billing")} <TourReplayButton tourId="billing" /><HelpButton slug="billing" variant="label" /></h1>
        <p className="mt-1 text-sm text-muted-foreground">{ts("billingDesc")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ts("hintBilling")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4 text-primary" />
              {tb("currentPlan")}
            </CardTitle>
            <CardDescription>{ts("hintBilling")}</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" />
              {tb("tierTitle")}
            </CardTitle>
            <CardDescription>{tb("tierSubtitle")}</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              {tb("requestHistory")}
            </CardTitle>
            <CardDescription>{tb("paymentNote")}</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>{tb("title")}</CardTitle>
          <CardDescription>{tb("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">{tb("subscribeDialogDesc")}</p>
          <Button asChild className="gap-2 sm:shrink-0">
            <Link href="/billing/subscriptions">
              {tb("title")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
