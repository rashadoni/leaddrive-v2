"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface TenantAdminPasswordResetProps {
  tenantId: string
  tenantName: string
  tenantSlug: string
  user: {
    id: string
    name: string
    email: string
    isActive: boolean
  }
}

export function TenantAdminPasswordReset({
  tenantId,
  tenantName,
  tenantSlug,
  user,
}: TenantAdminPasswordResetProps) {
  const t = useTranslations("settingsUsers")
  const tAuth = useTranslations("auth")
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setPassword("")
    setConfirmPassword("")
    setShowPassword(false)
    setCapsLock(false)
    setConfirmed(false)
    setSaving(false)
    setError("")
  }, [open])

  const updateCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState("CapsLock"))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError(t("passwordMismatch"))
      return
    }
    if (!confirmed) {
      setError(t("passwordResetConfirmationRequired"))
      return
    }

    setSaving(true)
    try {
      const response = await fetch(
        `/api/v1/admin/tenants/${tenantId}/users/${user.id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirmPassword }),
        },
      )
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(result?.error || t("passwordResetFailed"))
      }

      toast.success(t("passwordResetSuccess", { name: user.name }))
      setOpen(false)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t("passwordResetFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-muted-foreground hover:text-foreground"
        aria-label={t("passwordResetUserNamed", { name: user.name })}
        title={t("passwordResetAction")}
        onClick={() => setOpen(true)}
      >
        <KeyRound className="h-4 w-4 sm:mr-1.5" />
        <span className="hidden sm:inline">{t("passwordResetAction")}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen} widthClassName="max-w-[34rem]">
        <form onSubmit={handleSubmit} autoComplete="off" className="flex max-h-[85vh] flex-col">
          <DialogHeader>
            <DialogTitle>{t("passwordResetTitle", { name: user.name })}</DialogTitle>
            <DialogDescription>{t("passwordResetDescription")}</DialogDescription>
          </DialogHeader>

          <DialogContent className="space-y-4">
            <div className="rounded-lg border border-border/80 bg-muted/40 px-4 py-3">
              <p className="text-sm font-medium text-foreground">{tenantName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{tenantSlug} · {user.email}</p>
            </div>

            {error && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {!user.isActive && (
              <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">{t("inactivePasswordWarningTitle")}</p>
                  <p className="mt-1">{t("inactivePasswordWarningDescription")}</p>
                </div>
              </div>
            )}

            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`admin-reset-password-${user.id}`}>{t("passwordNew")}</Label>
                <div className="relative">
                  <Input
                    id={`admin-reset-password-${user.id}`}
                    name={`admin-reset-password-${user.id}`}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={updateCapsLock}
                    onKeyUp={updateCapsLock}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    required
                    data-dialog-initial-focus
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{tAuth("passwordMinLength")}</p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor={`admin-confirm-password-${user.id}`}>{t("passwordConfirm")}</Label>
                <Input
                  id={`admin-confirm-password-${user.id}`}
                  name={`admin-confirm-password-${user.id}`}
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  onKeyDown={updateCapsLock}
                  onKeyUp={updateCapsLock}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={72}
                  required
                />
              </div>

              {capsLock && (
                <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  {t("capsLockOn")}
                </p>
              )}

              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                />
                <span>{t("passwordResetConfirmation")}</span>
              </label>
            </div>
          </DialogContent>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !confirmed}>
              {saving
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("saving")}</>
                : <><KeyRound className="mr-2 h-4 w-4" />{t("passwordResetAction")}</>}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  )
}
