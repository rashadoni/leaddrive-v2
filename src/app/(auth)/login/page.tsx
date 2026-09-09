"use client"

import { useState, useEffect } from "react"
import { signIn } from "@/lib/auth-signin"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, Eye, EyeOff } from "lucide-react"
import { normalizeLoginErrorCode } from "@/lib/login-error"

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations("auth")
  const rawOAuthError = searchParams.get("error")
  const oauthError = normalizeLoginErrorCode(rawOAuthError)

  function getInitialOAuthError(): string {
    if (!oauthError) return ""
    if (oauthError === "CredentialsSignin") return t("invalidCredentials")
    if (oauthError === "OAuthAccountNotLinked") return t("errOAuthNotLinked")
    if (oauthError === "AccessDenied") return t("errAccessDenied")
    if (oauthError === "OAuthCallbackError") return t("errOAuthCallbackError")
    if (oauthError === "cross-tenant") return t("errCrossTenant")
    return t("errDefault")
  }

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState(getInitialOAuthError)
  const [loading, setLoading] = useState(false)
  const [tenantBranding, setTenantBranding] = useState<{
    name?: string
    logo?: string
    branding?: Record<string, unknown>
    suspended?: boolean
  } | null>(null)

  useEffect(() => {
    // Tenant branding: detect subdomain from hostname
    try {
      const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"
      const host = window.location.hostname
      const match = host.match(new RegExp(`^([a-z0-9][a-z0-9-]*)\\.${baseDomain.replace(/\./g, "\\.")}$`))
      if (match && !["app", "admin", "www"].includes(match[1])) {
        fetch(`/api/v1/public/tenant-branding?slug=${match[1]}`)
          .then(r => r.json())
          .then(j => { if (j.data) setTenantBranding(j.data) })
          .catch(() => {})
      }
    } catch {
      // Branding detection failed — continue with default
    }
  }, [])

  useEffect(() => {
    // Older Auth.js redirects could leave a literal `error=undefined` in the
    // address bar. It is not a real error code and must never be rendered or
    // carried into the next login attempt.
    if (rawOAuthError && !oauthError) {
      router.replace("/login", { scroll: false })
    }
  }, [oauthError, rawOAuthError, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    // F-36: pull tenant slug from the host subdomain so the credentials
    // provider only matches users in the org for the current URL. Use the
    // shared RESERVED_SUBDOMAINS list so middleware and login agree on
    // which hostnames are tenant subdomains.
    let organizationSlug: string | undefined = undefined
    try {
      const { getOrgSubdomain } = await import("@/lib/tenant-domain")
      const sub = getOrgSubdomain(window.location.hostname)
      if (sub) organizationSlug = sub
    } catch { /* host parsing failed — keep undefined */ }

    const result = await signIn("credentials", {
      email,
      password,
      ...(organizationSlug ? { organizationSlug } : {}),
      redirect: false,
    })

    setLoading(false)

    if (!result?.ok || result.error) {
      setError(t("invalidCredentials"))
    } else {
      router.push("/")
      router.refresh()
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        {tenantBranding?.logo && (
          <img src={tenantBranding.logo} alt={tenantBranding.name} className="h-10 mx-auto mb-2 object-contain" />
        )}
        <CardTitle className="text-2xl font-bold">
          {tenantBranding?.name || "LeadDrive CRM"}
        </CardTitle>
        <CardDescription>
          {tenantBranding?.suspended
            ? "This account has been suspended"
            : t("signInToAccount")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {tenantBranding?.suspended && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-sm text-amber-200">
              This organization has been deactivated. Contact your administrator.
            </div>
          )}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t("email")}
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("password")}
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                required
                minLength={8}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {capsLock && (
              <p className="flex items-center gap-2 text-sm text-amber-300" role="status">
                <AlertTriangle className="h-4 w-4" />
                {t("capsLockOn")}
              </p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("signingIn") : t("signIn")}
          </Button>

          <div className="flex justify-center text-sm w-full">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-primary">
              {t("forgotPassword")}
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
