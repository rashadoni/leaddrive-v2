"use client"

import { useRef } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShimmerButton } from "@/components/ui/shimmer-button"
import { AnimatedGradientText } from "@/components/ui/animated-gradient-text"
import { MagicCard } from "@/components/ui/magic-card"
import { TypingAnimation } from "@/components/ui/typing-animation"
import { AnimatedBeam } from "@/components/ui/animated-beam"
import {
  Palette,
  Type,
  Image,
  Layers,
  Sparkles,
  Zap,
  Globe,
  Database,
  Monitor,
} from "lucide-react"

function AnimatedBeamDemo() {
  const containerRef = useRef<HTMLDivElement>(null!)
  const fromRef = useRef<HTMLDivElement>(null!)
  const toRef = useRef<HTMLDivElement>(null!)
  const midRef = useRef<HTMLDivElement>(null!)

  return (
    <div
      ref={containerRef}
      className="relative flex h-[200px] w-full items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-10"
    >
      <div ref={fromRef} className="z-10 flex size-12 items-center justify-center rounded-full border-2 bg-background shadow-sm">
        <Globe className="size-5 text-muted-foreground" />
      </div>
      <div ref={midRef} className="z-10 flex size-12 items-center justify-center rounded-full border-2 bg-background shadow-sm">
        <Zap className="size-5 text-accent" />
      </div>
      <div ref={toRef} className="z-10 flex size-12 items-center justify-center rounded-full border-2 bg-background shadow-sm">
        <Database className="size-5 text-primary" />
      </div>
      <AnimatedBeam containerRef={containerRef} fromRef={fromRef} toRef={midRef} gradientStartColor="hsl(175, 86%, 33%)" gradientStopColor="hsl(207, 53%, 24.5%)" />
      <AnimatedBeam containerRef={containerRef} fromRef={midRef} toRef={toRef} gradientStartColor="hsl(207, 53%, 24.5%)" gradientStopColor="hsl(175, 86%, 33%)" />
    </div>
  )
}

const colorTokens = [
  { name: "Primary", var: "--primary", hsl: "207 53% 24.5%", desc: "Dark Navy" },
  { name: "Accent", var: "--accent", hsl: "175 86% 33%", desc: "Teal" },
  { name: "Background", var: "--background", hsl: "210 20% 98%", desc: "Near White" },
  { name: "Foreground", var: "--foreground", hsl: "207 53% 15%", desc: "Body Text" },
  { name: "Muted", var: "--muted", hsl: "210 25% 94%", desc: "Secondary BG" },
  { name: "Destructive", var: "--destructive", hsl: "0 84.2% 60.2%", desc: "Error Red" },
  { name: "Border", var: "--border", hsl: "214 25% 88%", desc: "Dividers" },
  { name: "Ring", var: "--ring", hsl: "175 86% 33%", desc: "Focus Ring" },
]

export default function DesignCheckPage() {
  const t = useTranslations("designCheck")
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="size-6 text-accent" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary">Nano-Banana</Badge>
          <Badge variant="secondary">UI UX Pro Max</Badge>
          <Badge variant="secondary">21st.dev</Badge>
        </div>
      </div>

      <Tabs defaultValue="components" className="space-y-4">
        <TabsList>
          <TabsTrigger value="components" className="gap-1.5">
            <Layers className="size-4" /> {t("tabs.components")}
          </TabsTrigger>
          <TabsTrigger value="tokens" className="gap-1.5">
            <Palette className="size-4" /> {t("tabs.tokens")}
          </TabsTrigger>
          <TabsTrigger value="generation" className="gap-1.5">
            <Image className="size-4" /> {t("tabs.generation")}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: 21st.dev Animated Components */}
        <TabsContent value="components" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Shimmer Button */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ShimmerButton</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <ShimmerButton
                  shimmerColor="hsl(175, 86%, 33%)"
                  background="hsl(207, 53%, 24.5%)"
                  borderRadius="8px"
                >
                  <span className="text-sm font-medium text-white">
                    LeadDrive Pro
                  </span>
                </ShimmerButton>
                <p className="text-xs text-muted-foreground text-center">
                  {t("shimmerDesc")}
                </p>
              </CardContent>
            </Card>

            {/* Animated Gradient Text */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">AnimatedGradientText</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <AnimatedGradientText>
                  <span className="inline animate-gradient bg-gradient-to-r from-[hsl(175,86%,33%)] via-[hsl(207,53%,24.5%)] to-[hsl(175,86%,33%)] bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent text-lg font-semibold">
                    CRM Intelligence
                  </span>
                </AnimatedGradientText>
                <p className="text-xs text-muted-foreground text-center">
                  {t("gradientDesc")}
                </p>
              </CardContent>
            </Card>

            {/* Magic Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">MagicCard</CardTitle>
              </CardHeader>
              <CardContent>
                <MagicCard
                  gradientColor="hsl(175, 86%, 33%)"
                  gradientOpacity={0.15}
                  className="p-6"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Monitor className="size-5 text-accent" />
                      <span className="font-semibold">{t("dashboardAnalytics")}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t("magicCardDesc")}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Badge>+12.5%</Badge>
                      <Badge variant="secondary">{t("companiesCount", { count: 241 })}</Badge>
                    </div>
                  </div>
                </MagicCard>
              </CardContent>
            </Card>

            {/* Typing Animation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">TypingAnimation</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <TypingAnimation
                  text={t("welcomeText")}
                  duration={80}
                  className="text-lg font-semibold text-foreground"
                />
                <p className="text-xs text-muted-foreground text-center">
                  {t("typingDesc")}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Animated Beam */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AnimatedBeam — Data Flow</CardTitle>
            </CardHeader>
            <CardContent>
              <AnimatedBeamDemo />
              <p className="text-xs text-muted-foreground text-center mt-3">
                {t("beamDesc")}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Design Tokens (UI UX Pro Max) */}
        <TabsContent value="tokens" className="space-y-6">
          {/* Color Palette */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="size-5" /> Color Palette
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {colorTokens.map((token) => (
                  <div key={token.var} className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                    <div
                      className="size-10 rounded-md border border-zinc-200 dark:border-zinc-700 shadow-sm shrink-0"
                      style={{ backgroundColor: `hsl(${token.hsl})` }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{token.name}</p>
                      <p className="text-xs text-muted-foreground">{token.desc}</p>
                      <code className="text-[10px] text-muted-foreground font-mono">
                        {token.var}
                      </code>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Typography */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Type className="size-5" /> Typography
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between border-b pb-2">
                  <span className="text-2xl font-bold">Page Title — Inter Bold 30px</span>
                  <code className="text-xs text-muted-foreground font-mono">text-2xl font-bold</code>
                </div>
                <div className="flex items-baseline justify-between border-b pb-2">
                  <span className="text-lg font-semibold">Section Title — Inter Semibold 18px</span>
                  <code className="text-xs text-muted-foreground font-mono">text-lg font-semibold</code>
                </div>
                <div className="flex items-baseline justify-between border-b pb-2">
                  <span className="text-base font-medium">Card Title — Inter Medium 16px</span>
                  <code className="text-xs text-muted-foreground font-mono">text-base font-medium</code>
                </div>
                <div className="flex items-baseline justify-between border-b pb-2">
                  <span className="text-sm">Body Text — Inter Regular 14px</span>
                  <code className="text-xs text-muted-foreground font-mono">text-sm</code>
                </div>
                <div className="flex items-baseline justify-between border-b pb-2">
                  <span className="text-xs text-muted-foreground">Caption — Inter 12px Muted</span>
                  <code className="text-xs text-muted-foreground font-mono">text-xs text-muted-foreground</code>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm">Code — JetBrains Mono 13px</span>
                  <code className="text-xs text-muted-foreground font-mono">font-mono text-sm</code>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Spacing & Radius */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spacing & Border Radius</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-center">
                  <div className="mx-auto mb-2 size-16 rounded-[var(--radius)] bg-primary/10 border border-zinc-200 dark:border-zinc-700" />
                  <p className="text-sm font-medium">--radius: 0.5rem</p>
                  <p className="text-xs text-muted-foreground">Default border radius</p>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-center">
                  <div className="mx-auto mb-2 flex h-16 items-center justify-center">
                    <div className="flex gap-1">
                      {[16, 24, 32].map((size) => (
                        <div
                          key={size}
                          className="bg-accent/20 border border-accent/40"
                          style={{ width: size, height: size, borderRadius: 4 }}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-sm font-medium">Gap: 1rem (16px)</p>
                  <p className="text-xs text-muted-foreground">Grid gap standard</p>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 text-center">
                  <div className="mx-auto mb-2 flex h-16 items-center justify-center">
                    <div className="rounded-lg border-2 border-dashed border-primary/30 px-6 py-3">
                      <span className="text-xs text-muted-foreground">24px padding</span>
                    </div>
                  </div>
                  <p className="text-sm font-medium">Card padding: 1.5rem</p>
                  <p className="text-xs text-muted-foreground">Standard card content</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Nano-Banana Image Generation */}
        <TabsContent value="generation" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Image className="size-5" /> Nano-Banana MCP — Gemini Image Generation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border-2 border-dashed border-accent/30 bg-accent/5 p-8 text-center">
                <Sparkles className="mx-auto size-12 text-accent/50 mb-4" />
                <h3 className="text-lg font-semibold mb-2">{t("imageGen.title")}</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  {t("imageGen.description")}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Badge variant="secondary">Gemini 2.5 Flash</Badge>
                  <Badge variant="secondary">Text-to-Image</Badge>
                  <Badge variant="secondary">Image Editing</Badge>
                  <Badge variant="secondary">Iterative Workflows</Badge>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
                  <h4 className="font-medium text-sm mb-1">{t("imageGen.mockups")}</h4>
                  <p className="text-xs text-muted-foreground">
                    {t("imageGen.mockupsDesc")}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
                  <h4 className="font-medium text-sm mb-1">{t("imageGen.editing")}</h4>
                  <p className="text-xs text-muted-foreground">
                    {t("imageGen.editingDesc")}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
                  <h4 className="font-medium text-sm mb-1">{t("imageGen.export")}</h4>
                  <p className="text-xs text-muted-foreground">
                    {t("imageGen.exportDesc")}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-xs font-mono text-muted-foreground">
                  # {t("mcpActivationHint1")}<br />
                  # {t("mcpActivationHint2")}<br />
                  # {t("mcpActivationHint3")}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
