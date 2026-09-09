"use client"

import { useRef, useState, useEffect } from "react"
import { AnimateIn } from "./animate-in"
import {
  Brain, MessageSquare, TrendingUp, Shield,
  ArrowUpRight, Zap, BarChart3, Users,
} from "lucide-react"
import { useTranslations } from "next-intl"

/* ── Animated counter ── */
function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true) },
      { threshold: 0.3 },
    )
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [ref])
  return inView
}

function Counter({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref)

  useEffect(() => {
    if (!inView) return
    const duration = 1400
    const startTime = performance.now()
    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * value))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [inView, value])

  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>
}

/* ── Mini sparkline SVG ── */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 80
  const h = 28
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`)
    .join(" ")

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function useMetrics() {
  const t = useTranslations("marketing.stats")
  return [
    {
      value: 160, suffix: "+", label: t("features"), sublabel: "160+ · 20",
      icon: BarChart3, trend: "+12%", color: "#f97316",
      spark: [24, 42, 35, 56, 65, 75, 94, 103, 113, 125, 144, 160],
    },
    {
      value: 16, suffix: "", label: t("aiIntegrations"), sublabel: t("aiDesc"),
      icon: Brain, trend: "+4", color: "#8b5cf6",
      spark: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
    },
    {
      value: 7, suffix: "", label: t("channels"), sublabel: t("channelsDesc"),
      icon: MessageSquare, trend: "7/7", color: "#06b6d4",
      spark: [2, 3, 3, 4, 5, 5, 6, 6, 7, 7, 7, 7],
    },
    {
      value: 5, suffix: "", label: t("industries"), sublabel: t("industriesDesc"),
      icon: Users, trend: "5/5", color: "#10b981",
      spark: [1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5],
    },
  ]
}

export function StatsCounter() {
  const metrics = useMetrics()
  const tBar = useTranslations("marketing.statsBar")
  return (
    <section className="relative bg-white py-16 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Section micro-header */}
        <AnimateIn>
          <p className="text-center text-sm font-medium text-[#001E3C]/40 uppercase tracking-widest mb-10">
            {tBar("featuresCount")}
          </p>
        </AnimateIn>

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {metrics.map((m, i) => {
            const Icon = m.icon
            return (
              <AnimateIn key={m.label} delay={i * 80}>
                <div className="group relative rounded-2xl border border-[#001E3C]/10 bg-white p-5 lg:p-6 hover:border-[#001E3C]/15 hover:shadow-lg hover:shadow-[#001E3C]/5 transition-all duration-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                  {/* Icon + trend */}
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className="flex items-center justify-center w-9 h-9 rounded-xl"
                      style={{ backgroundColor: `${m.color}12` }}
                    >
                      <Icon className="w-4.5 h-4.5" style={{ color: m.color }} />
                    </div>
                    <span
                      className="inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-2 py-0.5"
                      style={{ backgroundColor: `${m.color}10`, color: m.color }}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      {m.trend}
                    </span>
                  </div>

                  {/* Number */}
                  <div className="text-3xl lg:text-4xl font-bold tabular-nums text-[#001E3C] leading-none">
                    <Counter value={m.value} suffix={m.suffix} />
                  </div>

                  {/* Label */}
                  <div className="mt-1.5 text-sm font-medium text-[#001E3C]">{m.label}</div>
                  <div className="text-xs text-[#001E3C]/40">{m.sublabel}</div>

                  {/* Sparkline */}
                  <div className="mt-3 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Sparkline data={m.spark} color={m.color} />
                  </div>
                </div>
              </AnimateIn>
            )
          })}
        </div>
      </div>
    </section>
  )
}
