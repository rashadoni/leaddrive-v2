"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"

export function CookieConsent() {
  const t = useTranslations("marketing")
  const [show, setShow] = useState(false)

  useEffect(() => {
    const accepted = localStorage.getItem("cookie-consent")
    if (!accepted) {
      const timer = setTimeout(() => setShow(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  const accept = () => {
    localStorage.setItem("cookie-consent", "true")
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-[#001E3C]/95 backdrop-blur-xl p-4 sm:p-6 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-white/60 flex-1">
          {t("cookieConsent.message")}
        </p>
        <div className="flex gap-3 flex-shrink-0">
          <button
            onClick={accept}
            className="rounded-full bg-[#EA580C] px-5 py-2 text-sm font-semibold text-white hover:bg-[#EA580C]/90 transition-colors"
          >
            {t("cookieConsent.accept")}
          </button>
          <button
            onClick={() => setShow(false)}
            className="rounded-full border border-white/20 px-5 py-2 text-sm font-medium text-white/60 hover:text-white hover:border-white/40 transition-colors"
          >
            {t("cookieConsent.close")}
          </button>
        </div>
      </div>
    </div>
  )
}
