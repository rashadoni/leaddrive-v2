"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Laptop } from "lucide-react"
import { HomeCard, HomePill } from "@/components/mtm/home-parts"
import { Button } from "@/components/ui/button"
import type { AttendanceBranchScreenDirectory } from "@/lib/mtm/attendance-qr-contract"

/**
 * Personnel → Settings → QR: desks and office networks (owner, 2026-11-04;
 * mockup desk-and-breaks/3-crm-settings.png). Employees may pair their own
 * computer (off until turned on); each branch remembers the office network of
 * the computer the administrator presses the button on — no address is typed.
 */
export function MtmAttendanceDeskSettings({ directory, busy, mutate, reload }: {
  directory: AttendanceBranchScreenDirectory
  busy: boolean
  mutate: (run: () => Promise<Response>) => Promise<unknown>
  reload: () => Promise<unknown>
}) {
  const t = useTranslations("mtmAttendance")
  const [remembered, setRemembered] = useState<string | null>(null)
  const json = { "content-type": "application/json" }
  async function toggle() {
    await mutate(() => fetch("/api/v1/mtm/attendance/desk-screens", { method: "PUT", headers: json, body: JSON.stringify({ enabled: !directory.deskEnabled }) }))
    await reload()
  }
  async function network(branchId: string, action: "REMEMBER" | "FORGET") {
    setRemembered(null)
    const done = await mutate(() => fetch("/api/v1/mtm/attendance/branch-network", { method: "POST", headers: json, body: JSON.stringify({ branchId, action }) }))
    if (done && action === "REMEMBER") setRemembered(branchId)
    await reload()
  }
  return <HomeCard testId="attendance-desk-settings" titleId="attendance-desk-settings-title" title={t("deskSettingsTitle")} icon={<Laptop className="h-5 w-5" aria-hidden="true" />} tone="blue">
    <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm text-muted-foreground">{t("deskSettingsHint")}</p>
        <div className="flex items-center gap-3"><HomePill tone={directory.deskEnabled ? "green" : "zinc"}>{t(directory.deskEnabled ? "installationOn" : "installationOff")}</HomePill>
          {directory.canConfigure && <Button type="button" variant={directory.deskEnabled ? "outline" : "default"} role="switch" aria-checked={directory.deskEnabled} aria-label={t("deskSettingsRule")}
            className="min-h-11" disabled={busy} onClick={() => void toggle()} data-testid="attendance-desk-rule">{t(directory.deskEnabled ? "deskSettingsTurnOff" : "deskSettingsTurnOn")}</Button>}</div></div>
      <div className="divide-y rounded-xl border">
        <p className="bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground">{t("deskNetworkTitle")}</p>
        {directory.branches.map(branch => <div key={branch.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3" data-testid="attendance-branch-network">
          <div className="min-w-0"><p className="font-medium">{branch.name}</p>
            <p className="text-sm text-muted-foreground">{branch.networks ? t("deskNetworkRemembered", { count: branch.networks }) : t("deskNetworkNone")}</p>
            {remembered === branch.id && <p role="status" className="text-sm text-emerald-700">{t("deskNetworkJustRemembered")}</p>}</div>
          {directory.canConfigure && <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void network(branch.id, "REMEMBER")} data-testid="attendance-branch-network-remember">{t("deskNetworkRemember")}</Button>
            {branch.networks > 0 && <Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={busy} onClick={() => void network(branch.id, "FORGET")} data-testid="attendance-branch-network-forget">{t("deskNetworkForget")}</Button>}
          </div>}
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">{t("deskNetworkHint")}</p>
    </div>
  </HomeCard>
}
