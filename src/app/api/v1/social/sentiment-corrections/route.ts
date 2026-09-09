import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { classifyAutomaticReviewText } from "@/lib/social/automatic-review-triage"
import {
  OPERATOR_SENTIMENT_SOURCE,
  operatorSentimentCorrection,
} from "@/lib/social/operator-sentiment"

/**
 * Отчёт по правкам тональности, сделанным вручную.
 *
 * Зачем. Владелец спросил, происходит ли обучение, когда он меняет негатив на
 * нейтрал. Обучения модели нет и не обещается, но правки — это размеченный
 * человеком набор, и по нему видно, согласны ли ТЕКУЩИЕ правила с оператором.
 * Число расхождений и есть измеримый ответ: оно должно падать после каждой
 * правки правил, а не оставаться на месте.
 *
 * Здесь же список расхождений — это готовая работа по правилам, а не абстрактная
 * «точность».
 */
const MAX_SCAN = 500
const MAX_SAMPLES = 20

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const limit = Math.max(1, Math.min(
    Number.parseInt(req.nextUrl.searchParams.get("limit") || "200", 10) || 200,
    MAX_SCAN,
  ))

  const corrected = await prisma.socialMention.findMany({
    where: {
      organizationId: auth.orgId,
      purgedAt: null,
      sourceMetadata: {
        path: ["socialTriage", "sentimentSource"],
        equals: OPERATOR_SENTIMENT_SOURCE,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true, platform: true, text: true, sentiment: true,
      contentKind: true, sourceMetadata: true, url: true,
    },
  })

  const byDirection: Record<string, number> = {}
  const disagreements: Array<{
    id: string
    platform: string
    operator: string | null
    classifier: string
    evidence: string | null
    text: string
    url: string | null
  }> = []
  let agrees = 0
  let unknownToClassifier = 0

  for (const mention of corrected) {
    const correction = operatorSentimentCorrection(mention.sourceMetadata)
    const direction = `${correction?.before ?? "нет"}→${correction?.after ?? mention.sentiment ?? "нет"}`
    byDirection[direction] = (byDirection[direction] ?? 0) + 1

    // Правила прогоняются БЕЗ подсказки сохранённой тональности: иначе они
    // просто повторили бы правку оператора и согласие было бы всегда полным.
    const verdict = classifyAutomaticReviewText(mention.text, null)
    if (verdict.classification === "unknown") {
      unknownToClassifier += 1
      continue
    }
    // Соболезнование и мусор правила помечают как «не про риск» — оператор
    // выражает то же самое, снимая негатив.
    const classifierSentiment = verdict.classification === "irrelevant"
      ? "neutral"
      : verdict.sentiment
    if (classifierSentiment === (correction?.after ?? mention.sentiment)) {
      agrees += 1
      continue
    }
    if (disagreements.length < MAX_SAMPLES) {
      disagreements.push({
        id: mention.id,
        platform: mention.platform,
        operator: correction?.after ?? mention.sentiment,
        classifier: String(classifierSentiment),
        evidence: verdict.classifierEvidence,
        text: mention.text.replace(/\s+/g, " ").slice(0, 200),
        url: mention.url,
      })
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      total: corrected.length,
      byDirection,
      classifier: {
        agrees,
        disagrees: corrected.length - agrees - unknownToClassifier,
        // «Правила не знают» — не ошибка: такие тексты уходят на разбор ИИ.
        unknownToRules: unknownToClassifier,
      },
      disagreements,
    },
  })
})
