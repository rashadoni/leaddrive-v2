"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Brain, RefreshCw, ChevronDown, ChevronRight, AlertCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAiAnalysis, useRefreshAiAnalysis } from "@/lib/cost-model/hooks"
import { sanitizeRichHtml } from "@/lib/sanitize"
import { markdownToHtml } from "@/lib/simple-markdown"

interface AIObservationsProps {
  tab: string
}

export function AIObservations({ tab }: AIObservationsProps) {
  const t = useTranslations("profitability")
  const [enabled, setEnabled] = useState(false)
  const [showThinking, setShowThinking] = useState(false)

  const { data, isLoading, isError, error } = useAiAnalysis(tab, { enabled })
  const refreshMutation = useRefreshAiAnalysis()

  const handleAnalyze = () => {
    setEnabled(true)
  }

  const handleRefresh = () => {
    refreshMutation.mutate({ tab, lang: "ru" })
  }

  const isRefreshing = refreshMutation.isPending

  // Use mutation result if available, otherwise query result
  const result = refreshMutation.data || data

  return (
    <Card className="ai-card">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-[hsl(var(--ai-from))]" />
          <span className="ai-pulse-dot" />
          {t("aiAnalysis")}
          {result?.cached && (
            <Badge variant="outline" className="text-[10px] ml-1">
              Cached
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {!enabled && !result && (
            <Button variant="default" size="sm" onClick={handleAnalyze}>
              <Brain className="h-4 w-4 mr-1" />
              {t("aiAnalysis")}
            </Button>
          )}
          {(enabled || result) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
              {t("aiRefresh")}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Not yet requested */}
        {!enabled && !result && !isLoading && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <Brain className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>{t("aiNotStarted")}</p>
            <p className="text-xs mt-1">{t("aiClickToStart")}</p>
          </div>
        )}

        {/* Loading state */}
        {(isLoading || isRefreshing) && !result && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <div className="relative inline-block mb-4">
              <Brain className="h-10 w-10 animate-pulse" />
              <div className="absolute -top-1 -right-1 h-3 w-3 bg-violet-500 rounded-full animate-ping" />
            </div>
            <p className="font-medium">{t("aiThinking")}</p>
            <p className="text-xs mt-1 text-muted-foreground">
              {t("aiAnalyzingData")}
            </p>
          </div>
        )}

        {/* Error state */}
        {isError && !result && (
          <div className="text-center py-8 text-red-600 text-sm">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-60" />
            <p className="font-medium">{t("aiErrorOccurred")}</p>
            <p className="text-xs mt-1 text-muted-foreground">
              {error instanceof Error ? error.message : t("aiTryAgain")}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={handleAnalyze}>
              {t("aiRetry")}
            </Button>
          </div>
        )}

        {/* Refresh error */}
        {refreshMutation.isError && (
          <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-950 text-red-600 text-xs">
            {t("aiRefreshError")}: {refreshMutation.error instanceof Error ? refreshMutation.error.message : t("aiUnknownError")}
          </div>
        )}

        {/* Analysis result */}
        {result?.analysis && (
          <div className="space-y-4">
            {/* Main analysis content */}
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(markdownToHtml(result.analysis)) }}
            />

            {/* Thinking section (collapsible) */}
            {result.thinking && (
              <div className="border-t pt-3 mt-4">
                <button
                  onClick={() => setShowThinking(!showThinking)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showThinking ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {t("aiThinkingProcess")}
                </button>
                {showThinking && (
                  <div className="mt-2 p-3 rounded bg-muted/50 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                    {result.thinking}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <p className="text-xs text-muted-foreground text-center pt-2 border-t">
              {t("aiPoweredBy")} {result.cached ? "(cached)" : ""}
              {isRefreshing && ` — ${t("aiRefreshing")}`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
