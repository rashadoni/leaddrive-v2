"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, BookOpen, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ChannelReplyMatrix } from "@/components/settings/channel-reply-matrix";
import { InboxAgentEditor } from "@/components/settings/inbox-agent-editor";
import { InboxFollowupSettings } from "@/components/settings/inbox-followup-settings";
import { InboxEscalationKeywords } from "@/components/settings/inbox-escalation-keywords";
import { HelpButton } from "@/components/help/help-button";

type KnowledgeArticle = {
  id: string;
  title: string;
  content?: string | null;
  status: string;
  tags?: string[];
  updatedAt: string;
  category?: { name?: string | null } | null;
};

type KnowledgeResponse = {
  data?: {
    articles?: KnowledgeArticle[];
    total?: number;
  };
  error?: string;
};

/**
 * Omni-channel AI agent — the Communication group's own AI settings section.
 * Simplified 2026-07: the actual controls (who replies per channel, the agent
 * persona, follow-ups, escalation keywords) come FIRST; the knowledge base — the
 * AI's source of truth — sits below them. The old onboarding wall (setup hero +
 * explainer cards) is gone; the controls are self-explanatory now.
 */
export default function InboxAiAgentPage() {
  const t = useTranslations("settings");
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>([]);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  const topKnowledgeArticles = useMemo(
    () => knowledgeArticles.slice(0, 5),
    [knowledgeArticles],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledgeSources() {
      setKnowledgeLoading(true);
      setKnowledgeError(null);
      try {
        const res = await fetch("/api/v1/kb?status=published&limit=5", {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as KnowledgeResponse;
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setKnowledgeArticles(json.data?.articles ?? []);
        setKnowledgeTotal(json.data?.total ?? 0);
      } catch (err) {
        if (!cancelled) {
          setKnowledgeArticles([]);
          setKnowledgeTotal(0);
          setKnowledgeError(
            (err as Error)?.message || "Failed to load knowledge sources",
          );
        }
      } finally {
        if (!cancelled) setKnowledgeLoading(false);
      }
    }

    loadKnowledgeSources();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          {t("aiAgentTitle")}
          <HelpButton slug="inbox-ai-agent" variant="label" />
        </h1>
        <p className="text-sm text-muted-foreground">{t("aiAgentDesc")}</p>
      </div>

      {/* Controls first — the actual settings, no onboarding wall above them. */}
      <ChannelReplyMatrix />
      <InboxAgentEditor />
      <InboxFollowupSettings />
      <InboxEscalationKeywords />

      {/* Knowledge base — the AI's source of truth, secondary to the controls above. */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t("aiAgentKnowledgeTitle")}</h2>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {knowledgeTotal} {t("aiAgentKnowledgePublished")}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("aiAgentKnowledgeDesc")}
            </p>
            <div className="mt-4 rounded-xl border bg-background/60 p-3">
              {knowledgeLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("aiAgentKnowledgeLoading")}
                </div>
              ) : knowledgeError ? (
                <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t("aiAgentKnowledgeError")}</span>
                </div>
              ) : topKnowledgeArticles.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t("aiAgentKnowledgeEmptyTitle")}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t("aiAgentKnowledgeEmptyDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {topKnowledgeArticles.map((article) => (
                    <Link
                      key={article.id}
                      href={`/knowledge-base/${article.id}`}
                      className="block rounded-lg border border-transparent px-2.5 py-2 transition hover:border-primary/20 hover:bg-primary/5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">
                          {article.title}
                        </span>
                        {article.category?.name && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {article.category.name}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {article.content || t("aiAgentKnowledgeNoPreview")}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <Link
              href="/knowledge-base"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
            >
              {t("aiAgentKnowledgeManage")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
