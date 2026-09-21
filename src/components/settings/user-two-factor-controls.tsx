"use client"

import { useTranslations } from "next-intl"
import {
  requireTwoFactorToggleUpdate,
  twoFactorAdminStatus,
  type TwoFactorState,
} from "@/lib/two-factor-policy"

/** One administrator update of a user's 2FA: the body of PUT /api/v1/users/:id. */
export type UserTwoFactorUpdate = { resetTotp: true } | { resetSms: true } | { require2fa: boolean }

/**
 * The 2FA cell of Settings → Users: the TOTP and SMS factors (a click resets
 * one), the "Require 2FA" switch, and a read-only status of the setup.
 *
 * The switch used to show "required OR any factor enrolled" and to save the
 * opposite of what it showed. For a user who had set up an authenticator on
 * their own it looked ON and every click saved OFF, so 2FA could never be made
 * mandatory for them, and actions that demand mandatory MFA (reopening a
 * workday among them) stayed refused. It now shows and flips only the stored
 * requirement; enrollment is the status beside it.
 */
export function UserTwoFactorControls({ user, onUpdate }: {
  user: TwoFactorState
  onUpdate: (update: UserTwoFactorUpdate) => void | Promise<void>
}) {
  const tu = useTranslations("settingsUsers")
  const status = twoFactorAdminStatus(user)

  return (
    <div className="flex flex-nowrap items-center gap-1.5">
      {/* TOTP status pill — clickable to reset */}
      <button
        type="button"
        title={user.totpEnabled ? tu("totpSetTooltip") : tu("totpNotSetTooltip")}
        className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition ${
          user.totpEnabled
            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
            : "bg-muted/40 text-muted-foreground border-muted"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          if (!user.totpEnabled) return
          if (!confirm(tu("totpResetConfirm"))) return
          void onUpdate({ resetTotp: true })
        }}
      >
        TOTP {user.totpEnabled ? "✓" : "—"}
      </button>
      {/* SMS status pill — clickable to reset */}
      <button
        type="button"
        title={
          user.smsAuthEnabled
            ? tu("smsSetTooltip", { phone: user.verifiedPhone || "—" })
            : tu("smsNotSetTooltip")
        }
        className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition ${
          user.smsAuthEnabled
            ? "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100"
            : "bg-muted/40 text-muted-foreground border-muted"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          if (!user.smsAuthEnabled) return
          if (!confirm(tu("smsResetConfirm"))) return
          void onUpdate({ resetSms: true })
        }}
      >
        SMS {user.smsAuthEnabled ? "✓" : "—"}
      </button>
      {/* Require 2FA — the stored requirement only, never the enrollment */}
      <button
        type="button"
        role="switch"
        aria-checked={status.required}
        aria-label={tu("require2faTooltip")}
        title={tu("require2faTooltip")}
        data-testid="user-require-2fa-switch"
        className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors ${
          status.required ? "bg-green-500" : "bg-muted-foreground/40"
        }`}
        onClick={(e) => {
          e.stopPropagation()
          void onUpdate(requireTwoFactorToggleUpdate(user))
        }}
      >
        <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
          status.required ? "translate-x-3" : "translate-x-0"
        }`} />
      </button>
      {status.configured ? (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          data-testid="user-2fa-status"
        >
          {tu("twoFactorConfigured")}
        </span>
      ) : status.setupPending ? (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="user-2fa-status"
        >
          {tu("twoFactorSetupPending")}
        </span>
      ) : null}
    </div>
  )
}
