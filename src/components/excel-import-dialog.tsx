"use client"

/**
 * Import from Excel or CSV (docs/sales-procurement/README.md, task 7.4):
 * choose the file → see which field each column goes to (guessed from the
 * header in az/ru/en, changeable) → «Check» shows what will be added, what is
 * already there and which rows are wrong → «Import». The file is read on the
 * server each step; nothing is written before «Import».
 */
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type ExcelImportEntity = "companies" | "suppliers" | "contacts" | "products"

interface ReadResult { headers: string[]; sample: string[][]; total: number; mapping: (string | null)[]; fields: { key: string; required: boolean }[] }
interface Outcome { total: number; created: number; duplicateCount: number; errorCount: number; duplicates: { row: number; value: string }[]; errors: { row: number; message: string }[] }

export function ExcelImportDialog({ open, onOpenChange, entity, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entity: ExcelImportEntity
  onImported: () => void
}) {
  const t = useTranslations("excelImport")
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [read, setRead] = useState<ReadResult | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [check, setCheck] = useState<Outcome | null>(null)
  const [done, setDone] = useState<Outcome | null>(null)
  const [busy, setBusy] = useState<"" | "read" | "check" | "import">("")

  const reset = () => { setFile(null); setRead(null); setMapping([]); setCheck(null); setDone(null); setBusy(""); if (input.current) input.current.value = "" }

  const send = async (step: "read" | "check" | "import", chosen: File, map?: (string | null)[]) => {
    const form = new FormData()
    form.append("entity", entity)
    form.append("step", step)
    form.append("file", chosen)
    if (map) form.append("mapping", JSON.stringify(map))
    const res = await fetch("/api/v1/imports", { method: "POST", body: form })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || t("failed"))
    return body.data
  }

  const choose = async (chosen: File | undefined) => {
    if (!chosen) return
    setBusy("read")
    try {
      const data: ReadResult = await send("read", chosen)
      setFile(chosen)
      setRead(data)
      setMapping(data.mapping)
      setCheck(null)
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : t("failed"))
    } finally {
      setBusy("")
    }
  }

  const run = async (step: "check" | "import") => {
    if (!file) return
    setBusy(step)
    try {
      const data: Outcome = await send(step, file, mapping)
      if (step === "check") setCheck(data)
      else { setDone(data); onImported() }
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : t("failed"))
    } finally {
      setBusy("")
    }
  }

  const fieldLabel = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}` as never) : key)
  const errorLabel = (message: string) => (t.has(`errorField.${message}`) ? t(`errorField.${message}` as never) : message)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (busy) return; onOpenChange(next); if (!next) reset() }} widthClassName="max-w-[52rem]">
      <DialogHeader>
        <DialogTitle>{t(`title.${entity}`)}</DialogTitle>
        <DialogDescription>{t("hint")}</DialogDescription>
      </DialogHeader>
      <DialogContent>
        <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} />
        {done ? (
          <div className="space-y-2 text-sm">
            <p className="text-base font-semibold">{t("done", { n: done.created })}</p>
            {done.duplicateCount > 0 && <p className="text-muted-foreground">{t("duplicates", { n: done.duplicateCount })}</p>}
            {done.errorCount > 0 && <p className="text-red-600">{t("errors", { n: done.errorCount })}</p>}
          </div>
        ) : !read ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <Button type="button" disabled={busy === "read"} onClick={() => input.current?.click()}>
              {busy === "read" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("reading")}</> : <><Upload className="mr-2 h-4 w-4" />{t("choose")}</>}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">{t("columns")} · {file?.name} · {read.total}</p>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {read.headers.map((header, i) => (
                        <th key={i} className="min-w-[10rem] px-2 py-2 text-left align-top font-medium">
                          <div className="mb-1 truncate text-xs text-muted-foreground" title={header}>{header}</div>
                          <select
                            aria-label={header}
                            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                            value={mapping[i] ?? ""}
                            onChange={(e) => { const next = [...mapping]; next[i] = e.target.value || null; setMapping(next); setCheck(null) }}
                          >
                            <option value="">{t("skip")}</option>
                            {read.fields.map((field) => <option key={field.key} value={field.key}>{fieldLabel(field.key)}{field.required ? " *" : ""}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {read.sample.map((row, r) => (
                      <tr key={r} className="border-t">
                        {row.map((cell, c) => <td key={c} className={`max-w-[14rem] truncate px-2 py-1 ${mapping[c] ? "" : "text-muted-foreground"}`}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {check && (
              <div className="space-y-1 rounded-xl border p-3 text-sm">
                <p className="font-semibold">{t("willCreate", { n: check.created })}</p>
                {check.duplicateCount > 0 && <p className="text-muted-foreground">{t("duplicates", { n: check.duplicateCount })}</p>}
                {check.errorCount > 0 && (
                  <>
                    <p className="text-red-600">{t("errors", { n: check.errorCount })}</p>
                    <ul className="max-h-32 overflow-y-auto text-xs text-muted-foreground">
                      {check.errors.map((item) => <li key={`${item.row}-${item.message}`}>{t("row", { n: item.row })}: {errorLabel(item.message)}</li>)}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        {done ? (
          <Button type="button" onClick={() => { onOpenChange(false); reset() }}>{t("close")}</Button>
        ) : (
          <>
            {read && <Button type="button" variant="outline" disabled={!!busy} onClick={reset}>{t("back")}</Button>}
            {read && <Button type="button" variant="outline" disabled={!!busy} onClick={() => void run("check")}>{busy === "check" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("checking")}</> : t("check")}</Button>}
            {read && <Button type="button" disabled={!!busy || !check || check.created === 0} onClick={() => void run("import")}>{busy === "import" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("importing")}</> : t("import")}</Button>}
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}
