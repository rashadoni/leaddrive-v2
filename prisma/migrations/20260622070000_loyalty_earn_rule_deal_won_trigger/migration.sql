-- Add 'deal_won' to the LoyaltyEarnRule.trigger allow-list (deal-WON auto-earn).
-- A DISTINCT trigger (not 'purchase') by design: invoice-paid already awards a
-- 'purchase' rule, so a separate 'deal_won' trigger means a won deal and its
-- later paid invoice never double-award from the same rule — the tenant opts in
-- by creating a deal_won rule. Mirrors EARN_RULE_TRIGGERS in src/lib/loyalty/limits.ts.
ALTER TABLE "loyalty_earn_rules" DROP CONSTRAINT IF EXISTS "loyalty_earn_rules_trigger_check";
ALTER TABLE "loyalty_earn_rules"
  ADD CONSTRAINT "loyalty_earn_rules_trigger_check"
  CHECK ("trigger" IN (
    'purchase', 'deal_won', 'signup', 'referral', 'birthday', 'review', 'survey', 'custom'
  ));
