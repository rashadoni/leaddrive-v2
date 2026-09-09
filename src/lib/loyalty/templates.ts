/**
 * D8 Loyalty — one-click EARN-RULE templates (Slice 2 Loyalty Builder).
 *
 * Pre-built earn rules so a tenant goes empty → working program in a couple of
 * clicks instead of decoding "pointsRate vs pointsFlat". Mirrors the shape of
 * `src/lib/workflow-templates.ts`; applied via POST /api/v1/loyalty-templates,
 * which stamps each created rule with `metadata.templateId` for dedup (no
 * migration — reuses the existing LoyaltyEarnRule.metadata JSON column).
 *
 * Names/descriptions resolve via the `loyaltyTemplates` i18n namespace; the
 * `name` on each payload is an English fallback persisted as the rule name.
 *
 * To add a template:
 *  1. Append to LOYALTY_TEMPLATES below.
 *  2. Add loyaltyTemplates.items.{id}.(name|description) in all 3 message files.
 *  3. Map its `icon` (lucide-react name) in the builder UI.
 */
import type { EarnRuleTrigger } from "./limits"

/** A single earn rule a template creates — shape mirrors the validated
 *  POST /api/v1/loyalty-earn-rules body (templates are hardcoded-valid). */
export interface LoyaltyEarnRulePayload {
  /** English fallback, persisted as LoyaltyEarnRule.name. */
  name: string
  trigger: EarnRuleTrigger
  pointsRate?: number | null
  pointsFlat?: number | null
  minOrderAmount?: number | null
  productCategory?: string | null
  priority?: number
  applyTierMultiplier?: boolean
}

export interface LoyaltyTemplate {
  id: string
  /** Resolves under the `loyaltyTemplates` namespace: items.{id}.name */
  nameKey: string
  descriptionKey: string
  /** lucide-react icon name. */
  icon: string
  category: "earning" | "engagement"
  /** UI HINT (not POST behavior): the quick-start wizard also seeds the default
   *  tier ladder (via POST /api/v1/loyalty-tiers?seedDefaults=true) when true.
   *  The templates endpoint itself only creates earn rules. */
  seedTiers?: boolean
  earnRules: LoyaltyEarnRulePayload[]
}

export const LOYALTY_TEMPLATES: LoyaltyTemplate[] = [
  {
    id: "points-per-dollar",
    nameKey: "items.pointsPerDollar.name",
    descriptionKey: "items.pointsPerDollar.description",
    icon: "Coins",
    category: "earning",
    seedTiers: true,
    earnRules: [
      { name: "1 point per $1 spent", trigger: "purchase", pointsRate: 1, applyTierMultiplier: true, priority: 0 },
    ],
  },
  {
    id: "welcome-bonus",
    nameKey: "items.welcomeBonus.name",
    descriptionKey: "items.welcomeBonus.description",
    icon: "Gift",
    category: "engagement",
    earnRules: [
      { name: "Welcome bonus", trigger: "signup", pointsFlat: 500, applyTierMultiplier: false, priority: 10 },
    ],
  },
  {
    id: "birthday-bonus",
    nameKey: "items.birthdayBonus.name",
    descriptionKey: "items.birthdayBonus.description",
    icon: "Cake",
    category: "engagement",
    earnRules: [
      { name: "Birthday bonus", trigger: "birthday", pointsFlat: 100, applyTierMultiplier: false, priority: 10 },
    ],
  },
  {
    id: "referral-reward",
    nameKey: "items.referralReward.name",
    descriptionKey: "items.referralReward.description",
    icon: "Users",
    category: "engagement",
    earnRules: [
      { name: "Referral reward", trigger: "referral", pointsFlat: 250, applyTierMultiplier: false, priority: 10 },
    ],
  },
]

export function getLoyaltyTemplateById(id: string): LoyaltyTemplate | undefined {
  return LOYALTY_TEMPLATES.find((t) => t.id === id)
}
