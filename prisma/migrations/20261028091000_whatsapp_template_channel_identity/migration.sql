-- The same template name/language can belong to different business numbers.
-- Preserve every existing row; only scope uniqueness to its saved channel.
CREATE UNIQUE INDEX "whatsapp_templates_org_channel_name_language_key"
  ON "whatsapp_templates"("organizationId", "channelConfigId", "name", "language");
DROP INDEX "whatsapp_templates_organizationId_name_language_key";
