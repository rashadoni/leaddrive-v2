"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, FileSpreadsheet, ExternalLink } from "lucide-react"
import { fmtAmount } from "@/lib/utils"
import { getCurrencySymbol } from "@/lib/constants"

interface Invoice {
  id: string
  invoiceNumber: string
  title: string
  status: string
  totalAmount: number
  paidAmount: number
  balanceDue: number
  currency: string
  issueDate: string
  dueDate?: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-indigo-100 text-indigo-800",
  partially_paid: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-purple-100 text-purple-800",
}

export function InvoicesTab({ dealId, orgId }: { dealId: string; orgId: string }) {
  const t = useTranslations("invoices")
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgId || !dealId) return
    fetch(`/api/v1/invoices?dealId=${dealId}&limit=100`, {
      headers: { "x-organization-id": orgId },
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) setInvoices(json.data.invoices)
      })
      .finally(() => setLoading(false))
  }, [orgId, dealId])

  const totalInvoiced = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const totalPaid = invoices.reduce((s, i) => s + i.paidAmount, 0)

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-4">
      {invoices.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{t("totalInvoiced")}</p>
              <p className="text-xl font-bold">{fmtAmount(totalInvoiced)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{t("totalPaid")}</p>
              <p className="text-xl font-bold text-green-600">{fmtAmount(totalPaid)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{t("balanceDue")}</p>
              <p className="text-xl font-bold text-orange-600">{fmtAmount(totalInvoiced - totalPaid)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="font-semibold">{t("title")} ({invoices.length})</h3>
        <Button size="sm" onClick={() => router.push(`/invoices/create?dealId=${dealId}`)}>
          <Plus className="h-4 w-4 mr-1" /> {t("newInvoice")}
        </Button>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => (
            <Card key={inv.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => router.push(`/invoices/${inv.id}`)}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <code className="text-sm font-mono text-muted-foreground">{inv.invoiceNumber}</code>
                  <span className="font-medium">{inv.title}</span>
                  <Badge className={STATUS_COLORS[inv.status] || ""}>{t(`status.${inv.status}` as never)}</Badge>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold">{inv.totalAmount.toLocaleString()} {inv.currency}</span>
                  {inv.balanceDue > 0 && (
                    <span className="text-sm text-orange-600">({t("balanceDue")}: {inv.balanceDue.toLocaleString()})</span>
                  )}
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
