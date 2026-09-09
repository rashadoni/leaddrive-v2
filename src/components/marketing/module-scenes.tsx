"use client"

/**
 * Module storytelling section — replaces the old ModuleShowcase of coded UI
 * screenshots (owner request 2026-08-31: «убрать скрины, вместо них хук-картинки
 * и плюсы модулей»). Each module gets a hook headline, a scenario line, 3–4
 * benefit bullets and a language-neutral illustrated vignette built from the
 * same visual vocabulary (bubbles, cards, avatars) instead of a fake UI.
 *
 * Facts behind every claim were verified against the codebase on 2026-08-31:
 * channels — webhooks/* + business-hours.ts; contract risk — contracts/[id]/
 * score-risk; POS points — loyaltyPos nav; report narrative — reports/
 * ai-narrative; the rest — nav-items.ts + module pages. Keep it that way:
 * a vignette may simplify, but must not invent a capability.
 */

import { useTranslations } from "next-intl"
import { AnimateIn } from "./animate-in"
import {
  Mail, Send, Phone, MessageSquare, Camera, Music2, Globe, Hash,
  Sparkles, Check, PhoneCall, FileText, ScanLine, AlertTriangle,
  TrendingUp, Target, MousePointerClick, Users, UserRound,
  BadgePercent, Receipt, Gift, Megaphone, FileBarChart, Scale,
  Headphones, Timer, Zap, BookOpen, Wallet, PieChart,
  Trophy, Lightbulb, MapPin, Route as RouteIcon, Image as ImageIcon,
  Building2, Merge, ArrowRight, CalendarCheck, ClipboardCheck,
} from "lucide-react"

const NAVY = "#0A2540"

/* ────────────────────────── shared vignette bits ────────────────────────── */

export function Vignette({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl border border-[#0A2540]/8 p-6 lg:p-8"
      style={{
        minHeight: 340,
        background: `linear-gradient(135deg, ${tint}0d 0%, #ffffff 55%, ${tint}14 100%)`,
      }}
    >
      {children}
    </div>
  )
}

export function Ava({ text, color, size = 36 }: { text: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {text}
    </span>
  )
}

export function ChanIcon({ icon: Icon, color }: { icon: typeof Mail; color: string }) {
  return (
    <span
      className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
      style={{ backgroundColor: color }}
    >
      <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
    </span>
  )
}

export function AiChip({ label = "AI" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-600">
      <Sparkles style={{ width: 12, height: 12 }} /> {label}
    </span>
  )
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border border-[#0A2540]/8 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function Line({ w = "100%", light = false }: { w?: string | number; light?: boolean }) {
  return (
    <span
      className={`block h-1.5 rounded-full ${light ? "bg-[#0A2540]/8" : "bg-[#0A2540]/15"}`}
      style={{ width: w }}
    />
  )
}

/* ──────────────────────────────── scenes ────────────────────────────────── */

/** Omni-Channel: many platforms → one inbox → human + AI replies. */
export function OmniScene({ tall = false }: { tall?: boolean }) {
  const channels = [
    { icon: Send,          color: "#229ED9" }, // Telegram
    { icon: Phone,         color: "#25D366" }, // WhatsApp
    { icon: Camera,        color: "#E1306C" }, // Instagram
    { icon: Mail,          color: "#6091FF" }, // Email
    { icon: Music2,        color: "#111111" }, // TikTok
    { icon: MessageSquare, color: "#F59E0B" }, // SMS
    { icon: Globe,         color: "#06B6D4" }, // Web chat
    { icon: Hash,          color: "#4C75A3" }, // VK
    { icon: PhoneCall,     color: "#10B981" }, // Calls
  ]
  return (
    <Vignette tint="#06B6D4">
      <div className="flex items-center gap-4 lg:gap-6" style={tall ? { minHeight: 380 } : undefined}>
        {/* стая каналов */}
        <div className="grid shrink-0 grid-cols-2 gap-2.5">
          {channels.map((c, i) => (
            <div key={i} className={i % 2 ? "translate-y-2" : ""}>
              <ChanIcon icon={c.icon} color={c.color} />
            </div>
          ))}
        </div>
        <ArrowRight className="hidden shrink-0 text-[#0A2540]/25 sm:block" style={{ width: 28, height: 28 }} />
        {/* единая лента */}
        <Card className="min-w-0 flex-1 p-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <Ava text="A" color="#E1306C" size={30} />
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-[#F3F6FA] px-3 py-2">
                <Line w="82%" />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Ava text="M" color="#229ED9" size={30} />
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-[#F3F6FA] px-3 py-2">
                <Line w="60%" />
              </div>
            </div>
            {/* ответ человека */}
            <div className="flex items-center justify-end gap-2.5">
              <div className="min-w-0 flex-1 rounded-xl rounded-tr-sm px-3 py-2" style={{ backgroundColor: `${NAVY}0d` }}>
                <Line w="70%" />
              </div>
              <Ava text="R" color={NAVY} size={30} />
            </div>
            {/* ответ AI */}
            <div className="flex items-center justify-end gap-2.5">
              <AiChip />
              <div className="min-w-0 flex-1 rounded-xl rounded-tr-sm bg-violet-500/8 px-3 py-2" style={{ maxWidth: "58%" }}>
                <Line w="88%" light />
              </div>
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-violet-500 text-white">
                <Sparkles style={{ width: 14, height: 14 }} />
              </span>
            </div>
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** Sales: today's touch queue + pipeline momentum. */
function SalesScene() {
  return (
    <Vignette tint="#EF4444">
      <div className="flex items-stretch gap-4">
        <Card className="flex-1 p-4">
          <div className="mb-3 flex items-center gap-2">
            <CalendarCheck className="text-red-500" style={{ width: 16, height: 16 }} />
            <Line w={90} />
            <span className="ml-auto rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-500">7</span>
          </div>
          {[
            { icon: PhoneCall, done: true },
            { icon: Mail, done: true },
            { icon: Phone, done: false },
            { icon: Send, done: false },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 border-t border-[#0A2540]/6 py-2.5">
              <s.icon className="text-[#0A2540]/50" style={{ width: 15, height: 15 }} />
              <Line w={i % 2 ? "45%" : "62%"} light={s.done} />
              {s.done
                ? <Check className="ml-auto text-emerald-500" style={{ width: 15, height: 15 }} />
                : <ArrowRight className="ml-auto text-[#0A2540]/30" style={{ width: 15, height: 15 }} />}
            </div>
          ))}
        </Card>
        <Card className="hidden w-[42%] flex-col justify-end gap-1 p-4 sm:flex">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="text-red-500" style={{ width: 16, height: 16 }} />
            <Line w={70} />
          </div>
          <div className="flex h-full items-end gap-2">
            {[38, 55, 47, 70, 88].map((h, i) => (
              <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#EF4444" : "#EF444433" }} />
            ))}
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** CRM: one customer card pulls every thread together. */
function CrmScene() {
  const around = [
    { icon: Mail, color: "#6091FF" },
    { icon: Wallet, color: "#10B981" },
    { icon: PhoneCall, color: "#F59E0B" },
    { icon: ClipboardCheck, color: "#8B5CF6" },
  ]
  return (
    <Vignette tint="#3B82F6">
      <div className="flex items-center justify-center gap-4">
        <div className="flex flex-col gap-3">
          {around.slice(0, 2).map((a, i) => <ChanIcon key={i} icon={a.icon} color={a.color} />)}
        </div>
        <Card className="w-[300px] max-w-full p-4">
          <div className="mb-3 flex items-center gap-3">
            <Ava text="ZP" color="#3B82F6" size={40} />
            <div className="flex-1 space-y-1.5">
              <Line w="65%" />
              <Line w="42%" light />
            </div>
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold text-blue-600">VIP</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[Building2, Users, Receipt].map((I, i) => (
              <div key={i} className="flex items-center justify-center rounded-xl bg-[#F3F6FA] py-2.5">
                <I className="text-[#0A2540]/45" style={{ width: 16, height: 16 }} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-blue-500/6 px-3 py-2">
            <Merge className="text-blue-500" style={{ width: 14, height: 14 }} />
            <Line w="55%" light />
            <Check className="ml-auto text-emerald-500" style={{ width: 14, height: 14 }} />
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          {around.slice(2).map((a, i) => <ChanIcon key={i} icon={a.icon} color={a.color} />)}
        </div>
      </div>
    </Vignette>
  )
}

/** Support: SLA ring + skill routing to the right agent. */
function SupportScene() {
  return (
    <Vignette tint="#8B5CF6">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[220px] p-4">
          <div className="mb-3 flex items-center gap-2">
            <Headphones className="text-violet-500" style={{ width: 16, height: 16 }} />
            <Line w="55%" />
          </div>
          <Line w="80%" light />
          <div className="mt-3 flex items-center gap-2">
            <Timer className="text-violet-500" style={{ width: 15, height: 15 }} />
            <span className="text-[12px] font-bold text-violet-600">SLA 82%</span>
            <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/15">
              <Zap className="text-amber-500" style={{ width: 13, height: 13 }} />
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#0A2540]/8">
            <span className="block h-full rounded-full bg-violet-500" style={{ width: "82%" }} />
          </div>
        </Card>
        <div className="flex flex-col items-center gap-1">
          <ArrowRight className="text-[#0A2540]/25" style={{ width: 24, height: 24 }} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#0A2540]/35">skills</span>
        </div>
        <div className="flex flex-col gap-2.5">
          {[
            { t: "N", c: "#8B5CF6", on: true },
            { t: "E", c: "#0A2540", on: false },
            { t: "K", c: "#0A2540", on: false },
          ].map((a, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 ${a.on ? "bg-violet-500/10" : "bg-[#0A2540]/4 opacity-50"}`}>
              <Ava text={a.t} color={a.c} size={28} />
              <Line w={a.on ? 56 : 40} light={!a.on} />
              {a.on && <Check className="text-emerald-500" style={{ width: 14, height: 14 }} />}
            </div>
          ))}
          <div className="mt-1 flex items-center gap-1.5 pl-1">
            <BookOpen className="text-violet-500" style={{ width: 14, height: 14 }} />
            <AiChip label="24/7" />
          </div>
        </div>
      </div>
    </Vignette>
  )
}

/** Finance: profitable vs loss-making client, taxes/risk included. */
function FinanceScene() {
  return (
    <Vignette tint="#10B981">
      <div className="flex flex-col items-center gap-3">
        <div className="flex w-full max-w-[440px] gap-3">
          <Card className="flex-1 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Ava text="A" color="#10B981" size={28} />
              <Line w="50%" />
            </div>
            <div className="text-xl font-extrabold text-emerald-500">+34%</div>
            <div className="mt-2 flex h-8 items-end gap-1">
              {[40, 55, 70, 90].map((h, i) => (
                <span key={i} className="flex-1 rounded-t bg-emerald-500/70" style={{ height: `${h}%` }} />
              ))}
            </div>
          </Card>
          <Card className="flex-1 border-red-200 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Ava text="B" color="#EF4444" size={28} />
              <Line w="50%" />
            </div>
            <div className="text-xl font-extrabold text-red-500">−12%</div>
            <div className="mt-2 flex h-8 items-end gap-1">
              {[70, 60, 45, 30].map((h, i) => (
                <span key={i} className="flex-1 rounded-t bg-red-400/60" style={{ height: `${h}%` }} />
              ))}
            </div>
          </Card>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm">
          <PieChart className="text-emerald-500" style={{ width: 15, height: 15 }} />
          <span className="text-[12px] font-semibold text-[#0A2540]/60">₼ + %</span>
          <Line w={80} light />
          <Receipt className="text-[#0A2540]/40" style={{ width: 15, height: 15 }} />
        </div>
      </div>
    </Vignette>
  )
}

/** Marketing: ad → click → deal → money, glued into one profile. */
function MarketingScene() {
  const steps = [
    { icon: Megaphone, color: "#F97316" },
    { icon: MousePointerClick, color: "#3B82F6" },
    { icon: Target, color: "#8B5CF6" },
    { icon: Wallet, color: "#10B981" },
  ]
  return (
    <Vignette tint="#F97316">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2 sm:gap-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 sm:gap-3">
              <ChanIcon icon={s.icon} color={s.color} />
              {i < steps.length - 1 && <ArrowRight className="text-[#0A2540]/25" style={{ width: 18, height: 18 }} />}
            </div>
          ))}
        </div>
        <Card className="w-full max-w-[420px] p-4">
          <div className="flex items-center gap-3">
            <Ava text="S" color="#F97316" size={36} />
            <div className="flex-1 space-y-1.5">
              <Line w="58%" />
              <Line w="38%" light />
            </div>
            <div className="text-right">
              <div className="text-lg font-extrabold text-emerald-500">ROI 4.2×</div>
              <Line w={54} light />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Merge className="text-orange-500" style={{ width: 14, height: 14 }} />
            <span className="text-[11px] font-semibold text-[#0A2540]/45">2 → 1</span>
            <Line w="40%" light />
            <BadgePercent className="ml-auto text-[#0A2540]/35" style={{ width: 15, height: 15 }} />
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** Contracts: document scan → AI risk grade → approval chain. */
function ContractsScene() {
  return (
    <Vignette tint="#0EA5E9">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="relative w-[190px] overflow-hidden p-4">
          <FileText className="mb-2 text-sky-500" style={{ width: 20, height: 20 }} />
          <div className="space-y-1.5">
            <Line /><Line w="85%" /><Line w="90%" light /><Line w="70%" light />
          </div>
          <span className="absolute inset-x-0 top-1/2 h-px bg-sky-400/70 shadow-[0_0_12px_2px_rgba(14,165,233,0.45)]" />
          <ScanLine className="absolute right-2 top-2 text-sky-400" style={{ width: 15, height: 15 }} />
        </Card>
        <div className="flex flex-col items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 shadow-sm">
            <Sparkles className="text-violet-500" style={{ width: 13, height: 13 }} />
            <span className="text-[12px] font-extrabold text-amber-500">Risk B</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 shadow-sm">
            <AlertTriangle className="text-red-400" style={{ width: 13, height: 13 }} />
            <span className="text-[12px] font-bold text-[#0A2540]/50">×2</span>
          </span>
        </div>
        <div className="flex flex-col gap-2.5">
          {[true, true, false].map((ok, i) => (
            <div key={i} className="flex items-center gap-2">
              <Ava text={["R", "N", "E"][i]} color={ok ? NAVY : "#94A3B8"} size={28} />
              {ok
                ? <Check className="text-emerald-500" style={{ width: 15, height: 15 }} />
                : <Timer className="text-amber-500" style={{ width: 15, height: 15 }} />}
            </div>
          ))}
        </div>
      </div>
    </Vignette>
  )
}

/** Analytics: KPI Arena podium + AI insight card. */
function AnalyticsScene() {
  return (
    <Vignette tint="#F59E0B">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <div className="flex items-end gap-2">
          {[
            { h: 64, t: "N", c: "#94A3B8" },
            { h: 92, t: "R", c: "#F59E0B" },
            { h: 48, t: "E", c: "#CBD5E1" },
          ].map((p, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              {i === 1 && <Trophy className="text-amber-500" style={{ width: 18, height: 18 }} />}
              <Ava text={p.t} color={p.c === "#F59E0B" ? NAVY : p.c} size={30} />
              <span className="w-12 rounded-t-lg" style={{ height: p.h, backgroundColor: p.c }} />
            </div>
          ))}
        </div>
        <Card className="w-[230px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Lightbulb className="text-amber-500" style={{ width: 16, height: 16 }} />
            <AiChip />
          </div>
          <div className="space-y-1.5">
            <Line w="90%" /><Line w="70%" light />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-2">
            <span className="text-[12px] font-bold text-amber-600">14d</span>
            <Line w="45%" light />
            <ArrowRight className="ml-auto text-amber-500" style={{ width: 14, height: 14 }} />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <FileBarChart className="text-[#0A2540]/40" style={{ width: 14, height: 14 }} />
            <Line w="60%" light />
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** VoIP: call wave → transcript with AI tags → ticket. */
function VoipScene() {
  return (
    <Vignette tint="#10B981">
      <div className="flex items-center justify-center gap-4">
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-md">
            <PhoneCall style={{ width: 20, height: 20 }} />
          </span>
          <div className="flex items-end gap-0.5">
            {[10, 22, 14, 28, 18, 24, 12].map((h, i) => (
              <span key={i} className="w-1 rounded-full bg-emerald-500/60" style={{ height: h }} />
            ))}
          </div>
        </div>
        <ArrowRight className="text-[#0A2540]/25" style={{ width: 22, height: 22 }} />
        <Card className="w-[260px] p-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2"><Ava text="C" color="#10B981" size={24} /><Line w="70%" light /></div>
            <div className="flex items-center gap-2"><Ava text="R" color={NAVY} size={24} /><Line w="55%" light /></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <AiChip />
            <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-[11px] font-bold text-red-500">!</span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-600">☺</span>
            <span className="ml-auto flex items-center gap-1 rounded-full bg-[#0A2540] px-2.5 py-1 text-[11px] font-bold text-white">
              <Headphones style={{ width: 11, height: 11 }} /> →
            </span>
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** Social Monitoring: outside posts → reply queue → PDF report. */
function SocialScene() {
  return (
    <Vignette tint="#E1306C">
      <div className="flex items-center justify-center gap-4">
        <div className="grid grid-cols-2 gap-2">
          {[Camera, Music2, Hash, Globe].map((I, i) => (
            <Card key={i} className={`flex h-16 w-16 flex-col items-center justify-center gap-1 ${i === 0 ? "ring-2 ring-pink-400" : "opacity-70"}`}>
              <I className="text-[#0A2540]/50" style={{ width: 16, height: 16 }} />
              <Line w={28} light />
            </Card>
          ))}
        </div>
        <ArrowRight className="text-[#0A2540]/25" style={{ width: 22, height: 22 }} />
        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center gap-2 p-3">
            <MessageSquare className="text-pink-500" style={{ width: 15, height: 15 }} />
            <Line w={70} />
            <AiChip />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <Scale className="text-[#0A2540]/45" style={{ width: 15, height: 15 }} />
            <Line w={54} light />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <FileBarChart className="text-pink-500" style={{ width: 15, height: 15 }} />
            <span className="text-[11px] font-extrabold text-[#0A2540]/60">PDF</span>
            <Line w={40} light />
          </Card>
        </div>
      </div>
    </Vignette>
  )
}

/** Loyalty: receipt at the POS → points → tier progress. */
function LoyaltyScene() {
  return (
    <Vignette tint="#D946EF">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[150px] p-4">
          <Receipt className="mb-2 text-fuchsia-500" style={{ width: 18, height: 18 }} />
          <div className="space-y-1.5"><Line /><Line w="70%" light /><Line w="85%" light /></div>
          <div className="mt-3 border-t border-dashed border-[#0A2540]/15 pt-2 text-right text-[13px] font-extrabold text-[#0A2540]/70">
            84 ₼
          </div>
        </Card>
        <div className="flex flex-col items-center gap-1">
          <span className="rounded-full bg-fuchsia-500 px-3 py-1 text-[13px] font-extrabold text-white shadow-md">+50</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#0A2540]/35">POS</span>
        </div>
        <Card className="w-[200px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Ava text="L" color="#D946EF" size={28} />
            <Line w="55%" />
            <Gift className="ml-auto text-fuchsia-500" style={{ width: 15, height: 15 }} />
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#0A2540]/40">
            <span>●</span><span className="text-fuchsia-500">●</span><span>●</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0A2540]/8">
            <span className="block h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-fuchsia-600" style={{ width: "64%" }} />
          </div>
          <div className="mt-2 flex justify-between">
            <Line w={34} light /><Line w={34} light /><Line w={34} light />
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** Route & Field: live map, route, photo check-in. */
function MtmScene() {
  return (
    <Vignette tint="#0EA5E9">
      <div className="flex items-center justify-center gap-4">
        <Card className="relative h-[210px] w-[250px] overflow-hidden bg-[#F0F6FB] p-0">
          <svg viewBox="0 0 250 210" className="absolute inset-0 h-full w-full">
            <path d="M20 180 C 70 150, 60 90, 120 80 S 220 60, 230 30" fill="none" stroke="#0EA5E9" strokeWidth="2.5" strokeDasharray="6 6" />
            <circle cx="20" cy="180" r="6" fill="#0EA5E9" />
            <circle cx="120" cy="80" r="6" fill="#0EA5E9" opacity="0.5" />
          </svg>
          <span className="absolute" style={{ left: 208, top: 8 }}>
            <MapPin className="text-red-500 drop-shadow" style={{ width: 26, height: 26 }} />
          </span>
          <span className="absolute rounded-full bg-white p-1.5 shadow" style={{ left: 104, top: 96 }}>
            <UserRound className="text-sky-600" style={{ width: 16, height: 16 }} />
          </span>
        </Card>
        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center gap-2 p-3">
            <ImageIcon className="text-sky-500" style={{ width: 15, height: 15 }} />
            <Line w={56} />
            <Check className="text-emerald-500" style={{ width: 14, height: 14 }} />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <RouteIcon className="text-sky-500" style={{ width: 15, height: 15 }} />
            <span className="text-[12px] font-bold text-[#0A2540]/60">12/14</span>
            <Line w={36} light />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <Trophy className="text-amber-500" style={{ width: 15, height: 15 }} />
            <Ava text="T" color="#0EA5E9" size={22} />
            <Ava text="F" color="#94A3B8" size={22} />
            <Ava text="V" color="#CBD5E1" size={22} />
          </Card>
        </div>
      </div>
    </Vignette>
  )
}

/* ─────────────────────────────── section ────────────────────────────────── */

const SCENES = [
  { key: "omni",      color: "#06B6D4", Scene: OmniScene },
  { key: "sales",     color: "#EF4444", Scene: SalesScene },
  { key: "crm",       color: "#3B82F6", Scene: CrmScene },
  { key: "support",   color: "#8B5CF6", Scene: SupportScene },
  { key: "finance",   color: "#10B981", Scene: FinanceScene },
  { key: "marketing", color: "#F97316", Scene: MarketingScene },
  { key: "contracts", color: "#0EA5E9", Scene: ContractsScene },
  { key: "analytics", color: "#F59E0B", Scene: AnalyticsScene },
  { key: "voip",      color: "#10B981", Scene: VoipScene },
  { key: "social",    color: "#E1306C", Scene: SocialScene },
  { key: "loyalty",   color: "#D946EF", Scene: LoyaltyScene },
  { key: "mtm",       color: "#0EA5E9", Scene: MtmScene },
] as const

export function ModuleScenes() {
  const tBar = useTranslations("marketing.statsBar")
  const t = useTranslations("marketing.scenes")

  return (
    <section id="modules" className="relative bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <AnimateIn className="mb-16 text-center lg:mb-20">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-[#001E3C]/40">{tBar("featuresCount")}</p>
          <h2 className="text-3xl font-bold tracking-tight text-[#001E3C] lg:text-4xl">{tBar("title")}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-[#001E3C]/60">{tBar("description")}</p>
        </AnimateIn>

        <div className="space-y-20 lg:space-y-24">
          {SCENES.map(({ key, color, Scene }, i) => (
            <AnimateIn key={key} delay={60}>
              <div className={`flex flex-col ${i % 2 ? "lg:flex-row-reverse" : "lg:flex-row"} items-center gap-8 lg:gap-14`}>
                <div className="w-full shrink-0 lg:w-[54%]">
                  <Scene />
                </div>
                <div className="w-full lg:w-[46%]">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color }}>
                    {t(`${key}.name`)}
                  </p>
                  <h3 className="text-2xl font-bold leading-snug text-[#001E3C] lg:text-[1.7rem]">
                    {t(`${key}.hook`)}
                  </h3>
                  <p className="mt-3 leading-relaxed text-[#001E3C]/60">{t(`${key}.desc`)}</p>
                  <ul className="mt-5 space-y-2.5">
                    {[1, 2, 3, 4].map((n) => (
                      <li key={n} className="flex items-start gap-2.5">
                        <Check className="mt-0.5 shrink-0" style={{ width: 16, height: 16, color }} />
                        <span className="text-sm text-[#001E3C]/60">{t(`${key}.p${n}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </AnimateIn>
          ))}
        </div>
      </div>
    </section>
  )
}
