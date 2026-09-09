ALTER TABLE "social_legal_policies"
  ALTER COLUMN "allowedCategories"
  SET DEFAULT ARRAY[
    'insult',
    'defamation',
    'false_accusation',
    'threat',
    'complaint',
    'reputation_risk'
  ]::TEXT[];

UPDATE "social_legal_policies"
SET
  "allowedCategories" = ARRAY[
    'insult',
    'defamation',
    'false_accusation',
    'threat',
    'complaint',
    'reputation_risk'
  ]::TEXT[],
  "policyVersion" = "policyVersion" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "allowedCategories" = ARRAY[
  'insult',
  'defamation',
  'false_accusation',
  'threat'
]::TEXT[];
