"use client"

import { useEffect, useState } from "react"
import {
  AiAgentKnowledgeSourcesView,
  type AiAgentKnowledgeArticle,
} from "@/components/settings/ai-agent-page-view"

type KnowledgeResponse = {
  data?: {
    articles?: AiAgentKnowledgeArticle[]
    total?: number
  }
  error?: string
}

/** «Bilik mənbələri» for the signed-in tenant: its published articles, the AI's source of truth. */
export function AiAgentKnowledgeSources() {
  const [articles, setArticles] = useState<AiAgentKnowledgeArticle[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadKnowledgeSources() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch("/api/v1/kb?status=published&limit=5", {
          cache: "no-store",
        })
        const json = (await res.json().catch(() => ({}))) as KnowledgeResponse
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        if (cancelled) return
        setArticles(json.data?.articles ?? [])
        setTotal(json.data?.total ?? 0)
      } catch (err) {
        if (!cancelled) {
          setArticles([])
          setTotal(0)
          setError((err as Error)?.message || "Failed to load knowledge sources")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadKnowledgeSources()
    return () => {
      cancelled = true
    }
  }, [])

  return <AiAgentKnowledgeSourcesView articles={articles} total={total} loading={loading} error={error} />
}
