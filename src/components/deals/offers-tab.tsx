"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, Plus, Send, Pencil, Trash2, FileText } from "lucide-react"
import { OfferForm } from "./offer-form"
import { SendOfferDialog } from "./send-offer-dialog"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { useTranslations } from "next-intl"

interface OfferItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
  sortOrder: number
}

interface Offer {
  id: string
  offerNumber: string
  type: string
  title: string
  status: string
  totalAmount: number | null
  currency: string
  includeVat: boolean
  voen: string | null
  validUntil: string | null
  sentAt: string | null
  recipientEmail: string | null
  notes: string | null
  contactId: string | null
  companyId: string | null
  clientName: string | null
  contactPerson: string | null
  contractNumber: string | null
  discount: number | null
  items: OfferItem[]
  createdAt: string
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-foreground/70",
  sent: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
}

const typeLabels: Record<string, string> = {
  commercial: "Kommersiya",
  invoice: "Hesab-faktura",
  equipment: "Avadanlıq",
  services: "Xidmətlər",
}

export function OffersTab({
  dealId,
  orgId,
  companyId,
  contactId,
  contactEmail,
  currency,
  valueAmount,
}: {
  dealId: string
  orgId?: string
  companyId?: string | null
  contactId?: string | null
  contactEmail?: string | null
  currency?: string
  valueAmount?: number
}) {
  const t = useTranslations("offers")
  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editOffer, setEditOffer] = useState<Offer | null>(null)
  const [sendOffer, setSendOffer] = useState<Offer | null>(null)
  const [deleteOffer, setDeleteOffer] = useState<Offer | null>(null)

  const headers: Record<string, string> = orgId ? { "x-organization-id": orgId } : {} as Record<string, string>

  const loadOffers = () => {
    setLoading(true)
    fetch(`/api/v1/deals/${dealId}/offers`, { headers })
      .then(r => r.json())
      .then(j => { if (j.success) setOffers(j.data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOffers() }, [dealId, orgId])

  const handleDelete = async () => {
    if (!deleteOffer) return
    await fetch(`/api/v1/offers/${deleteOffer.id}`, { method: "DELETE", headers })
    setDeleteOffer(null)
    loadOffers()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("title")} ({offers.length})</h3>
        <Button size="sm" onClick={() => { setEditOffer(null); setShowForm(true) }}>
          <Plus className="h-4 w-4 mr-1" /> {t("new")}
        </Button>
      </div>

      {offers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>{t("empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {offers.map(offer => (
            <Card key={offer.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-muted-foreground">{offer.offerNumber}</span>
                      <Badge variant="outline" className={statusColors[offer.status] || ""}>
                        {t(`status.${offer.status}`)}
                      </Badge>
                      <Badge variant="secondary">{typeLabels[offer.type] || offer.type}</Badge>
                    </div>
                    <p className="font-medium">{offer.title}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {(offer.totalAmount || 0).toFixed(2)} {offer.currency}
                        {offer.includeVat && <span className="text-xs ml-1">(+18% ƏDV)</span>}
                      </span>
                      {offer.validUntil && (
                        <span>{t("validUntil")}: {new Date(offer.validUntil).toLocaleDateString()}</span>
                      )}
                      {offer.sentAt && (
                        <span>{t("sentAt")}: {new Date(offer.sentAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    {offer.items.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {offer.items.length} {t("items")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {offer.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => { setEditOffer(offer); setShowForm(true) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setSendOffer(offer)}>
                      <Send className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteOffer(offer)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <OfferForm
          open={showForm}
          onClose={() => { setShowForm(false); setEditOffer(null) }}
          onSaved={() => { setShowForm(false); setEditOffer(null); loadOffers() }}
          dealId={dealId}
          orgId={orgId}
          offer={editOffer}
          defaultCompanyId={companyId}
          defaultContactId={contactId}
          defaultCurrency={currency}
          dealValueAmount={valueAmount}
        />
      )}

      {sendOffer && (
        <SendOfferDialog
          open={!!sendOffer}
          onClose={() => setSendOffer(null)}
          onSent={() => { setSendOffer(null); loadOffers() }}
          offer={sendOffer}
          orgId={orgId}
          defaultEmail={contactEmail}
        />
      )}

      {deleteOffer && (
        <DeleteConfirmDialog
          open={!!deleteOffer}
          onOpenChange={() => setDeleteOffer(null)}
          onConfirm={handleDelete}
          title={t("deleteTitle")}
          description={`${t("deleteConfirm")} ${deleteOffer.offerNumber}?`}
        />
      )}
    </div>
  )
}
