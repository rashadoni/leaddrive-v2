"use client"

import { useState, useRef } from "react"
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

interface CsvImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityType: "contacts" | "companies"
  onImported: () => void
}

interface ParsedRow {
  [key: string]: string
}

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  const headers = lines[0].split(",").map(h => h.trim().replace(/^["']|["']$/g, ""))
  const rows = lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^["']|["']$/g, ""))
    const row: ParsedRow = {}
    headers.forEach((h, i) => { row[h] = values[i] || "" })
    return row
  })

  return { headers, rows }
}

const CONTACT_FIELD_MAP: Record<string, string> = {
  name: "fullName", fullname: "fullName", full_name: "fullName",
  email: "email", mail: "email",
  phone: "phone", tel: "phone", telephone: "phone",
  company: "companyName",
  position: "position", title: "position", role: "position",
  source: "source",
  brand: "brand",
  category: "category", segment: "category",
}

const COMPANY_FIELD_MAP: Record<string, string> = {
  name: "name", company: "name", company_name: "name",
  email: "email", mail: "email",
  phone: "phone", tel: "phone",
  website: "website", site: "website", url: "website",
  industry: "industry", sector: "industry",
  address: "address",
  city: "city",
  country: "country",
}

function mapField(header: string, type: "contacts" | "companies"): string | null {
  const norm = header.toLowerCase().replace(/[^a-z0-9_]/g, "")
  const map = type === "contacts" ? CONTACT_FIELD_MAP : COMPANY_FIELD_MAP
  return map[norm] || null
}

export function CsvImportDialog({ open, onOpenChange, entityType, onImported }: CsvImportDialogProps) {
  const t = useTranslations("common")
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "done">("upload")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fieldMapping, setFieldMapping] = useState<Record<string, string | null>>({})
  const [result, setResult] = useState<{ imported: number; errors: number }>({ imported: 0, errors: 0 })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { headers: h, rows: r } = parseCSV(text)
      setHeaders(h)
      setRows(r)

      // Auto-map fields
      const mapping: Record<string, string | null> = {}
      h.forEach(header => {
        mapping[header] = mapField(header, entityType)
      })
      setFieldMapping(mapping)
      setStep("preview")
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    setStep("importing")
    let imported = 0
    let errors = 0

    const endpoint = entityType === "contacts" ? "/api/v1/contacts" : "/api/v1/companies"

    for (const row of rows) {
      const data: Record<string, string> = {}
      Object.entries(fieldMapping).forEach(([csvCol, targetField]) => {
        if (targetField && row[csvCol]) {
          data[targetField] = row[csvCol]
        }
      })

      // Skip rows without required field
      const requiredField = entityType === "contacts" ? "fullName" : "name"
      if (!data[requiredField]) {
        errors++
        return
      }

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        })
        if (res.ok) imported++
        else errors++
      } catch {
        errors++
      }
    }

    setResult({ imported, errors })
    setStep("done")
    if (imported > 0) onImported()
  }

  const reset = () => {
    setStep("upload")
    setHeaders([])
    setRows([])
    setFieldMapping({})
    setResult({ imported: 0, errors: 0 })
  }

  const mappedFields = Object.values(fieldMapping).filter(Boolean)
  const targetFields = entityType === "contacts"
    ? ["fullName", "email", "phone", "position", "source", "brand", "category", "companyName"]
    : ["name", "email", "phone", "website", "industry", "address", "city", "country"]

  return (
    <Dialog open={open} onOpenChange={open => { onOpenChange(open); if (!open) reset() }}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          {t("csvImportTitle", { entity: entityType === "contacts" ? t("contacts") : t("companies") })}
        </DialogTitle>
      </DialogHeader>
      <DialogContent className="max-h-[70vh] overflow-y-auto">
        {step === "upload" && (
          <div
            className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm font-medium">{t("csvClickToUpload")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("csvHeadersHint")}</p>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{rows.length} rows</Badge>
              <Badge variant="outline">{headers.length} columns</Badge>
              <Badge className="bg-green-100 text-green-700">{mappedFields.length} mapped</Badge>
            </div>

            {/* Field mapping */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">{t("csvFieldMapping")}</p>
              {headers.map(h => (
                <div key={h} className="flex items-center gap-2">
                  <span className="text-xs w-[120px] truncate font-mono bg-muted px-2 py-1 rounded">{h}</span>
                  <span className="text-xs text-muted-foreground">→</span>
                  <select
                    className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 flex-1"
                    value={fieldMapping[h] || ""}
                    onChange={e => setFieldMapping(prev => ({ ...prev, [h]: e.target.value || null }))}
                  >
                    <option value="">{t("csvSkip")}</option>
                    {targetFields.map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview rows */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-auto max-h-[200px]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-2 py-1 text-left">#</th>
                    {headers.filter(h => fieldMapping[h]).map(h => (
                      <th key={h} className="px-2 py-1 text-left">{fieldMapping[h]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                      {headers.filter(h => fieldMapping[h]).map(h => (
                        <td key={h} className="px-2 py-1 truncate max-w-[150px]">{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                  {rows.length > 5 && (
                    <tr><td colSpan={100} className="px-2 py-1 text-center text-muted-foreground">...and {rows.length - 5} more</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="text-center py-12">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary mb-4" />
            <p className="text-sm font-medium">{t("csvImporting", { count: rows.length })}</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <p className="text-lg font-semibold">{t("csvImported", { count: result.imported })}</p>
            {result.errors > 0 && (
              <p className="text-sm text-red-500 flex items-center justify-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3" /> {t("csvErrors", { count: result.errors })}
              </p>
            )}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        {step === "preview" && (
          <>
            <Button variant="outline" onClick={reset}>{t("back")}</Button>
            <Button onClick={handleImport} disabled={mappedFields.length === 0}>
              {t("csvImportRecords", { count: rows.length })}
            </Button>
          </>
        )}
        {step === "done" && (
          <Button onClick={() => onOpenChange(false)}>{t("close")}</Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
