-- M2-4a: MtmExternalIdMap — mapping table between internal MTM IDs and external 1C ERP IDs

CREATE TABLE "mtm_external_id_maps" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType"     TEXT NOT NULL,
    "entityId"       TEXT NOT NULL,
    "erpId"          TEXT NOT NULL,
    "syncedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_external_id_maps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mtm_external_id_maps_entityId_entityType_organizationId_key"
    ON "mtm_external_id_maps"("entityId", "entityType", "organizationId");

CREATE INDEX "mtm_external_id_maps_organizationId_entityType_idx"
    ON "mtm_external_id_maps"("organizationId", "entityType");

ALTER TABLE "mtm_external_id_maps"
    ADD CONSTRAINT "mtm_external_id_maps_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
