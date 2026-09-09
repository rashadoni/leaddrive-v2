"use client"

import { useState, useEffect } from "react"
import { ArrowUp, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export function FloatingButtons() {
  const t = useTranslations("marketing")
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 400)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {/* Back to top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-[#001E3C]/90 backdrop-blur-sm text-white/60 hover:text-white hover:border-white/40 shadow-lg transition-all duration-300",
          showTop ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        aria-label={t("floatingButtons.backToTop")}
      >
        <ArrowUp className="h-4 w-4" />
      </button>

    </div>
  )
}
