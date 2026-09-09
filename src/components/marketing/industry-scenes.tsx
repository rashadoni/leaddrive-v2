"use client"

/**
 * Industry clouds page section — same storytelling system as ModuleScenes
 * (hook + scenario + verified bullets + language-neutral vignette), one row
 * per industry cloud. Facts per cloud come straight from nav-items.ts:
 * health (patients/encounters/care plans/providers), insurance (policyholders/
 * policies/claims/beneficiaries), public sector (citizens/cases/licenses/
 * grants), media (subscribers/content/ad campaigns), energy (customers/
 * metering/outages/service calls). A vignette may simplify, never invent.
 */

import { useTranslations } from "next-intl"
import Link from "next/link"
import { AnimateIn } from "./animate-in"
import { Vignette, Ava, Card, Line, AiChip } from "./module-scenes"
import {
  Check, ArrowRight, HeartPulse, Stethoscope, ClipboardList,
  Umbrella, FileCheck, Landmark, FileBadge, Coins,
  Tv2, PlaySquare, Megaphone, Flame, Gauge, Wrench, Zap,
  CalendarDays, UserRound,
} from "lucide-react"


/* ─────────────────────────────── vignettes ──────────────────────────────── */

/** Health: patient card → encounters timeline → care plan checklist. */
function HealthScene() {
  return (
    <Vignette tint="#E11D48">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[210px] p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <Ava text="P" color="#E11D48" size={34} />
            <div className="flex-1 space-y-1.5">
              <Line w="70%" />
              <Line w="45%" light />
            </div>
            <HeartPulse className="text-rose-500" style={{ width: 18, height: 18 }} />
          </div>
          {[CalendarDays, Stethoscope, CalendarDays].map((I, i) => (
            <div key={i} className="flex items-center gap-2 border-t border-[#0A2540]/6 py-2">
              <I className="text-[#0A2540]/45" style={{ width: 14, height: 14 }} />
              <Line w={i === 1 ? "58%" : "42%"} light />
              {i < 2 && <Check className="ml-auto text-emerald-500" style={{ width: 14, height: 14 }} />}
            </div>
          ))}
        </Card>
        <ArrowRight className="text-[#0A2540]/25" style={{ width: 22, height: 22 }} />
        <Card className="w-[190px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <ClipboardList className="text-rose-500" style={{ width: 16, height: 16 }} />
            <Line w="55%" />
          </div>
          {[true, true, false].map((ok, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded ${ok ? "bg-emerald-500" : "border border-[#0A2540]/20"}`}
              >
                {ok && <Check className="text-white" style={{ width: 11, height: 11 }} />}
              </span>
              <Line w={ok ? "70%" : "55%"} light={!ok} />
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2">
            <UserRound className="text-[#0A2540]/40" style={{ width: 14, height: 14 }} />
            <Line w="48%" light />
          </div>
        </Card>
      </div>
    </Vignette>
  )
}

/** Insurance: policy card → claim pipeline → beneficiaries. */
function InsuranceScene() {
  return (
    <Vignette tint="#0891B2">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-4">
          <Card className="w-[190px] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Umbrella className="text-cyan-600" style={{ width: 17, height: 17 }} />
              <Line w="60%" />
            </div>
            <Line w="80%" light />
            <div className="mt-3 flex items-center justify-between">
              <Ava text="S" color="#0891B2" size={26} />
              <span className="rounded-full bg-cyan-600/10 px-2 py-0.5 text-[11px] font-bold text-cyan-700">№ 2107</span>
            </div>
          </Card>
          <div className="flex flex-col gap-2">
            {["V", "L"].map((t, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Ava text={t} color={i ? "#94A3B8" : "#0891B2"} size={24} />
                <Line w={34} light />
              </div>
            ))}
          </div>
        </div>
        {/* claim pipeline */}
        <Card className="flex w-full max-w-[430px] items-center justify-between p-3.5">
          {[
            { icon: FileCheck, done: true },
            { icon: ClipboardList, done: true },
            { icon: Coins, done: false },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full"
                style={{ backgroundColor: s.done ? "#0891B2" : "#0A254014", color: s.done ? "#fff" : "#0A254066" }}
              >
                <s.icon style={{ width: 15, height: 15 }} />
              </span>
              {i < 2 && <span className="h-0.5 w-10 rounded-full sm:w-16" style={{ backgroundColor: i === 0 ? "#0891B2" : "#0A254020" }} />}
            </div>
          ))}
          <span className="text-[13px] font-extrabold text-cyan-700">72h</span>
        </Card>
      </div>
    </Vignette>
  )
}

/** Public sector: citizen case moves stages, license + grant tracked. */
function PublicSectorScene() {
  return (
    <Vignette tint="#7C3AED">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[210px] p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <Ava text="V" color="#7C3AED" size={32} />
            <div className="flex-1 space-y-1.5">
              <Line w="68%" />
              <Line w="40%" light />
            </div>
            <Landmark className="text-violet-600" style={{ width: 17, height: 17 }} />
          </div>
          <div className="flex items-center gap-1.5">
            {[true, true, false, false].map((ok, i) => (
              <span key={i} className="h-2 flex-1 rounded-full" style={{ backgroundColor: ok ? "#7C3AED" : "#0A254014" }} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-[#0A2540]/40">
            <span>2/4</span>
            <Line w={60} light />
          </div>
        </Card>
        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center gap-2 p-3">
            <FileBadge className="text-violet-600" style={{ width: 15, height: 15 }} />
            <Line w={58} />
            <Check className="text-emerald-500" style={{ width: 14, height: 14 }} />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <Coins className="text-violet-600" style={{ width: 15, height: 15 }} />
            <div className="w-[90px]">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#0A2540]/8">
                <span className="block h-full rounded-full bg-violet-600" style={{ width: "45%" }} />
              </div>
            </div>
            <span className="text-[11px] font-bold text-violet-600">45%</span>
          </Card>
        </div>
      </div>
    </Vignette>
  )
}

/** Media: subscriber base → content library → ad campaign ROI. */
function MediaScene() {
  return (
    <Vignette tint="#DB2777">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[170px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Tv2 className="text-pink-600" style={{ width: 16, height: 16 }} />
            <Line w="52%" />
          </div>
          <div className="flex items-center gap-1.5">
            {["A", "N", "G"].map((t, i) => (
              <Ava key={t} text={t} color={["#DB2777", "#94A3B8", "#CBD5E1"][i]} size={26} />
            ))}
            <span className="text-[12px] font-extrabold text-pink-600">+</span>
          </div>
          <div className="mt-3 flex h-9 items-end gap-1">
            {[35, 48, 44, 62, 80].map((h, i) => (
              <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#DB2777" : "#DB277733" }} />
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className={`flex h-14 w-14 items-center justify-center ${i === 0 ? "ring-2 ring-pink-400" : "opacity-70"}`}>
              <PlaySquare className="text-[#0A2540]/45" style={{ width: 16, height: 16 }} />
            </Card>
          ))}
        </div>
        <Card className="w-[150px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Megaphone className="text-pink-600" style={{ width: 15, height: 15 }} />
            <Line w="45%" />
          </div>
          <div className="text-lg font-extrabold text-emerald-500">3.1×</div>
          <Line w="70%" light />
        </Card>
      </div>
    </Vignette>
  )
}

/** Energy: meter reading → outage alert → service crew dispatched. */
function EnergyScene() {
  return (
    <Vignette tint="#EA580C">
      <div className="flex items-center justify-center gap-4 lg:gap-6">
        <Card className="w-[180px] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Gauge className="text-orange-600" style={{ width: 17, height: 17 }} />
            <Line w="50%" />
          </div>
          <div className="font-mono text-xl font-extrabold tracking-widest text-[#0A2540]/80">04 218</div>
          <div className="mt-2 flex h-8 items-end gap-1">
            {[30, 45, 38, 52, 44, 60].map((h, i) => (
              <span key={i} className="flex-1 rounded-t bg-orange-500/40" style={{ height: `${h}%` }} />
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-2.5">
          <Card className="flex items-center gap-2 border-amber-300 p-3">
            <Flame className="text-amber-500" style={{ width: 15, height: 15 }} />
            <Line w={64} />
            <span className="ml-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-600">!</span>
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <Wrench className="text-orange-600" style={{ width: 15, height: 15 }} />
            <Ava text="B" color="#EA580C" size={24} />
            <ArrowRight className="text-[#0A2540]/30" style={{ width: 14, height: 14 }} />
            <Zap className="text-emerald-500" style={{ width: 15, height: 15 }} />
          </Card>
          <Card className="flex items-center gap-2 p-3">
            <AiChip label="24/7" />
            <Line w={52} light />
          </Card>
        </div>
      </div>
    </Vignette>
  )
}

/* ─────────────────────────────── section ────────────────────────────────── */

const CLOUDS = [
  { key: "health",       color: "#E11D48", Scene: HealthScene },
  { key: "insurance",    color: "#0891B2", Scene: InsuranceScene },
  { key: "publicSector", color: "#7C3AED", Scene: PublicSectorScene },
  { key: "media",        color: "#DB2777", Scene: MediaScene },
  { key: "energy",       color: "#EA580C", Scene: EnergyScene },
] as const

export function IndustryScenes() {
  const t = useTranslations("marketing.industries")

  return (
    <section className="relative bg-white py-20 lg:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <AnimateIn className="mb-16 text-center lg:mb-20">
          <p className="mb-3 text-sm font-medium uppercase tracking-widest text-[#001E3C]/40">{t("eyebrow")}</p>
          <h1 className="text-balance text-3xl font-bold tracking-tight text-[#001E3C] lg:text-5xl">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-[#001E3C]/60">{t("subtitle")}</p>
        </AnimateIn>

        <div className="space-y-20 lg:space-y-24">
          {CLOUDS.map(({ key, color, Scene }, i) => (
            <AnimateIn key={key} delay={60}>
              <div className={`flex flex-col ${i % 2 ? "lg:flex-row-reverse" : "lg:flex-row"} items-center gap-8 lg:gap-14`}>
                <div className="w-full shrink-0 lg:w-[54%]">
                  <Scene />
                </div>
                <div className="w-full lg:w-[46%]">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color }}>
                    {t(`${key}.name`)}
                  </p>
                  <h2 className="text-2xl font-bold leading-snug text-[#001E3C] lg:text-[1.7rem]">
                    {t(`${key}.hook`)}
                  </h2>
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

        <AnimateIn delay={200} className="mt-16 text-center">
          <Link
            href="/demo"
            className="group inline-flex items-center gap-2 rounded-full bg-[#EA580C] px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-[#EA580C]/25 transition-all hover:bg-[#EA580C]/90 hover:shadow-[#EA580C]/40"
          >
            {t("cta")}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </AnimateIn>
      </div>
    </section>
  )
}
