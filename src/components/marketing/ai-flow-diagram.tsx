"use client"

import { useRef, useState, useEffect } from "react"
import { AnimateIn } from "./animate-in"
import { aiCapabilities } from "@/lib/marketing-data"
import { useTranslations } from "next-intl"
import {
  Bot, ArrowRight, Sparkles, Send,
  TrendingUp, Star, Mail, MessageSquare,
  Zap, CheckCircle2,
} from "lucide-react"
import Link from "next/link"

/* ── Fake AI Chat Preview ── */
function AiChatPreview() {
  return (
    <div className="rounded-xl border border-[#001E3C]/10 bg-white overflow-hidden shadow-lg shadow-[#001E3C]/5">
      {/* Chat header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#001E3C]/8 bg-[#F3F4F7]">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#EA580C] to-[#EA580C] flex items-center justify-center">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
        <div>
          <div className="text-xs font-semibold text-[#001E3C]">Da Vinci</div>
          <div className="text-[10px] text-emerald-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Aktiv
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] bg-[#EA580C]/10 text-[#EA580C] px-1.5 py-0.5 rounded font-medium">DV</span>
        </div>
      </div>

      {/* Chat messages */}
      <div className="p-3 space-y-3 text-xs" style={{ minHeight: 200 }}>
        {/* User message */}
        <div className="flex justify-end">
          <div className="bg-[#001E3C] text-white rounded-xl rounded-br-sm px-3 py-2 max-w-[75%]">
            Bu lid haqqında nə deyə bilərsən?
          </div>
        </div>

        {/* AI response */}
        <div className="flex gap-2">
          <div className="w-5 h-5 rounded-md bg-[#EA580C]/10 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3 h-3 text-[#EA580C]" />
          </div>
          <div className="bg-[#F3F4F7] rounded-xl rounded-bl-sm px-3 py-2 max-w-[80%] space-y-2">
            <p className="text-[#001E3C]/80 leading-relaxed">
              <span className="font-semibold text-[#001E3C]">TechVision MMC</span> yüksək potensial lid kimi qiymətləndirildi:
            </p>
            {/* Scoring card */}
            <div className="bg-white rounded-lg border border-[#001E3C]/8 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#001E3C]/60">Lid Skoru</span>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">A — 87/100</span>
              </div>
              <div className="w-full bg-[#F3F4F7] rounded-full h-1.5">
                <div className="bg-gradient-to-r from-[#7D55C7] to-[#9B6CFF] h-1.5 rounded-full" style={{ width: "87%" }} />
              </div>
              <div className="grid grid-cols-3 gap-1 text-[9px]">
                <div className="text-center bg-[#F3F4F7] rounded p-1">
                  <div className="font-semibold text-[#001E3C]/80">Yüksək</div>
                  <div className="text-[#001E3C]/40">Uyğunluq</div>
                </div>
                <div className="text-center bg-[#F3F4F7] rounded p-1">
                  <div className="font-semibold text-[#001E3C]/80">4 əlaqə</div>
                  <div className="text-[#001E3C]/40">Fəallıq</div>
                </div>
                <div className="text-center bg-[#F3F4F7] rounded p-1">
                  <div className="font-semibold text-emerald-600">$45K</div>
                  <div className="text-[#001E3C]/40">Potensial</div>
                </div>
              </div>
            </div>
            <p className="text-[#001E3C]/60 leading-relaxed">
              <span className="font-medium text-[#EA580C]">Tövsiyə:</span> Bu həftə görüş təyin et. 72% ehtimalla bağlanacaq.
            </p>
          </div>
        </div>

        {/* AI action buttons */}
        <div className="flex gap-1.5 pl-7">
          <button className="flex items-center gap-1 text-[10px] font-medium text-[#EA580C] bg-[#EA580C]/10 border border-[#EA580C]/20 rounded-lg px-2 py-1">
            <Mail className="w-3 h-3" /> E-poçt yaz
          </button>
          <button className="flex items-center gap-1 text-[10px] font-medium text-[#001E3C]/60 bg-[#F3F4F7] border border-[#001E3C]/10 rounded-lg px-2 py-1">
            <TrendingUp className="w-3 h-3" /> Proqnoz
          </button>
        </div>
      </div>

      {/* Input bar */}
      <div className="px-3 py-2 border-t border-[#001E3C]/8 flex items-center gap-2">
        <input
          type="text"
          placeholder="Sual yazın..."
          className="flex-1 text-xs text-[#001E3C]/60 bg-transparent outline-none"
          readOnly
        />
        <div className="w-6 h-6 rounded-md bg-[#001E3C] flex items-center justify-center">
          <Send className="w-3 h-3 text-white" />
        </div>
      </div>
    </div>
  )
}

/* ── AI Email Generation Preview ── */
function AiEmailPreview() {
  return (
    <div className="rounded-xl border border-[#001E3C]/10 bg-white overflow-hidden shadow-lg shadow-[#001E3C]/5">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#001E3C]/8 bg-[#F3F4F7]">
        <Mail className="w-3.5 h-3.5 text-[#001E3C]/40" />
        <span className="text-xs font-medium text-[#001E3C]/80">Da Vinci E-poçt Generasiyası</span>
        <span className="ml-auto text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
          <Zap className="w-2.5 h-2.5" /> Auto
        </span>
      </div>
      <div className="p-3 space-y-2 text-xs">
        <div className="flex items-center gap-2 text-[#001E3C]/60">
          <span className="text-[10px] font-medium text-[#001E3C]/40 w-10">Kimə:</span>
          <span className="text-[#001E3C]/80">info@techvision.az</span>
        </div>
        <div className="flex items-center gap-2 text-[#001E3C]/60">
          <span className="text-[10px] font-medium text-[#001E3C]/40 w-10">Mövzu:</span>
          <span className="text-[#001E3C]/80">LeadDrive CRM — Şəxsi təklif</span>
        </div>
        <div className="border-t border-[#001E3C]/8 pt-2 space-y-1.5 text-[#001E3C]/60 leading-relaxed">
          <p>Hörmətli Kamran bəy,</p>
          <p>TechVision MMC-nin ERP ehtiyaclarını nəzərə alaraq, sizin üçün xüsusi Professional plan hazırladıq...</p>
          <p className="text-[#001E3C]/40 italic">✨ Da Vinci tərəfindən yaradıldı — 3 saniyə</p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <div className="flex items-center gap-1 text-[10px] text-emerald-600">
            <CheckCircle2 className="w-3 h-3" />
            Ton: Peşəkar
          </div>
          <div className="flex items-center gap-1 text-[10px] text-emerald-600">
            <CheckCircle2 className="w-3 h-3" />
            Uzunluq: Optimal
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Floating AI Capability Badges ── */
function AiCapabilityBadges() {
  const badges = [
    { label: "Hiss Təhlili", emoji: "😊", x: "5%", y: "8%" },
    { label: "Lid Skorinq", emoji: "📊", x: "70%", y: "2%" },
    { label: "Bilik Bazası", emoji: "📚", x: "80%", y: "45%" },
    { label: "Auto-Tiket", emoji: "🎫", x: "2%", y: "55%" },
  ]

  return (
    <>
      {badges.map((b) => (
        <div
          key={b.label}
          className="absolute bg-white/90 backdrop-blur border border-[#001E3C]/8 rounded-lg px-2.5 py-1.5 shadow-md text-[10px] font-medium text-[#001E3C]/60 flex items-center gap-1.5 z-10"
          style={{ left: b.x, top: b.y }}
        >
          <span>{b.emoji}</span>
          {b.label}
        </div>
      ))}
    </>
  )
}

export function AiFlowDiagram() {
  const t = useTranslations("marketing.davinci")
  return (
    <section id="davinci" className="relative bg-[#F3F4F7] py-20 lg:py-28 overflow-hidden">
      {/* Subtle bg accent */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#7D55C7]/10 rounded-full blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text */}
          <AnimateIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#EA580C]/20 bg-white px-4 py-1.5 text-xs font-medium text-[#EA580C] mb-5">
              <Bot className="h-3.5 w-3.5" />
              {t("sectionTitle")}
            </span>

            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight text-[#001E3C]">
              {t("sectionSubtitle")}
            </h2>

            <p className="mt-4 text-lg text-[#001E3C]/60 leading-relaxed max-w-lg">
              {t("sectionDescription")}
            </p>

            <ul className="mt-8 space-y-3.5">
              {[
                { key: "autoResponses", icon: aiCapabilities[0]?.icon },
                { key: "leadScoring", icon: aiCapabilities[1]?.icon },
                { key: "emailGeneration", icon: aiCapabilities[2]?.icon },
                { key: "profitability", icon: aiCapabilities[3]?.icon },
                { key: "knowledgeBase", icon: aiCapabilities[4]?.icon },
              ].map((cap) => {
                const Icon = cap.icon || Bot
                return (
                  <li key={cap.key} className="flex items-start gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-[#001E3C]/10 shrink-0 mt-0.5 shadow-sm">
                      <Icon className="h-4 w-4 text-[#EA580C]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#001E3C]">{t(cap.key)}</p>
                      <p className="text-sm text-[#001E3C]/60">{t(`${cap.key}Desc`)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <Link
              href="/demo"
              className="mt-8 group inline-flex items-center gap-2 rounded-full bg-[#001E3C] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#001E3C]/10 hover:bg-[#001E3C]/60 transition-all"
            >
              {t("tryDavinci")}
              <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </AnimateIn>

          {/* Product UI previews */}
          <AnimateIn delay={150}>
            <div className="relative">
              <AiCapabilityBadges />
              <div className="space-y-4">
                <AiChatPreview />
                <AiEmailPreview />
              </div>
            </div>
          </AnimateIn>
        </div>
      </div>
    </section>
  )
}
