"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle, XCircle } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"

type PreviewRow = {
  row: number
  externalRegistryNumber: number | null
  customerName: string | null
  requestDate: string | null
  brand: string | null
  riskLevel: string | null
  status: string | null
}

type PreviewResult = {
  dryRun?: boolean
  totalParsed: number
  imported?: number
  errors: Array<{ row: number; error: string }>
  preview?: PreviewRow[]
}

const localeMap: Record<string, string> = { ru: "ru-RU", en: "en-US", az: "az-AZ" }

export default function ImportComplaintsPage() {
  const t = useTranslations("complaints")
  const locale = useLocale()
  const dateLocale = localeMap[locale] || "en-US"
  const router = useRouter()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [running, setRunning] = useState(false)
  const [imported, setImported] = useState<PreviewResult | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function runPreview(f: File) {
    setFile(f)
    setImported(null)
    setRunning(true)
    try {
      const fd = new FormData()
      fd.append("file", f)
      fd.append("dryRun", "true")
      const res = await fetch("/api/v1/complaints/import-xlsx", {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
        body: fd,
      })
      const json = await res.json()
      if (json.success) setPreview(json.data)
      else setPreview({ totalParsed: 0, errors: [{ row: 0, error: json.error }] })
    } finally {
      setRunning(false)
    }
  }

  async function runImport() {
    if (!file) return
    setRunning(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/v1/complaints/import-xlsx", {
        method: "POST",
        headers: orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>),
        body: fd,
      })
      const json = await res.json()
      if (json.success) setImported(json.data)
    } finally {
      setRunning(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void runPreview(f)
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
      <Link href="/complaints" className="text-sm text-muted-foreground flex items-center gap-1 hover:underline">
        <ArrowLeft className="w-4 h-4" /> {t("backToRegistry")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">{t("importTitle")} <HelpButton slug="complaints-import" variant="label" /></h1>
        <p className="text-sm text-muted-foreground mt-1">{t("importDescription")}</p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-10 text-center transition ${
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20"
        }`}
      >
        <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">{t("dropHere")}</p>
        <p className="text-xs text-muted-foreground mb-4">{t("orSelect")}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void runPreview(f)
          }}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={running}>
          <Upload className="w-4 h-4 mr-2" /> {t("selectFile")}
        </Button>
        {file && <div className="mt-3 text-sm text-muted-foreground">{file.name}</div>}
      </div>

      {running && <div className="text-sm text-muted-foreground">{t("processing")}</div>}

      {preview && !imported && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card">
          <div className="p-4 border-b flex justify-between items-center">
            <div>
              <div className="font-medium">{t("preview")}</div>
              <div className="text-xs text-muted-foreground">
                {t("parsedRows", { count: preview.totalParsed })}
                {preview.errors.length > 0 && ` · ${t("errorsCount", { count: preview.errors.length })}`}
              </div>
            </div>
            <Button disabled={running || preview.totalParsed === 0} onClick={runImport}>
              {t("importRecords", { count: preview.totalParsed })}
            </Button>
          </div>
          {preview.preview && preview.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left text-xs">{t("colRegistryNumber")}</th>
                    <th className="p-2 text-left text-xs">{t("colOrderNumber")}</th>
                    <th className="p-2 text-left text-xs">{t("colCustomer")}</th>
                    <th className="p-2 text-left text-xs">{t("colDate")}</th>
                    <th className="p-2 text-left text-xs">{t("colBrand")}</th>
                    <th className="p-2 text-left text-xs">{t("colRisk")}</th>
                    <th className="p-2 text-left text-xs">{t("colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((p) => (
                    <tr key={p.row} className="border-t">
                      <td className="p-2 font-mono text-xs">{p.row}</td>
                      <td className="p-2">{p.externalRegistryNumber ?? "—"}</td>
                      <td className="p-2">{p.customerName || "—"}</td>
                      <td className="p-2">{p.requestDate ? new Date(p.requestDate).toLocaleDateString(dateLocale) : "—"}</td>
                      <td className="p-2">{p.brand || "—"}</td>
                      <td className="p-2">{p.riskLevel || "—"}</td>
                      <td className="p-2">{p.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.totalParsed > preview.preview.length && (
                <div className="p-3 text-xs text-muted-foreground text-center border-t">
                  {t("moreRecords", {
                    count: preview.totalParsed - preview.preview.length,
                    shown: preview.preview.length,
                  })}
                </div>
              )}
            </div>
          )}
          {preview.errors.length > 0 && (
            <div className="p-4 border-t space-y-1">
              <div className="text-sm font-medium text-red-600 mb-2">{t("warnings")}</div>
              {preview.errors.slice(0, 5).map((e, i) => (
                <div key={i} className="text-xs text-red-600">
                  {t("rowError", { row: e.row, error: e.error })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {imported && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-6 bg-card">
          <div className="flex items-center gap-3">
            {imported.imported && imported.imported > 0 ? (
              <CheckCircle className="w-8 h-8 text-green-600" />
            ) : (
              <XCircle className="w-8 h-8 text-red-600" />
            )}
            <div>
              <div className="font-medium text-lg">{t("importDone")}</div>
              <div className="text-sm text-muted-foreground">
                {t("importSummary", { imported: imported.imported ?? 0, total: imported.totalParsed })}
                {imported.errors.length > 0 && ` · ${t("errorsCount", { count: imported.errors.length })}`}
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => router.push("/complaints")}>{t("openRegistry")}</Button>
            <Button
              variant="outline"
              onClick={() => {
                setImported(null)
                setPreview(null)
                setFile(null)
              }}
            >
              {t("importMore")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
