"use client"

/**
 * Signing a price protocol or an acceptance act, on its page — the contract's
 * own e-sign flow pointed at the document (…/documents/[docId]/esign):
 *   draft      — «İmzaya göndər»: who signs (the people who signed the
 *                contract come first), then the links to copy;
 *   in_signing — who has signed and who not yet, and «İmzadan geri çağır»
 *                (the document becomes a draft again, the links die);
 *   signed     — the signature sheet and the signed PDF.
 */
import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Copy, Loader2, Plus, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Hint } from "@/components/hint"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { EsignSignatureSheet } from "@/components/contract-esign-signature-sheet"

type DocStatus = "draft" | "in_signing" | "signed" | "cancelled"
interface Signer {
  id: string
  fullName: string
  email: string
  order: number
  role: string
  status: string
  signedAt: string | null
  signatureMethod?: string | null
  signedIpAddress?: string | null
}
interface Envelope { id: string; status: string; sentAt: string | null; completedAt: string | null; boundContentHash: string | null; signers: Signer[] }
interface Row { fullName: string; email: string }
interface Link { signerId: string; fullName: string; email: string; signingLink: string }

export function ContractDocumentSigning({
  contractId,
  docId,
  status,
  hasLines,
  unsaved,
  onChanged,
}: {
  contractId: string
  docId: string
  status: DocStatus
  /** The saved document has lines: an empty one is not sent. */
  hasLines: boolean
  /** Edits not saved yet: what goes for signing is the saved document. */
  unsaved: boolean
  onChanged: () => void
}) {
  const t = useTranslations("contractDocuments")
  const locale = useLocale()
  const lang = locale === "ru" || locale === "en" ? locale : "az"
  const base = `/api/v1/contracts/${encodeURIComponent(contractId)}/documents/${encodeURIComponent(docId)}`
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([{ fullName: "", email: "" }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [links, setLinks] = useState<Link[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmRecall, setConfirmRecall] = useState(false)

  const load = useCallback(() => {
    fetch(`${base}/esign`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setEnvelopes((json?.data?.envelopes as Envelope[]) ?? []))
      .catch(() => setEnvelopes([]))
  }, [base])
  useEffect(load, [load, status])

  // The people who signed the contract usually sign its protocol and acts too.
  const openDialog = async () => {
    setError(null)
    setOpen(true)
    const json = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/esign`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const done = ((json?.data ?? []) as Envelope[]).find((e) => e.status === "completed")
    const people = done?.signers.filter((s) => s.role === "signer").map((s) => ({ fullName: s.fullName, email: s.email })) ?? []
    if (people.length > 0) setRows(people)
  }

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${base}/esign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signers: rows.map((r) => ({ fullName: r.fullName.trim(), email: r.email.trim() })), lang }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(json?.errorKey === "esignNotConfigured" ? t("errEsignNotConfigured") : json?.code === "CONFLICT" ? t("errChanged") : json?.code === "NO_LINES" ? t("errNoLines") : t("errSend"))
        return
      }
      setLinks(json.data.signingLinks as Link[])
      setOpen(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const copy = async (link: Link) => {
    try {
      await navigator.clipboard.writeText(link.signingLink)
      setCopied(link.signerId)
    } catch {
      setCopied(null)
    }
  }

  const live = envelopes.find((e) => e.status === "sent" || e.status === "in_progress")
  const completed = envelopes.find((e) => e.status === "completed")
  const rowsValid = rows.length > 0 && rows.every((r) => r.fullName.trim() && /\S+@\S+\.\S+/.test(r.email.trim()))
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  })()

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="document-signing">
      <h2 className="text-base font-semibold">{t("signingTitle")}</h2>

      {status === "draft" && !open && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t("signingDraft")}</p>
          <Hint text={unsaved ? t("saveFirst") : hasLines ? t("sendHint") : t("errNoLines")} wrap>
            <Button onClick={openDialog} disabled={!hasLines || unsaved} data-testid="document-send-open">
              <Send className="mr-1 h-4 w-4" /> {t("send")}
            </Button>
          </Hint>
        </div>
      )}

      {status === "draft" && open && (
        <div className="space-y-3" data-testid="document-send-form">
          <p className="text-sm text-muted-foreground">{t("sendExplain")}</p>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div>
                <Label htmlFor={`signer-name-${i}`}>{t("signerName")}</Label>
                <Input id={`signer-name-${i}`} value={row.fullName} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, fullName: e.target.value } : r)))} />
              </div>
              <div>
                <Label htmlFor={`signer-email-${i}`}>{t("signerEmail")}</Label>
                <Input id={`signer-email-${i}`} type="email" value={row.email} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, email: e.target.value } : r)))} />
              </div>
              <Hint text={t("removeSigner")}>
                <Button variant="ghost" size="icon" aria-label={t("removeSigner")} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </Button>
              </Hint>
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" size="sm" disabled={rows.length >= 10} onClick={() => setRows((rs) => [...rs, { fullName: "", email: "" }])}>
              <Plus className="mr-1 h-4 w-4" /> {t("addSigner")}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("close")}
              </Button>
              <Hint text={rowsValid ? null : t("signersInvalid")} wrap>
                <Button onClick={send} disabled={busy || !rowsValid} data-testid="document-send">
                  {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  {t("send")}
                </Button>
              </Hint>
            </div>
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div className="space-y-2 rounded-md border p-3" data-testid="document-signing-links">
          <p className="text-sm">{t("linksExplain")}</p>
          {links.map((link) => (
            <div key={link.signerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{`${link.fullName} · ${link.email}`}</span>
              <Button size="sm" variant="outline" onClick={() => copy(link)}>
                {copied === link.signerId ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                {copied === link.signerId ? t("copied") : t("copyLink")}
              </Button>
            </div>
          ))}
        </div>
      )}

      {status === "in_signing" && live && (
        <div className="space-y-2" data-testid="document-in-signing">
          <ul className="divide-y rounded-md border text-sm">
            {live.signers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words">{`${s.fullName} · ${s.email}`}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${s.status === "signed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-muted"}`}>
                  {t(`signer_${s.status}`)}
                </span>
              </li>
            ))}
          </ul>
          <Hint text={t("recallHint")}>
            <Button variant="outline" onClick={() => setConfirmRecall(true)} data-testid="document-recall">
              {t("recall")}
            </Button>
          </Hint>
        </div>
      )}

      {status === "signed" && completed && completed.boundContentHash && (
        <EsignSignatureSheet
          envelope={completed}
          signedVersion={{ versionNo: null, contentHash: completed.boundContentHash }}
          pdfUrl={`${base}/pdf?lang=${lang}&signed=1&download=1&tz=${encodeURIComponent(tz)}`}
        />
      )}

      {error && <p className="text-sm text-destructive" data-testid="document-signing-error">{error}</p>}

      <ConfirmDialog
        open={confirmRecall}
        onOpenChange={setConfirmRecall}
        title={t("recallTitle")}
        description={t("recallDescription")}
        confirmLabel={t("recall")}
        onConfirm={async () => {
          const res = await fetch(`${base}/esign`, { method: "DELETE" })
          if (!res.ok) throw new Error(t("errSend"))
          setLinks([])
          onChanged()
        }}
      />
    </section>
  )
}
