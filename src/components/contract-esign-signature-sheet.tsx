"use client"

/**
 * The signature sheet («İmza vərəqi») of a completed e-sign envelope in the
 * contract card: who signed, how, when and from which address, and the
 * fingerprint of the signed text. The same facts are the last page of the
 * signed PDF (`src/lib/clm/signature-sheet.ts`), which the button downloads.
 *
 * Every signature here is a simple electronic one, and the card says so with a
 * tag and a hint: only ASAN İmza or SİMA stands in for a handwritten signature.
 */
import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint, HintValue } from "@/components/hint"

export interface SheetSigner {
  id: string
  fullName: string
  email: string
  role: string
  signedAt: string | null
  /** drawn | typed | uploaded */
  signatureMethod?: string | null
  signedIpAddress?: string | null
}

export function EsignSignatureSheet({
  envelope,
  signedVersion,
  pdfUrl,
}: {
  envelope: { signers: SheetSigner[] }
  /** versionNo is null for a price protocol or act, which has no versions. */
  signedVersion: { versionNo: number | null; contentHash: string }
  pdfUrl: string
}) {
  const t = useTranslations("contracts")
  const signers = envelope.signers.filter((s) => s.role === "signer")
  const methodLabel = (method: string | null | undefined) =>
    method === "drawn"
      ? t("esignMethodDrawn")
      : method === "typed"
        ? t("esignMethodTyped")
        : method === "uploaded"
          ? t("esignMethodUploaded")
          : t("esignSimpleSignature")
  const hash = signedVersion.contentHash
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="esign-signature-sheet">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">{t("esignSheetTitle")}</span>
        <Hint text={t("esignSignedPdfHint")}>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => window.open(pdfUrl, "_blank")}>
            <Download className="h-3 w-3 mr-1" />
            {t("esignSignedPdf")}
          </Button>
        </Hint>
      </div>
      <div className={signers.length > 1 ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
        {signers.map((signer) => (
          <div key={signer.id} className="h-full rounded-md border bg-card p-2.5 text-xs space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium break-words">{signer.fullName}</span>
              <Hint text={t("esignSimpleSignatureHint")}>
                <span
                  tabIndex={0}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                >
                  {t("esignSimpleSignature")}
                </span>
              </Hint>
            </div>
            <div className="text-muted-foreground break-words">{signer.email}</div>
            {signer.signedAt ? (
              <>
                <div>{methodLabel(signer.signatureMethod)}</div>
                <div>
                  {t("esignSignedAt")}: {new Date(signer.signedAt).toLocaleString()}
                </div>
                {signer.signedIpAddress && (
                  <div className="text-muted-foreground">
                    {t("esignSignedFromIp")}: <span className="font-mono">{signer.signedIpAddress}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">{t("esignNotSigned")}</div>
            )}
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        {signedVersion.versionNo === null ? t("esignFingerprintPlain") : t("esignFingerprint", { version: signedVersion.versionNo })}:{" "}
        <HintValue text={t("esignFingerprintHint")} className="font-mono">
          {`${hash.slice(0, 8)}…${hash.slice(-8)}`}
        </HintValue>
      </div>
    </div>
  )
}
