"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Save, RotateCcw, Loader2 } from "lucide-react"
import { useParameters, useUpdateParameters } from "@/lib/cost-model/hooks"
import { getCurrencySymbol } from "@/lib/constants"
import type { CostModelParams } from "@/lib/cost-model/types"

interface FieldDef {
  key: keyof CostModelParams
  type: "number" | "percentage"
  group: string
}

// label + description + group title are localized via t(field.key) / t(`${key}Desc`) / t(GROUP_KEY[group])
const FIELDS: FieldDef[] = [
  { key: "totalEmployees", type: "number", group: "headcount" },
  { key: "backOfficeStaff", type: "number", group: "headcount" },
  { key: "technicalStaff", type: "number", group: "headcount" },
  { key: "vatRate", type: "percentage", group: "taxes" },
  { key: "employerTaxRate", type: "percentage", group: "taxes" },
  { key: "riskRate", type: "percentage", group: "ratios" },
  { key: "miscExpenseRate", type: "percentage", group: "ratios" },
  { key: "fixedOverheadRatio", type: "percentage", group: "overhead" },
]

const GROUP_KEY: Record<string, string> = {
  headcount: "groupHeadcount",
  taxes: "groupTaxes",
  ratios: "groupRatios",
  overhead: "groupOverhead",
}

export function ParametersTab() {
  const t = useTranslations("profitabilityParams")
  const { data: serverParams, isLoading, error } = useParameters()
  const updateMutation = useUpdateParameters()

  const [localParams, setLocalParams] = useState<CostModelParams | null>(null)
  const [dirty, setDirty] = useState(false)
  const [realUserCount, setRealUserCount] = useState<number | null>(null)

  // Fetch real totalUsers from companies
  useEffect(() => {
    fetch("/api/v1/companies?category=client&limit=1")
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data.totalUsers !== undefined) {
          setRealUserCount(json.data.totalUsers)
        }
      })
      .catch(() => {})
  }, [])

  // Sync server data into local state
  useEffect(() => {
    if (serverParams && !dirty) {
      setLocalParams(serverParams)
    }
  }, [serverParams, dirty])

  const params = localParams || serverParams

  const updateParam = (key: keyof CostModelParams, value: number) => {
    if (!params) return
    setLocalParams({ ...params, [key]: value })
    setDirty(true)
  }

  const handleSave = () => {
    if (!localParams) return
    updateMutation.mutate(
      {
        totalUsers: localParams.totalUsers,
        totalEmployees: localParams.totalEmployees,
        technicalStaff: localParams.technicalStaff,
        backOfficeStaff: localParams.backOfficeStaff,
        monthlyWorkHours: localParams.monthlyWorkHours,
        vatRate: localParams.vatRate,
        employerTaxRate: localParams.employerTaxRate,
        riskRate: localParams.riskRate,
        miscExpenseRate: localParams.miscExpenseRate,
        fixedOverheadRatio: localParams.fixedOverheadRatio,
      },
      {
        onSuccess: () => setDirty(false),
      }
    )
  }

  const handleReset = () => {
    if (serverParams) {
      setLocalParams(serverParams)
      setDirty(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Yüklənir...</span>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-red-600">
          Xəta baş verdi: {(error as Error).message}
        </CardContent>
      </Card>
    )
  }

  if (!params) return null

  const groups = Array.from(new Set(FIELDS.map(f => f.group)))
  const variableRatio = 1 - (params.fixedOverheadRatio || 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Bu parametrlər maya dəyəri modelinin xərc hesablamalarını idarə edir.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Paylaşma: Sabit {((params.fixedOverheadRatio || 0) * 100).toFixed(0)}% + Dəyişən {(variableRatio * 100).toFixed(0)}%
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty}>
            <RotateCcw className="h-4 w-4 mr-1" /> Sıfırla
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Saxla
            {dirty && <Badge variant="destructive" className="ml-2 h-4 text-[10px]">Dəyişiklik</Badge>}
          </Button>
        </div>
      </div>

      {/* Total Users — editable with auto-sync */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ümumi Məlumat</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 items-center">
            <div>
              <label className="text-sm font-medium">Cəm İstifadəçi Sayı</label>
              <p className="text-xs text-muted-foreground">Bütün müştərilərin istifadəçi sayı</p>
              {realUserCount !== null && params.totalUsers !== realUserCount && (
                <p className="text-xs text-orange-600 mt-1">
                  {t("realFromCompanies", { count: realUserCount })}
                </p>
              )}
              {realUserCount !== null && params.totalUsers === realUserCount && (
                <p className="text-xs text-green-600 mt-1">{t("matchesCompanies")}</p>
              )}
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Input
                type="number"
                value={params.totalUsers || 0}
                onChange={e => updateParam("totalUsers", parseInt(e.target.value) || 0)}
                className="w-40 text-right"
              />
              {realUserCount !== null && params.totalUsers !== realUserCount && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateParam("totalUsers", realUserCount)}
                  className="text-xs whitespace-nowrap"
                >
                  {t("sync", { count: realUserCount })}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {groups.map(group => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-base">{t(GROUP_KEY[group] as Parameters<typeof t>[0])}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {FIELDS.filter(f => f.group === group).map(field => (
              <div key={field.key} className="grid grid-cols-3 gap-4 items-center">
                <div>
                  <label className="text-sm font-medium">{t(field.key as Parameters<typeof t>[0])}</label>
                  <p className="text-xs text-muted-foreground">{t(`${field.key}Desc` as Parameters<typeof t>[0])}</p>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  {field.type === "percentage" ? (
                    <>
                      <Input
                        type="number"
                        step="0.1"
                        value={Math.round((params[field.key] as number) * 10000) / 100}
                        onChange={e => updateParam(field.key, (parseFloat(e.target.value) || 0) / 100)}
                        className="w-32 text-right"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        (raw: {params[field.key] as number})
                      </span>
                    </>
                  ) : (
                    <Input
                      type="number"
                      value={params[field.key] as number}
                      onChange={e => updateParam(field.key, parseFloat(e.target.value) || 0)}
                      className="w-40 text-right"
                    />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Derived values */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hesablanan Dəyərlər</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">Dəyişən Overhead Nisbəti</span>
              <span className="font-mono font-medium">{(variableRatio * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">Gəlir Vergisi Dərəcəsi (sabit)</span>
              <span className="font-mono font-medium">14%</span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">İstifadəçi başına Maya (təxmini)</span>
              <span className="font-mono font-medium">
                {params.totalUsers > 0
                  ? ((serverParams?.totalUsers ? (serverParams as any).costPerUser : 0) || "N/A")
                  : "N/A"
                } {getCurrencySymbol()}
              </span>
            </div>
            <div className="flex justify-between p-2 rounded bg-muted/50">
              <span className="text-muted-foreground">Ort. Əmək Haqqı Yükü Əmsalı</span>
              <span className="font-mono font-medium">
                {((1 / (1 - 0.14)) * (1 + (params.employerTaxRate || 0))).toFixed(4)}x
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
