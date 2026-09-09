"use client"

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Globe, Plus, Trash2, RefreshCw, Copy, CheckCircle2, AlertCircle, Clock, ShieldCheck, ExternalLink, Info, BookOpen, ArrowRight, Server, FileCode2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PageDescription } from "@/components/page-description"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface CustomDomain {
  id: string
  domain: string
  status: string
  dnsVerifiedAt: string | null
  sslIssuedAt: string | null
  lastCheckedAt: string | null
  errorMessage: string | null
  createdAt: string
}

const CNAME_TARGET = process.env.NEXT_PUBLIC_CNAME_TARGET || "pages.leaddrivecrm.org"

export default function CustomDomainsPage() {
  const t = useTranslations("customDomains")
  useAutoTour("customDomains")
  const tc = useTranslations("common")
  const [domains, setDomains] = useState<CustomDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [domainInput, setDomainInput] = useState("")
  const [adding, setAdding] = useState(false)
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [deletingDomain, setDeletingDomain] = useState<CustomDomain | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/custom-domains")
      if (res.ok) {
        const data = await res.json()
        setDomains(data.domains)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDomains()
  }, [fetchDomains])

  const handleAdd = async () => {
    if (!domainInput.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/v1/custom-domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(t("domainAdded"))
        setAddOpen(false)
        setDomainInput("")
        fetchDomains()
      } else {
        toast.error(data.error || "Failed to add domain")
      }
    } catch {
      toast.error(tc("errorCreateFailed"))
    } finally {
      setAdding(false)
    }
  }

  const handleVerify = async (id: string) => {
    setVerifyingId(id)
    try {
      const res = await fetch(`/api/v1/custom-domains/${id}/verify`, { method: "POST" })
      const data = await res.json()
      if (data.verified) {
        toast.success(t("dnsVerifySuccess"))
      } else {
        toast.error(t("dnsVerifyFailed"))
      }
      fetchDomains()
    } catch {
      toast.error(tc("errorVerification"))
    } finally {
      setVerifyingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deletingDomain) return
    try {
      const res = await fetch(`/api/v1/custom-domains/${deletingDomain.id}`, { method: "DELETE" })
      if (res.ok) {
        toast.success(t("domainDeleted"))
        setDeleteOpen(false)
        setDeletingDomain(null)
        fetchDomains()
      } else {
        toast.error(tc("errorDeleteFailed"))
      }
    } catch {
      toast.error(tc("errorDeleteFailed"))
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(t("copied"))
    setTimeout(() => setCopied(false), 2000)
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800"><Clock className="h-3 w-3 mr-1" />{t("pending")}</Badge>
      case "dns_verified":
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800"><CheckCircle2 className="h-3 w-3 mr-1" />{t("dnsVerified")}</Badge>
      case "ssl_active":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"><ShieldCheck className="h-3 w-3 mr-1" />{t("sslActive")}</Badge>
      case "error":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800"><AlertCircle className="h-3 w-3 mr-1" />{t("error")}</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const hasPendingDomains = domains.some((d) => d.status === "pending" || d.status === "error")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour-id="domains-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6" />
            {t("title")} <TourReplayButton tourId="customDomains" /><HelpButton slug="custom-domains" variant="label" />
          </h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
          <PageDescription text={t("description")} />
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("addDomain")}
        </Button>
      </div>

      {/* How it works — always visible guide */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/20 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-semibold text-blue-900 dark:text-blue-300">{t("howItWorks")}</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Step 1 */}
          <div className="bg-white/80 dark:bg-white/5 rounded-lg p-4 border border-blue-100 dark:border-blue-900/40">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">1</div>
              <h4 className="font-medium text-sm">{t("step1Title")}</h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("step1Desc")}</p>
          </div>

          {/* Step 2 */}
          <div className="bg-white/80 dark:bg-white/5 rounded-lg p-4 border border-blue-100 dark:border-blue-900/40">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">2</div>
              <h4 className="font-medium text-sm">{t("step2Title")}</h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">{t("step2Desc")}</p>
            {/* CNAME visual */}
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-md p-3 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("recordType")}</span>
                <span className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">CNAME</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("hostLabel")}</span>
                <span className="text-xs font-mono text-foreground">{t("yourSubdomain")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("valueLabel")}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-semibold text-blue-700 dark:text-blue-400">{CNAME_TARGET}</span>
                  <button
                    onClick={() => copyToClipboard(CNAME_TARGET)}
                    className="p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                    title="Copy"
                  >
                    {copied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-white/80 dark:bg-white/5 rounded-lg p-4 border border-blue-100 dark:border-blue-900/40">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-7 w-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">3</div>
              <h4 className="font-medium text-sm">{t("step3Title")}</h4>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{t("step3Desc")}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-blue-700/70 dark:text-blue-400/60">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{t("dnsNote")}</span>
        </div>
      </div>

      {/* Example card */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <FileCode2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-medium mb-1">{t("exampleTitle")}</h4>
            <p className="text-xs text-muted-foreground mb-2">{t("exampleDesc")}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs bg-background px-2 py-1 rounded border font-mono">landing.yourcompany.com</code>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <code className="text-xs bg-background px-2 py-1 rounded border font-mono">CNAME</code>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <code className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded border border-blue-200 dark:border-blue-800 font-mono">{CNAME_TARGET}</code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{t("exampleResult")}</p>
          </div>
        </div>
      </div>

      {/* Domain list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold">{t("noDomains")}</h3>
          <p className="text-muted-foreground mt-1 mb-4">{t("noDomainsHint")}</p>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("addDomain")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t("yourDomains")}</h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">{t("domain")}</th>
                    <th className="text-left p-3 font-medium">{t("status")}</th>
                    <th className="text-left p-3 font-medium">{t("added")}</th>
                    <th className="text-right p-3 font-medium">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm font-medium">{d.domain}</span>
                          {d.status === "ssl_active" && (
                            <a
                              href={`https://${d.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-col gap-1">
                          {statusBadge(d.status)}
                          {d.errorMessage && (
                            <span className="text-xs text-red-500">{d.errorMessage}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-2">
                          {(d.status === "pending" || d.status === "error") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerify(d.id)}
                              disabled={verifyingId === d.id}
                            >
                              <RefreshCw className={`h-3 w-3 mr-1.5 ${verifyingId === d.id ? "animate-spin" : ""}`} />
                              {verifyingId === d.id ? t("verifying") : t("verifyDns")}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={() => {
                              setDeletingDomain(d)
                              setDeleteOpen(true)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Domain Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addDomainTitle")}</DialogTitle>
            <DialogDescription>{t("addDomainDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="domain">{t("domain")}</Label>
              <Input
                id="domain"
                placeholder={t("domainPlaceholder")}
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
              <p className="text-xs text-muted-foreground">{t("domainHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleAdd} disabled={adding || !domainInput.trim()}>
              {adding ? "..." : t("add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteConfirm")}</DialogTitle>
            <DialogDescription>
              {t("deleteConfirmHint")}
              {deletingDomain && (
                <span className="block font-mono mt-2 font-semibold text-foreground">{deletingDomain.domain}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
