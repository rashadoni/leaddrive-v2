import { describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  organization: { findUnique: vi.fn(), findFirst: vi.fn() },
  aiUsageLog: { aggregate: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))

import { isAiFeatureEnabled } from "@/lib/ai/budget"
import {
  featuresIncludeBrandProtectionOnly,
  SOCIAL_BRAND_PROTECTION_ONLY_FLAG,
} from "@/lib/social/brand-protection"
import { CHATBOT_CHANNEL_DISABLED_PREFIX, isChatbotChannelEnabled } from "@/lib/chatbot-engine"
import { featuresToModuleMap } from "@/lib/ai/advisor/capabilities"

/**
 * Прод 2026-08-03: у тенанта brandprotection список флагов оказался запакован в
 * строку (`"[\"ai\",...]"` вместо `["ai", ...]`). Узкая проверка
 * `Array.isArray(features)` отвечала на это «выключено», и ВСЯ автоматика ИИ
 * молча встала: 422 негативные находки без черновиков ответов, крон при этом
 * бодро рапортовал «ноль действий» — то есть тишина была неотличима от нормы.
 *
 * Эти тесты фиксируют терпимость к обеим формам хранения. Их падение означает,
 * что кто-то снова добавил узкую проверку.
 */
const FLAGS = [
  "ai",
  "social",
  "ai_auto_social_reply_shadow",
  SOCIAL_BRAND_PROTECTION_ONLY_FLAG,
  "chatbotAutoReply",
]
const AS_ARRAY = FLAGS
const AS_PACKED_STRING = JSON.stringify(FLAGS)

describe("feature flag shape tolerance", () => {
  it("resolves an AI feature flag from a packed string exactly like from an array", async () => {
    for (const features of [AS_ARRAY, AS_PACKED_STRING]) {
      mockPrisma.organization.findUnique.mockResolvedValue({ features })
      await expect(isAiFeatureEnabled("org-1", "ai_auto_social_reply_shadow")).resolves.toBe(true)
      await expect(isAiFeatureEnabled("org-1", "ai_auto_social_reply")).resolves.toBe(false)
    }
  })

  it("keeps brand-protection mode visible in both shapes", () => {
    expect(featuresIncludeBrandProtectionOnly(AS_ARRAY)).toBe(true)
    expect(featuresIncludeBrandProtectionOnly(AS_PACKED_STRING)).toBe(true)
    expect(featuresIncludeBrandProtectionOnly(JSON.stringify(["social"]))).toBe(false)
  })

  it("keeps chatbot channels enabled in both shapes and still honours the per-channel opt-out", () => {
    expect(isChatbotChannelEnabled(AS_ARRAY, "whatsapp")).toBe(true)
    expect(isChatbotChannelEnabled(AS_PACKED_STRING, "whatsapp")).toBe(true)
    expect(isChatbotChannelEnabled(
      JSON.stringify([...FLAGS, `${CHATBOT_CHANNEL_DISABLED_PREFIX}whatsapp`]),
      "whatsapp",
    )).toBe(false)
  })

  it("builds the advisor module map from a packed string", () => {
    expect(featuresToModuleMap(AS_PACKED_STRING)).toMatchObject({ social: true, ai: true })
    // Отсутствие флагов — по-прежнему «нечего сказать», а не пустая карта.
    expect(featuresToModuleMap(null)).toBeUndefined()
  })

  it("treats malformed values as no flags instead of throwing", async () => {
    for (const features of ["not json at all", "{}", 42, null]) {
      mockPrisma.organization.findUnique.mockResolvedValue({ features })
      await expect(isAiFeatureEnabled("org-1", "ai")).resolves.toBe(false)
    }
  })
})
