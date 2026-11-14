"use client"

import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Check, Circle, Copy, Eye, EyeOff, Wand2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { passwordRuleChecks } from "@/lib/password-policy"

/**
 * A password box that says what is wrong while the password is typed, not after
 * the form is sent (owner, 2026-11-07: «нужно именно в момент набора уже
 * показывать, подходит или нет»). The rules are the server's own
 * (`passwordRuleChecks` from the shared policy), so a fully green list is a
 * password the server accepts.
 */

type Rule = keyof ReturnType<typeof passwordRuleChecks>
// Always listed: what a person has to put into the password.
const BUILD_RULES: Rule[] = ["length", "uppercase", "lowercase", "digit", "special"]
// Listed only once broken: nobody needs to be told up front not to paste 73 bytes.
const GUARD_RULES: Rule[] = ["noSpaces", "notTooLong", "notCommon"]

export function passwordIsAcceptable(password: string): boolean {
  return Object.values(passwordRuleChecks(password)).every(Boolean)
}

/** A random temporary password that always satisfies the policy. */
export function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const body = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `Aa1!${body}`
}

export function PasswordRules({ password, id }: { password: string; id?: string }) {
  const t = useTranslations("settingsUsers")
  const checks = passwordRuleChecks(password)
  const typed = password.length > 0
  const rules = [...BUILD_RULES, ...GUARD_RULES.filter((rule) => !checks[rule])]
  const allOk = typed && Object.values(checks).every(Boolean)
  return (
    <div id={id} aria-live="polite" className="mt-2 rounded-md border border-border px-3 py-2" data-testid="password-rules">
      {allOk ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {t("passwordRulesOk")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("passwordRulesTitle")}</p>
          <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {rules.map((rule) => {
              const ok = checks[rule]
              const state = ok ? "ok" : typed ? "bad" : "todo"
              return (
                <li
                  key={rule}
                  data-rule={rule}
                  data-state={state}
                  className={`flex items-center gap-1.5 text-xs ${
                    state === "ok" ? "text-green-700 dark:text-green-400"
                      : state === "bad" ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {state === "ok" ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    : state === "bad" ? <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      : <Circle className="h-3 w-3 shrink-0" aria-hidden="true" />}
                  {t(`passwordRule_${rule}` as never)}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export function PasswordInput({
  id, name, value, onChange, visible, onToggleVisible, onKeyDown, onKeyUp, describedBy, invalid, testId, className,
}: {
  id: string
  name: string
  value: string
  onChange: (value: string) => void
  visible: boolean
  onToggleVisible: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onKeyUp?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  describedBy?: string
  invalid?: boolean
  testId?: string
  /** For a form whose other boxes are drawn differently (the teams page's «add a user»). */
  className?: string
}) {
  const t = useTranslations("settingsUsers")
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        autoComplete="new-password"
        spellCheck={false}
        autoCapitalize="off"
        required
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        data-testid={testId}
        className={cn("pr-11", className, invalid && "border-destructive focus-visible:ring-destructive")}
      />
      <button
        type="button"
        onClick={onToggleVisible}
        data-testid={testId ? `${testId}-toggle` : undefined}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        title={visible ? t("hidePassword") : t("showPassword")}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** «Сгенерировать» and «Копировать» under a new-password box. */
export function PasswordActions({ value, onGenerate, className }: { value: string; onGenerate: () => void; className?: string }) {
  const t = useTranslations("settingsUsers")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("passwordCopied"))
    } catch { /* the password is on screen; copying by hand still works */ }
  }
  return (
    <div className={cn("mt-2 flex flex-wrap gap-2", className)}>
      <button
        type="button"
        onClick={onGenerate}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
      >
        <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t("passwordGenerate")}
      </button>
      {value && (
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {t("passwordCopy")}
        </button>
      )}
    </div>
  )
}
