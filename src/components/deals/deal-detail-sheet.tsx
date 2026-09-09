"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DollarSign, Building, User, Calendar, ArrowRight, MessageSquare, Pencil, Trash2, Plus, Loader2 } from "lucide-react"
import { fmtAmount, fmtAmountDecimal } from "@/lib/utils"
import { useState } from "react"
import { useTranslations } from "next-intl"

interface DealDetail {
  id: string
  name: string
  company: string
  value: number
  stage: string
  stageColor: string
  probability: number
  assignee: string
  assigneeAvatar: string
  createdAt: string
  expectedClose: string
  description: string
  contact: string
  contactEmail: string
  stageHistory: Array<{ stage: string; date: string; by: string }>
  activities: Array<{ type: string; description: string; date: string; by: string }>
  team: Array<{ name: string; role: string; avatar: string }>
}

interface DealDetailSheetProps {
  deal: DealDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: () => void
  onDelete?: () => void
  onAddToPricing?: (dealId: string, data: any) => Promise<boolean>
  orgId?: string
}

const STAGE_COLORS: Record<string, string> = {
  "Lead": "bg-muted text-foreground",
  "Qualified": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  "Proposal": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  "Negotiation": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  "Won": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  "Lost": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
}

export function DealDetailSheet({ deal, open, onOpenChange, onEdit, onDelete, onAddToPricing, orgId }: DealDetailSheetProps) {
  const t = useTranslations("deals")
  const [showPricingForm, setShowPricingForm] = useState(false)
  const [pricingForm, setPricingForm] = useState({
    type: "recurring" as string,
    name: "",
    price: 0,
    qty: 1,
    effectiveDate: new Date().toISOString().split("T")[0],
  })
  const [pricingSaving, setPricingSaving] = useState(false)

  if (!deal) return null

  const isWon = deal.stage === "Won" || deal.stage === "WON"

  const handleAddToPricing = async () => {
    if (!onAddToPricing || !deal.id || !pricingForm.name) return
    setPricingSaving(true)
    try {
      const ok = await onAddToPricing(deal.id, pricingForm)
      if (ok) {
        setShowPricingForm(false)
        setPricingForm({ type: "recurring", name: "", price: 0, qty: 1, effectiveDate: new Date().toISOString().split("T")[0] })
      }
    } finally { setPricingSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <div className="flex items-center justify-between pr-8">
            <Badge className={STAGE_COLORS[deal.stage] || ""}>{deal.stage}</Badge>
            <div className="flex items-center gap-2">
              {onEdit && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-1" />{t("editDeal")}</Button>}
              {onDelete && <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600" onClick={onDelete}><Trash2 className="h-3.5 w-3.5 mr-1" />{t("deleteDealBtn")}</Button>}
            </div>
          </div>
          <SheetTitle className="text-xl">{deal.name}</SheetTitle>
          <SheetDescription className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1"><Building className="h-3.5 w-3.5" /> {deal.company}</span>
            <span className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5" /> {fmtAmount(deal.value)}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="pt-3 pb-3">
                <p className="text-xs text-muted-foreground">{t("expectedClose")}</p>
                <p className="text-sm font-medium flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {deal.expectedClose}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-3 pb-3">
                <p className="text-xs text-muted-foreground">{t("sheetContact")}</p>
                <p className="text-sm font-medium flex items-center gap-1"><User className="h-3.5 w-3.5" /> {deal.contact}</p>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="overview">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="flex-1">{t("overview")}</TabsTrigger>
              <TabsTrigger value="history" className="flex-1">{t("history")}</TabsTrigger>
              <TabsTrigger value="activities" className="flex-1">{t("sheetActivities")}</TabsTrigger>
              <TabsTrigger value="team" className="flex-1">{t("team")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 mt-3">
              <div>
                <h4 className="text-sm font-medium mb-1">{t("sheetDescription")}</h4>
                <p className="text-sm text-muted-foreground">{deal.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">{t("assignedTo")}</span>
                  <p className="font-medium">{deal.assignee}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">{t("sheetCreated")}</span>
                  <p className="font-medium">{deal.createdAt}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">{t("sheetContactEmail")}</span>
                  <p className="font-medium">{deal.contactEmail}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <span className="text-muted-foreground">{t("dealValue")}</span>
                  <p className="font-medium">{fmtAmount(deal.value)}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-1" /> {t("editDeal")}
              </Button>

              {/* Add to Pricing - only for WON deals */}
              {isWon && onAddToPricing && (
                <div className="mt-3">
                  {!showPricingForm ? (
                    <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={() => setShowPricingForm(true)}>
                      <DollarSign className="h-4 w-4 mr-1" /> {t("addToPricingModel")}
                    </Button>
                  ) : (
                    <div className="p-3 bg-green-50 rounded-lg space-y-2 border border-green-200">
                      <div className="text-xs font-semibold text-green-700">{t("addToPricingModel")}</div>
                      <div className="space-y-2">
                        <select
                          value={pricingForm.type}
                          onChange={(e) => setPricingForm({ ...pricingForm, type: e.target.value })}
                          className="w-full h-8 border border-zinc-200 dark:border-zinc-700 rounded px-2 text-sm"
                        >
                          <option value="recurring">{t("pricingRecurring")}</option>
                          <option value="one_time">{t("pricingOneTime")}</option>
                        </select>
                        <Input
                          placeholder={t("pricingServiceName")}
                          value={pricingForm.name}
                          onChange={(e) => setPricingForm({ ...pricingForm, name: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">{t("pricingQty")}</label>
                            <Input
                              type="number"
                              value={pricingForm.qty}
                              onChange={(e) => setPricingForm({ ...pricingForm, qty: parseInt(e.target.value) || 0 })}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">{t("pricingPrice")}</label>
                            <Input
                              type="number"
                              step="0.01"
                              value={pricingForm.price}
                              onChange={(e) => setPricingForm({ ...pricingForm, price: parseFloat(e.target.value) || 0 })}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">{t("pricingDate")}</label>
                            <Input
                              type="date"
                              value={pricingForm.effectiveDate}
                              onChange={(e) => setPricingForm({ ...pricingForm, effectiveDate: e.target.value })}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleAddToPricing} disabled={!pricingForm.name || pricingSaving}>
                          {pricingSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                          {t("pricingAdd")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowPricingForm(false)}>{t("pricingCancel")}</Button>
                        {pricingForm.qty > 0 && pricingForm.price > 0 && (
                          <span className="text-xs text-muted-foreground self-center ml-auto">
                            {fmtAmountDecimal(pricingForm.qty * pricingForm.price)}
                            {pricingForm.type === "recurring" && ` /${t("pricingPerMonth")}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-3">
              <div className="space-y-3">
                {deal.stageHistory.map((entry, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{entry.stage}</Badge>
                        {i < deal.stageHistory.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{entry.date} by {entry.by}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="activities" className="mt-3">
              <div className="space-y-3">
                {deal.activities.map((activity, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="font-medium">{activity.description}</p>
                      <p className="text-xs text-muted-foreground">{activity.date} — {activity.by}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="team" className="mt-3">
              <div className="space-y-2">
                {deal.team.map((member, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded bg-muted/50">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                      {member.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}
