"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FinanceDashboard } from "@/components/finance/finance-dashboard"
import { ARDashboard } from "@/components/finance/ar-dashboard"
import { APDashboard } from "@/components/finance/ap-dashboard"
import { FundManager } from "@/components/finance/fund-manager"
import { PaymentsDashboard } from "@/components/finance/payments-dashboard"
import { LayoutDashboard, FileText, CreditCard, PiggyBank, Banknote } from "lucide-react"
import { DidYouKnow } from "@/components/did-you-know"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

export default function FinancePage() {
  const t = useTranslations("finance.dash")
  const tn = useTranslations("nav")
  const searchParams = useSearchParams()
  useAutoTour("finance")
  const initialTab = searchParams.get("tab") || "overview"
  const [activeTab, setActiveTab] = useState(initialTab)

  const TABS = [
    { value: "overview", label: t("tabOverview"), icon: LayoutDashboard },
    { value: "receivables", label: t("tabAR"), icon: FileText },
    { value: "payables", label: t("tabAP"), icon: CreditCard },
    { value: "funds", label: t("tabFunds"), icon: PiggyBank },
    { value: "payments", label: t("tabPayments"), icon: Banknote },
  ] as const

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{tn("finance")} <TourReplayButton tourId="finance" /><HelpButton slug="finance-overview" variant="label" /></h1>
      </div>
      <DidYouKnow page="finance" className="mb-4" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList data-tour-id="finance-tabs">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-1.5">
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" data-tour-id="finance-overview">
          <FinanceDashboard />
        </TabsContent>

        <TabsContent value="receivables" data-tour-id="finance-ar">
          <ARDashboard />
        </TabsContent>

        <TabsContent value="payables">
          <APDashboard />
        </TabsContent>

        <TabsContent value="funds">
          <FundManager />
        </TabsContent>

        <TabsContent value="payments">
          <PaymentsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
